import { createStudyDocumentFromMoves, type StudyDocument } from "@shogi/app-core";
import {
    createMemoryStudyStore,
    createStudySync,
    type StudyApi,
    type StudyStore,
    type StudySync,
} from "@shogi/study-client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyStudyCommentDraftChange, readStudyCommentDrafts } from "./studyDrafts";

const DRAFTS_KEY = "ramu-study-comment-drafts";

/** 引き継ぎのテストで使う、メモリ上の保存層の同期エンジン（null なら本物を作る）。 */
let memorySync: StudySync | null = null;
vi.mock("@shogi/study-client", async (importOriginal) => {
    const original = await importOriginal<typeof import("@shogi/study-client")>();
    return {
        ...original,
        createBrowserStudySync: (...args: Parameters<typeof original.createBrowserStudySync>) =>
            memorySync
                ? { sync: memorySync, store: null, dispose: () => {} }
                : original.createBrowserStudySync(...args),
    };
});

const { ensureStudySession, getStudySync, resetStudySyncForTest, syncStudySession } = await import(
    "./studySync"
);

const offline = async () => ({ ok: false as const, status: 0, error: {} });
const offlineApi: StudyApi = {
    list: offline,
    create: offline,
    get: offline,
    postOps: offline,
    delete: offline,
    limits: offline,
};
const createSync = (store: StudyStore): StudySync => createStudySync({ store, api: offlineApi });
const createDoc = (id: string): StudyDocument =>
    createStudyDocumentFromMoves({
        id,
        title: "ノート",
        origin: { kind: "paste", ref: null },
        startSfen: "startpos",
        moves: ["7g7f"],
        meta: {},
    });
const draft = (text: string) => ({ type: "set" as const, text, base: "" });

describe("studySync", () => {
    afterEach(() => {
        resetStudySyncForTest();
        memorySync = null;
        localStorage.clear();
    });

    it("アプリで 1 つの同期エンジンを使い回す", () => {
        const sync = getStudySync();
        expect(getStudySync()).toBe(sync);
        resetStudySyncForTest();
        expect(getStudySync()).not.toBe(sync);
    });

    it("ログイン状態を同期エンジンに伝える", () => {
        expect(getStudySync().getSession()).toBeNull();
        syncStudySession("user-1");
        expect(getStudySync().getSession()).toEqual({ userId: "user-1" });
        syncStudySession("user-1");
        expect(getStudySync().getSession()).toEqual({ userId: "user-1" });
        syncStudySession(null);
        expect(getStudySync().getSession()).toBeNull();
    });

    it("読み込む前のノートの保存の状態は「ブラウザ内」", () => {
        expect(getStudySync().getStatus("unknown")).toMatchObject({
            state: "local",
            pendingCount: 0,
        });
    });

    describe("未ログイン中のノートの引き継ぎと、コメントの書きかけ", () => {
        const ANON = "11111111-1111-4111-8111-111111111111";
        const OTHERS = "22222222-2222-4222-8222-222222222222";
        const STILL_ANON = "33333333-3333-4333-8333-333333333333";

        it("引き継いだノートの書きかけ（複数のタブの分も）を、同じアカウントへ移す。別のアカウントの書きかけは移さない", async () => {
            const store = createMemoryStudyStore();
            // user-2 のノートと、その書きかけ。
            const seed = createSync(store);
            seed.setSession({ userId: "user-2" });
            await seed.createStudy(createDoc(OTHERS));
            seed.dispose();
            applyStudyCommentDraftChange(OTHERS, "user-2", "n", draft("user-2 の書きかけ"));
            // 未ログイン中に作ったノートと、保存できなかった書きかけ（別のタブと、この画面）。
            memorySync = createSync(store);
            await getStudySync().createStudy(createDoc(ANON));
            applyStudyCommentDraftChange(ANON, null, "n1", draft("この画面の書きかけ"));
            const all = JSON.parse(localStorage.getItem(DRAFTS_KEY) ?? "{}");
            all[ANON].nodes.unshift({ nodeId: "n2", text: "別のタブ", base: "", at: 1, tab: "x" });
            localStorage.setItem(DRAFTS_KEY, JSON.stringify(all));

            // ログインして戻ってきた。
            await ensureStudySession("user-1");

            expect((await getStudySync().load(ANON))?.owner).toBe("user-1");
            expect(readStudyCommentDrafts(ANON, null)).toEqual([]);
            expect(readStudyCommentDrafts(ANON, "user-1").map((entry) => entry.text)).toEqual([
                "別のタブ",
                "この画面の書きかけ",
            ]);
            expect(readStudyCommentDrafts(OTHERS, "user-1")).toEqual([]);
            expect(readStudyCommentDrafts(OTHERS, "user-2")).toHaveLength(1);
        });

        it("他のタブが先にノートを引き継いでいても、書きかけを移す。引き継いでいないノートの書きかけは移さない", async () => {
            const store = createMemoryStudyStore();
            const otherTab = createSync(store);
            await otherTab.createStudy(createDoc(ANON));
            applyStudyCommentDraftChange(ANON, null, "n1", draft("引き継ぎ前の書きかけ"));
            // 他のタブが、先に持ち主を決めた。
            otherTab.setSession({ userId: "user-1" });
            expect(await otherTab.adoptAnonymousStudies()).toEqual([ANON]);
            otherTab.dispose();
            // 保存層に無いノートの、匿名の書きかけ。
            applyStudyCommentDraftChange(STILL_ANON, null, "n1", draft("匿名のまま"));
            memorySync = createSync(store);

            await ensureStudySession("user-1");

            expect(readStudyCommentDrafts(ANON, "user-1")).toHaveLength(1);
            expect(readStudyCommentDrafts(STILL_ANON, null)).toHaveLength(1);
            expect(readStudyCommentDrafts(STILL_ANON, "user-1")).toEqual([]);
        });

        it("書きかけを移す前の確認（ノートの読み込み）に失敗したら、次にセッションが確定したときに確かめ直して移す", async () => {
            const store = createMemoryStudyStore();
            memorySync = createSync(store);
            const sync = getStudySync();
            await sync.createStudy(createDoc(ANON));
            await sync.createStudy(createDoc(STILL_ANON));
            // 書いた時刻をずらし、あとに書いたノートから先に確かめさせる。
            applyStudyCommentDraftChange(ANON, null, "n1", draft("読めなかったノートの書きかけ"), {
                now: 1000,
            });
            applyStudyCommentDraftChange(STILL_ANON, null, "n1", draft("読めたノートの書きかけ"), {
                now: 2000,
            });
            const failure = vi.spyOn(console, "error").mockImplementation(() => {});
            // 1 回だけ、ノートを読めない（ブラウザ内の保存の一時的な失敗）。
            // 確かめる順は書いた時刻で変わるので、何回目かではなくノートで決める。
            const originalLoad = sync.load;
            let failed = false;
            const load = vi.spyOn(sync, "load").mockImplementation((studyId) => {
                if (studyId === ANON && !failed) {
                    failed = true;
                    return Promise.reject(new Error("読み込めない"));
                }
                return originalLoad(studyId);
            });

            await ensureStudySession("user-1");

            // 読めなかった分は匿名のまま残り、読めた分は移っている。
            expect(readStudyCommentDrafts(ANON, null)).toHaveLength(1);
            expect(readStudyCommentDrafts(ANON, "user-1")).toEqual([]);
            expect(readStudyCommentDrafts(STILL_ANON, "user-1")).toHaveLength(1);

            // 同じユーザーで、もう一度セッションが確定した（別のページを開いた、など）。
            await ensureStudySession("user-1");

            expect(readStudyCommentDrafts(ANON, null)).toEqual([]);
            expect(readStudyCommentDrafts(ANON, "user-1")).toHaveLength(1);

            // すべて確かめ終えたら、同じユーザーではやり直さない。
            const calls = load.mock.calls.length;
            await ensureStudySession("user-1");
            expect(load.mock.calls.length).toBe(calls);
            failure.mockRestore();
        });
    });
});
