/**
 * 研究ノートへの入口（棋譜を見ている画面から「研究ノートで開く」）。
 *
 * 同じ元棋譜のノートが既にあればそれを開き、無ければ新しく作る。作ったノートはまず
 * ブラウザ内に保存され、ログイン中ならクラウドへも送られる。
 */

import {
    createStudyDocumentFromCsa,
    createStudyDocumentFromKifuTree,
    createStudyDocumentFromMoves,
    generateStudyId,
    getPositionService,
    isStudyUsiMove,
    type KifuTree,
    type StudyDocument,
    StudyLimitError,
    type StudyMeta,
    type StudyOrigin,
    validateStudyDocument,
} from "@shogi/app-core";
import type { RshogiGame } from "@shogi/match-client";
import { createStudyApiClient, type StudyApi, type StudySync } from "@shogi/study-client";
import type { StudyKifuSource } from "@shogi/ui/components/study-workspace/studyImport";
import { getStudySync } from "./studySync";

interface OpenOrCreateStudyOptions {
    origin: StudyOrigin;
    /** 新しく作るときだけ呼ばれる。渡された ID で文書を作る。 */
    build: (studyId: string) => StudyDocument;
    sync?: StudySync;
    api?: StudyApi;
}

interface OpenOrCreateStudyResult {
    studyId: string;
    /** 既にあったノートを開いた。 */
    existing: boolean;
}

/**
 * 同じ元棋譜のノートを探し、無ければ作る。
 *
 * 探す順は、ブラウザ内 → （ログイン中なら）クラウド。クラウドに問い合わせられなかった
 * ときは新しく作る（あとでサーバーが同じ元棋譜のノートを返したら、同期エンジンが
 * 成果をそのノートへ統合する）。貼り付けた棋譜（`paste`）は毎回新しく作る。
 */
export async function openOrCreateStudy({
    origin,
    build,
    sync = getStudySync(),
    api = createStudyApiClient(),
}: OpenOrCreateStudyOptions): Promise<OpenOrCreateStudyResult> {
    if (origin.kind !== "paste" && origin.ref !== null) {
        const localId = await sync.findLocalByOrigin(origin);
        if (localId !== null) return { studyId: localId, existing: true };
        if (sync.getSession() !== null) {
            const listed = await api.list({
                originKind: origin.kind,
                originRef: origin.ref,
                limit: 1,
            });
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
) => Promise<{ applied: string[]; error?: string }>;

interface ImportDeps extends Pick<OpenOrCreateStudyOptions, "sync" | "api"> {
    replayMovesStrict?: ReplayMovesStrict;
}

/**
 * 貼り付けた棋譜の手順が、開始局面から実際に指せるかを確かめる。
 *
 * `createStudyDocumentFromMoves` は「駒がそこにあるか」程度しか見ない（歩を飛び越える角なども
 * 通ってしまう）ので、信頼できない入力は先にここを通す。指せない手があれば、何手目かを添えて断る。
 */
async function assertLegalLine(
    startSfen: string,
    moves: readonly string[],
    replay: ReplayMovesStrict | undefined,
): Promise<void> {
    const run: ReplayMovesStrict =
        replay ?? ((sfen, line) => getPositionService().replayMovesStrict(sfen, line));
    const result = await run(startSfen, [...moves]);
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
    deps: Pick<OpenOrCreateStudyOptions, "sync" | "api"> = {},
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

interface GameRecordForStudy {
    id: string;
    initialSfen: string;
    moves: string[];
    participants: Array<{ seat: "b" | "w" | null; displayNameSnapshot: string }>;
    startedAt: string | null;
    result: { winner: "b" | "w" | null; reason: string } | null;
}

/** 対局記録のメタ情報（`{ roomSettings: { passRights } }`）から、パス権つきの対局かを読む。 */
function usesPassRights(metadata: unknown): boolean {
    if (metadata === null || typeof metadata !== "object") return false;
    const settings = (metadata as { roomSettings?: unknown }).roomSettings;
    if (settings === null || typeof settings !== "object") return false;
    const passRights = (settings as { passRights?: unknown }).passRights;
    return passRights !== null && passRights !== undefined;
}

/**
 * 自分の対局の棋譜が研究ノートにできるか。
 * 指し手があり、変則ルール（パス権）の対局でなく、パスの手を含まないこと。
 */
export function canOpenGameRecordAsStudy(
    game: Pick<GameRecordForStudy, "moves"> & { metadata?: unknown },
): boolean {
    return (
        game.moves.length > 0 &&
        !usesPassRights(game.metadata) &&
        game.moves.every((move) => isStudyUsiMove(move))
    );
}

/** 自分の対局の詳細から研究ノートを開く。 */
export function openStudyFromGameRecord(
    game: GameRecordForStudy,
    deps: Pick<OpenOrCreateStudyOptions, "sync" | "api"> = {},
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

/** 対局者名の無い棋譜の表題（例: 「取り込んだ棋譜（10/12）」）。あとから画面で変えられる。 */
function importedTitle(now: Date = new Date()): string {
    return `取り込んだ棋譜（${now.getMonth() + 1}/${now.getDate()}）`;
}

/**
 * 貼り付け・ファイルの棋譜から研究ノートを作る（毎回新しいノートになる）。
 * 手順は、開始局面から実際に指せることを確かめてから取り込む（CSA は解析の時点で確かめている）。
 */
export async function createStudyFromKifuSource(
    source: StudyKifuSource,
    deps: ImportDeps = {},
): Promise<OpenOrCreateStudyResult> {
    const origin: StudyOrigin = { kind: "paste", ref: null };
    if (source.kind === "moves") {
        await assertLegalLine(source.startSfen, source.moves, deps.replayMovesStrict);
    }
    return openOrCreateStudy({
        sync: deps.sync,
        api: deps.api,
        origin,
        build: (id) =>
            source.kind === "csa"
                ? createStudyDocumentFromCsa({ id, csa: source.csa, origin })
                : createStudyDocumentFromMoves({
                      id,
                      title: importedTitle(),
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
 * 棋譜に付いていた評価値（先手視点に正規化済みのもの）は、対局時の評価値として取り込む。
 * 棋譜に対局者名が書かれていれば（CSA）、直接貼ったときと同じ表題・対局者名にする。
 */
export async function createStudyFromKifuTree(
    tree: KifuTree,
    info: { players?: { sente?: string; gote?: string } } = {},
    deps: ImportDeps = {},
): Promise<OpenOrCreateStudyResult> {
    const origin: StudyOrigin = { kind: "paste", ref: null };
    for (const line of leafLines(tree)) {
        await assertLegalLine(tree.startSfen, line, deps.replayMovesStrict);
    }
    const sente = info.players?.sente?.trim() || undefined;
    const gote = info.players?.gote?.trim() || undefined;
    return openOrCreateStudy({
        sync: deps.sync,
        api: deps.api,
        origin,
        build: (id) =>
            createStudyDocumentFromKifuTree({
                id,
                title: sente && gote ? `${sente} 対 ${gote}` : importedTitle(),
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
