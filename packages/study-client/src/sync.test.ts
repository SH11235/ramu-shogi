import "fake-indexeddb/auto";
import {
    applyStudyOps,
    type StudyDocument,
    type StudyLayerSpec,
    StudyLimitError,
    type StudyOp,
    StudyOpError,
    studyChildNodeId,
    studyLayerId,
} from "@shogi/app-core";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import type { StudyOpsRequest } from "./api-types";
import { createIndexedDbStudyStore } from "./indexeddb-store";
import { createMemoryStudyStore, StudyStorageError, type StudyStore } from "./store";
import {
    createInProcessLockManager,
    createStudySync,
    type StudySync,
    StudySyncError,
    type StudySyncEvent,
} from "./sync";
import {
    createChannelHub,
    createFakeStudyServer,
    createManualScheduler,
    createTestDocument,
    type FakeStudyServer,
    type ManualScheduler,
    settle,
    TEST_STUDY_ID,
} from "./sync-test-support";

const USER_A = "user-a";
const USER_B = "user-b";

/** テスト用の、連番から決まる小文字の UUID v4（サーバーは UUID 以外の batchId を 400 にする）。 */
const batchUuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** 同じテストを、メモリ実装と IndexedDB 実装（fake-indexeddb）の両方で回す。 */
const STORES: Array<{ name: string; create: () => StudyStore }> = [
    { name: "メモリ", create: () => createMemoryStudyStore() },
    {
        name: "IndexedDB",
        create: () => createIndexedDbStudyStore({ indexedDB: new IDBFactory() }),
    },
];
let createStore: () => StudyStore = STORES[0].create;

interface Harness {
    server: FakeStudyServer;
    store: StudyStore;
    scheduler: ManualScheduler;
    sync: StudySync;
    events: StudySyncEvent[];
    /** ブラウザのセッション Cookie の持ち主（サーバーから見えるユーザー）。 */
    login(userId: string | null): void;
    /** 別のタブでのログアウト・アカウントの切り替え（Cookie だけが変わり、このタブには伝わらない）。 */
    switchCookie(userId: string | null): void;
    /** 時刻を進め、動き出した処理が落ち着くまで待つ。 */
    advance(ms: number): Promise<void>;
    postOpsCalls(): Array<{ status: number; body: StudyOpsRequest }>;
}

const createHarness = (
    overrides: {
        server?: FakeStudyServer;
        store?: StudyStore;
        /** サーバーから見たログイン中のユーザー（作成の直前の確認）。省略時は確認しない。 */
        verifySession?: () => Promise<{ userId: string } | null>;
    } = {},
): Harness => {
    const server = overrides.server ?? createFakeStudyServer();
    const store = overrides.store ?? createStore();
    const scheduler = createManualScheduler();
    let cookieUser: string | null = null;
    let batch = 0;
    const sync = createStudySync({
        store,
        api: server.apiFor(() => cookieUser),
        scheduler,
        now: scheduler.now,
        randomId: () => batchUuid(++batch),
        verifySession: overrides.verifySession,
    });
    const events: StudySyncEvent[] = [];
    sync.subscribeEvents((event) => events.push(event));
    return {
        server,
        store,
        scheduler,
        sync,
        events,
        login(userId) {
            cookieUser = userId;
            sync.setSession(userId === null ? null : { userId });
        },
        switchCookie(userId) {
            cookieUser = userId;
        },
        async advance(ms) {
            // セッションの切り替えなどで動き出した処理が、タイマーを予定し終えるのを待つ。
            await settle(5);
            scheduler.advance(ms);
            await settle();
        },
        postOpsCalls: () =>
            server.calls
                .filter((call) => call.method === "postOps")
                .map((call) => ({ status: call.status, body: call.body as StudyOpsRequest })),
    };
};

const doc = createTestDocument();
const rootId = doc.tree.rootId;
const firstId = studyChildNodeId(rootId, "7g7f");
const secondId = studyChildNodeId(firstId, "3c3d");

const comment = (value: string, nodeId = firstId): StudyOp => ({
    type: "setComment",
    nodeId,
    value,
});

const spec: StudyLayerSpec = {
    version: 1,
    engine: { kind: "wasm", name: "rshogi", version: "0.8.1" },
    evaluation: { nnueSha256: null, fvScale: null, progressSha256: null, layerStacks: null },
    limits: { timeMs: 1000, depth: 15, nodes: null },
    multiPv: 1,
    rules: { variant: "standard" },
};

const analysisOps = (nodeId: string, value: number): StudyOp[] => [
    { type: "ensureLayer", spec, display: { label: "RAMU・1 秒" } },
    {
        type: "putAnalysis",
        layerId: studyLayerId(spec),
        nodeId,
        result: {
            runId: "9d6783f2-d773-4572-ae4e-bd463bf8f816",
            completion: "completed",
            depth: 15,
            nodes: 1000,
            timeMs: 1000,
            execution: { threads: 1, hashMb: null, parallelWorkers: 1 },
            candidates: [
                { rank: 1, score: { kind: "cp", value }, depth: 15, seldepth: null, pv: [] },
            ],
        },
    },
];

/** ログイン済みで、サーバーに作成済みのノートを 1 件持つ状態にする。 */
const createSyncedHarness = async (): Promise<Harness> => {
    const harness = createHarness();
    harness.login(USER_A);
    await harness.sync.createStudy(doc);
    await harness.advance(0);
    expect(harness.sync.getStatus(TEST_STUDY_ID).state).toBe("synced");
    return harness;
};

const localDoc = async (harness: Harness, studyId = TEST_STUDY_ID): Promise<StudyDocument> => {
    const study = await harness.sync.load(studyId);
    if (!study) throw new Error("study missing");
    return study.doc;
};

const serverDoc = (harness: Harness, studyId = TEST_STUDY_ID) => {
    const study = harness.server.study(studyId);
    if (!study) throw new Error("server study missing");
    return { tree: study.tree, layers: study.layers, title: study.title };
};

describe.each(STORES)("同期エンジン（保存層: $name）", ({ create }) => {
    beforeEach(() => {
        createStore = create;
    });

    describe("ローカル優先の保存と送信", () => {
        it("作成はまずローカルに書き、ログイン中ならサーバーに同じ studyId で作る", async () => {
            const harness = createHarness();
            harness.login(USER_A);
            const created = await harness.sync.createStudy(doc);
            expect(created).toMatchObject({
                id: TEST_STUDY_ID,
                owner: USER_A,
                serverRevision: null,
            });
            // サーバーが受理するまでは「クラウドに保存済み」と出さない。
            expect(harness.sync.getStatus(TEST_STUDY_ID).state).toBe("pending");
            expect(harness.server.study(TEST_STUDY_ID)).toBeNull();

            await harness.advance(0);
            expect(harness.server.study(TEST_STUDY_ID)).toMatchObject({
                id: TEST_STUDY_ID,
                revision: 1,
                tree: doc.tree,
            });
            expect(harness.sync.getStatus(TEST_STUDY_ID)).toMatchObject({
                state: "synced",
                pendingCount: 0,
            });
            expect((await harness.sync.load(TEST_STUDY_ID))?.serverRevision).toBe(1);
        });

        it("編集はすぐローカルに保存し、送信は約 5 秒まとめて 1 バッチで送る", async () => {
            const harness = await createSyncedHarness();
            const afterFirst = await harness.sync.applyOps(TEST_STUDY_ID, [comment("一")]);
            expect(afterFirst.tree.nodes[firstId].comment).toBe("一");
            await harness.sync.applyOps(TEST_STUDY_ID, [comment("二")]);
            await harness.sync.applyOps(TEST_STUDY_ID, [
                { type: "setBookmark", nodeId: firstId, value: true },
            ]);
            // ローカルには保存済み、サーバーにはまだ送っていない。
            expect((await localDoc(harness)).tree.nodes[firstId]).toMatchObject({
                comment: "二",
                bookmarked: true,
            });
            expect(harness.sync.getStatus(TEST_STUDY_ID)).toMatchObject({
                state: "pending",
                pendingCount: 3,
            });
            await harness.advance(4999);
            expect(harness.postOpsCalls()).toEqual([]);

            await harness.advance(1);
            const calls = harness.postOpsCalls();
            expect(calls).toHaveLength(1);
            expect(calls[0]).toMatchObject({
                status: 200,
                body: { batchId: batchUuid(1), expectedRevision: 1 },
            });
            expect(calls[0].body.ops).toHaveLength(3);
            expect(harness.server.study(TEST_STUDY_ID)?.revision).toBe(2);
            expect(serverDoc(harness).tree).toEqual((await localDoc(harness)).tree);
            expect(harness.sync.getStatus(TEST_STUDY_ID)).toMatchObject({
                state: "synced",
                pendingCount: 0,
            });
        });

        it("flush で間引きを待たずに送る（解析の区切り）", async () => {
            const harness = await createSyncedHarness();
            await harness.sync.applyOps(TEST_STUDY_ID, analysisOps(firstId, 120));
            await harness.sync.flush(TEST_STUDY_ID);
            expect(harness.postOpsCalls()).toHaveLength(1);
            expect(serverDoc(harness).layers).toEqual((await localDoc(harness)).layers);
            // 残っていた間引きのタイマーが発火しても、送るものは無い。
            await harness.advance(10_000);
            expect(harness.postOpsCalls()).toHaveLength(1);
        });

        it("何も変えない操作は送信待ちに入れない", async () => {
            const harness = await createSyncedHarness();
            await harness.sync.applyOps(TEST_STUDY_ID, [
                comment(""),
                comment("x", "0".repeat(32)),
                { type: "setBookmark", nodeId: firstId, value: false },
            ]);
            expect(harness.sync.getStatus(TEST_STUDY_ID)).toMatchObject({
                state: "synced",
                pendingCount: 0,
            });
            await harness.advance(10_000);
            expect(harness.postOpsCalls()).toEqual([]);
        });

        it("送信待ちが多いときは 200 操作ずつに分けて、順に送る", async () => {
            const harness = await createSyncedHarness();
            const ops = Array.from({ length: 450 }, (_, i) => comment(`コメント ${i}`));
            await harness.sync.applyOps(TEST_STUDY_ID, ops);
            await harness.sync.flush(TEST_STUDY_ID);
            const calls = harness.postOpsCalls();
            expect(calls.map((call) => call.body.ops.length)).toEqual([200, 200, 50]);
            expect(calls.map((call) => call.body.expectedRevision)).toEqual([1, 2, 3]);
            expect(harness.server.maxConcurrentPostOps).toBe(1);
            expect(serverDoc(harness).tree.nodes[firstId].comment).toBe("コメント 449");
            expect(harness.sync.getStatus(TEST_STUDY_ID).state).toBe("synced");
        });

        it("無いノート・統合済みのノートへの操作は拒否する", async () => {
            const harness = createHarness();
            await expect(harness.sync.applyOps("missing", [comment("x")])).rejects.toBeInstanceOf(
                StudySyncError,
            );
            await harness.sync.createStudy(doc);
            await expect(harness.sync.createStudy(doc)).rejects.toMatchObject({
                code: "already_exists",
            });
        });
    });

    describe("失敗と再送", () => {
        it("応答が失われたバッチは同じ batchId で再送し、replayed を受理済みとして扱う", async () => {
            const harness = await createSyncedHarness();
            harness.server.interceptOnce("postOps", "drop-response");
            await harness.sync.applyOps(TEST_STUDY_ID, [comment("届いたが応答なし")]);
            await harness.sync.flush(TEST_STUDY_ID);

            // サーバーは受理済みだが、クライアントは知らない。
            expect(harness.server.study(TEST_STUDY_ID)?.revision).toBe(2);
            expect(harness.sync.getStatus(TEST_STUDY_ID)).toMatchObject({
                state: "pending",
                pendingCount: 1,
                retrying: true,
            });
            expect((await harness.sync.load(TEST_STUDY_ID))?.inflight).toMatchObject({
                batchId: batchUuid(1),
                expectedRevision: 1,
            });

            // 間隔を空けて再送する。
            await harness.advance(1999);
            expect(harness.postOpsCalls()).toHaveLength(1);
            await harness.advance(1);
            const calls = harness.postOpsCalls();
            expect(calls).toHaveLength(2);
            expect(calls[1].body).toEqual(calls[0].body);
            expect(calls[1].status).toBe(200);

            // 二重に適用されていない（リビジョンは 1 回分しか進まない）。
            expect(harness.server.study(TEST_STUDY_ID)?.revision).toBe(2);
            expect((await harness.sync.load(TEST_STUDY_ID))?.serverRevision).toBe(2);
            expect(harness.sync.getStatus(TEST_STUDY_ID)).toMatchObject({
                state: "synced",
                pendingCount: 0,
                retrying: false,
            });
        });

        it("作成の応答が失われても、同じ studyId の再送で existing を受けて続きから送る", async () => {
            const harness = createHarness();
            harness.login(USER_A);
            harness.server.interceptOnce("create", "drop-response");
            await harness.sync.createStudy(doc);
            await harness.advance(0);
            expect(harness.server.study(TEST_STUDY_ID)?.revision).toBe(1);
            expect(harness.sync.getStatus(TEST_STUDY_ID).state).toBe("pending");

            await harness.sync.applyOps(TEST_STUDY_ID, [comment("作成後の編集")]);
            await harness.advance(5000);
            const creates = harness.server.calls.filter((call) => call.method === "create");
            expect(creates.map((call) => call.status)).toEqual([0, 200]);
            expect(serverDoc(harness).tree.nodes[firstId].comment).toBe("作成後の編集");
            expect(harness.sync.getStatus(TEST_STUDY_ID).state).toBe("synced");
        });

        it("オフラインの間はローカルに溜め、間隔を広げながら再送し、戻ったら送る", async () => {
            const harness = await createSyncedHarness();
            const goOnline = harness.server.intercept("*", "offline");
            await harness.sync.applyOps(TEST_STUDY_ID, [comment("オフライン中の編集")]);
            await harness.advance(5000);
            expect(harness.sync.getStatus(TEST_STUDY_ID)).toMatchObject({
                state: "pending",
                pendingCount: 1,
                retrying: true,
            });
            // 再送の間隔は 2 秒、4 秒、8 秒と広がる。
            expect(harness.scheduler.pendingDelays()).toEqual([2000]);
            await harness.advance(2000);
            expect(harness.scheduler.pendingDelays()).toEqual([4000]);
            await harness.advance(4000);
            expect(harness.scheduler.pendingDelays()).toEqual([8000]);

            // オフライン中の編集もローカルには保存される。
            await harness.sync.applyOps(TEST_STUDY_ID, [comment("さらに編集")]);
            expect((await localDoc(harness)).tree.nodes[firstId].comment).toBe("さらに編集");
            expect(harness.server.study(TEST_STUDY_ID)?.revision).toBe(1);

            goOnline();
            await harness.advance(8000);
            expect(serverDoc(harness).tree.nodes[firstId].comment).toBe("さらに編集");
            expect(harness.sync.getStatus(TEST_STUDY_ID)).toMatchObject({
                state: "synced",
                retrying: false,
            });
            // 応答待ちだった 1 つ目のバッチは同じ batchId のまま送られる。
            const calls = harness.postOpsCalls();
            expect(
                new Set(calls.filter((call) => call.status === 0).map((c) => c.body.batchId)),
            ).toEqual(new Set([batchUuid(1)]));
        });

        it("サーバーの一時的な失敗（500 / 429）も再送する", async () => {
            const harness = await createSyncedHarness();
            harness.server.interceptOnce("postOps", { status: 500 });
            harness.server.interceptOnce("postOps", { status: 429 });
            await harness.sync.applyOps(TEST_STUDY_ID, [comment("再送される")]);
            await harness.sync.flush(TEST_STUDY_ID);
            expect(harness.sync.getStatus(TEST_STUDY_ID).retrying).toBe(true);
            await harness.advance(2000);
            await harness.advance(4000);
            expect(harness.postOpsCalls().map((call) => call.status)).toEqual([500, 429, 200]);
            expect(harness.sync.getStatus(TEST_STUDY_ID).state).toBe("synced");
        });
    });

    describe("他の端末の変更との競合（409）", () => {
        it("最新のノートを取得し、未送信の操作をその上に再適用して送り直す", async () => {
            const harness = await createSyncedHarness();
            // 他の端末が分岐とコメントを足した（リビジョン 2）。
            const otherBranch = studyChildNodeId(firstId, "8c8d");
            harness.server.applyFromOtherDevice(TEST_STUDY_ID, [
                { type: "addMoves", parentId: firstId, moves: ["8c8d"] },
                comment("他の端末のコメント", rootId),
            ]);

            await harness.sync.applyOps(TEST_STUDY_ID, [
                comment("この端末のコメント"),
                ...analysisOps(firstId, 80),
            ]);
            await harness.sync.flush(TEST_STUDY_ID);

            const calls = harness.postOpsCalls();
            expect(calls.map((call) => [call.status, call.body.expectedRevision])).toEqual([
                [409, 1],
                [200, 2],
            ]);
            // 送り直しは新しいバッチ。
            expect(calls[1].body.batchId).not.toBe(calls[0].body.batchId);
            expect(calls[1].body.ops).toEqual(calls[0].body.ops);

            const local = await localDoc(harness);
            expect(local.tree.nodes[otherBranch]).toBeDefined();
            expect(local.tree.nodes[rootId].comment).toBe("他の端末のコメント");
            expect(local.tree.nodes[firstId].comment).toBe("この端末のコメント");
            expect(local.layers[0].results[firstId]).toBeDefined();
            expect(serverDoc(harness)).toEqual({
                tree: local.tree,
                layers: local.layers,
                title: local.title,
            });
            expect(harness.server.study(TEST_STUDY_ID)?.revision).toBe(3);
            expect(harness.sync.getStatus(TEST_STUDY_ID).state).toBe("synced");
            expect(harness.events).toContainEqual({
                type: "document",
                studyId: TEST_STUDY_ID,
                origin: "remote",
            });
        });

        it("並べ替え（本譜との入れ替え）は、他の端末が同じ親に手を足していても捨てず、足された手を含む並びで送り直す", async () => {
            const harness = await createSyncedHarness();
            // この端末で変化を足して、同期しておく。
            const variation = studyChildNodeId(firstId, "8c8d");
            await harness.sync.applyOps(TEST_STUDY_ID, [
                { type: "addMoves", parentId: firstId, moves: ["8c8d"] },
            ]);
            await harness.sync.flush(TEST_STUDY_ID);
            // 他の端末が、同じ親に別の手を足した。
            const added = studyChildNodeId(firstId, "4c4d");
            harness.server.applyFromOtherDevice(TEST_STUDY_ID, [
                { type: "addMoves", parentId: firstId, moves: ["4c4d"] },
            ]);

            // この端末で、変化を本譜と入れ替える（足された手を知らないままの並び）。
            await harness.sync.applyOps(TEST_STUDY_ID, [
                { type: "reorderChildren", parentId: firstId, value: [variation, secondId] },
            ]);
            await harness.sync.flush(TEST_STUDY_ID);

            const calls = harness.postOpsCalls().slice(-2);
            expect(calls.map((call) => call.status)).toEqual([409, 200]);
            expect(calls[1].body.ops).toEqual([
                { type: "reorderChildren", parentId: firstId, value: [variation, secondId, added] },
            ]);
            const expected = [variation, secondId, added];
            expect((await localDoc(harness)).tree.nodes[firstId].children).toEqual(expected);
            expect(serverDoc(harness).tree.nodes[firstId].children).toEqual(expected);
            expect(harness.sync.getStatus(TEST_STUDY_ID)).toMatchObject({
                state: "synced",
                pendingCount: 0,
            });
        });

        it("他の端末で消されたノードへの未送信の操作は、読み飛ばされて送信待ちから落ちる", async () => {
            const harness = await createSyncedHarness();
            harness.server.applyFromOtherDevice(TEST_STUDY_ID, [
                { type: "deleteSubtree", nodeId: firstId },
            ]);
            await harness.sync.applyOps(TEST_STUDY_ID, [comment("消されたノードへのコメント")]);
            await harness.sync.flush(TEST_STUDY_ID);

            expect(harness.postOpsCalls().map((call) => call.status)).toEqual([409]);
            expect((await localDoc(harness)).tree.nodes[firstId]).toBeUndefined();
            expect(harness.sync.getStatus(TEST_STUDY_ID)).toMatchObject({
                state: "synced",
                pendingCount: 0,
            });
        });

        it("応答が失われたバッチのあとに他の端末の変更が入っても、再適用で二重にならない", async () => {
            const harness = await createSyncedHarness();
            harness.server.interceptOnce("postOps", "drop-response");
            await harness.sync.applyOps(TEST_STUDY_ID, [
                { type: "addMoves", parentId: firstId, moves: ["8c8d", "2g2f"] },
            ]);
            await harness.sync.flush(TEST_STUDY_ID);
            // 受理済み（リビジョン 2）のあと、他の端末が書いた（リビジョン 3）。
            harness.server.applyFromOtherDevice(TEST_STUDY_ID, [comment("他の端末", rootId)]);

            await harness.advance(2000);
            // 再送は replayed にならず 409。取得して再適用すると、既に入っている操作は落ちる。
            expect(harness.postOpsCalls().map((call) => call.status)).toEqual([0, 409]);
            const local = await localDoc(harness);
            expect(Object.keys(local.tree.nodes)).toHaveLength(5);
            expect(serverDoc(harness).tree).toEqual(local.tree);
            expect(harness.server.study(TEST_STUDY_ID)?.revision).toBe(3);
            expect(harness.sync.getStatus(TEST_STUDY_ID)).toMatchObject({
                state: "synced",
                pendingCount: 0,
            });
        });
    });

    describe("サーバーが受け付けない場合", () => {
        it("上限超過（422）: ローカルの成果は残し、上限超過と表示し、同じ内容は送り直さない", async () => {
            const harness = await createSyncedHarness();
            harness.server.limits.nodesPerStudy = 4;
            const branch = studyChildNodeId(firstId, "8c8d");
            await harness.sync.applyOps(TEST_STUDY_ID, [
                { type: "addMoves", parentId: firstId, moves: ["8c8d", "2g2f"] },
            ]);
            await harness.sync.flush(TEST_STUDY_ID);

            expect(harness.sync.getStatus(TEST_STUDY_ID)).toMatchObject({
                state: "limit_exceeded",
                limit: "nodesPerStudy",
                pendingCount: 1,
            });
            expect(Object.keys((await localDoc(harness)).tree.nodes)).toHaveLength(5);
            expect(Object.keys(serverDoc(harness).tree.nodes)).toHaveLength(3);
            // 時間が経っても、同じ内容は送り直さない。
            await harness.advance(120_000);
            expect(harness.postOpsCalls().map((call) => call.status)).toEqual([422]);

            // 上限に収まるように直すと、次の送信で通る。
            await harness.sync.applyOps(TEST_STUDY_ID, [
                { type: "deleteSubtree", nodeId: studyChildNodeId(branch, "2g2f") },
            ]);
            await harness.advance(5000);
            expect(harness.postOpsCalls().map((call) => call.status)).toEqual([422, 200]);
            expect(serverDoc(harness).tree).toEqual((await localDoc(harness)).tree);
            expect(harness.sync.getStatus(TEST_STUDY_ID).state).toBe("synced");
        });

        it("ノート数の上限（作成の 422）: retry で上限が空いたあとに送り直せる", async () => {
            const harness = createHarness();
            harness.server.limits.studiesPerUser = 0;
            harness.login(USER_A);
            await harness.sync.createStudy(doc);
            await harness.advance(0);
            expect(harness.sync.getStatus(TEST_STUDY_ID)).toMatchObject({
                state: "limit_exceeded",
                limit: "studiesPerUser",
            });
            await harness.advance(120_000);
            expect(harness.server.calls.filter((call) => call.method === "create")).toHaveLength(1);

            harness.server.limits.studiesPerUser = 200;
            await harness.sync.retry(TEST_STUDY_ID);
            expect(harness.server.study(TEST_STUDY_ID)?.revision).toBe(1);
            expect(harness.sync.getStatus(TEST_STUDY_ID).state).toBe("synced");
        });

        it("本文が大きすぎる（413）も上限超過として扱う", async () => {
            const harness = await createSyncedHarness();
            harness.server.interceptOnce("postOps", { status: 413 });
            await harness.sync.applyOps(TEST_STUDY_ID, [comment("大きい")]);
            await harness.sync.flush(TEST_STUDY_ID);
            expect(harness.sync.getStatus(TEST_STUDY_ID)).toMatchObject({
                state: "limit_exceeded",
                limit: "opsBatchBytes",
            });
            expect((await localDoc(harness)).tree.nodes[firstId].comment).toBe("大きい");
        });

        it("入力不正（400）: 保存に失敗と表示し、同じ内容は送り直さない", async () => {
            const harness = await createSyncedHarness();
            harness.server.interceptOnce("postOps", {
                status: 400,
                error: { error: "INVALID_INPUT", message: "comment too long" },
            });
            await harness.sync.applyOps(TEST_STUDY_ID, [comment("x")]);
            await harness.sync.flush(TEST_STUDY_ID);
            expect(harness.sync.getStatus(TEST_STUDY_ID)).toMatchObject({
                state: "error",
                reason: "rejected",
                message: "comment too long",
            });
            await harness.advance(120_000);
            expect(harness.postOpsCalls()).toHaveLength(1);
        });

        it("削除済み（410）: 以後は送らず、保存に失敗（サーバーで削除済み）と表示する", async () => {
            const harness = await createSyncedHarness();
            harness.server.remove(TEST_STUDY_ID);
            await harness.sync.applyOps(TEST_STUDY_ID, [comment("消されたあとの編集")]);
            await harness.sync.flush(TEST_STUDY_ID);
            expect(harness.sync.getStatus(TEST_STUDY_ID)).toMatchObject({
                state: "error",
                reason: "deleted_remotely",
            });
            // ローカルの成果は残る。
            expect((await localDoc(harness)).tree.nodes[firstId].comment).toBe(
                "消されたあとの編集",
            );
            await harness.sync.applyOps(TEST_STUDY_ID, [comment("さらに編集")]);
            await harness.advance(120_000);
            expect(harness.postOpsCalls()).toHaveLength(1);
        });

        it("未認証（401）: 送信を止めて知らせ、ログインし直すと再開する", async () => {
            const harness = await createSyncedHarness();
            expect(harness.sync.isUnauthorized()).toBe(false);
            harness.server.interceptOnce("postOps", { status: 401 });
            await harness.sync.applyOps(TEST_STUDY_ID, [comment("セッション切れ")]);
            await harness.sync.flush(TEST_STUDY_ID);
            expect(harness.events).toContainEqual({ type: "unauthorized" });
            // 伝え直されるまでは、401 を受けた状態のまま（画面はこの間、編集を止める）。
            expect(harness.sync.isUnauthorized()).toBe(true);
            expect(harness.sync.getStatus(TEST_STUDY_ID)).toMatchObject({
                state: "local",
                reason: "signed_out",
                pendingCount: 1,
            });
            await harness.advance(120_000);
            expect(harness.postOpsCalls()).toHaveLength(1);

            // 同じユーザーでログインし直したら、少し間隔を空けてから送り直す。
            harness.login(USER_A);
            expect(harness.sync.isUnauthorized()).toBe(false);
            await harness.advance(1999);
            expect(harness.postOpsCalls()).toHaveLength(1);
            await harness.advance(1);
            expect(serverDoc(harness).tree.nodes[firstId].comment).toBe("セッション切れ");
            expect(harness.sync.getStatus(TEST_STUDY_ID).state).toBe("synced");
        });

        it("未認証（401）のあと別のユーザーになったら、間隔を空けずに、そのユーザーとして扱う", async () => {
            const harness = await createSyncedHarness();
            harness.server.interceptOnce("postOps", { status: 401 });
            await harness.sync.applyOps(TEST_STUDY_ID, [comment("セッション切れ")]);
            await harness.sync.flush(TEST_STUDY_ID);

            harness.login(USER_B);
            await harness.advance(0);
            // 別のアカウントのノートは送らない。
            expect(harness.postOpsCalls()).toHaveLength(1);
            // 元のユーザーに戻れば、待たずに送る（401 の続いた回数は引き継がない）。
            harness.login(USER_A);
            await harness.advance(0);
            expect(serverDoc(harness).tree.nodes[firstId].comment).toBe("セッション切れ");
        });

        it("同じユーザーのまま 401 が続くときは、再送の間隔を延ばし、成功したら通常に戻る", async () => {
            const harness = await createSyncedHarness();
            // セッションは有効と言われるのに、API は 401 を返し続ける（サーバー側の障害）。
            const stop = harness.server.intercept("postOps", { status: 401 });
            // 画面と同じく、401 の知らせを受けるたびにセッションを取り直す（結果は同じユーザー）。
            let refreshes = 0;
            harness.sync.subscribeEvents((event) => {
                if (event.type !== "unauthorized") return;
                refreshes++;
                harness.login(USER_A);
            });
            await harness.sync.applyOps(TEST_STUDY_ID, [comment("401 が続く")]);
            await harness.sync.flush(TEST_STUDY_ID);
            expect(harness.postOpsCalls()).toHaveLength(1);

            // 待ち時間なしでは送り直さない。間隔は 2 秒 → 4 秒 → 8 秒 … と延びる。
            const attemptsAt: number[] = [];
            let elapsed = 0;
            for (const step of [1999, 1, 3999, 1, 7999, 1, 15_999, 1]) {
                await harness.advance(step);
                elapsed += step;
                attemptsAt.push(harness.postOpsCalls().length);
                // 取り直したセッションを同じユーザーとして何度伝えても、間隔は縮まない。
                harness.login(USER_A);
            }
            expect(attemptsAt).toEqual([1, 2, 2, 3, 3, 4, 4, 5]);
            // 待っている間は、保存の状態から「再送待ち」と分かる。
            await harness.advance(0);
            expect(harness.sync.getStatus(TEST_STUDY_ID)).toMatchObject({
                state: "pending",
                retrying: true,
            });
            expect(elapsed).toBe(30_000);
            expect(refreshes).toBe(5);
            // 上限（60 秒）を超えて延びない。
            await harness.advance(32_000);
            expect(harness.postOpsCalls()).toHaveLength(6);
            await harness.advance(59_999);
            expect(harness.postOpsCalls()).toHaveLength(6);
            await harness.advance(1);
            expect(harness.postOpsCalls()).toHaveLength(7);

            // サーバーが直ったら、次の再送で届き、通常に戻る。
            stop();
            await harness.advance(60_000);
            expect(serverDoc(harness).tree.nodes[firstId].comment).toBe("401 が続く");
            expect(harness.sync.getStatus(TEST_STUDY_ID).state).toBe("synced");
            // 以後の編集は、いつもどおりの間引き（5 秒）で送る。間隔を引きずらない。
            const sent = harness.postOpsCalls().length;
            await harness.sync.applyOps(TEST_STUDY_ID, [comment("直ったあと")]);
            await harness.advance(5000);
            expect(harness.postOpsCalls()).toHaveLength(sent + 1);
            expect(serverDoc(harness).tree.nodes[firstId].comment).toBe("直ったあと");
            // そのあとの 1 回の 401 は、最初の間隔（2 秒）からやり直す。
            harness.server.interceptOnce("postOps", { status: 401 });
            await harness.sync.applyOps(TEST_STUDY_ID, [comment("もう一度")]);
            await harness.sync.flush(TEST_STUDY_ID);
            await harness.advance(1999);
            expect(serverDoc(harness).tree.nodes[firstId].comment).toBe("直ったあと");
            await harness.advance(1);
            expect(serverDoc(harness).tree.nodes[firstId].comment).toBe("もう一度");
        });

        it("他人の studyId と衝突（409 ID_CONFLICT）: 保存に失敗と表示する", async () => {
            const harness = createHarness();
            harness.server.seed(USER_B, doc);
            harness.login(USER_A);
            await harness.sync.createStudy(doc);
            await harness.advance(0);
            expect(harness.sync.getStatus(TEST_STUDY_ID)).toMatchObject({
                state: "error",
                reason: "rejected",
            });
            expect((await harness.sync.load(TEST_STUDY_ID))?.remote).toMatchObject({
                state: "rejected",
                code: "ID_CONFLICT",
            });
        });
    });

    describe("開いたあとの最初の取り込み（最新の内容かどうか）", () => {
        const pulledEvents = (harness: Harness) =>
            harness.events.filter((event) => event.type === "pulled");

        it("開いた直後は取り込み前で、取り込めたら `done` になり、取り込んだ内容を書いてから知らせる", async () => {
            const harness = await createSyncedHarness();
            harness.server.applyFromOtherDevice(TEST_STUDY_ID, [comment("他の端末 C", rootId)]);
            // 取得の応答を手で止める。
            let release: () => void = () => {};
            harness.server.beforeHandle = async (call) => {
                if (call.method !== "get") return;
                await new Promise<void>((resolve) => {
                    release = resolve;
                });
            };
            const commentsAtPulled: string[] = [];
            harness.sync.subscribeEvents((event) => {
                if (event.type !== "pulled") return;
                void harness.sync
                    .load(TEST_STUDY_ID)
                    .then((study) =>
                        commentsAtPulled.push(study?.doc.tree.nodes[rootId].comment ?? ""),
                    );
            });

            // `open` は取り込みを待たずに、ローカルの内容を返す。
            const opened = await harness.sync.open(TEST_STUDY_ID);
            expect(opened.status).toBe("ok");
            expect(harness.sync.getPullState(TEST_STUDY_ID)).toBe("pending");
            await settle();
            expect(harness.sync.getPullState(TEST_STUDY_ID)).toBe("pending");
            expect(pulledEvents(harness)).toHaveLength(0);

            harness.server.beforeHandle = null;
            release();
            await harness.advance(0);
            expect(harness.sync.getPullState(TEST_STUDY_ID)).toBe("done");
            expect(pulledEvents(harness)).toEqual([{ type: "pulled", studyId: TEST_STUDY_ID }]);
            // 知らせを受けた時点で、取り込んだ内容が読める。
            expect(commentsAtPulled).toEqual(["他の端末 C"]);

            // 開き直すと、もう一度確かめ直す。
            await harness.sync.open(TEST_STUDY_ID);
            expect(harness.sync.getPullState(TEST_STUDY_ID)).toBe("pending");
            await harness.advance(0);
            expect(harness.sync.getPullState(TEST_STUDY_ID)).toBe("done");
            expect(pulledEvents(harness)).toHaveLength(2);
        });

        it("開き直す前に始めた取得が届いても `done` にせず、開き直したあとの取得で `done` になる", async () => {
            const harness = await createSyncedHarness();
            const releases: Array<() => void> = [];
            harness.server.beforeHandle = async (call) => {
                if (call.method !== "get") return;
                await new Promise<void>((resolve) => {
                    releases.push(resolve);
                });
            };

            await harness.sync.open(TEST_STUDY_ID);
            await settle();
            expect(releases).toHaveLength(1);
            // 最初の取得の応答を待っている間に、開き直す。
            await harness.sync.open(TEST_STUDY_ID);
            expect(harness.sync.getPullState(TEST_STUDY_ID)).toBe("pending");

            // 開き直す前に始めた取得が届いても、最新を確かめたことにはしない。
            releases[0]();
            await settle();
            expect(harness.sync.getPullState(TEST_STUDY_ID)).toBe("pending");
            expect(pulledEvents(harness)).toHaveLength(0);

            // 開き直したあとに始めた取得が届いて、はじめて `done` になる。
            expect(releases).toHaveLength(2);
            harness.server.beforeHandle = null;
            releases[1]();
            await harness.advance(0);
            expect(harness.sync.getPullState(TEST_STUDY_ID)).toBe("done");
            expect(pulledEvents(harness)).toHaveLength(1);
        });

        it("取り込めない間（オフライン・失敗）は `pending` のままで、取り込めたら `done` になる", async () => {
            const harness = await createSyncedHarness();
            const stop = harness.server.intercept("get", "offline");
            await harness.sync.open(TEST_STUDY_ID);
            await harness.advance(0);
            expect(harness.sync.getPullState(TEST_STUDY_ID)).toBe("pending");
            await harness.advance(120_000);
            expect(harness.sync.getPullState(TEST_STUDY_ID)).toBe("pending");
            expect(pulledEvents(harness)).toHaveLength(0);

            stop();
            await harness.sync.refreshOpen();
            expect(harness.sync.getPullState(TEST_STUDY_ID)).toBe("done");
            expect(pulledEvents(harness)).toHaveLength(1);
        });

        it("取り込む相手がいないノート（匿名・サーバーに未作成）は `not_needed`", async () => {
            const harness = createHarness();
            // 未ログインで作った匿名のノート。
            await harness.sync.createStudy(doc);
            await harness.sync.open(TEST_STUDY_ID);
            await harness.advance(0);
            expect(harness.sync.getPullState(TEST_STUDY_ID)).toBe("not_needed");
            // 開いていない・知らないノート。
            expect(harness.sync.getPullState("unknown")).toBe("not_needed");

            // ログイン中に作ったが、まだサーバーに作れていないノート。
            const offline = createHarness();
            offline.server.intercept("*", "offline");
            offline.login(USER_A);
            await offline.sync.createStudy(doc);
            await offline.sync.open(TEST_STUDY_ID);
            await offline.advance(0);
            expect(offline.sync.getPullState(TEST_STUDY_ID)).toBe("not_needed");
        });

        it("ログインし直したあとに開き直すと、取り込みが済むまで `pending` に戻る", async () => {
            const harness = await createSyncedHarness();
            await harness.sync.open(TEST_STUDY_ID);
            await harness.advance(0);
            expect(harness.sync.getPullState(TEST_STUDY_ID)).toBe("done");

            // ログアウトしている間に、他の端末がコメントを書いた。
            harness.login(null);
            expect(harness.sync.getPullState(TEST_STUDY_ID)).toBe("not_needed");
            harness.server.applyFromOtherDevice(TEST_STUDY_ID, [comment("他の端末 C", rootId)]);
            harness.login(USER_A);
            expect(harness.sync.getPullState(TEST_STUDY_ID)).toBe("pending");
            await harness.sync.open(TEST_STUDY_ID);
            expect(harness.sync.getPullState(TEST_STUDY_ID)).toBe("pending");
            await harness.advance(0);
            expect(harness.sync.getPullState(TEST_STUDY_ID)).toBe("done");
            expect((await localDoc(harness)).tree.nodes[rootId].comment).toBe("他の端末 C");
        });

        it("401 のあとの待機中に頼まれた取り込みは、待機が明けたら自動でやり直す", async () => {
            const harness = await createSyncedHarness();
            // 取得が 401 になり、取り直したセッションは同じユーザーだった。
            harness.server.interceptOnce("get", { status: 401 });
            await harness.sync.open(TEST_STUDY_ID);
            await harness.advance(0);
            expect(harness.events).toContainEqual({ type: "unauthorized" });
            harness.login(USER_A);
            harness.server.applyFromOtherDevice(TEST_STUDY_ID, [comment("他の端末 C", rootId)]);
            const getCalls = () => harness.server.calls.filter((call) => call.method === "get");
            const before = getCalls().length;

            // 待機中に取り込みを頼んでも、まだ取得しない。
            await harness.sync.refreshOpen();
            await harness.advance(1999);
            expect(getCalls()).toHaveLength(before);
            expect(harness.sync.getPullState(TEST_STUDY_ID)).toBe("pending");

            // 待機が明けたら、送信待ちが無くても、開いているノートを取り込む。
            await harness.advance(1);
            expect(getCalls()).toHaveLength(before + 1);
            expect(harness.sync.getPullState(TEST_STUDY_ID)).toBe("done");
            expect((await localDoc(harness)).tree.nodes[rootId].comment).toBe("他の端末 C");
        });
    });

    describe("複数タブ", () => {
        const createTabs = () => {
            const server = createFakeStudyServer();
            const store = createStore();
            const locks = createInProcessLockManager();
            const hub = createChannelHub();
            const scheduler = createManualScheduler();
            let batch = 0;
            const createTab = () => {
                const sync = createStudySync({
                    store,
                    api: server.apiFor(() => USER_A),
                    locks,
                    channel: hub.join(),
                    scheduler,
                    now: scheduler.now,
                    randomId: () => batchUuid(++batch),
                });
                sync.setSession({ userId: USER_A });
                const events: StudySyncEvent[] = [];
                sync.subscribeEvents((event) => events.push(event));
                return { sync, events };
            };
            return { server, scheduler, tabA: createTab(), tabB: createTab() };
        };

        it("2 つの送信役が同時に動いても、送信は 1 つずつで、どの操作も 1 回だけ届く", async () => {
            const { server, tabA, tabB } = createTabs();
            await tabA.sync.createStudy(doc);
            await Promise.all([tabA.sync.flush(TEST_STUDY_ID), tabB.sync.flush(TEST_STUDY_ID)]);
            expect(server.calls.filter((call) => call.method === "create")).toHaveLength(1);

            // 両方のタブで編集し、同時に送る。
            await Promise.all([
                tabA.sync.applyOps(TEST_STUDY_ID, [comment("A の編集", rootId)]),
                tabB.sync.applyOps(TEST_STUDY_ID, [comment("B の編集", firstId)]),
                tabA.sync.applyOps(TEST_STUDY_ID, analysisOps(firstId, 50)),
                tabB.sync.applyOps(TEST_STUDY_ID, analysisOps(rootId, 20)),
            ]);
            await Promise.all([
                tabA.sync.flush(TEST_STUDY_ID),
                tabB.sync.flush(TEST_STUDY_ID),
                tabA.sync.flush(TEST_STUDY_ID),
                tabB.sync.flush(TEST_STUDY_ID),
            ]);

            const postOps = server.calls.filter((call) => call.method === "postOps");
            expect(server.maxConcurrentPostOps).toBe(1);
            // 競合（409）も再送（replayed）も起きず、操作の重複も無い。
            expect(postOps.every((call) => call.status === 200)).toBe(true);
            const sentOps = postOps.flatMap((call) => (call.body as StudyOpsRequest).ops);
            expect(sentOps).toHaveLength(5);
            const batchIds = postOps.map((call) => (call.body as StudyOpsRequest).batchId);
            expect(new Set(batchIds).size).toBe(batchIds.length);

            const local = (await tabA.sync.load(TEST_STUDY_ID))?.doc as StudyDocument;
            expect(server.study(TEST_STUDY_ID)).toMatchObject({
                tree: local.tree,
                layers: local.layers,
            });
            expect(tabA.sync.getStatus(TEST_STUDY_ID).state).toBe("synced");
            await settle();
            expect((await tabB.sync.load(TEST_STUDY_ID))?.doc).toEqual(local);
            expect(tabB.sync.getStatus(TEST_STUDY_ID).state).toBe("synced");
        });

        it("変更を他のタブに知らせ、他のタブは保存の状態と文書を読み直せる", async () => {
            const { scheduler, tabA, tabB } = createTabs();
            await tabA.sync.createStudy(doc);
            await tabA.sync.flush(TEST_STUDY_ID);
            const statusChanges: string[] = [];
            tabB.sync.subscribeStatus(TEST_STUDY_ID, () =>
                statusChanges.push(tabB.sync.getStatus(TEST_STUDY_ID).state),
            );

            await tabA.sync.applyOps(TEST_STUDY_ID, [comment("A の編集")]);
            // 通知はまとめて 1 回だけ読み直す。
            scheduler.advance(250);
            await settle();
            expect(tabB.events).toContainEqual({
                type: "document",
                studyId: TEST_STUDY_ID,
                origin: "other-tab",
            });
            expect(tabB.sync.getStatus(TEST_STUDY_ID)).toMatchObject({
                state: "pending",
                pendingCount: 1,
            });
            expect((await tabB.sync.load(TEST_STUDY_ID))?.doc.tree.nodes[firstId].comment).toBe(
                "A の編集",
            );

            // A が送ったあとは、B も「クラウドに保存済み」になる。
            await tabA.sync.flush(TEST_STUDY_ID);
            scheduler.advance(250);
            await settle();
            expect(tabB.sync.getStatus(TEST_STUDY_ID).state).toBe("synced");
            expect(statusChanges).toEqual(expect.arrayContaining(["pending", "synced"]));
        });
    });

    describe("未ログインからの引き継ぎ", () => {
        it("未ログイン中のノートは匿名でブラウザ内に保存し、サーバーには送らない", async () => {
            const harness = createHarness();
            const created = await harness.sync.createStudy(doc);
            expect(created.owner).toBeNull();
            await harness.sync.applyOps(TEST_STUDY_ID, [comment("未ログインの編集")]);
            await harness.advance(60_000);
            expect(harness.server.calls).toEqual([]);
            expect(harness.sync.getStatus(TEST_STUDY_ID)).toMatchObject({
                state: "local",
                reason: "anonymous",
            });
        });

        it("ログイン後に引き継ぐと、持ち主を固定し、同じ studyId で作成して成果を送る", async () => {
            const harness = createHarness();
            await harness.sync.createStudy(doc);
            await harness.sync.applyOps(TEST_STUDY_ID, [
                comment("未ログインの編集"),
                ...analysisOps(firstId, 120),
            ]);
            // ログインへ遷移する前に、書き込みが終わっていることを確かめられる。
            await harness.sync.whenLocalWritesSettled();

            harness.login(USER_A);
            await harness.advance(60_000);
            // ログインしただけでは送らない（引き継ぎの起動が要る）。
            expect(harness.server.calls).toEqual([]);

            expect(await harness.sync.adoptAnonymousStudies()).toEqual([TEST_STUDY_ID]);
            await harness.advance(0);
            expect((await harness.sync.load(TEST_STUDY_ID))?.owner).toBe(USER_A);
            const local = await localDoc(harness);
            expect(harness.server.study(TEST_STUDY_ID)).toMatchObject({
                id: TEST_STUDY_ID,
                tree: local.tree,
                layers: local.layers,
            });
            // 作成ではツリーだけを送り（コメントはツリーに含まれる）、レイヤーと結果は操作バッチで送る。
            const creates = harness.server.calls.filter((call) => call.method === "create");
            expect(creates).toHaveLength(1);
            expect((creates[0].body as { layers?: unknown[] }).layers ?? []).toEqual([]);
            expect(
                harness.postOpsCalls().map((call) => call.body.ops.map((op) => op.type)),
            ).toEqual([["ensureLayer", "putAnalysis"]]);
            expect(harness.sync.getStatus(TEST_STUDY_ID)).toMatchObject({
                state: "synced",
                pendingCount: 0,
            });
            // もう一度呼んでも、引き継ぐものは無い。
            expect(await harness.sync.adoptAnonymousStudies()).toEqual([]);
        });

        it("同じ元棋譜のノートが既にあれば（ORIGIN_EXISTS）、成果をそのノートに統合する", async () => {
            const origin = { kind: "rshogi_csa", ref: "wdoor-20261009000001-93ef4d36a6" } as const;
            const existingId = "0d9f5c3a-2b7e-4c1d-9a55-1f2e3d4c5b6a";
            const harness = createHarness();
            // 別の端末で、同じ棋譜から作ってコメントを付けたノートがある。
            harness.server.seed(
                USER_A,
                applyStudyOps(
                    createTestDocument({ id: existingId, origin, title: "既存のノート" }),
                    [comment("既存のコメント", rootId)],
                ),
            );

            await harness.sync.createStudy(createTestDocument({ origin }));
            const branch = studyChildNodeId(firstId, "8c8d");
            await harness.sync.applyOps(TEST_STUDY_ID, [
                { type: "addMoves", parentId: firstId, moves: ["8c8d"] },
                comment("未ログイン中のコメント"),
                ...analysisOps(branch, -200),
            ]);

            harness.login(USER_A);
            await harness.sync.adoptAnonymousStudies();
            await harness.advance(0);
            await harness.advance(0);

            expect(harness.events).toContainEqual({
                type: "merged",
                studyId: TEST_STUDY_ID,
                into: existingId,
            });
            expect(await harness.sync.open(TEST_STUDY_ID)).toEqual({
                status: "merged",
                into: existingId,
            });
            // 成果は捨てず、既存のノートに操作バッチとして入る。
            const merged = harness.server.study(existingId);
            expect(merged?.title).toBe("既存のノート");
            expect(merged?.tree.nodes[rootId].comment).toBe("既存のコメント");
            expect(merged?.tree.nodes[firstId].comment).toBe("未ログイン中のコメント");
            expect(merged?.tree.nodes[branch]).toBeDefined();
            expect(merged?.layers[0].results[branch]).toBeDefined();
            expect(harness.server.study(TEST_STUDY_ID)).toBeNull();

            const local = await harness.sync.load(existingId);
            expect(local).toMatchObject({ owner: USER_A, serverRevision: merged?.revision });
            expect(local?.doc.tree).toEqual(merged?.tree);
            expect(harness.sync.getStatus(existingId).state).toBe("synced");
            // 統合済みのノートは一覧に出ず、同じ棋譜の検索は統合先を返す。
            expect((await harness.sync.listLocal()).map((item) => item.id)).toEqual([existingId]);
            expect(await harness.sync.findLocalByOrigin(origin)).toBe(existingId);
            await expect(
                harness.sync.applyOps(TEST_STUDY_ID, [comment("x")]),
            ).rejects.toMatchObject({
                code: "merged",
            });
        });

        it("引き継ぎの途中で別のアカウントに切り替わったら、古いアカウントのものにしない", async () => {
            const harness = createHarness();
            await harness.sync.createStudy(createTestDocument());
            await harness.sync.whenLocalWritesSettled();

            harness.login(USER_A);
            // 一覧の読み込みを待っている間に、別のアカウントへ切り替わる。
            const adopting = harness.sync.adoptAnonymousStudies();
            harness.login(USER_B);
            expect(await adopting).toEqual([]);
            expect((await harness.sync.load(TEST_STUDY_ID))?.owner).toBeNull();

            // 切り替え後のアカウントで、あらためて引き継げる。
            expect(await harness.sync.adoptAnonymousStudies()).toEqual([TEST_STUDY_ID]);
            expect((await harness.sync.load(TEST_STUDY_ID))?.owner).toBe(USER_B);
        });

        it("あるアカウントのものになったノートは、別のアカウントでログインしても送らない", async () => {
            const harness = await createSyncedHarness();
            // 持ち主のアカウントで編集し、送信される前に別のアカウントに切り替わった。
            await harness.sync.applyOps(TEST_STUDY_ID, [comment("送信前の編集")]);
            const callsBefore = harness.server.calls.length;

            harness.login(USER_B);
            expect(await harness.sync.adoptAnonymousStudies()).toEqual([]);
            await harness.sync.flush();
            await harness.advance(120_000);
            expect(harness.server.calls).toHaveLength(callsBefore);
            expect(harness.sync.getStatus(TEST_STUDY_ID)).toMatchObject({
                state: "local",
                reason: "other_account",
                pendingCount: 1,
            });
            // 別のアカウントからは、読めず、編集できず、「同じ棋譜のノート」としても返らない。
            expect(await harness.sync.load(TEST_STUDY_ID)).toBeNull();
            await expect(
                harness.sync.applyOps(TEST_STUDY_ID, [comment("別アカウントの編集")]),
            ).rejects.toMatchObject({ code: "not_found" });
            expect(await harness.sync.findLocalByOrigin({ kind: "paste", ref: null })).toBeNull();
            expect((await harness.store.read(TEST_STUDY_ID)).study?.owner).toBe(USER_A);

            // ログアウト中も送らない。
            harness.login(null);
            await harness.advance(120_000);
            expect(harness.server.calls).toHaveLength(callsBefore);
            expect(harness.sync.getStatus(TEST_STUDY_ID).reason).toBe("signed_out");

            // 元のアカウントに戻ると、溜まっていた操作が送られる。
            harness.login(USER_A);
            await harness.advance(0);
            expect(serverDoc(harness).tree.nodes[firstId].comment).toBe("送信前の編集");
            expect(harness.sync.getStatus(TEST_STUDY_ID).state).toBe("synced");
        });
    });

    describe("ノートを開く・取り込む・削除する", () => {
        it("ローカルに無いノートは、ログイン中ならサーバーから取得して保存する", async () => {
            const harness = createHarness();
            harness.server.seed(USER_A, doc);
            expect(await harness.sync.open(TEST_STUDY_ID)).toEqual({ status: "not_found" });

            harness.login(USER_A);
            const opened = await harness.sync.open(TEST_STUDY_ID);
            expect(opened).toMatchObject({
                status: "ok",
                study: { id: TEST_STUDY_ID, owner: USER_A, serverRevision: 1, doc },
            });
            expect(harness.sync.getStatus(TEST_STUDY_ID).state).toBe("synced");
            expect(await harness.sync.open("missing")).toEqual({ status: "not_found" });

            harness.server.interceptOnce("get", "offline");
            expect(await harness.sync.open("offline-study")).toMatchObject({
                status: "unavailable",
            });
        });

        it("他人のノートは存在しないものとして扱う", async () => {
            const harness = createHarness();
            harness.server.seed(USER_B, doc);
            harness.login(USER_A);
            expect(await harness.sync.open(TEST_STUDY_ID)).toEqual({ status: "not_found" });
            expect(await harness.sync.load(TEST_STUDY_ID)).toBeNull();
        });

        it("開いたとき・タブに戻ったときに、他の端末の変更を取り込む", async () => {
            const harness = await createSyncedHarness();
            harness.server.applyFromOtherDevice(TEST_STUDY_ID, [comment("他の端末で編集")]);
            const opened = await harness.sync.open(TEST_STUDY_ID);
            // まずローカルの内容をすぐ返し、取り込みは裏で行う。
            expect(opened).toMatchObject({ status: "ok" });
            await settle();
            expect((await localDoc(harness)).tree.nodes[firstId].comment).toBe("他の端末で編集");
            expect((await harness.sync.load(TEST_STUDY_ID))?.serverRevision).toBe(2);

            harness.server.applyFromOtherDevice(TEST_STUDY_ID, [comment("さらに編集")]);
            await harness.sync.refreshOpen();
            expect((await localDoc(harness)).tree.nodes[firstId].comment).toBe("さらに編集");

            // 閉じたノートは取り込みの対象から外れる。
            harness.sync.close(TEST_STUDY_ID);
            harness.server.applyFromOtherDevice(TEST_STUDY_ID, [comment("閉じたあと")]);
            await harness.sync.refreshOpen();
            expect((await localDoc(harness)).tree.nodes[firstId].comment).toBe("さらに編集");
        });

        it("取り込みは未送信の操作を保ったまま行い、続けて送る", async () => {
            const harness = await createSyncedHarness();
            await harness.sync.applyOps(TEST_STUDY_ID, [comment("未送信", rootId)]);
            harness.server.applyFromOtherDevice(TEST_STUDY_ID, [comment("他の端末")]);
            await harness.sync.pull(TEST_STUDY_ID);
            const local = await localDoc(harness);
            expect(local.tree.nodes[rootId].comment).toBe("未送信");
            expect(local.tree.nodes[firstId].comment).toBe("他の端末");
            expect(serverDoc(harness).tree).toEqual(local.tree);
            // 取り込んだあとの送信は競合しない。
            expect(harness.postOpsCalls().map((call) => call.status)).toEqual([200]);
        });

        it("削除: クラウドにあるノートはサーバーからも消し、匿名のノートはローカルだけ消す", async () => {
            const harness = await createSyncedHarness();
            await harness.sync.deleteStudy(TEST_STUDY_ID);
            expect(harness.server.study(TEST_STUDY_ID)).toBeNull();
            expect(await harness.sync.load(TEST_STUDY_ID)).toBeNull();
            expect(await harness.sync.listLocal()).toEqual([]);
            expect(harness.events).toContainEqual({ type: "removed", studyId: TEST_STUDY_ID });

            const anonymous = createHarness();
            await anonymous.sync.createStudy(doc);
            await anonymous.sync.deleteStudy(TEST_STUDY_ID);
            expect(await anonymous.sync.load(TEST_STUDY_ID)).toBeNull();
            expect(anonymous.server.calls).toEqual([]);
        });

        it("オフライン中の削除は、戻ったときにサーバーへ伝える", async () => {
            const harness = await createSyncedHarness();
            const goOnline = harness.server.intercept("delete", "offline");
            await harness.sync.deleteStudy(TEST_STUDY_ID);
            expect(await harness.sync.listLocal()).toEqual([]);
            expect(await harness.sync.open(TEST_STUDY_ID)).toEqual({ status: "not_found" });
            expect(harness.server.study(TEST_STUDY_ID)).not.toBeNull();
            goOnline();
            await harness.advance(2000);
            expect(harness.server.study(TEST_STUDY_ID)).toBeNull();
            expect(await harness.sync.load(TEST_STUDY_ID)).toBeNull();
        });

        it("一覧は保存の状態つきで返し、同じ元棋譜のノートを探せる", async () => {
            const origin = { kind: "game_record", ref: "game-1" } as const;
            const harness = createHarness();
            harness.login(USER_A);
            await harness.sync.createStudy(createTestDocument({ origin }));
            await harness.advance(0);
            await harness.sync.applyOps(TEST_STUDY_ID, [comment("編集")]);
            const list = await harness.sync.listLocal();
            expect(list).toHaveLength(1);
            expect(list[0]).toMatchObject({
                id: TEST_STUDY_ID,
                title: "RAMU 対 Panda",
                origin,
                nodeCount: 3,
                pendingCount: 1,
                status: { state: "pending", pendingCount: 1 },
            });
            expect(await harness.sync.findLocalByOrigin(origin)).toBe(TEST_STUDY_ID);
            expect(
                await harness.sync.findLocalByOrigin({ kind: "game_record", ref: "game-2" }),
            ).toBe(null);
        });
    });

    describe("保存の状態の購読と、保存層の失敗", () => {
        it("内容が変わるまで同じ参照を返し、変わったときだけ通知する", async () => {
            const harness = await createSyncedHarness();
            let notified = 0;
            const unsubscribe = harness.sync.subscribeStatus(TEST_STUDY_ID, () => {
                notified += 1;
            });
            const before = harness.sync.getStatus(TEST_STUDY_ID);
            await harness.sync.load(TEST_STUDY_ID);
            expect(harness.sync.getStatus(TEST_STUDY_ID)).toBe(before);
            expect(notified).toBe(0);

            await harness.sync.applyOps(TEST_STUDY_ID, [comment("編集")]);
            expect(notified).toBe(1);
            expect(harness.sync.getStatus(TEST_STUDY_ID)).not.toBe(before);
            unsubscribe();
            await harness.sync.flush(TEST_STUDY_ID);
            expect(notified).toBe(1);
        });

        it("ブラウザ内に書けないときは、操作を拒否して「保存に失敗」と表示する（黙って失わない）", async () => {
            const inner = createMemoryStudyStore();
            let failure: StudyStorageError | null = null;
            const store: StudyStore = {
                ...inner,
                transact(studyId, mutate) {
                    if (failure) return Promise.reject(failure);
                    return inner.transact(studyId, mutate);
                },
            };
            const harness = createHarness({ store });
            await harness.sync.createStudy(doc);

            failure = new StudyStorageError("quota_exceeded", "ブラウザの保存容量が足りません");
            await expect(harness.sync.applyOps(TEST_STUDY_ID, [comment("書けない")])).rejects.toBe(
                failure,
            );
            expect(harness.sync.getStatus(TEST_STUDY_ID)).toMatchObject({
                state: "error",
                reason: "storage_quota",
                message: "ブラウザの保存容量が足りません",
            });
            expect((await localDoc(harness)).tree.nodes[firstId].comment).toBe("");

            failure = new StudyStorageError("unavailable", "使えません");
            await expect(harness.sync.applyOps(TEST_STUDY_ID, [comment("書けない")])).rejects.toBe(
                failure,
            );
            expect(harness.sync.getStatus(TEST_STUDY_ID).reason).toBe("storage_unavailable");

            // 書けるようになったら、状態も戻る。
            failure = null;
            await harness.sync.applyOps(TEST_STUDY_ID, [comment("書けた")]);
            expect(harness.sync.getStatus(TEST_STUDY_ID)).toMatchObject({
                state: "local",
                reason: "anonymous",
            });
        });

        it("呼んだ順に適用し、whenLocalWritesSettled で書き込みの完了を待てる", async () => {
            const harness = createHarness();
            await harness.sync.createStudy(doc);
            void harness.sync.applyOps(TEST_STUDY_ID, [comment("1")]);
            void harness.sync.applyOps(TEST_STUDY_ID, [comment("2")]);
            void harness.sync.applyOps(TEST_STUDY_ID, [comment("3")]);
            await harness.sync.whenLocalWritesSettled();
            expect((await localDoc(harness)).tree.nodes[firstId].comment).toBe("3");
        });

        it("dispose のあとは送信を予定しない", async () => {
            const harness = await createSyncedHarness();
            harness.sync.dispose();
            await harness.sync.applyOps(TEST_STUDY_ID, [comment("破棄後")]);
            await harness.advance(60_000);
            expect(harness.postOpsCalls()).toEqual([]);
        });
    });

    describe("レビュー 1 巡目の指摘の再現", () => {
        const origin = { kind: "rshogi_csa", ref: "wdoor-20261009000001-93ef4d36a6" } as const;
        const existingId = "0d9f5c3a-2b7e-4c1d-9a55-1f2e3d4c5b6a";
        const specOf = (timeMs: number): StudyLayerSpec => ({
            ...spec,
            limits: { ...spec.limits, timeMs },
        });
        const resultOf = (depth: number): StudyOp & { type: "putAnalysis" } => ({
            type: "putAnalysis",
            layerId: studyLayerId(spec),
            nodeId: firstId,
            result: {
                runId: "9d6783f2-d773-4572-ae4e-bd463bf8f816",
                completion: "completed",
                depth,
                nodes: null,
                timeMs: null,
                execution: { threads: null, hashMb: null, parallelWorkers: null },
                candidates: [
                    { rank: 1, score: { kind: "cp", value: 1 }, depth, seldepth: null, pv: [] },
                ],
            },
        });

        it("統合: 既存ノートの取得を待つあいだに保存した編集も、統合先に入る", async () => {
            const harness = createHarness();
            harness.server.seed(USER_A, createTestDocument({ id: existingId, origin }));
            await harness.sync.createStudy(createTestDocument({ origin }));
            await harness.sync.applyOps(TEST_STUDY_ID, [comment("統合の前の編集", rootId)]);
            harness.login(USER_A);

            // 既存ノートの GET の応答を待っているあいだに、利用者が元のノートを編集する。
            let editedDuringGet = false;
            harness.server.beforeHandle = async (call) => {
                if (call.method !== "get" || call.studyId !== existingId || editedDuringGet) return;
                editedDuringGet = true;
                await harness.sync.applyOps(TEST_STUDY_ID, [comment("取得待ち中の編集")]);
            };
            await harness.sync.adoptAnonymousStudies();
            await harness.advance(0);
            await harness.advance(0);

            expect(editedDuringGet).toBe(true);
            const merged = harness.server.study(existingId);
            expect(merged?.tree.nodes[rootId].comment).toBe("統合の前の編集");
            expect(merged?.tree.nodes[firstId].comment).toBe("取得待ち中の編集");
            expect((await harness.sync.load(existingId))?.doc.tree).toEqual(merged?.tree);
            expect(harness.sync.getStatus(existingId).state).toBe("synced");
            const source = await harness.sync.load(TEST_STUDY_ID);
            expect(source).toMatchObject({ mergedInto: existingId, mergePending: false });
            // 統合済みになったあとの編集は、取り残されないよう拒否される。
            await expect(
                harness.sync.applyOps(TEST_STUDY_ID, [comment("x")]),
            ).rejects.toMatchObject({
                code: "merged",
            });
        });

        it("統合: 取り込みの途中で止まっても、次の同期で続きから取り込む", async () => {
            const harness = createHarness();
            harness.server.seed(USER_A, createTestDocument({ id: existingId, origin }));
            await harness.sync.createStudy(createTestDocument({ origin }));
            await harness.sync.applyOps(TEST_STUDY_ID, [comment("匿名のコメント")]);
            // 統合済みにした直後（取り込みの前）でタブが閉じられた状態を作る。
            await harness.store.transact(TEST_STUDY_ID, (snapshot) => ({
                study: {
                    ...(snapshot.study as NonNullable<typeof snapshot.study>),
                    owner: USER_A,
                    mergedInto: existingId,
                    mergePending: true,
                },
                removeOpsUpTo: Number.MAX_SAFE_INTEGER,
                result: undefined,
            }));

            harness.login(USER_A);
            await harness.advance(0);
            await harness.advance(0);
            expect(harness.server.study(existingId)?.tree.nodes[firstId].comment).toBe(
                "匿名のコメント",
            );
            expect((await harness.sync.load(TEST_STUDY_ID))?.mergePending).toBe(false);
        });

        it("統合: 同じノードの両方にコメントがあれば、既存側の後ろに匿名側をつなぐ", async () => {
            const harness = createHarness();
            const long = "あ".repeat(1300);
            harness.server.seed(
                USER_A,
                applyStudyOps(createTestDocument({ id: existingId, origin }), [
                    comment("既存のコメント", rootId),
                    comment("同じコメント", firstId),
                    comment(long, secondId),
                ]),
            );
            await harness.sync.createStudy(createTestDocument({ origin }));
            await harness.sync.applyOps(TEST_STUDY_ID, [
                comment("匿名のコメント", rootId),
                comment("同じコメント", firstId),
                // つなぐと 4 KiB を超えるので、既存側を残す。
                comment("い".repeat(100), secondId),
            ]);
            harness.login(USER_A);
            await harness.sync.adoptAnonymousStudies();
            await harness.advance(0);
            await harness.advance(0);

            const nodes = harness.server.study(existingId)?.tree.nodes;
            expect(nodes?.[rootId].comment).toBe("既存のコメント\n\n匿名のコメント");
            expect(nodes?.[firstId].comment).toBe("同じコメント");
            expect(nodes?.[secondId].comment).toBe(long);
            expect(harness.sync.getStatus(existingId).state).toBe("synced");
        });

        it("作成の再送で existing が返ったら、サーバーの最新の文書を取り込んでから続ける", async () => {
            const harness = createHarness();
            // 同じ ID のノートがサーバーにあり、他の端末が変更している（リビジョン 2）。
            harness.server.seed(USER_A, doc);
            harness.server.applyFromOtherDevice(TEST_STUDY_ID, [
                comment("他の端末のコメント", rootId),
                { type: "addMoves", parentId: firstId, moves: ["8c8d"] },
            ]);
            harness.login(USER_A);
            await harness.sync.createStudy(doc);
            await harness.sync.applyOps(TEST_STUDY_ID, [comment("この端末のコメント")]);
            await harness.sync.flush(TEST_STUDY_ID);

            const creates = harness.server.calls.filter((call) => call.method === "create");
            expect(creates.map((call) => call.status)).toEqual([200]);
            const local = await localDoc(harness);
            // サーバーの変更がローカルに入り、未送信の操作も保たれて送られる。
            expect(local.tree.nodes[rootId].comment).toBe("他の端末のコメント");
            expect(local.tree.nodes[studyChildNodeId(firstId, "8c8d")]).toBeDefined();
            expect(local.tree.nodes[firstId].comment).toBe("この端末のコメント");
            expect(serverDoc(harness).tree).toEqual(local.tree);
            expect((await harness.sync.load(TEST_STUDY_ID))?.serverRevision).toBe(3);
            expect(harness.sync.getStatus(TEST_STUDY_ID).state).toBe("synced");
        });

        it("作成の再送で existing が返ったが、サーバーで削除済みなら「削除済み」になる", async () => {
            const harness = createHarness();
            harness.server.seed(USER_A, doc);
            harness.login(USER_A);
            await harness.sync.createStudy(doc);
            // 作成の応答のあと、取得までのあいだに他の端末が削除した。
            harness.server.beforeHandle = async (call) => {
                if (call.method === "get") harness.server.remove(TEST_STUDY_ID);
            };
            await harness.sync.flush(TEST_STUDY_ID);
            expect(harness.sync.getStatus(TEST_STUDY_ID)).toMatchObject({
                state: "error",
                reason: "deleted_remotely",
            });
        });

        it("サーバーが受け付けない操作は、保存も送信待ちへの追加もせずに型つきのエラーで拒否する", async () => {
            const harness = await createSyncedHarness();
            const before = await localDoc(harness);
            const cases: Array<{ ops: StudyOp[]; limit?: string; name: string }> = [
                {
                    name: "StudyLimitError",
                    limit: "commentBytes",
                    // 4 KiB（UTF-8）を超えるコメント。前の正しい操作ごと拒否される。
                    ops: [comment("手前の操作"), comment("あ".repeat(1366))],
                },
                {
                    name: "StudyLimitError",
                    limit: "titleLength",
                    ops: [{ type: "setTitle", value: "題".repeat(201) }],
                },
                {
                    name: "StudyLimitError",
                    limit: "multiPv",
                    ops: [
                        {
                            type: "ensureLayer",
                            spec: { ...spec, multiPv: 6 },
                            display: { label: "x" },
                        },
                    ],
                },
                {
                    name: "StudyOpError",
                    // rank の重複。
                    ops: [
                        ...analysisOps(firstId, 1).slice(0, 1),
                        {
                            ...resultOf(10),
                            result: {
                                ...resultOf(10).result,
                                candidates: [
                                    ...resultOf(10).result.candidates,
                                    ...resultOf(10).result.candidates,
                                ],
                            },
                        },
                    ],
                },
                {
                    name: "StudyOpError",
                    // rank 1 の無い結果。
                    ops: [
                        ...analysisOps(firstId, 1).slice(0, 1),
                        {
                            ...resultOf(10),
                            result: {
                                ...resultOf(10).result,
                                candidates: [{ ...resultOf(10).result.candidates[0], rank: 2 }],
                            },
                        },
                    ],
                },
                {
                    name: "StudyOpError",
                    // UUID でない runId。
                    ops: [
                        ...analysisOps(firstId, 1).slice(0, 1),
                        { ...resultOf(10), result: { ...resultOf(10).result, runId: "run-1" } },
                    ],
                },
            ];
            for (const item of cases) {
                const error = await harness.sync
                    .applyOps(TEST_STUDY_ID, item.ops)
                    .catch((caught: unknown) => caught);
                expect(error).toBeInstanceOf(StudyOpError);
                expect((error as Error).name).toBe(item.name);
                if (item.limit) {
                    expect(error).toBeInstanceOf(StudyLimitError);
                    expect((error as StudyLimitError).limit).toBe(item.limit);
                }
            }
            // 何も保存されず、送信待ちにも入らない。保存の状態も「保存に失敗」にはならない。
            expect(await localDoc(harness)).toEqual(before);
            expect(harness.sync.getStatus(TEST_STUDY_ID)).toMatchObject({
                state: "synced",
                pendingCount: 0,
            });
            // レイヤー数の上限（8）。9 個目で拒否される。
            for (let i = 0; i < 8; i++) {
                await harness.sync.applyOps(TEST_STUDY_ID, [
                    { type: "ensureLayer", spec: specOf(1000 + i), display: { label: `L${i}` } },
                ]);
            }
            await expect(
                harness.sync.applyOps(TEST_STUDY_ID, [
                    { type: "ensureLayer", spec: specOf(9999), display: { label: "L9" } },
                ]),
            ).rejects.toMatchObject({ name: "StudyLimitError", limit: "layersPerStudy" });
            // そのあとの正しい操作は普通に保存・送信できる。
            await harness.sync.applyOps(TEST_STUDY_ID, [comment("正しい操作")]);
            await harness.sync.flush(TEST_STUDY_ID);
            expect(harness.sync.getStatus(TEST_STUDY_ID).state).toBe("synced");
        });

        it("サーバーにコメントの上限超過で拒否されても、短く直せば次の送信で通る", async () => {
            const harness = await createSyncedHarness();
            // クライアントの検証は通るが、サーバーは拒否する状況（上限が食い違った場合）。
            harness.server.limits.commentBytes = 30;
            await harness.sync.applyOps(TEST_STUDY_ID, [
                comment("ルートのコメント", rootId),
                comment("長すぎるコメント".repeat(4)),
            ]);
            await harness.sync.flush(TEST_STUDY_ID);
            expect(harness.sync.getStatus(TEST_STUDY_ID)).toMatchObject({
                state: "limit_exceeded",
                limit: "commentBytes",
            });
            expect(serverDoc(harness).tree.nodes[rootId].comment).toBe("");

            await harness.sync.applyOps(TEST_STUDY_ID, [comment("短いコメント")]);
            await harness.advance(5000);
            // 拒否された操作の列は送り直さず、サーバーの文書との差分だけを送る。
            const calls = harness.postOpsCalls();
            expect(calls.map((call) => call.status)).toEqual([422, 200]);
            expect(calls[1].body.ops).toEqual([
                comment("ルートのコメント", rootId),
                comment("短いコメント"),
            ]);
            expect(serverDoc(harness).tree).toEqual((await localDoc(harness)).tree);
            expect(harness.sync.getStatus(TEST_STUDY_ID)).toMatchObject({
                state: "synced",
                pendingCount: 0,
            });
        });

        it("サーバーにノード数の上限超過で拒否されても、枝を削れば次の送信で通る", async () => {
            const harness = await createSyncedHarness();
            harness.server.limits.nodesPerStudy = 4;
            const branch = studyChildNodeId(firstId, "8c8d");
            await harness.sync.applyOps(TEST_STUDY_ID, [
                { type: "addMoves", parentId: firstId, moves: ["8c8d", "2g2f"] },
                comment("分岐のコメント", branch),
            ]);
            await harness.sync.flush(TEST_STUDY_ID);
            expect(harness.sync.getStatus(TEST_STUDY_ID)).toMatchObject({
                state: "limit_exceeded",
                limit: "nodesPerStudy",
            });
            // 直さないまま明示的に再試行しても、ローカルの成果は残り、上限超過のまま。
            await harness.sync.retry(TEST_STUDY_ID);
            expect(harness.sync.getStatus(TEST_STUDY_ID).state).toBe("limit_exceeded");
            expect(Object.keys((await localDoc(harness)).tree.nodes)).toHaveLength(5);

            await harness.sync.applyOps(TEST_STUDY_ID, [
                { type: "deleteSubtree", nodeId: studyChildNodeId(branch, "2g2f") },
            ]);
            await harness.advance(5000);
            const local = await localDoc(harness);
            expect(Object.keys(local.tree.nodes)).toHaveLength(4);
            expect(serverDoc(harness).tree).toEqual(local.tree);
            expect(harness.sync.getStatus(TEST_STUDY_ID).state).toBe("synced");
        });

        it("1 バッチの解析結果は 20 件まで。残りは間引きを待たずに続けて送る", async () => {
            const harness = await createSyncedHarness();
            await harness.sync.applyOps(TEST_STUDY_ID, [
                { type: "ensureLayer", spec, display: { label: "RAMU・1 秒" } },
                ...Array.from({ length: 120 }, (_, i) => resultOf(i + 1)),
            ]);
            await harness.sync.flush(TEST_STUDY_ID);
            const calls = harness.postOpsCalls();
            expect(
                calls.map((call) => call.body.ops.filter((op) => op.type === "putAnalysis").length),
            ).toEqual([20, 20, 20, 20, 20, 20]);
            expect(calls.every((call) => call.status === 200)).toBe(true);
            expect(serverDoc(harness).layers[0].results[firstId].depth).toBe(120);
            expect(harness.sync.getStatus(TEST_STUDY_ID).state).toBe("synced");
        });

        it("レイヤーの並びはサーバー（作成時刻・ID 順）と揃い、取り込みの前後で変わらない", async () => {
            const harness = createHarness();
            harness.login(USER_A);
            // レイヤーは作成では送らず、操作バッチで 1 つずつ作るので、足した順に並ぶ。
            const specs = [specOf(3000), specOf(1000), specOf(2000), specOf(9000), specOf(8000)];
            await harness.sync.createStudy(doc);
            await harness.sync.applyOps(
                TEST_STUDY_ID,
                specs.slice(0, 3).map((item, i) => ({
                    type: "ensureLayer" as const,
                    spec: item,
                    display: { label: `作成前 ${i}` },
                })),
            );
            await harness.sync.flush(TEST_STUDY_ID);
            await harness.sync.applyOps(
                TEST_STUDY_ID,
                specs.slice(3).map((item, i) => ({
                    type: "ensureLayer" as const,
                    spec: item,
                    display: { label: `追加 ${i}` },
                })),
            );
            await harness.sync.flush(TEST_STUDY_ID);
            // 同じバッチで 2 つ作ると作成時刻が同じになり ID 順に並んでしまうので、1 バッチ 1 つ。
            expect(
                harness
                    .postOpsCalls()
                    .map((call) => call.body.ops.filter((op) => op.type === "ensureLayer").length),
            ).toEqual([1, 1, 1, 1, 1]);
            const expected = specs.map(studyLayerId);
            expect(expected).not.toEqual([...expected].sort());
            const beforePull = (await localDoc(harness)).layers.map((layer) => layer.id);
            expect(beforePull).toEqual(expected);
            expect(serverDoc(harness).layers.map((layer) => layer.id)).toEqual(expected);

            // 他の端末の変更を取り込んでも、並びは変わらない。
            harness.server.applyFromOtherDevice(TEST_STUDY_ID, [comment("他の端末")]);
            await harness.sync.pull(TEST_STUDY_ID);
            expect((await localDoc(harness)).layers.map((layer) => layer.id)).toEqual(expected);
        });

        it("引き継ぎ: 作成はツリーだけ、レイヤーと結果は 20 件ずつ送り、途中で失敗しても最後は一致する", async () => {
            const harness = createHarness();
            await harness.sync.createStudy(doc);
            const layerSpecs = [specOf(1000), specOf(2000)];
            const nodeIds = [rootId, firstId, secondId];
            const ops: StudyOp[] = [comment("未ログイン中のコメント")];
            for (const layerSpec of layerSpecs) {
                ops.push({ type: "ensureLayer", spec: layerSpec, display: { label: "L" } });
                // 1 レイヤーにつき 3 ノード × 深さ違い 15 回 = 45 回の結果（どれも優先度が上がる）。
                for (let depth = 1; depth <= 15; depth++) {
                    for (const nodeId of nodeIds) {
                        ops.push({
                            ...resultOf(depth),
                            layerId: studyLayerId(layerSpec),
                            nodeId,
                        });
                    }
                }
            }
            await harness.sync.applyOps(TEST_STUDY_ID, ops);
            const before = await localDoc(harness);

            // 送信のあちこちで失敗させる: 作成の応答が届かない、操作バッチの応答が届かない、
            // サーバーの一時的な失敗、通信できない。
            harness.server.interceptOnce("create", "drop-response");
            harness.server.interceptOnce("postOps", "drop-response");
            harness.server.interceptOnce("postOps", { status: 500 });
            harness.server.interceptOnce("postOps", "offline");
            harness.login(USER_A);
            await harness.sync.adoptAnonymousStudies();
            const states = new Set<string>();
            harness.sync.subscribeStatus(TEST_STUDY_ID, () =>
                states.add(harness.sync.getStatus(TEST_STUDY_ID).state),
            );
            for (
                let i = 0;
                i < 12 && harness.sync.getStatus(TEST_STUDY_ID).state !== "synced";
                i++
            ) {
                // 全部が受理されるまでは「送信待ち」のまま。
                expect(harness.sync.getStatus(TEST_STUDY_ID).state).toBe("pending");
                await harness.advance(60_000);
            }

            expect(harness.sync.getStatus(TEST_STUDY_ID)).toMatchObject({
                state: "synced",
                pendingCount: 0,
            });
            expect(states).toEqual(new Set(["pending", "synced"]));
            const local = await localDoc(harness);
            expect(local).toEqual(before);
            expect(serverDoc(harness)).toEqual({
                tree: local.tree,
                layers: local.layers,
                title: local.title,
            });
            // 作成リクエストには解析結果を載せない。
            for (const call of harness.server.calls.filter((item) => item.method === "create")) {
                expect((call.body as { layers?: unknown[] }).layers ?? []).toEqual([]);
            }
            // 受理された操作バッチは、どれも解析結果 20 件以下・レイヤーの作成 1 つ以下。
            const accepted = harness.postOpsCalls().filter((call) => call.status === 200);
            expect(accepted.length).toBeGreaterThanOrEqual(2);
            for (const call of harness.postOpsCalls()) {
                const types = call.body.ops.map((op) => op.type);
                expect(types.filter((type) => type === "putAnalysis").length).toBeLessThanOrEqual(
                    20,
                );
                expect(types.filter((type) => type === "ensureLayer").length).toBeLessThanOrEqual(
                    1,
                );
            }
            expect(harness.server.maxConcurrentPostOps).toBe(1);
        });

        it("サーバーから消えていた（404）ノートの作り直しでも、レイヤーと結果は操作バッチで送る", async () => {
            const harness = await createSyncedHarness();
            await harness.sync.applyOps(TEST_STUDY_ID, analysisOps(firstId, 50));
            await harness.sync.flush(TEST_STUDY_ID);
            // 送信待ちが空の状態で、サーバーからノートが消えた。
            harness.server.interceptOnce("postOps", {
                status: 404,
                error: { error: "STUDY_NOT_FOUND" },
            });
            harness.server.forget(TEST_STUDY_ID);
            await harness.sync.applyOps(TEST_STUDY_ID, [comment("消えたあとの編集")]);
            await harness.sync.flush(TEST_STUDY_ID);

            const local = await localDoc(harness);
            expect(local.layers[0].results[firstId]).toBeDefined();
            expect(serverDoc(harness)).toEqual({
                tree: local.tree,
                layers: local.layers,
                title: local.title,
            });
            const creates = harness.server.calls.filter((call) => call.method === "create");
            expect(
                (creates[creates.length - 1].body as { layers?: unknown[] }).layers ?? [],
            ).toEqual([]);
            expect(harness.sync.getStatus(TEST_STUDY_ID).state).toBe("synced");
        });

        it("一覧と open は、いまのアカウントのノートと匿名のノートだけを見せる", async () => {
            const anonymousId = "3a1c0e7b-5f2d-4b6a-8c9d-0e1f2a3b4c5d";
            const harness = await createSyncedHarness();
            harness.login(null);
            await harness.sync.createStudy(createTestDocument({ id: anonymousId }));

            // 未ログイン: 匿名のノートだけ。
            expect((await harness.sync.listLocal()).map((item) => item.id)).toEqual([anonymousId]);
            expect(await harness.sync.open(TEST_STUDY_ID)).toEqual({ status: "not_found" });
            expect(await harness.sync.open(anonymousId)).toMatchObject({ status: "ok" });

            // 別のアカウント: そのアカウントのノートは無いので、匿名のノートだけ。
            harness.login(USER_B);
            expect((await harness.sync.listLocal()).map((item) => item.id)).toEqual([anonymousId]);
            expect(await harness.sync.open(TEST_STUDY_ID)).toEqual({ status: "not_found" });

            // 持ち主のアカウント: 自分のノートと匿名のノート。
            harness.login(USER_A);
            expect((await harness.sync.listLocal()).map((item) => item.id).sort()).toEqual(
                [TEST_STUDY_ID, anonymousId].sort(),
            );
            expect(await harness.sync.open(TEST_STUDY_ID)).toMatchObject({ status: "ok" });
        });

        it("別のタブでアカウントが切り替わっていたら、サーバーには作成しない", async () => {
            let serverSideUser: string | null = USER_B;
            const harness = createHarness({
                verifySession: async () => (serverSideUser ? { userId: serverSideUser } : null),
            });
            // このタブは A のつもりだが、Cookie は別のタブで B に切り替わっている。
            harness.login(USER_A);
            await harness.sync.createStudy(doc);
            await harness.advance(0);
            expect(harness.server.calls.filter((call) => call.method === "create")).toEqual([]);
            expect(harness.sync.getSession()).toEqual({ userId: USER_B });
            expect(harness.sync.getStatus(TEST_STUDY_ID)).toMatchObject({
                state: "local",
                reason: "other_account",
            });

            // ログアウトしていた場合。
            serverSideUser = null;
            harness.login(USER_A);
            await harness.advance(0);
            expect(harness.server.calls.filter((call) => call.method === "create")).toEqual([]);
            expect(harness.sync.getStatus(TEST_STUDY_ID).reason).toBe("signed_out");

            // 持ち主のアカウントに戻れば作成する。
            serverSideUser = USER_A;
            harness.login(USER_A);
            await harness.advance(0);
            expect(harness.server.study(TEST_STUDY_ID)?.revision).toBe(1);
            expect(harness.sync.getStatus(TEST_STUDY_ID).state).toBe("synced");
        });

        it("ログイン状態を確認できないときは、作成せずにあとで試し直す", async () => {
            let fail = true;
            const harness = createHarness({
                verifySession: async () => {
                    if (fail) throw new Error("ログイン状態を確認できませんでした (503)");
                    return { userId: USER_A };
                },
            });
            harness.login(USER_A);
            await harness.sync.createStudy(doc);
            await harness.advance(0);
            expect(harness.server.calls).toEqual([]);
            expect(harness.sync.getStatus(TEST_STUDY_ID)).toMatchObject({
                state: "pending",
                retrying: true,
            });
            fail = false;
            await harness.advance(2000);
            expect(harness.sync.getStatus(TEST_STUDY_ID).state).toBe("synced");
        });

        it("表示の状態（表示中のレイヤー・見ていた局面）をノートごとにブラウザ内へ保存する", async () => {
            const harness = createHarness();
            await harness.sync.createStudy(doc);
            expect(await harness.sync.getViewState(TEST_STUDY_ID)).toEqual({});

            expect(
                await harness.sync.setViewState(TEST_STUDY_ID, { selectedLayerId: "layer-1" }),
            ).toEqual({ selectedLayerId: "layer-1" });
            // 続けて呼んでも、項目ごとの上書きが失われない。
            void harness.sync.setViewState(TEST_STUDY_ID, { currentNodeId: firstId });
            void harness.sync.setViewState(TEST_STUDY_ID, { panel: "kifu" });
            await harness.sync.setViewState(TEST_STUDY_ID, { selectedLayerId: null });
            expect(await harness.sync.getViewState(TEST_STUDY_ID)).toEqual({
                selectedLayerId: null,
                currentNodeId: firstId,
                panel: "kifu",
            });

            // 別のエンジン（リロード後・別タブ）からも読める。サーバーには送らない。
            const reloaded = createHarness({ store: harness.store });
            expect(await reloaded.sync.getViewState(TEST_STUDY_ID)).toMatchObject({
                currentNodeId: firstId,
            });
            expect(harness.server.calls).toEqual([]);

            // ノートを消すと一緒に消える。
            await harness.sync.deleteStudy(TEST_STUDY_ID);
            expect(await harness.sync.getViewState(TEST_STUDY_ID)).toEqual({});
        });

        it("保存層の中での判断による中止（対象なし・統合済み）は、保存の失敗にならない", async () => {
            const harness = createHarness();
            const error = await harness.sync
                .applyOps("missing", [comment("x")])
                .catch((caught: unknown) => caught);
            expect(error).toBeInstanceOf(StudySyncError);
            expect(error).toMatchObject({ code: "not_found" });
            expect(harness.sync.getStatus("missing").state).not.toBe("error");
        });
    });

    describe("レビュー 2 巡目の指摘の再現", () => {
        const origin = { kind: "rshogi_csa", ref: "wdoor-20261009000001-93ef4d36a6" } as const;
        const existingId = "0d9f5c3a-2b7e-4c1d-9a55-1f2e3d4c5b6a";
        const specOf = (timeMs: number): StudyLayerSpec => ({
            ...spec,
            limits: { ...spec.limits, timeMs },
        });
        const putResult = (layerSpec: StudyLayerSpec, nodeId: string, depth: number): StudyOp => ({
            type: "putAnalysis",
            layerId: studyLayerId(layerSpec),
            nodeId,
            result: {
                runId: "9d6783f2-d773-4572-ae4e-bd463bf8f816",
                completion: "completed",
                depth,
                nodes: null,
                timeMs: null,
                execution: { threads: null, hashMb: null, parallelWorkers: null },
                candidates: [
                    { rank: 1, score: { kind: "cp", value: depth }, depth, seldepth: null, pv: [] },
                ],
            },
        });
        const expectSameAsServer = async (harness: Harness): Promise<StudyDocument> => {
            const local = await localDoc(harness);
            expect(serverDoc(harness)).toEqual({
                tree: local.tree,
                layers: local.layers,
                title: local.title,
            });
            return local;
        };

        it("拒否からの復帰で、未取り込みの他の端末の変更（枝・コメント・表題・レイヤー）を消さない", async () => {
            const harness = await createSyncedHarness();
            // 端末 B が 8 レイヤーを作った（この端末 A はまだ取り込んでいない）。
            const others = Array.from({ length: 8 }, (_, i) => specOf(2000 + i));
            harness.server.applyFromOtherDevice(
                TEST_STUDY_ID,
                others.map(
                    (item, i): StudyOp => ({
                        type: "ensureLayer",
                        spec: item,
                        display: { label: `B${i}` },
                    }),
                ),
            );
            // A が 1 レイヤーと結果を足す → 409 → 再適用で 9 レイヤー → 422 layersPerStudy。
            const mine = specOf(1000);
            await harness.sync.applyOps(TEST_STUDY_ID, [
                { type: "ensureLayer", spec: mine, display: { label: "A" } },
                putResult(mine, firstId, 12),
            ]);
            await harness.sync.flush(TEST_STUDY_ID);
            expect(harness.sync.getStatus(TEST_STUDY_ID)).toMatchObject({
                state: "limit_exceeded",
                limit: "layersPerStudy",
            });
            expect((await localDoc(harness)).layers).toHaveLength(9);

            // そのあいだに B が枝・コメント・表題を足し、レイヤーの結果も入れた。
            const otherBranch = studyChildNodeId(firstId, "8c8d");
            harness.server.applyFromOtherDevice(TEST_STUDY_ID, [
                { type: "addMoves", parentId: firstId, moves: ["8c8d", "2g2f"] },
                comment("B のコメント", rootId),
                { type: "setTitle", value: "B が付けた表題" },
                putResult(others[1], firstId, 30),
            ]);

            // A が手元でレイヤーを 1 つ消すと、自動で送り直す。
            await harness.sync.applyOps(TEST_STUDY_ID, [
                { type: "deleteLayer", layerId: studyLayerId(others[0]) },
            ]);
            await harness.advance(5000);

            expect(harness.sync.getStatus(TEST_STUDY_ID)).toMatchObject({
                state: "synced",
                pendingCount: 0,
            });
            const server = harness.server.study(TEST_STUDY_ID);
            // B の成果はサーバーに残り、ローカルにも入る。
            expect(server?.tree.nodes[otherBranch]).toBeDefined();
            expect(server?.tree.nodes[rootId].comment).toBe("B のコメント");
            expect(server?.title).toBe("B が付けた表題");
            expect(server?.layers.map((layer) => layer.id)).toEqual([
                ...others.slice(1).map(studyLayerId),
                studyLayerId(mine),
            ]);
            expect(server?.layers[0].results[firstId].depth).toBe(30);
            expect(server?.layers[7].results[firstId].depth).toBe(12);
            await expectSameAsServer(harness);
            // 送ったのは、明示的に消したレイヤーの削除と、自分のレイヤーと結果だけ。
            const lastOps = harness
                .postOpsCalls()
                .at(-1)
                ?.body.ops.map((op) => op.type);
            expect(
                harness
                    .postOpsCalls()
                    .filter((call) => call.status === 200)
                    .flatMap((call) => call.body.ops.map((op) => op.type))
                    .sort(),
            ).toEqual(["deleteLayer", "ensureLayer", "putAnalysis"]);
            expect(lastOps).toBeDefined();
        });

        it("拒否からの復帰で、サーバー側が優先度で勝つ解析結果はローカルにも反映される", async () => {
            const harness = await createSyncedHarness();
            await harness.sync.applyOps(TEST_STUDY_ID, [
                { type: "ensureLayer", spec, display: { label: "RAMU・1 秒" } },
            ]);
            await harness.sync.flush(TEST_STUDY_ID);
            // 拒否の状態にする（サーバーだけが拒否する長さのコメント）。
            harness.server.limits.commentBytes = 30;
            await harness.sync.applyOps(TEST_STUDY_ID, [comment("長すぎるコメント".repeat(4))]);
            await harness.sync.flush(TEST_STUDY_ID);
            expect(harness.sync.getStatus(TEST_STUDY_ID).state).toBe("limit_exceeded");

            // 他の端末が深さ 20 の結果を入れた。この端末は深さ 10 の結果を入れ、コメントを直す。
            harness.server.applyFromOtherDevice(TEST_STUDY_ID, [putResult(spec, firstId, 20)]);
            await harness.sync.applyOps(TEST_STUDY_ID, [
                putResult(spec, firstId, 10),
                comment("短いコメント"),
            ]);
            expect((await localDoc(harness)).layers[0].results[firstId].depth).toBe(10);
            await harness.advance(5000);

            expect(harness.sync.getStatus(TEST_STUDY_ID).state).toBe("synced");
            const local = await expectSameAsServer(harness);
            expect(local.layers[0].results[firstId].depth).toBe(20);
            expect(local.tree.nodes[firstId].comment).toBe("短いコメント");
            expect(harness.events).toContainEqual({
                type: "document",
                studyId: TEST_STUDY_ID,
                origin: "remote",
            });
        });

        it("統合: 取り込みのやり直しまでに統合先のコメントへ追記があっても、二重につながない", async () => {
            const harness = createHarness();
            harness.server.seed(
                USER_A,
                applyStudyOps(createTestDocument({ id: existingId, origin }), [comment("既存")]),
            );
            await harness.sync.createStudy(createTestDocument({ origin }));
            await harness.sync.applyOps(TEST_STUDY_ID, [comment("匿名")]);
            harness.login(USER_A);
            await harness.sync.adoptAnonymousStudies();
            await harness.advance(0);
            await harness.advance(0);
            expect(harness.server.study(existingId)?.tree.nodes[firstId].comment).toBe(
                "既存\n\n匿名",
            );

            // 取り込みは済んだが「完了」の記録の前に止まり、そのあいだに統合先へ追記があった状態。
            harness.server.applyFromOtherDevice(existingId, [comment("既存\n\n匿名\n追記")]);
            await harness.sync.pull(existingId);
            await harness.store.transact(TEST_STUDY_ID, (snapshot) => ({
                study: {
                    ...(snapshot.study as NonNullable<typeof snapshot.study>),
                    mergePending: true,
                },
                result: undefined,
            }));
            harness.login(USER_A);
            await harness.advance(0);
            await harness.advance(0);

            expect((await harness.sync.load(TEST_STUDY_ID))?.mergePending).toBe(false);
            expect(harness.server.study(existingId)?.tree.nodes[firstId].comment).toBe(
                "既存\n\n匿名\n追記",
            );
            expect(harness.sync.getStatus(existingId)).toMatchObject({
                state: "synced",
                pendingCount: 0,
            });
        });

        it("作成が 400 で拒否されたノートは、編集のたびに作成を送り直さない（明示の再試行で送る）", async () => {
            const harness = createHarness();
            harness.login(USER_A);
            harness.server.interceptOnce("create", {
                status: 400,
                error: { error: "INVALID_REQUEST", message: "invalid" },
            });
            await harness.sync.createStudy(doc);
            await harness.advance(0);
            expect(harness.sync.getStatus(TEST_STUDY_ID)).toMatchObject({
                state: "error",
                reason: "rejected",
            });
            const creates = () => harness.server.calls.filter((call) => call.method === "create");
            expect(creates()).toHaveLength(1);

            // ローカルの検証は通っている文書なので、編集しても送り直さない。
            for (const text of ["一", "二", "三"]) {
                await harness.sync.applyOps(TEST_STUDY_ID, [comment(text)]);
                await harness.advance(5000);
            }
            await harness.sync.flush(TEST_STUDY_ID);
            expect(creates()).toHaveLength(1);
            expect(harness.sync.getStatus(TEST_STUDY_ID).state).toBe("error");
            expect((await localDoc(harness)).tree.nodes[firstId].comment).toBe("三");

            await harness.sync.retry(TEST_STUDY_ID);
            expect(creates()).toHaveLength(2);
            expect(harness.sync.getStatus(TEST_STUDY_ID).state).toBe("synced");
            await expectSameAsServer(harness);
        });

        it("作成が 400 で拒否されたノートは、内容の問題が直ったとき（検証が通るようになったとき）に送り直す", async () => {
            const harness = createHarness();
            harness.login(USER_A);
            // 対局時の評価値の読み筋に、USI の書式でない手が入っている文書（サーバーは 400）。
            const broken = applyStudyOps(doc, [
                {
                    type: "setSource",
                    nodeId: firstId,
                    value: { kind: "kif", score: null, pv: ["７六歩"], elapsedMs: null },
                },
            ]);
            await harness.sync.createStudy(broken);
            await harness.advance(0);
            const creates = () => harness.server.calls.filter((call) => call.method === "create");
            expect(creates().map((call) => call.status)).toEqual([400]);
            expect((await harness.sync.load(TEST_STUDY_ID))?.remote).toMatchObject({
                state: "rejected",
                locallyValid: false,
            });

            // 関係のない編集では送り直さない。
            await harness.sync.applyOps(TEST_STUDY_ID, [comment("関係のない編集")]);
            await harness.advance(5000);
            expect(creates()).toHaveLength(1);

            // 問題の項目を直すと、次の送信で作成が通る。
            await harness.sync.applyOps(TEST_STUDY_ID, [
                { type: "setSource", nodeId: firstId, value: null },
            ]);
            await harness.advance(5000);
            expect(creates().map((call) => call.status)).toEqual([400, 201]);
            expect(harness.sync.getStatus(TEST_STUDY_ID).state).toBe("synced");
            await expectSameAsServer(harness);
        });

        it("作成が 503 STUDY_CREATE_UNSETTLED のときは、そのまま再送する", async () => {
            const harness = createHarness();
            harness.login(USER_A);
            harness.server.interceptOnce("create", {
                status: 503,
                error: { error: "STUDY_CREATE_UNSETTLED" },
            });
            await harness.sync.createStudy(doc);
            await harness.advance(0);
            expect(harness.sync.getStatus(TEST_STUDY_ID)).toMatchObject({
                state: "pending",
                retrying: true,
            });
            await harness.advance(2000);
            expect(
                harness.server.calls
                    .filter((call) => call.method === "create")
                    .map((c) => c.status),
            ).toEqual([503, 201]);
            expect(harness.sync.getStatus(TEST_STUDY_ID).state).toBe("synced");
        });

        it("レイヤーを消して同じ設定で作り直しても、並びがサーバーと揃う", async () => {
            const harness = await createSyncedHarness();
            const specs = [specOf(1000), specOf(2000), specOf(3000)];
            await harness.sync.applyOps(
                TEST_STUDY_ID,
                specs.map(
                    (item, i): StudyOp => ({
                        type: "ensureLayer",
                        spec: item,
                        display: { label: `L${i}` },
                    }),
                ),
            );
            await harness.sync.flush(TEST_STUDY_ID);
            // 先頭のレイヤーを消して、同じ設定で作り直す（1 回の操作で）。
            await harness.sync.applyOps(TEST_STUDY_ID, [
                { type: "deleteLayer", layerId: studyLayerId(specs[0]) },
                { type: "ensureLayer", spec: specs[0], display: { label: "作り直し" } },
            ]);
            await harness.sync.flush(TEST_STUDY_ID);
            const expected = [specs[1], specs[2], specs[0]].map(studyLayerId);
            expect((await localDoc(harness)).layers.map((layer) => layer.id)).toEqual(expected);
            expect(serverDoc(harness).layers.map((layer) => layer.id)).toEqual(expected);
            // 削除と作り直しは別のバッチで送る。
            expect(
                harness
                    .postOpsCalls()
                    .slice(-2)
                    .map((call) => call.body.ops.map((op) => op.type)),
            ).toEqual([["deleteLayer"], ["ensureLayer"]]);
            await harness.sync.pull(TEST_STUDY_ID);
            expect((await localDoc(harness)).layers.map((layer) => layer.id)).toEqual(expected);
        });

        it("セッションの確認中・ログアウト中は、アカウントのノートを読めず、編集もできない", async () => {
            const first = await createSyncedHarness();
            // リロード後（同じ保存層、セッションはまだ確認中）。
            const reloaded = createHarness({ store: first.store, server: first.server });
            expect(reloaded.sync.getSessionStatus()).toBe("unknown");
            expect(await reloaded.sync.load(TEST_STUDY_ID)).toBeNull();
            expect(await reloaded.sync.listLocal()).toEqual([]);
            expect(await reloaded.sync.open(TEST_STUDY_ID)).toEqual({ status: "not_found" });
            await expect(
                reloaded.sync.applyOps(TEST_STUDY_ID, [comment("x")]),
            ).rejects.toMatchObject({
                code: "not_found",
            });
            await expect(
                reloaded.sync.setViewState(TEST_STUDY_ID, { selectedLayerId: "x" }),
            ).rejects.toMatchObject({ code: "not_found" });

            // ログアウトが確定しても同じ。
            reloaded.login(null);
            expect(reloaded.sync.getSessionStatus()).toBe("signed_out");
            expect(await reloaded.sync.load(TEST_STUDY_ID)).toBeNull();
            await expect(
                reloaded.sync.applyOps(TEST_STUDY_ID, [comment("x")]),
            ).rejects.toMatchObject({
                code: "not_found",
            });

            // 別のアカウントでも同じ。持ち主のアカウントなら読める・編集できる。
            reloaded.login(USER_B);
            expect(await reloaded.sync.load(TEST_STUDY_ID)).toBeNull();
            reloaded.login(USER_A);
            expect(reloaded.sync.getSessionStatus()).toBe("signed_in");
            expect((await reloaded.sync.load(TEST_STUDY_ID))?.owner).toBe(USER_A);
            await reloaded.sync.applyOps(TEST_STUDY_ID, [comment("持ち主の編集")]);
            expect(
                (await first.store.read(TEST_STUDY_ID)).study?.doc.tree.nodes[firstId].comment,
            ).toBe("持ち主の編集");
        });

        it("open / load の前でも、保存の状態は保存層から読んで通知される", async () => {
            const first = await createSyncedHarness();
            const reloaded = createHarness({ store: first.store, server: first.server });
            reloaded.login(USER_A);
            let notified = 0;
            reloaded.sync.subscribeStatus(TEST_STUDY_ID, () => {
                notified += 1;
            });
            // 読む前は既定の状態。裏で読んだあとに「クラウドに保存済み」になり、購読側に通知される。
            await settle();
            expect(reloaded.sync.getStatus(TEST_STUDY_ID).state).toBe("synced");
            expect(notified).toBeGreaterThan(0);
        });

        it("表示の状態は、無いノート・削除したノートには保存しない", async () => {
            const harness = createHarness();
            await expect(
                harness.sync.setViewState(TEST_STUDY_ID, { selectedLayerId: "x" }),
            ).rejects.toBeInstanceOf(StudySyncError);
            await harness.sync.createStudy(doc);
            await harness.sync.setViewState(TEST_STUDY_ID, { selectedLayerId: "x" });
            await harness.sync.deleteStudy(TEST_STUDY_ID);
            await expect(
                harness.sync.setViewState(TEST_STUDY_ID, { selectedLayerId: "y" }),
            ).rejects.toMatchObject({ code: "not_found" });
            expect(await harness.store.readViewState?.(TEST_STUDY_ID)).toBeNull();
        });
    });

    describe("レビュー 3 巡目の指摘の再現", () => {
        const putResult = (layerSpec: StudyLayerSpec, nodeId: string, depth: number): StudyOp => ({
            type: "putAnalysis",
            layerId: studyLayerId(layerSpec),
            nodeId,
            result: {
                runId: "9d6783f2-d773-4572-ae4e-bd463bf8f816",
                completion: "completed",
                depth,
                nodes: null,
                timeMs: null,
                execution: { threads: null, hashMb: null, parallelWorkers: null },
                candidates: [
                    { rank: 1, score: { kind: "cp", value: depth }, depth, seldepth: null, pv: [] },
                ],
            },
        });
        const expectSameAsServer = async (harness: Harness): Promise<StudyDocument> => {
            const local = await localDoc(harness);
            expect(serverDoc(harness)).toEqual({
                tree: local.tree,
                layers: local.layers,
                title: local.title,
            });
            return local;
        };
        /** サーバーだけが拒否する長さのコメントを送って、拒否の状態（上限超過）にする。 */
        const enterRejectedState = async (harness: Harness): Promise<void> => {
            harness.server.limits.commentBytes = 30;
            await harness.sync.applyOps(TEST_STUDY_ID, [
                comment("長すぎるコメント".repeat(4), rootId),
            ]);
            await harness.sync.flush(TEST_STUDY_ID);
            expect(harness.sync.getStatus(TEST_STUDY_ID).state).toBe("limit_exceeded");
        };

        it("拒否からの復帰で、レイヤーを消して同じ設定で作り直した操作が取り消されない", async () => {
            const harness = await createSyncedHarness();
            // サーバーにあるレイヤー: 表示名「旧」、2 つのノートに深さ 30 の結果。
            await harness.sync.applyOps(TEST_STUDY_ID, [
                { type: "ensureLayer", spec, display: { label: "旧" } },
                putResult(spec, firstId, 30),
                putResult(spec, secondId, 30),
            ]);
            await harness.sync.flush(TEST_STUDY_ID);
            await enterRejectedState(harness);

            // 利用者がレイヤーを消して、同じ設定で作り直した（結果は深さ 5 を 1 つだけ）。
            await harness.sync.applyOps(TEST_STUDY_ID, [
                { type: "deleteLayer", layerId: studyLayerId(spec) },
                { type: "ensureLayer", spec, display: { label: "新" } },
                putResult(spec, firstId, 5),
                comment("短い", rootId),
            ]);
            await harness.advance(5000);

            expect(harness.sync.getStatus(TEST_STUDY_ID)).toMatchObject({
                state: "synced",
                pendingCount: 0,
            });
            const local = await expectSameAsServer(harness);
            // 旧い結果（深さ 30）や旧い表示名が戻っていない。
            expect(local.layers).toHaveLength(1);
            expect(local.layers[0].display).toEqual({ label: "新" });
            expect(Object.keys(local.layers[0].results)).toEqual([firstId]);
            expect(local.layers[0].results[firstId].depth).toBe(5);
            // 削除と、同じ設定での作り直しは、別のバッチで送る。
            const accepted = harness
                .postOpsCalls()
                .filter((call) => call.status === 200)
                .map((call) => call.body.ops.map((op) => op.type));
            const deleteBatch = accepted.findIndex((types) => types.includes("deleteLayer"));
            const ensureBatch = accepted.findIndex(
                (types, index) => index > 0 && types.includes("ensureLayer"),
            );
            expect(deleteBatch).toBeGreaterThan(0);
            expect(ensureBatch).toBeGreaterThan(deleteBatch);
        });

        it("拒否からの復帰で、枝を消して同じ手順で作り直しても、配下の旧い結果やコメントが戻らない", async () => {
            const harness = await createSyncedHarness();
            await harness.sync.applyOps(TEST_STUDY_ID, [
                { type: "ensureLayer", spec, display: { label: "RAMU・1 秒" } },
                putResult(spec, firstId, 30),
                putResult(spec, secondId, 30),
                comment("旧いコメント", secondId),
                { type: "setBookmark", nodeId: secondId, value: true },
            ]);
            await harness.sync.flush(TEST_STUDY_ID);
            await enterRejectedState(harness);

            // 初手より先を消して、同じ手順で作り直した。
            await harness.sync.applyOps(TEST_STUDY_ID, [
                { type: "deleteSubtree", nodeId: firstId },
                { type: "addMoves", parentId: rootId, moves: ["7g7f", "3c3d"] },
                comment("新しいコメント", firstId),
                comment("短い", rootId),
            ]);
            await harness.advance(5000);

            expect(harness.sync.getStatus(TEST_STUDY_ID).state).toBe("synced");
            const local = await expectSameAsServer(harness);
            expect(local.tree.nodes[firstId].comment).toBe("新しいコメント");
            expect(local.tree.nodes[secondId]).toMatchObject({ comment: "", bookmarked: false });
            expect(local.layers[0].results).toEqual({});
        });

        it("拒否からの復帰で、消して作り直したレイヤーの優先度の低い結果が、旧い結果に負けない", async () => {
            const harness = await createSyncedHarness();
            await harness.sync.applyOps(TEST_STUDY_ID, [
                { type: "ensureLayer", spec, display: { label: "RAMU・1 秒" } },
                putResult(spec, firstId, 30),
            ]);
            await harness.sync.flush(TEST_STUDY_ID);
            await enterRejectedState(harness);
            // 他の端末がさらに深い結果を入れた（この端末は未取り込み）。
            harness.server.applyFromOtherDevice(TEST_STUDY_ID, [putResult(spec, firstId, 40)]);

            await harness.sync.applyOps(TEST_STUDY_ID, [
                { type: "deleteLayer", layerId: studyLayerId(spec) },
                { type: "ensureLayer", spec, display: { label: "RAMU・1 秒" } },
                putResult(spec, firstId, 3),
                comment("短い", rootId),
            ]);
            await harness.advance(5000);
            expect(harness.sync.getStatus(TEST_STUDY_ID).state).toBe("synced");
            const local = await expectSameAsServer(harness);
            expect(local.layers[0].results[firstId].depth).toBe(3);
        });

        it("別のアカウントのノートは削除できない（持ち主が戻ったときにサーバーから消えない）", async () => {
            const harness = await createSyncedHarness();
            harness.login(USER_B);
            await expect(harness.sync.deleteStudy(TEST_STUDY_ID)).rejects.toMatchObject({
                code: "not_found",
            });
            harness.login(null);
            await expect(harness.sync.deleteStudy(TEST_STUDY_ID)).rejects.toMatchObject({
                code: "not_found",
            });
            expect((await harness.store.read(TEST_STUDY_ID)).study?.deleting).toBe(false);

            harness.login(USER_A);
            await harness.advance(0);
            expect(harness.server.study(TEST_STUDY_ID)).not.toBeNull();
            expect((await harness.sync.listLocal()).map((item) => item.id)).toEqual([
                TEST_STUDY_ID,
            ]);
            // 無いノートの削除は、これまでどおり何もしない。
            await expect(harness.sync.deleteStudy("missing")).resolves.toBeUndefined();
        });

        it("作成が上限超過で拒否されたノートは、検証が通るようになるまで作成を送り直さない", async () => {
            const harness = createHarness();
            harness.login(USER_A);
            // 4 KiB を超えるコメントのあるノート（ローカルには残すが、サーバーは 422）。
            const oversize = applyStudyOps(doc, [comment("あ".repeat(1400))]);
            await harness.sync.createStudy(oversize);
            await harness.advance(0);
            const creates = () => harness.server.calls.filter((call) => call.method === "create");
            expect(creates().map((call) => call.status)).toEqual([422]);
            expect(harness.sync.getStatus(TEST_STUDY_ID)).toMatchObject({
                state: "limit_exceeded",
                limit: "commentBytes",
            });

            // 関係のない編集を重ねても、作成の本文を送り直さない。
            for (const text of ["一", "二", "三"]) {
                await harness.sync.applyOps(TEST_STUDY_ID, [comment(text, rootId)]);
                await harness.advance(5000);
            }
            await harness.advance(3_600_000);
            expect(creates()).toHaveLength(1);

            // 超過を直すと、次の送信で作成が通る。
            await harness.sync.applyOps(TEST_STUDY_ID, [comment("短くした")]);
            await harness.advance(5000);
            expect(creates().map((call) => call.status)).toEqual([422, 201]);
            expect(harness.sync.getStatus(TEST_STUDY_ID).state).toBe("synced");
            await expectSameAsServer(harness);
        });

        it("ノートの件数の上限で拒否された作成は、編集のたびには送らず、間隔を空けて試し直す", async () => {
            const harness = createHarness();
            harness.server.limits.studiesPerUser = 0;
            harness.login(USER_A);
            await harness.sync.createStudy(doc);
            await harness.advance(0);
            const creates = () => harness.server.calls.filter((call) => call.method === "create");
            expect(creates()).toHaveLength(1);
            expect(harness.sync.getStatus(TEST_STUDY_ID)).toMatchObject({
                state: "limit_exceeded",
                limit: "studiesPerUser",
            });

            for (const text of ["一", "二", "三"]) {
                await harness.sync.applyOps(TEST_STUDY_ID, [comment(text)]);
                await harness.advance(5000);
            }
            expect(creates()).toHaveLength(1);

            // 10 分以上あとの編集では、もう一度だけ試す（まだ上限なら、また待つ）。
            await harness.advance(600_000);
            await harness.sync.applyOps(TEST_STUDY_ID, [comment("四")]);
            await harness.advance(5000);
            expect(creates()).toHaveLength(2);
            await harness.sync.applyOps(TEST_STUDY_ID, [comment("五")]);
            await harness.advance(5000);
            expect(creates()).toHaveLength(2);

            // 上限が空いたあとは、間隔を空けた再試行か明示の再試行で通る。
            harness.server.limits.studiesPerUser = 200;
            await harness.sync.retry(TEST_STUDY_ID);
            expect(creates()).toHaveLength(3);
            expect(harness.sync.getStatus(TEST_STUDY_ID).state).toBe("synced");
            await expectSameAsServer(harness);
        });

        it("ノードの追加と、そのノードへのしおりは、バッチの切れ目で分けない", async () => {
            const harness = await createSyncedHarness();
            // 199 個の操作のあとに「ノードの追加 → そのノードにしおり」を置く（200 個目で切れる位置）。
            const branch = studyChildNodeId(firstId, "8c8d");
            await harness.sync.applyOps(TEST_STUDY_ID, [
                ...Array.from({ length: 199 }, (_, i) => comment(`コメント ${i}`)),
                { type: "addMoves", parentId: firstId, moves: ["8c8d"] },
                { type: "setBookmark", nodeId: branch, value: true },
            ]);
            await harness.sync.flush(TEST_STUDY_ID);
            expect(
                harness.postOpsCalls().map((call) => call.body.ops.map((op) => op.type).slice(-2)),
            ).toEqual([
                ["setComment", "setComment"],
                ["addMoves", "setBookmark"],
            ]);
            expect(harness.postOpsCalls().map((call) => call.body.ops.length)).toEqual([199, 2]);
            await expectSameAsServer(harness);
        });
    });

    describe("レビュー 4 巡目の指摘の再現（別のタブでのログアウト・アカウントの切り替え）", () => {
        /** `verifySession` が、Cookie の持ち主（サーバーから見たユーザー）を返すハーネス。 */
        const createVerifyingHarness = (): Harness => {
            let serverSideUser: string | null = null;
            const harness = createHarness({
                verifySession: async () => (serverSideUser ? { userId: serverSideUser } : null),
            });
            return {
                ...harness,
                login(userId) {
                    serverSideUser = userId;
                    harness.login(userId);
                },
                switchCookie(userId) {
                    serverSideUser = userId;
                    harness.switchCookie(userId);
                },
            };
        };

        it.each([
            { label: "別のアカウントへの切り替え", other: USER_B, reason: "other_account" },
            { label: "ログアウト", other: null, reason: "signed_out" },
        ])("作成の直前の確認で $label が分かったら、ログイン状態の取り直しを促す", async ({
            other,
            reason,
        }) => {
            const harness = createVerifyingHarness();
            harness.login(USER_A);
            harness.switchCookie(other);
            await harness.sync.createStudy(doc);
            await harness.advance(0);
            expect(harness.server.calls.filter((call) => call.method === "create")).toEqual([]);
            expect(harness.sync.getStatus(TEST_STUDY_ID)).toMatchObject({ state: "local", reason });
            // 画面はこの通知でログイン状態を取り直す（通知が無いと、前の利用者のまま編集できる
            // 表示を続け、編集は拒否され続ける）。
            expect(harness.events.filter((event) => event.type === "unauthorized")).toHaveLength(1);

            // 持ち主でログインし直せば、作成する。
            harness.login(USER_A);
            await harness.advance(0);
            expect(harness.server.study(TEST_STUDY_ID)?.revision).toBe(1);
            expect(harness.sync.getStatus(TEST_STUDY_ID).state).toBe("synced");
        });

        it("別のアカウントとして送った削除の 404 では、削除済みにしない", async () => {
            const harness = createVerifyingHarness();
            harness.login(USER_A);
            await harness.sync.createStudy(doc);
            await harness.advance(0);
            expect(harness.sync.getStatus(TEST_STUDY_ID).state).toBe("synced");

            // 別のタブで B に切り替わった。このタブは A のつもりで削除する。
            harness.switchCookie(USER_B);
            await harness.sync.deleteStudy(TEST_STUDY_ID);
            expect(harness.server.calls.at(-1)).toMatchObject({ method: "delete", status: 404 });
            // A のノートはサーバーに残っている。ローカルのレコードは削除待ちのまま残す。
            expect(harness.server.study(TEST_STUDY_ID)).not.toBeNull();
            expect((await harness.store.read(TEST_STUDY_ID)).study?.deleting).toBe(true);
            expect(harness.sync.getSession()).toEqual({ userId: USER_B });
            expect(harness.events).toContainEqual({ type: "unauthorized" });
            // B からは見えない。
            expect(await harness.sync.listLocal()).toEqual([]);

            // A でログインし直すと、削除を送り直す。
            harness.login(USER_A);
            await harness.advance(0);
            expect(harness.server.study(TEST_STUDY_ID)).toBeNull();
            expect((await harness.store.read(TEST_STUDY_ID)).study).toBeNull();
        });

        it("持ち主のままの 404（既にサーバーに無い）は、従来どおり削除済みにする", async () => {
            const harness = createVerifyingHarness();
            harness.login(USER_A);
            await harness.sync.createStudy(doc);
            await harness.advance(0);
            harness.server.forget(TEST_STUDY_ID);
            await harness.sync.deleteStudy(TEST_STUDY_ID);
            expect(harness.server.calls.at(-1)).toMatchObject({ method: "delete", status: 404 });
            expect((await harness.store.read(TEST_STUDY_ID)).study).toBeNull();
            expect(harness.sync.getSession()).toEqual({ userId: USER_A });
            expect(harness.events).not.toContainEqual({ type: "unauthorized" });
        });

        it("削除の 404 のあとにログイン状態を確認できなければ、消さずにあとで試し直す", async () => {
            let fail = false;
            const harness = createHarness({
                verifySession: async () => {
                    if (fail) throw new Error("ログイン状態を確認できませんでした (503)");
                    return { userId: USER_A };
                },
            });
            harness.login(USER_A);
            await harness.sync.createStudy(doc);
            await harness.advance(0);
            harness.server.forget(TEST_STUDY_ID);
            fail = true;
            await harness.sync.deleteStudy(TEST_STUDY_ID);
            expect((await harness.store.read(TEST_STUDY_ID)).study?.deleting).toBe(true);
            fail = false;
            await harness.advance(2000);
            expect((await harness.store.read(TEST_STUDY_ID)).study).toBeNull();
        });
    });
});
