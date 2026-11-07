/**
 * 最後に開いた定跡ファイルを IndexedDB に一つだけ残す（再読み込みしても同じ定跡を開き直せるように）。
 * 定跡は数十 MB になり localStorage に入らないので、File のまま IndexedDB に置く。
 * 保存できない環境（プライベートウィンドウ等）では何もしない。
 */
const DB_NAME = "book-tree-viewer";
const STORE = "files";
const KEY = "last";

function openDb(): Promise<IDBDatabase | null> {
    if (typeof indexedDB === "undefined") return Promise.resolve(null);
    return new Promise((resolve) => {
        try {
            const request = indexedDB.open(DB_NAME, 1);
            request.onupgradeneeded = () => request.result.createObjectStore(STORE);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => resolve(null);
            request.onblocked = () => resolve(null);
        } catch {
            resolve(null);
        }
    });
}

async function run<T>(
    mode: IDBTransactionMode,
    action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | undefined> {
    const db = await openDb();
    if (!db) return undefined;
    return new Promise((resolve) => {
        try {
            const transaction = db.transaction(STORE, mode);
            const request = action(transaction.objectStore(STORE));
            transaction.oncomplete = () => {
                db.close();
                resolve(request.result);
            };
            transaction.onerror = transaction.onabort = () => {
                db.close();
                resolve(undefined);
            };
        } catch {
            db.close();
            resolve(undefined);
        }
    });
}

export async function saveLastBookFile(file: File): Promise<void> {
    await run("readwrite", (store) => store.put(file, KEY));
}

export async function loadLastBookFile(): Promise<File | null> {
    const value = await run("readonly", (store) => store.get(KEY));
    return value instanceof File ? value : null;
}
