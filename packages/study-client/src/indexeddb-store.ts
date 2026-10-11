/**
 * 研究ノートのローカル保存層の IndexedDB 実装。
 *
 * オブジェクトストア:
 * - `studies`: ノートの管理情報と一覧用の要約（キー: `id`）。一覧は文書の本体を読まずに出せる。
 * - `docs`: 文書の本体（キー: `id`）。
 * - `pendingOps`: 送信待ちの操作（キー: 自動採番の `seq`、索引: `studyId`）。
 *
 * 複数タブからの書き込みは、IndexedDB の読み書きトランザクションが直列化する。
 */

import type { StudyDocument, StudyOp } from "@shogi/app-core";
import {
    type PendingStudyOp,
    type StoredStudy,
    type StoredStudySummary,
    StudyStorageError,
    type StudyStore,
    type StudyStoreSnapshot,
    summarizeStoredStudy,
} from "./store";

export const STUDY_DB_NAME = "ramu-studies";
/** データベースのスキーマの版。ストアや索引を変えたら上げ、`upgrade` に移行を足す。 */
export const STUDY_DB_VERSION = 1;

const STUDIES = "studies";
const DOCS = "docs";
const PENDING = "pendingOps";

/** `studies` ストアの行。文書の本体は `docs` に分ける。 */
type StudyRow = Omit<StoredStudy, "doc"> & {
    summary: Pick<
        StoredStudySummary,
        "title" | "origin" | "meta" | "nodeCount" | "layerCount" | "resultCount"
    >;
};

interface DocRow {
    id: string;
    doc: StudyDocument;
}

interface PendingRow {
    seq?: number;
    studyId: string;
    op: StudyOp;
}

export interface IndexedDbStudyStoreOptions {
    /** 既定は `globalThis.indexedDB`。 */
    indexedDB?: IDBFactory;
    /** 既定は `ramu-studies`。 */
    dbName?: string;
}

/** スキーマを作る・移行する。版を上げたら、古い版からの手順をここに足す。 */
function upgrade(db: IDBDatabase, oldVersion: number): void {
    if (oldVersion < 1) {
        const studies = db.createObjectStore(STUDIES, { keyPath: "id" });
        studies.createIndex("originKey", "originKey", { unique: false });
        db.createObjectStore(DOCS, { keyPath: "id" });
        const pending = db.createObjectStore(PENDING, { keyPath: "seq", autoIncrement: true });
        pending.createIndex("studyId", "studyId", { unique: false });
    }
}

const toStorageError = (error: unknown, fallback: string): StudyStorageError => {
    if (error instanceof StudyStorageError) return error;
    const name = error instanceof Error || error instanceof DOMException ? error.name : "";
    const message = error instanceof Error ? error.message : fallback;
    if (name === "QuotaExceededError") {
        return new StudyStorageError("quota_exceeded", "ブラウザの保存容量が足りません", {
            cause: error,
        });
    }
    if (
        name === "SecurityError" ||
        name === "InvalidStateError" ||
        name === "VersionError" ||
        name === "UnknownError"
    ) {
        return new StudyStorageError(
            "unavailable",
            `ブラウザ内の保存領域を使えません: ${message}`,
            {
                cause: error,
            },
        );
    }
    return new StudyStorageError("failed", `ブラウザ内への保存に失敗しました: ${message}`, {
        cause: error,
    });
};

const requestToPromise = <T>(request: IDBRequest<T>): Promise<T> =>
    new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });

const transactionDone = (transaction: IDBTransaction): Promise<void> =>
    new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () =>
            reject(transaction.error ?? new DOMException("transaction aborted", "AbortError"));
    });

const toRow = (study: StoredStudy): { row: StudyRow; doc: DocRow } => {
    const { doc, ...rest } = study;
    const summary = summarizeStoredStudy(study, 0);
    return {
        row: {
            ...rest,
            summary: {
                title: summary.title,
                origin: summary.origin,
                meta: summary.meta,
                nodeCount: summary.nodeCount,
                layerCount: summary.layerCount,
                resultCount: summary.resultCount,
            },
        },
        doc: { id: study.id, doc },
    };
};

const fromRow = (row: StudyRow, doc: DocRow): StoredStudy => {
    const { summary: _summary, ...rest } = row;
    return { ...rest, doc: doc.doc };
};

/**
 * IndexedDB の保存層を作る。
 *
 * データベースは最初の読み書きで開く。IndexedDB が使えない・開けない場合、各メソッドは
 * `StudyStorageError`（`code: "unavailable"`）で失敗する。容量不足は `quota_exceeded`。
 */
export function createIndexedDbStudyStore(options: IndexedDbStudyStoreOptions = {}): StudyStore {
    const dbName = options.dbName ?? STUDY_DB_NAME;
    let dbPromise: Promise<IDBDatabase> | null = null;
    let closed = false;

    const open = (): Promise<IDBDatabase> => {
        if (dbPromise) return dbPromise;
        const factory = options.indexedDB ?? (globalThis.indexedDB as IDBFactory | undefined);
        const opening = new Promise<IDBDatabase>((resolve, reject) => {
            if (!factory) {
                reject(
                    new StudyStorageError(
                        "unavailable",
                        "このブラウザではブラウザ内の保存領域（IndexedDB）を使えません",
                    ),
                );
                return;
            }
            let request: IDBOpenDBRequest;
            try {
                request = factory.open(dbName, STUDY_DB_VERSION);
            } catch (error) {
                reject(toStorageError(error, "IndexedDB を開けません"));
                return;
            }
            request.onupgradeneeded = (event) => {
                upgrade(request.result, event.oldVersion);
            };
            request.onblocked = () => {
                reject(
                    new StudyStorageError(
                        "unavailable",
                        "他のタブが古い版の保存領域を開いています。他のタブを閉じてください",
                    ),
                );
            };
            request.onerror = () => {
                const error = request.error;
                reject(
                    error?.name === "VersionError"
                        ? new StudyStorageError(
                              "unavailable",
                              "保存領域が新しい版のアプリで作られています。ページを再読み込みしてください",
                              { cause: error },
                          )
                        : toStorageError(error, "IndexedDB を開けません"),
                );
            };
            request.onsuccess = () => {
                const db = request.result;
                // 他のタブが新しい版へ上げようとしたら、邪魔しないよう閉じる。次の操作で開き直す。
                db.onversionchange = () => {
                    db.close();
                    dbPromise = null;
                };
                db.onclose = () => {
                    dbPromise = null;
                };
                if (closed) db.close();
                resolve(db);
            };
        });
        dbPromise = opening;
        opening.catch(() => {
            if (dbPromise === opening) dbPromise = null;
        });
        return opening;
    };

    const readSnapshot = async (
        transaction: IDBTransaction,
        studyId: string,
    ): Promise<StudyStoreSnapshot> => {
        const [row, doc, pendingRows] = await Promise.all([
            requestToPromise<StudyRow | undefined>(transaction.objectStore(STUDIES).get(studyId)),
            requestToPromise<DocRow | undefined>(transaction.objectStore(DOCS).get(studyId)),
            requestToPromise<Required<PendingRow>[]>(
                transaction.objectStore(PENDING).index("studyId").getAll(IDBKeyRange.only(studyId)),
            ),
        ]);
        const pending: PendingStudyOp[] = pendingRows
            .map((item) => ({ seq: item.seq, op: item.op }))
            .sort((a, b) => a.seq - b.seq);
        return { study: row && doc ? fromRow(row, doc) : null, pending };
    };

    return {
        async read(studyId) {
            try {
                const db = await open();
                const transaction = db.transaction([STUDIES, DOCS, PENDING], "readonly");
                const done = transactionDone(transaction);
                const snapshot = await readSnapshot(transaction, studyId);
                await done;
                return snapshot;
            } catch (error) {
                throw toStorageError(error, "読み込みに失敗しました");
            }
        },

        async transact(studyId, mutate) {
            let db: IDBDatabase;
            try {
                db = await open();
            } catch (error) {
                throw toStorageError(error, "IndexedDB を開けません");
            }
            let transaction: IDBTransaction;
            try {
                transaction = db.transaction([STUDIES, DOCS, PENDING], "readwrite");
            } catch (error) {
                throw toStorageError(error, "書き込みを始められません");
            }
            const done = transactionDone(transaction);
            // 途中で失敗しても done の拒否が未処理にならないようにする（下で await する）。
            done.catch(() => undefined);
            try {
                const snapshot = await readSnapshot(transaction, studyId);
                const write = mutate(snapshot);
                const studies = transaction.objectStore(STUDIES);
                const docs = transaction.objectStore(DOCS);
                const pending = transaction.objectStore(PENDING);

                if (write.study === null) {
                    studies.delete(studyId);
                    docs.delete(studyId);
                    for (const item of snapshot.pending) pending.delete(item.seq);
                } else {
                    if (write.study !== undefined) {
                        const { row, doc } = toRow(write.study);
                        studies.put(row);
                        docs.put(doc);
                    }
                    if (write.removeOpsUpTo !== undefined) {
                        for (const item of snapshot.pending) {
                            if (item.seq <= write.removeOpsUpTo) pending.delete(item.seq);
                        }
                    }
                    for (const op of write.appendOps ?? []) {
                        const row: PendingRow = { studyId, op };
                        pending.add(row);
                    }
                }
                await done;
                return write.result;
            } catch (error) {
                try {
                    transaction.abort();
                } catch {
                    // 既に終わっている。
                }
                // トランザクションの失敗理由（容量不足など）があればそちらを優先する。
                throw toStorageError(transaction.error ?? error, "書き込みに失敗しました");
            }
        },

        async list() {
            try {
                const db = await open();
                const transaction = db.transaction([STUDIES, PENDING], "readonly");
                const done = transactionDone(transaction);
                const rows = await requestToPromise<StudyRow[]>(
                    transaction.objectStore(STUDIES).getAll(),
                );
                const index = transaction.objectStore(PENDING).index("studyId");
                const counts = await Promise.all(
                    rows.map((row) => requestToPromise(index.count(IDBKeyRange.only(row.id)))),
                );
                await done;
                return rows
                    .map((row, i): StoredStudySummary => {
                        const {
                            summary,
                            recordVersion: _version,
                            inflight: _inflight,
                            ...rest
                        } = row;
                        return { ...rest, ...summary, pendingCount: counts[i] };
                    })
                    .sort((a, b) => b.updatedAt - a.updatedAt || (a.id < b.id ? 1 : -1));
            } catch (error) {
                throw toStorageError(error, "一覧の読み込みに失敗しました");
            }
        },

        async findByOriginKey(originKey) {
            try {
                const db = await open();
                const transaction = db.transaction([STUDIES], "readonly");
                const done = transactionDone(transaction);
                const rows = await requestToPromise<StudyRow[]>(
                    transaction
                        .objectStore(STUDIES)
                        .index("originKey")
                        .getAll(IDBKeyRange.only(originKey)),
                );
                await done;
                return rows.sort((a, b) => b.updatedAt - a.updatedAt).map((row) => row.id);
            } catch (error) {
                throw toStorageError(error, "読み込みに失敗しました");
            }
        },

        close() {
            closed = true;
            const current = dbPromise;
            dbPromise = null;
            void current?.then((db) => db.close()).catch(() => undefined);
        },
    };
}
