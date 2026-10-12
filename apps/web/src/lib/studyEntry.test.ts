import {
    addMove,
    applyMoveWithState,
    createKifuTree,
    createStudyDocumentFromMoves,
    type KifuTree,
    parseStudySfen,
    STUDY_HIRATE_SFEN,
    type StudyDocument,
} from "@shogi/app-core";
import {
    createMemoryStudyStore,
    createStudySync,
    type StudyApi,
    type StudySync,
} from "@shogi/study-client";
import { describe, expect, it, vi } from "vitest";
import {
    canOpenGameRecordAsStudy,
    createStudyFromKifuSource,
    createStudyFromKifuTree,
    openOrCreateStudy,
    openStudyFromGameRecord,
    openStudyFromRshogiGame,
} from "./studyEntry";

const offline = async () => ({ ok: false as const, status: 0, error: {} });

/** サーバーに届かない API（未ログイン・backend なしの想定）。`list` だけ差し替えられる。 */
const createApi = (list: StudyApi["list"] = offline): StudyApi => ({
    list: vi.fn(list),
    create: vi.fn(offline),
    get: vi.fn(offline),
    postOps: vi.fn(offline),
    delete: vi.fn(offline),
    limits: vi.fn(offline),
});

const createSync = (api: StudyApi): StudySync =>
    createStudySync({ store: createMemoryStudyStore(), api });

const CSA = ["V2.2", "N+RAMU", "N-Panda", "PI", "+", "+7776FU,T4", "'** 45", "-3334FU,T7"].join(
    "\n",
);
const GAME = {
    meta: { gameId: "wdoor-20261009000001", senteName: "RAMU", goteName: "Panda", event: "f300" },
    csa: CSA,
};

describe("openOrCreateStudy", () => {
    it("同じ元棋譜のノートが無ければ作り、次からはそれを開く", async () => {
        const api = createApi();
        const sync = createSync(api);

        const first = await openStudyFromRshogiGame(GAME, { sync, api });
        expect(first.existing).toBe(false);
        const stored = await sync.load(first.studyId);
        expect(stored?.doc.origin).toEqual({ kind: "rshogi_csa", ref: "wdoor-20261009000001" });
        expect(stored?.doc.title).toBe("RAMU 対 Panda");
        expect(stored?.doc.meta).toMatchObject({ blackName: "RAMU", whiteName: "Panda" });
        // 対局時の評価値は、解析結果ではなく棋譜の来歴（source）として入る。
        const nodes = Object.values((stored?.doc as StudyDocument).tree.nodes);
        expect(nodes.some((node) => node.source?.score?.kind === "cp")).toBe(true);
        expect(stored?.doc.layers).toEqual([]);

        const second = await openStudyFromRshogiGame(GAME, { sync, api });
        expect(second).toEqual({ studyId: first.studyId, existing: true });
        expect((await sync.listLocal()).length).toBe(1);
    });

    it("ログイン中は、クラウドにある同じ棋譜のノートを開く（新しく作らない）", async () => {
        const api = createApi(async () => ({
            ok: true as const,
            status: 200,
            data: {
                studies: [
                    {
                        id: "22222222-2222-4222-8222-222222222222",
                        title: "RAMU 対 Panda",
                        origin: { kind: "rshogi_csa" as const, ref: "wdoor-20261009000001" },
                        meta: {},
                        revision: 3,
                        nodeCount: 3,
                        layerCount: 1,
                        resultCount: 3,
                        updatedAt: "2026-10-12T00:00:00.000Z",
                    },
                ],
                nextCursor: null,
            },
        }));
        const sync = createSync(api);
        sync.setSession({ userId: "user-1" });

        const opened = await openStudyFromRshogiGame(GAME, { sync, api });

        expect(opened).toEqual({
            studyId: "22222222-2222-4222-8222-222222222222",
            existing: true,
        });
        expect(api.list).toHaveBeenCalledWith({
            originKind: "rshogi_csa",
            originRef: "wdoor-20261009000001",
            limit: 1,
        });
        expect(await sync.listLocal()).toEqual([]);
    });

    it("クラウドへの問い合わせが 401（セッション切れ）なら、ログイン状態の取り直しを頼み、ノートは作る", async () => {
        const api = createApi(async () => ({ ok: false as const, status: 401, error: {} }));
        const sync = createSync(api);
        sync.setSession({ userId: "user-1" });
        const onSync = vi.fn();
        window.addEventListener("ramu-auth-session-sync", onSync);
        try {
            const opened = await openStudyFromRshogiGame(GAME, { sync, api });
            expect(opened.existing).toBe(false);
            expect(onSync).toHaveBeenCalledTimes(1);
        } finally {
            window.removeEventListener("ramu-auth-session-sync", onSync);
        }
    });

    it("未ログインではクラウドに問い合わせない", async () => {
        const api = createApi();
        const sync = createSync(api);
        await openStudyFromRshogiGame(GAME, { sync, api });
        expect(api.list).not.toHaveBeenCalled();
    });

    it("貼り付けた棋譜は、毎回新しいノートになる", async () => {
        const api = createApi();
        const sync = createSync(api);
        const source = { kind: "csa" as const, csa: CSA };

        const first = await createStudyFromKifuSource(source, { sync, api });
        const second = await createStudyFromKifuSource(source, { sync, api });

        expect(second.studyId).not.toBe(first.studyId);
        expect((await sync.load(first.studyId))?.doc.origin).toEqual({ kind: "paste", ref: null });
        expect((await sync.listLocal()).length).toBe(2);
    });

    it("作るときに渡す ID は UUID で、作った文書がそのまま保存される", async () => {
        const api = createApi();
        const sync = createSync(api);
        const build = vi.fn((id: string) =>
            createStudyDocumentFromMoves({
                id,
                title: "手順",
                origin: { kind: "paste", ref: null },
                startSfen: "startpos",
                moves: ["7g7f"],
            }),
        );
        const { studyId } = await openOrCreateStudy({
            origin: { kind: "paste", ref: null },
            build,
            sync,
            api,
        });
        expect(studyId).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        );
        expect(build).toHaveBeenCalledWith(studyId);
    });
});

describe("自分の対局からの入口", () => {
    const game = {
        id: "33333333-3333-4333-8333-333333333333",
        initialSfen: "startpos",
        moves: ["7g7f", "3c3d"],
        participants: [
            { seat: "b" as const, displayNameSnapshot: "わたし" },
            { seat: "w" as const, displayNameSnapshot: "あいて" },
        ],
        startedAt: "2026-10-01T10:00:00.000Z",
        result: { winner: "b" as const, reason: "resign" },
        metadata: { roomSettings: { passRights: null } },
    };

    it("対局の ID を元棋譜として研究ノートを作る", async () => {
        const api = createApi();
        const sync = createSync(api);
        const { studyId } = await openStudyFromGameRecord(game, { sync, api });
        const stored = await sync.load(studyId);
        expect(stored?.doc.origin).toEqual({ kind: "game_record", ref: game.id });
        expect(stored?.doc.title).toBe("わたし 対 あいて");
        expect(stored?.doc.meta).toMatchObject({ result: "WIN_BLACK" });
    });

    it("パスを含む対局（変則ルールのパス権）も研究ノートにできる。指し手の無い棋譜・読めない手のある棋譜では入口を出さない", () => {
        expect(canOpenGameRecordAsStudy(game)).toBe(true);
        expect(canOpenGameRecordAsStudy({ ...game, moves: ["7g7f", "pass"] })).toBe(true);
        expect(canOpenGameRecordAsStudy({ ...game, moves: [] })).toBe(false);
        expect(canOpenGameRecordAsStudy({ ...game, moves: ["7g7f", "resign"] })).toBe(false);
    });

    it("パスを含む対局から作ると、パスも手として取り込む", async () => {
        const api = createApi();
        const sync = createSync(api);
        const { studyId } = await openStudyFromGameRecord(
            { ...game, id: "game-pass", moves: ["7g7f", "pass", "2g2f", "3c3d", "pass"] },
            { sync, api },
        );
        const nodes = Object.values((await sync.load(studyId))?.doc.tree.nodes ?? {});
        expect(nodes.filter((node) => node.usiMove === "pass")).toHaveLength(2);
    });
});

describe("貼り付けた棋譜の検証", () => {
    const HIRATE = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1";
    /** ルールどおりに再生する関数の模擬: `illegal` に入っている手で止まる。 */
    const replayStoppingAt =
        (illegal: string) =>
        async (_sfen: string, moves: string[]): Promise<{ applied: string[]; error?: string }> => {
            const index = moves.indexOf(illegal);
            return index < 0
                ? { applied: moves }
                : { applied: moves.slice(0, index), error: "illegal move" };
        };

    it("指せない手を含む SFEN は、何手目かを添えて断り、ノートを作らない", async () => {
        const api = createApi();
        const sync = createSync(api);
        await expect(
            createStudyFromKifuSource(
                { kind: "moves", startSfen: HIRATE, moves: ["7g7e"] },
                { sync, api, replayMovesStrict: replayStoppingAt("7g7e") },
            ),
        ).rejects.toThrow("1 手目（7g7e）は指せない手です");
        // 歩を飛び越える角（KIF から読んだ手順）も同じ。
        await expect(
            createStudyFromKifuSource(
                { kind: "moves", startSfen: HIRATE, moves: ["7g7f", "3c3d", "8h3c"] },
                { sync, api, replayMovesStrict: replayStoppingAt("8h3c") },
            ),
        ).rejects.toThrow("3 手目（8h3c）は指せない手です");
        expect(await sync.listLocal()).toEqual([]);
    });

    it("指せる手順はそのまま取り込む", async () => {
        const api = createApi();
        const sync = createSync(api);
        const { studyId } = await createStudyFromKifuSource(
            { kind: "moves", startSfen: HIRATE, moves: ["7g7f", "3c3d"] },
            { sync, api, replayMovesStrict: replayStoppingAt("none") },
        );
        expect(Object.keys((await sync.load(studyId))?.doc.tree.nodes ?? {})).toHaveLength(3);
    });

    it("指し手の無い局面は、その局面から始めるノートになる（表題は「局面の研究」）", async () => {
        const api = createApi();
        const sync = createSync(api);
        const replay = vi.fn(replayStoppingAt("none"));
        const { studyId } = await createStudyFromKifuSource(
            { kind: "moves", startSfen: "4k4/9/9/9/9/9/9/9/4K4 b G 1", moves: [] },
            { sync, api, replayMovesStrict: replay },
        );
        const stored = await sync.load(studyId);
        expect(stored?.doc.title).toMatch(/^局面の研究（\d+\/\d+）$/);
        expect(Object.keys(stored?.doc.tree.nodes ?? {})).toHaveLength(1);
        // 局面を読み込めることも確かめている。
        expect(replay).toHaveBeenCalledWith("4k4/9/9/9/9/9/9/9/4K4 b G 1", []);
    });

    it("指し手が無く、局面として成り立たない（玉が無い・読み込めない）ものは、理由を添えて断る", async () => {
        const api = createApi();
        const sync = createSync(api);
        await expect(
            createStudyFromKifuSource(
                { kind: "moves", startSfen: "9/9/9/9/9/9/9/9/4K4 b - 1", moves: [] },
                { sync, api, replayMovesStrict: replayStoppingAt("none") },
            ),
        ).rejects.toThrow("この局面は研究ノートにできません: 後手の玉が盤上にありません");
        // 局面を読み込む側が断った。
        await expect(
            createStudyFromKifuSource(
                { kind: "moves", startSfen: "4k4/9/9/9/9/9/9/9/4K4 b G 1", moves: [] },
                { sync, api, replayMovesStrict: async () => ({ applied: [], error: "invalid" }) },
            ),
        ).rejects.toThrow("この局面は研究ノートにできません（読み込めない局面です）");
        expect(await sync.listLocal()).toEqual([]);
    });

    it("パスを含む手順は、各側が使った回数 + 1 のパス権を有効にして確かめる", async () => {
        const api = createApi();
        const sync = createSync(api);
        const replay = vi.fn(replayStoppingAt("none"));
        // 先手が 2 回、後手が 1 回パスする手順。
        const moves = ["pass", "3c3d", "pass", "pass", "7g7f"];
        const { studyId } = await createStudyFromKifuSource(
            { kind: "moves", startSfen: HIRATE, moves },
            { sync, api, replayMovesStrict: replay },
        );
        expect(replay).toHaveBeenCalledWith(HIRATE, moves, { passRights: { sente: 3, gote: 2 } });
        expect(Object.keys((await sync.load(studyId))?.doc.tree.nodes ?? {})).toHaveLength(6);
        // パスの無い手順には、何も渡さない。
        await createStudyFromKifuSource(
            { kind: "moves", startSfen: HIRATE, moves: ["7g7f"] },
            { sync, api, replayMovesStrict: replay },
        );
        expect(replay).toHaveBeenLastCalledWith(HIRATE, ["7g7f"], undefined);
    });

    it("長すぎる棋譜は、上限を説明して作らない", async () => {
        const api = createApi();
        const sync = createSync(api);
        // 1,025 手（飛車を 1 マス往復させ続ける）。
        const moves = Array.from(
            { length: 1025 },
            (_, index) => ["2h1h", "8b9b", "1h2h", "9b8b"][index % 4],
        );
        await expect(
            createStudyFromKifuSource(
                { kind: "moves", startSfen: HIRATE, moves },
                { sync, api, replayMovesStrict: replayStoppingAt("none") },
            ),
        ).rejects.toThrow("この棋譜は長すぎます（研究ノートにできるのは 1,024 手までです）");
        expect(await sync.listLocal()).toEqual([]);
    });
});

describe("/play に読み込んだ棋譜からの入口", () => {
    const buildTree = (moves: string[]): KifuTree => {
        let position = parseStudySfen(STUDY_HIRATE_SFEN);
        let tree = createKifuTree(position, "startpos");
        for (const move of moves) {
            const applied = applyMoveWithState(position, move, { validateTurn: false });
            if (!applied.ok) throw new Error(`テストの手順が不正です: ${move}`);
            position = applied.next;
            tree = addMove(tree, move, position);
        }
        return tree;
    };

    it("棋譜に対局者名があれば、直接貼ったときと同じ表題と対局者名にする", async () => {
        const api = createApi();
        const sync = createSync(api);
        const { studyId } = await createStudyFromKifuTree(
            buildTree(["7g7f", "3c3d"]),
            { players: { sente: "RAMU", gote: "Panda" } },
            { sync, api, replayMovesStrict: async (_sfen, moves) => ({ applied: moves }) },
        );
        const stored = await sync.load(studyId);
        expect(stored?.doc.title).toBe("RAMU 対 Panda");
        expect(stored?.doc.meta).toEqual({ blackName: "RAMU", whiteName: "Panda" });
        expect(stored?.doc.origin).toEqual({ kind: "paste", ref: null });
    });

    it("指し手の無い棋譜（編集した局面だけ）は、局面を確かめてから「局面の研究」として作る", async () => {
        const api = createApi();
        const sync = createSync(api);
        const replay = vi.fn(async (_sfen: string, moves: string[]) => ({ applied: moves }));
        const { studyId } = await createStudyFromKifuTree(
            buildTree([]),
            {},
            { sync, api, replayMovesStrict: replay },
        );
        expect(replay).toHaveBeenCalledTimes(1);
        expect((await sync.load(studyId))?.doc.title).toMatch(/^局面の研究（\d+\/\d+）$/);

        // 玉の無い局面のツリーは断る。
        const kingless = createKifuTree(
            parseStudySfen("9/9/9/9/9/9/9/9/9 b - 1"),
            "9/9/9/9/9/9/9/9/9 b - 1",
        );
        await expect(
            createStudyFromKifuTree(kingless, {}, { sync, api, replayMovesStrict: replay }),
        ).rejects.toThrow("この局面は研究ノートにできません");
    });

    it("対局者名が無ければ、日付つきの表題にする", async () => {
        const api = createApi();
        const sync = createSync(api);
        const { studyId } = await createStudyFromKifuTree(
            buildTree(["7g7f"]),
            {},
            { sync, api, replayMovesStrict: async (_sfen, moves) => ({ applied: moves }) },
        );
        expect((await sync.load(studyId))?.doc.title).toMatch(/^取り込んだ棋譜（\d+\/\d+）$/);
    });
});
