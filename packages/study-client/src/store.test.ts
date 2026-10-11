import "fake-indexeddb/auto";
import type { StudyOp } from "@shogi/app-core";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { createIndexedDbStudyStore, STUDY_DB_NAME, STUDY_DB_VERSION } from "./indexeddb-store";
import {
    createMemoryStudyStore,
    STUDY_RECORD_VERSION,
    type StoredStudy,
    StudyStorageError,
    type StudyStore,
} from "./store";
import { createTestDocument, TEST_STUDY_ID } from "./sync-test-support";

const stored = (overrides: Partial<StoredStudy> = {}): StoredStudy => ({
    recordVersion: STUDY_RECORD_VERSION,
    id: TEST_STUDY_ID,
    owner: null,
    doc: createTestDocument(),
    serverRevision: null,
    inflight: null,
    remote: { state: "ok" },
    mergedInto: null,
    deleting: false,
    originKey: null,
    createdAt: 1000,
    updatedAt: 1000,
    lastSyncedAt: null,
    ...overrides,
});

const comment = (value: string): StudyOp => ({
    type: "setComment",
    nodeId: createTestDocument().tree.rootId,
    value,
});

const implementations: Array<{ name: string; create: () => StudyStore }> = [
    { name: "メモリ", create: () => createMemoryStudyStore() },
    {
        name: "IndexedDB",
        create: () => createIndexedDbStudyStore({ indexedDB: new IDBFactory() }),
    },
];

describe.each(implementations)("保存層（$name）", ({ create }) => {
    it("無いノートは null と空の送信待ちを返す", async () => {
        const store = create();
        expect(await store.read("missing")).toEqual({ study: null, pending: [] });
        expect(await store.list()).toEqual([]);
    });

    it("文書の更新と送信待ちへの追加を 1 つのトランザクションで行う", async () => {
        const store = create();
        const result = await store.transact(TEST_STUDY_ID, (snapshot) => {
            expect(snapshot).toEqual({ study: null, pending: [] });
            return { study: stored(), appendOps: [comment("a"), comment("b")], result: "created" };
        });
        expect(result).toBe("created");

        const snapshot = await store.read(TEST_STUDY_ID);
        expect(snapshot.study).toEqual(stored());
        expect(snapshot.pending.map((item) => item.op)).toEqual([comment("a"), comment("b")]);
        expect(snapshot.pending[0].seq).toBeLessThan(snapshot.pending[1].seq);
    });

    it("mutate が例外を投げたら何も書かない", async () => {
        const store = create();
        await store.transact(TEST_STUDY_ID, () => ({ study: stored(), result: undefined }));
        await expect(
            store.transact(TEST_STUDY_ID, () => {
                throw new Error("abort");
            }),
        ).rejects.toThrow("abort");
        const snapshot = await store.read(TEST_STUDY_ID);
        expect(snapshot.study?.updatedAt).toBe(1000);
        expect(snapshot.pending).toEqual([]);
    });

    it("保存できない値（複製できない値）を含む書き込みは、全体が失敗する", async () => {
        const store = create();
        await store.transact(TEST_STUDY_ID, () => ({ study: stored(), result: undefined }));
        const broken: StudyOp = {
            type: "setComment",
            nodeId: createTestDocument().tree.rootId,
            value: (() => "x") as unknown as string,
        };
        await expect(
            store.transact(TEST_STUDY_ID, (snapshot) => ({
                study: { ...(snapshot.study as StoredStudy), updatedAt: 2000 },
                appendOps: [comment("ok"), broken],
                result: undefined,
            })),
        ).rejects.toBeDefined();
        const snapshot = await store.read(TEST_STUDY_ID);
        expect(snapshot.study?.updatedAt).toBe(1000);
        expect(snapshot.pending).toEqual([]);
    });

    it("連番は単調に増え、removeOpsUpTo でその連番以下だけを消す", async () => {
        const store = create();
        await store.transact(TEST_STUDY_ID, () => ({
            study: stored(),
            appendOps: [comment("1"), comment("2"), comment("3")],
            result: undefined,
        }));
        const before = (await store.read(TEST_STUDY_ID)).pending;
        await store.transact(TEST_STUDY_ID, (snapshot) => ({
            removeOpsUpTo: snapshot.pending[1].seq,
            appendOps: [comment("4")],
            result: undefined,
        }));
        const after = (await store.read(TEST_STUDY_ID)).pending;
        expect(after.map((item) => item.op)).toEqual([comment("3"), comment("4")]);
        expect(after[1].seq).toBeGreaterThan(before[2].seq);
    });

    it("送信待ちはノートごとに分かれる", async () => {
        const store = create();
        await store.transact("a", () => ({
            study: stored({ id: "a" }),
            appendOps: [comment("a1")],
            result: undefined,
        }));
        await store.transact("b", () => ({
            study: stored({ id: "b" }),
            appendOps: [comment("b1"), comment("b2")],
            result: undefined,
        }));
        expect((await store.read("a")).pending.map((item) => item.op)).toEqual([comment("a1")]);
        expect((await store.read("b")).pending).toHaveLength(2);
    });

    it("study: null でノートと送信待ちを消す", async () => {
        const store = create();
        await store.transact(TEST_STUDY_ID, () => ({
            study: stored(),
            appendOps: [comment("a")],
            result: undefined,
        }));
        await store.transact(TEST_STUDY_ID, () => ({ study: null, result: undefined }));
        expect(await store.read(TEST_STUDY_ID)).toEqual({ study: null, pending: [] });
        expect(await store.list()).toEqual([]);
    });

    it("一覧は要約を更新が新しい順に返す", async () => {
        const store = create();
        await store.transact("old", () => ({
            study: stored({ id: "old", updatedAt: 1000 }),
            result: undefined,
        }));
        await store.transact("new", () => ({
            study: stored({
                id: "new",
                owner: "user-1",
                serverRevision: 3,
                updatedAt: 2000,
                lastSyncedAt: 1500,
                originKey: "origin-key",
            }),
            appendOps: [comment("a"), comment("b")],
            result: undefined,
        }));
        const list = await store.list();
        expect(list.map((item) => item.id)).toEqual(["new", "old"]);
        expect(list[0]).toEqual({
            id: "new",
            owner: "user-1",
            title: "RAMU 対 Panda",
            origin: { kind: "paste", ref: null },
            meta: {},
            originKey: "origin-key",
            nodeCount: 3,
            layerCount: 0,
            resultCount: 0,
            serverRevision: 3,
            remote: { state: "ok" },
            mergedInto: null,
            deleting: false,
            pendingCount: 2,
            createdAt: 1000,
            updatedAt: 2000,
            lastSyncedAt: 1500,
        });
    });

    it("元棋譜のキーでノートを探せる", async () => {
        const store = create();
        await store.transact("a", () => ({
            study: stored({ id: "a", originKey: "key-1", updatedAt: 1000 }),
            result: undefined,
        }));
        await store.transact("b", () => ({
            study: stored({ id: "b", originKey: "key-1", updatedAt: 2000 }),
            result: undefined,
        }));
        await store.transact("c", () => ({
            study: stored({ id: "c", originKey: null }),
            result: undefined,
        }));
        expect(await store.findByOriginKey("key-1")).toEqual(["b", "a"]);
        expect(await store.findByOriginKey("key-2")).toEqual([]);
    });

    it("読んだ値を書き換えても保存層の中身は変わらない", async () => {
        const store = create();
        await store.transact(TEST_STUDY_ID, () => ({ study: stored(), result: undefined }));
        const first = await store.read(TEST_STUDY_ID);
        (first.study as StoredStudy).doc.title = "書き換え";
        expect((await store.read(TEST_STUDY_ID)).study?.doc.title).toBe("RAMU 対 Panda");
    });
});

describe("IndexedDB の保存層", () => {
    it("別のインスタンス（リロード後・別タブ）から同じ内容を読める", async () => {
        const indexedDB = new IDBFactory();
        const first = createIndexedDbStudyStore({ indexedDB });
        await first.transact(TEST_STUDY_ID, () => ({
            study: stored({ owner: "user-1" }),
            appendOps: [comment("a")],
            result: undefined,
        }));
        first.close();

        const second = createIndexedDbStudyStore({ indexedDB });
        const snapshot = await second.read(TEST_STUDY_ID);
        expect(snapshot.study).toEqual(stored({ owner: "user-1" }));
        expect(snapshot.pending.map((item) => item.op)).toEqual([comment("a")]);
        // 連番は別のインスタンスでも続きから振られる。
        await second.transact(TEST_STUDY_ID, () => ({
            appendOps: [comment("b")],
            result: undefined,
        }));
        const pending = (await second.read(TEST_STUDY_ID)).pending;
        expect(pending[1].seq).toBeGreaterThan(pending[0].seq);
    });

    it("2 つのインスタンスからの同時の書き込みは直列化され、どちらも失われない", async () => {
        const indexedDB = new IDBFactory();
        const a = createIndexedDbStudyStore({ indexedDB });
        const b = createIndexedDbStudyStore({ indexedDB });
        await a.transact(TEST_STUDY_ID, () => ({ study: stored(), result: undefined }));
        const bump = (store: StudyStore, label: string) =>
            store.transact(TEST_STUDY_ID, (snapshot) => ({
                study: {
                    ...(snapshot.study as StoredStudy),
                    updatedAt: (snapshot.study as StoredStudy).updatedAt + 1,
                },
                appendOps: [comment(label)],
                result: undefined,
            }));
        await Promise.all([bump(a, "a1"), bump(b, "b1"), bump(a, "a2"), bump(b, "b2")]);
        const snapshot = await a.read(TEST_STUDY_ID);
        expect(snapshot.study?.updatedAt).toBe(1004);
        expect(snapshot.pending).toHaveLength(4);
    });

    it("スキーマの版でデータベースを作る", async () => {
        const indexedDB = new IDBFactory();
        const store = createIndexedDbStudyStore({ indexedDB });
        await store.list();
        store.close();
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open(STUDY_DB_NAME);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
        expect(db.version).toBe(STUDY_DB_VERSION);
        expect([...db.objectStoreNames].sort()).toEqual(["docs", "pendingOps", "studies"]);
        db.close();
    });

    it("新しい版のアプリが作ったデータベースは開かず、使えないことを伝える", async () => {
        const indexedDB = new IDBFactory();
        await new Promise<void>((resolve, reject) => {
            const request = indexedDB.open(STUDY_DB_NAME, STUDY_DB_VERSION + 1);
            request.onsuccess = () => {
                request.result.close();
                resolve();
            };
            request.onerror = () => reject(request.error);
        });
        const store = createIndexedDbStudyStore({ indexedDB });
        await expect(store.read(TEST_STUDY_ID)).rejects.toMatchObject({
            name: "StudyStorageError",
            code: "unavailable",
        });
    });

    it("IndexedDB が無い環境では unavailable で失敗する", async () => {
        const original = globalThis.indexedDB;
        // @ts-expect-error テストのために IndexedDB の無い環境を模擬する。
        delete globalThis.indexedDB;
        try {
            const store = createIndexedDbStudyStore();
            const error = await store
                .transact(TEST_STUDY_ID, () => ({ study: stored(), result: undefined }))
                .catch((caught: unknown) => caught);
            expect(error).toBeInstanceOf(StudyStorageError);
            expect((error as StudyStorageError).code).toBe("unavailable");
            await expect(store.list()).rejects.toMatchObject({ code: "unavailable" });
        } finally {
            globalThis.indexedDB = original;
        }
    });

    it("容量不足は quota_exceeded、開けない場合は unavailable として伝える", async () => {
        const failing = (name: string): IDBFactory =>
            ({
                open() {
                    throw new DOMException("failed", name);
                },
            }) as unknown as IDBFactory;
        await expect(
            createIndexedDbStudyStore({ indexedDB: failing("QuotaExceededError") }).read("x"),
        ).rejects.toMatchObject({ code: "quota_exceeded" });
        await expect(
            createIndexedDbStudyStore({ indexedDB: failing("SecurityError") }).read("x"),
        ).rejects.toMatchObject({ code: "unavailable" });
    });
});
