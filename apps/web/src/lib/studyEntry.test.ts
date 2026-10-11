import { createStudyDocumentFromMoves, type StudyDocument } from "@shogi/app-core";
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

    it("変則ルール（パス権）の対局・パスを含む棋譜・指し手の無い棋譜では入口を出さない", () => {
        expect(canOpenGameRecordAsStudy(game)).toBe(true);
        expect(
            canOpenGameRecordAsStudy({
                ...game,
                metadata: { roomSettings: { passRights: { initialCount: 2 } } },
            }),
        ).toBe(false);
        expect(canOpenGameRecordAsStudy({ ...game, moves: ["7g7f", "pass"] })).toBe(false);
        expect(canOpenGameRecordAsStudy({ ...game, moves: [] })).toBe(false);
    });
});
