/**
 * 研究ノートへの入口（棋譜を見ている画面から「研究ノートで開く」）。Web / Desktop 共通。
 *
 * 同じ元棋譜のノートが既にあればそれを開き、無ければ新しく作る。作ったノートはまず
 * 端末の中に保存され、ログイン中ならクラウドへも送られる。
 *
 * 保存層（同期エンジン）と API は呼び出し側が渡す（ui は保存層に依存しない）。ここでは、
 * 使う分だけの形（`StudyEntrySync` / `StudyEntryApi`）で受け取る。
 */

import {
    createStudyDocumentFromCsa,
    createStudyDocumentFromKifuTree,
    createStudyDocumentFromMoves,
    generateStudyId,
    getPositionService,
    isStudyUsiMove,
    type KifuTree,
    STUDY_MAX_PASSES_PER_SIDE,
    type StudyDocument,
    StudyLimitError,
    type StudyMeta,
    type StudyOrigin,
    studyLineFitsPassLimit,
    studyPassRightsForLine,
    validateStudyDocument,
} from "@shogi/app-core";
import type { RshogiGame } from "@shogi/match-client";
import { type StudyKifuSource, studyStartPositionError } from "./studyImport";

/** 入口が使う、同期エンジンの口（`@shogi/study-client` の `StudySync` が満たす）。 */
interface StudyEntrySync {
    findLocalByOrigin(origin: StudyOrigin): Promise<string | null>;
    /** ログイン中のセッション。未ログインなら null。 */
    getSession(): unknown;
    createStudy(doc: StudyDocument): Promise<unknown>;
}

/** 入口が使う、API の口（`@shogi/study-client` の `StudyApi` が満たす）。 */
interface StudyEntryApi {
    list(query: {
        originKind: StudyOrigin["kind"];
        originRef: string;
        limit: number;
    }): Promise<
        { ok: true; data: { studies: Array<{ id: string }> } } | { ok: false; status: number }
    >;
}

export interface StudyEntryDeps {
    sync: StudyEntrySync;
    /** クラウドにある同じ元棋譜のノートを探すのに使う。渡さなければ探さない（ログインの無い環境）。 */
    api?: StudyEntryApi;
    /** クラウドへの問い合わせでセッション切れ（401）が分かったときに呼ぶ。 */
    onUnauthorized?: () => void;
}

interface OpenOrCreateStudyOptions extends StudyEntryDeps {
    origin: StudyOrigin;
    /** 新しく作るときだけ呼ばれる。渡された ID で文書を作る。 */
    build: (studyId: string) => StudyDocument;
}

export interface OpenOrCreateStudyResult {
    studyId: string;
    /** 既にあったノートを開いた。 */
    existing: boolean;
}

/**
 * 同じ元棋譜のノートを探し、無ければ作る。
 *
 * 探す順は、端末の中 → （ログイン中なら）クラウド。クラウドに問い合わせられなかった
 * ときは新しく作る（あとでサーバーが同じ元棋譜のノートを返したら、同期エンジンが
 * 成果をそのノートへ統合する）。貼り付けた棋譜（`paste`）は毎回新しく作る。
 */
export async function openOrCreateStudy({
    origin,
    build,
    sync,
    api,
    onUnauthorized,
}: OpenOrCreateStudyOptions): Promise<OpenOrCreateStudyResult> {
    if (origin.kind !== "paste" && origin.ref !== null) {
        const localId = await sync.findLocalByOrigin(origin);
        if (localId !== null) return { studyId: localId, existing: true };
        if (api && sync.getSession() !== null) {
            const listed = await api.list({
                originKind: origin.kind,
                originRef: origin.ref,
                limit: 1,
            });
            // セッション切れなら、ログイン状態を取り直してもらう（ノートは新しく作って続ける）。
            if (!listed.ok && listed.status === 401) onUnauthorized?.();
            const found = listed.ok ? listed.data.studies[0] : undefined;
            if (found) return { studyId: found.id, existing: true };
        }
    }
    const doc = build(generateStudyId());
    explainLimits(doc);
    await sync.createStudy(doc);
    return { studyId: doc.id, existing: false };
}

/** 上限を超えた棋譜を取り込もうとしたときの説明。 */
const IMPORT_LIMIT_MESSAGE: Record<string, string> = {
    lineLength: "この棋譜は長すぎます（研究ノートにできるのは 1,024 手までです）。",
    nodesPerStudy: "この棋譜は局面が多すぎます（研究ノートにできるのは 2,000 局面までです）。",
    treeBytes: "この棋譜は大きすぎます（変化やコメントが多すぎます）。",
    commentBytes: "コメントの長すぎる手があります（1 つのコメントは約 1,300 文字までです）。",
};

/**
 * 作る前に、上限に収まっているか確かめる。超えていれば、どの上限かを説明して作らない
 * （作っても、クラウドに保存できないノートになるため）。
 */
function explainLimits(doc: StudyDocument): void {
    try {
        validateStudyDocument(doc);
    } catch (error) {
        if (error instanceof StudyLimitError) {
            throw new Error(
                IMPORT_LIMIT_MESSAGE[error.limit] ?? "この棋譜は研究ノートの上限を超えています。",
            );
        }
        throw error;
    }
}

/** 開始局面からの手順を、ルールどおりに再生できるか確かめる関数（既定は共通の PositionService）。 */
type ReplayMovesStrict = (
    sfen: string,
    moves: string[],
    options?: { passRights?: { sente: number; gote: number } },
) => Promise<{ applied: string[]; error?: string }>;

export interface StudyImportDeps extends StudyEntryDeps {
    replayMovesStrict?: ReplayMovesStrict;
}

/**
 * 貼り付けた棋譜の手順が、開始局面から実際に指せるかを確かめる。
 *
 * `createStudyDocumentFromMoves` は「駒がそこにあるか」程度しか見ない（歩を飛び越える角なども
 * 通ってしまう）ので、信頼できない入力は先にここを通す。指せない手があれば、何手目かを添えて断る。
 *
 * 指し手が無いとき（局面だけのノート）は、手順の再生では局面を確かめられないので、局面として
 * 成り立つこと（玉がそれぞれ 1 枚まで、駒の枚数が一組に収まる）を確かめてから、局面を読み込ませる。
 */
async function assertLegalLine(
    startSfen: string,
    moves: readonly string[],
    replay: ReplayMovesStrict | undefined,
): Promise<void> {
    const run: ReplayMovesStrict =
        replay ??
        ((sfen, line, options) => getPositionService().replayMovesStrict(sfen, line, options));
    if (moves.length === 0) {
        const reason = studyStartPositionError(startSfen);
        if (reason) throw new Error(`この局面は研究ノートにできません: ${reason}`);
        const loaded = await run(startSfen, []);
        if (loaded.error)
            throw new Error("この局面は研究ノートにできません（読み込めない局面です）");
        return;
    }
    if (!studyLineFitsPassLimit(startSfen, moves)) {
        throw new Error(
            `この棋譜はパスが多すぎます（1 つの手順で、先手・後手それぞれ ${STUDY_MAX_PASSES_PER_SIDE} 回まで）。`,
        );
    }
    // パスを含む手順は、パス権を有効にしないと再生できない（回数の決め方は `studyPassRightsForLine`）。
    const passRights = studyPassRightsForLine(startSfen, moves);
    const result = await run(startSfen, [...moves], passRights ? { passRights } : undefined);
    if (result.applied.length >= moves.length && !result.error) return;
    const index = Math.min(result.applied.length, moves.length - 1);
    throw new Error(
        `${index + 1} 手目（${moves[index]}）は指せない手です。棋譜を確かめてください。`,
    );
}

/** 棋譜ツリーの、ルートから末端までの手順をすべて挙げる。 */
function leafLines(tree: KifuTree): string[][] {
    const lines: string[][] = [];
    const stack: Array<{ nodeId: string; moves: string[] }> = [{ nodeId: tree.rootId, moves: [] }];
    while (stack.length > 0) {
        const item = stack.pop() as { nodeId: string; moves: string[] };
        const node = tree.nodes.get(item.nodeId);
        if (!node) continue;
        const moves = node.usiMove === null ? item.moves : [...item.moves, node.usiMove];
        if (node.children.length === 0) {
            if (moves.length > 0) lines.push(moves);
            continue;
        }
        for (const childId of node.children) stack.push({ nodeId: childId, moves });
    }
    return lines;
}

const RESULT_BY_WINNER = { sente: "WIN_BLACK", gote: "WIN_WHITE" } as const;

/** rshogi viewer の棋譜（Floodgate・大会・自己対局）のメタ情報を、研究ノートのメタにする。 */
function rshogiGameMeta(game: RshogiGame): StudyMeta {
    const { meta } = game;
    const result = meta.result?.winner ? RESULT_BY_WINNER[meta.result.winner] : undefined;
    return {
        blackName: meta.senteName,
        whiteName: meta.goteName,
        ...(meta.startedAtMs !== undefined
            ? { playedAt: new Date(meta.startedAtMs).toISOString() }
            : {}),
        ...(meta.source ? { venue: meta.source } : {}),
        ...(meta.event ? { event: meta.event } : {}),
        ...(result ? { result } : {}),
    };
}

/** rshogi viewer の単局から研究ノートを開く（対局時の評価値を `source` として取り込む）。 */
export function openStudyFromRshogiGame(
    game: RshogiGame,
    deps: StudyEntryDeps,
): Promise<OpenOrCreateStudyResult> {
    return openOrCreateStudy({
        ...deps,
        origin: { kind: "rshogi_csa", ref: game.meta.gameId },
        build: (id) =>
            createStudyDocumentFromCsa({
                id,
                csa: game.csa,
                origin: { kind: "rshogi_csa", ref: game.meta.gameId },
                title: `${game.meta.senteName} 対 ${game.meta.goteName}`,
                meta: rshogiGameMeta(game),
            }),
    });
}

export interface GameRecordForStudy {
    id: string;
    initialSfen: string;
    moves: string[];
    participants: Array<{ seat: "b" | "w" | null; displayNameSnapshot: string }>;
    startedAt: string | null;
    result: { winner: "b" | "w" | null; reason: string } | null;
}

/**
 * 自分の対局の棋譜が研究ノートにできるか。
 * 指し手があり、どの手も研究ノートに入れられる書式で（変則ルールのパスも入れられる）、パスの
 * 回数が解析できる範囲に収まっていること（対局の設定は、パス権の回数に上限を設けていない）。
 */
export function canOpenGameRecordAsStudy(
    game: Pick<GameRecordForStudy, "moves" | "initialSfen">,
): boolean {
    return (
        game.moves.length > 0 &&
        game.moves.every((move) => isStudyUsiMove(move)) &&
        studyLineFitsPassLimit(game.initialSfen, game.moves)
    );
}

/** 自分の対局の詳細から研究ノートを開く。 */
export function openStudyFromGameRecord(
    game: GameRecordForStudy,
    deps: StudyEntryDeps,
): Promise<OpenOrCreateStudyResult> {
    const black = game.participants.find((participant) => participant.seat === "b");
    const white = game.participants.find((participant) => participant.seat === "w");
    const names = [black?.displayNameSnapshot, white?.displayNameSnapshot].filter(
        (name): name is string => typeof name === "string" && name.trim() !== "",
    );
    const result =
        game.result?.winner === "b"
            ? "WIN_BLACK"
            : game.result?.winner === "w"
              ? "WIN_WHITE"
              : undefined;
    return openOrCreateStudy({
        ...deps,
        origin: { kind: "game_record", ref: game.id },
        build: (id) =>
            createStudyDocumentFromMoves({
                id,
                title: names.length === 2 ? `${names[0]} 対 ${names[1]}` : "自分の対局",
                origin: { kind: "game_record", ref: game.id },
                startSfen: game.initialSfen,
                moves: game.moves,
                meta: {
                    ...(black ? { blackName: black.displayNameSnapshot } : {}),
                    ...(white ? { whiteName: white.displayNameSnapshot } : {}),
                    ...(game.startedAt ? { playedAt: game.startedAt } : {}),
                    ...(result ? { result } : {}),
                },
            }),
    });
}

/**
 * 対局者名の無い棋譜の表題（例: 「取り込んだ棋譜（10/12）」）。あとから画面で変えられる。
 * 指し手の無いノート（局面だけ）は「局面の研究（10/12）」にする。
 */
function importedTitle(hasMoves: boolean, now: Date = new Date()): string {
    const date = `${now.getMonth() + 1}/${now.getDate()}`;
    return hasMoves ? `取り込んだ棋譜（${date}）` : `局面の研究（${date}）`;
}

/**
 * 貼り付け・ファイルの棋譜から研究ノートを作る（毎回新しいノートになる）。
 * 手順は、開始局面から実際に指せることを確かめてから取り込む（CSA は解析の時点で確かめている）。
 */
export async function createStudyFromKifuSource(
    source: StudyKifuSource,
    deps: StudyImportDeps,
): Promise<OpenOrCreateStudyResult> {
    const origin: StudyOrigin = { kind: "paste", ref: null };
    if (source.kind === "moves") {
        await assertLegalLine(source.startSfen, source.moves, deps.replayMovesStrict);
    }
    return openOrCreateStudy({
        sync: deps.sync,
        api: deps.api,
        onUnauthorized: deps.onUnauthorized,
        origin,
        build: (id) =>
            source.kind === "csa"
                ? createStudyDocumentFromCsa({ id, csa: source.csa, origin })
                : createStudyDocumentFromMoves({
                      id,
                      title: importedTitle(source.moves.length > 0),
                      origin,
                      startSfen: source.startSfen,
                      moves: source.moves,
                      annotations: source.annotations,
                      sourceKind: source.sourceKind,
                  }),
    });
}

/**
 * `/play` に読み込んである棋譜（分岐・コメントごと）から研究ノートを作る。
 * 棋譜に付いていた評価値（先手視点に正規化済みのもの）と、AI が指した手の探索結果は、
 * 対局時の評価値として取り込む。
 * 棋譜に対局者名が書かれていれば（CSA）、直接貼ったときと同じ表題・対局者名にする。
 */
export async function createStudyFromKifuTree(
    tree: KifuTree,
    info: { players?: { sente?: string; gote?: string } },
    deps: StudyImportDeps,
): Promise<OpenOrCreateStudyResult> {
    const origin: StudyOrigin = { kind: "paste", ref: null };
    const lines = leafLines(tree);
    // 指し手の無い棋譜（編集した局面だけ）は、局面を確かめる（`leafLines` はルートだけの
    // ツリーで `[]` を返すので、空の手順を 1 件として渡す）。
    for (const line of lines.length > 0 ? lines : [[]]) {
        await assertLegalLine(tree.startSfen, line, deps.replayMovesStrict);
    }
    const sente = info.players?.sente?.trim() || undefined;
    const gote = info.players?.gote?.trim() || undefined;
    return openOrCreateStudy({
        sync: deps.sync,
        api: deps.api,
        onUnauthorized: deps.onUnauthorized,
        origin,
        build: (id) =>
            createStudyDocumentFromKifuTree({
                id,
                title: sente && gote ? `${sente} 対 ${gote}` : importedTitle(tree.nodes.size > 1),
                origin,
                tree,
                sourceKind: "kifu",
                meta: {
                    ...(sente ? { blackName: sente } : {}),
                    ...(gote ? { whiteName: gote } : {}),
                },
            }).doc,
    });
}
