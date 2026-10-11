/**
 * 同期エンジンをブラウザの API につなぐ部分。
 *
 * - 送信役を 1 つにするロック: Web Locks（`navigator.locks`）
 * - 他のタブへの通知: BroadcastChannel
 * - タブに戻ったとき・オンラインに戻ったときの取り込みと再送
 */

import { createStudyApiClient, type StudyApiClientOptions } from "./api-client";
import { createIndexedDbStudyStore } from "./indexeddb-store";
import type { StudyStore } from "./store";
import {
    createInProcessLockManager,
    createStudySync,
    type StudyChannel,
    type StudyChannelMessage,
    type StudyLockManager,
    type StudySync,
    type StudySyncOptions,
} from "./sync";

const STUDY_CHANNEL_NAME = "ramu-studies";

/**
 * Web Locks によるロック。同じオリジンの全タブで、同じ名前の処理は同時に 1 つだけ動く。
 * Web Locks が無い環境では、タブの中だけで直列化する（タブをまたいだ重複送信は起こりうるが、
 * 操作は冪等で、送信中のバッチは同じ `batchId` で再送されるので結果は変わらない）。
 */
export function createWebLockManager(
    lockManager: LockManager | undefined = globalThis.navigator?.locks,
): StudyLockManager {
    if (!lockManager) return createInProcessLockManager();
    return {
        request<T>(name: string, task: () => Promise<T>): Promise<T> {
            return lockManager.request(name, task) as Promise<T>;
        },
    };
}

/** BroadcastChannel による通知。使えない環境では null。 */
export function createBroadcastStudyChannel(
    name: string = STUDY_CHANNEL_NAME,
): StudyChannel | null {
    if (typeof BroadcastChannel === "undefined") return null;
    const channel = new BroadcastChannel(name);
    const handlers = new Set<(message: StudyChannelMessage) => void>();
    channel.onmessage = (event: MessageEvent<unknown>) => {
        const data = event.data as Partial<StudyChannelMessage> | null;
        if (!data || data.type !== "changed" || typeof data.studyId !== "string") return;
        for (const handler of [...handlers]) handler({ type: "changed", studyId: data.studyId });
    };
    return {
        post(message) {
            try {
                channel.postMessage(message);
            } catch {
                // 閉じたあとの通知は捨てる。
            }
        },
        subscribe(handler) {
            handlers.add(handler);
            return () => {
                handlers.delete(handler);
            };
        },
        close() {
            handlers.clear();
            channel.close();
        },
    };
}

export interface BrowserStudySyncOptions
    extends Partial<Pick<StudySyncOptions, "flushDelayMs" | "retryBaseMs" | "retryMaxMs">> {
    /** 既定は IndexedDB の保存層。 */
    store?: StudyStore;
    /** API クライアントの設定（既定は同一オリジンの `/api/studies`）。 */
    api?: StudyApiClientOptions;
}

export interface BrowserStudySync {
    sync: StudySync;
    store: StudyStore;
    /** ページのイベントの購読と通知を止め、保存層を閉じる。 */
    dispose(): void;
}

/**
 * ブラウザ用の同期エンジンを作る（アプリで 1 つだけ作って使い回す）。
 *
 * - タブが見える状態に戻ったら、開いているノートについてサーバーの変更を取り込む。
 * - オンラインに戻ったら、送信待ちをすぐ送る。
 * - タブが隠れるときは、送信待ちをすぐ送る（間引きの待ち時間で閉じられても送れるように）。
 */
export function createBrowserStudySync(options: BrowserStudySyncOptions = {}): BrowserStudySync {
    const store = options.store ?? createIndexedDbStudyStore();
    const channel = createBroadcastStudyChannel();
    const sync = createStudySync({
        store,
        api: createStudyApiClient(options.api),
        locks: createWebLockManager(),
        channel,
        flushDelayMs: options.flushDelayMs,
        retryBaseMs: options.retryBaseMs,
        retryMaxMs: options.retryMaxMs,
    });

    const onVisibilityChange = (): void => {
        if (document.visibilityState === "visible") {
            void sync.refreshOpen().catch(() => undefined);
        } else {
            void sync.flush().catch(() => undefined);
        }
    };
    const onOnline = (): void => {
        void sync.flush().catch(() => undefined);
    };
    const hasPage = typeof document !== "undefined" && typeof window !== "undefined";
    if (hasPage) {
        document.addEventListener("visibilitychange", onVisibilityChange);
        window.addEventListener("online", onOnline);
    }

    return {
        sync,
        store,
        dispose() {
            if (hasPage) {
                document.removeEventListener("visibilitychange", onVisibilityChange);
                window.removeEventListener("online", onOnline);
            }
            sync.dispose();
            channel?.close();
            store.close();
        },
    };
}
