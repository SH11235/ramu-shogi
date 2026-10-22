// ⚠️ このファイルのパスは apps/web/vite.config.ts の manualChunks で
// "ui-storage" chunk へ振り分けるためにハードコードされている。移動・リネームする
// 場合は vite.config.ts の該当ルールも必ず更新すること。放置すると本 util が
// shogi-match chunk に取り込まれ、eager path 全体が ~440KB の shogi-match を
// 引き込む回帰になる (ビルドエラーにはならずサイレントに劣化する)。
import { useEffect, useRef, useState } from "react";

export const LOCAL_STORAGE_SYNC_EVENT = "shogi-local-storage-sync";

export type LocalStorageChangeSource = "user" | "automatic";

export interface LocalStorageSyncDetail {
    key: string;
    source?: LocalStorageChangeSource;
}

function parseStoredValue<T>(key: string, stored: string | null, defaultValue: T): T {
    if (stored === null) {
        return defaultValue;
    }

    try {
        return JSON.parse(stored) as T;
    } catch (error) {
        console.warn(`Failed to parse localStorage key "${key}":`, error);
        return defaultValue;
    }
}

function isSameStoredValue<T>(left: T, right: T): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}

export function dispatchLocalStorageSyncEvent(
    key: string,
    source: LocalStorageChangeSource = "user",
): void {
    if (typeof window === "undefined") {
        return;
    }

    window.dispatchEvent(
        new CustomEvent<LocalStorageSyncDetail>(LOCAL_STORAGE_SYNC_EVENT, {
            detail: { key, source },
        }),
    );
}

/**
 * useLocalStorage の戻り値の型
 */
export type UseLocalStorageReturn<T> = readonly [
    T,
    (value: T | ((prev: T) => T), source?: LocalStorageChangeSource) => void,
];

/**
 * localStorage と同期する useState フック
 *
 * @param key - localStorage のキー
 * @param defaultValue - デフォルト値（localStorage に値がない場合に使用）
 * @returns [value, setValue] - useState と同じインターフェース
 */
export function useLocalStorage<T>(key: string, defaultValue: T): UseLocalStorageReturn<T> {
    // 初期値を localStorage から読み込む
    const [{ value, userRevision }, setStored] = useState(() => ({
        value:
            typeof window === "undefined"
                ? defaultValue
                : parseStoredValue(key, localStorage.getItem(key), defaultValue),
        userRevision: 0,
    }));
    const [setValue] = useState<UseLocalStorageReturn<T>[1]>(
        () =>
            (next: T | ((prev: T) => T), source: LocalStorageChangeSource = "user") => {
                setStored((previous) => {
                    const nextValue =
                        typeof next === "function"
                            ? (next as (prev: T) => T)(previous.value)
                            : next;
                    if (Object.is(previous.value, nextValue)) return previous;
                    return {
                        value: nextValue,
                        userRevision: previous.userRevision + (source === "user" ? 1 : 0),
                    };
                });
            },
    );
    const lastPersistedRef = useRef<{
        key: string;
        serialized: string;
        userRevision: number;
    } | null>(null);

    // 値が変更されたら localStorage に保存
    useEffect(() => {
        if (typeof window === "undefined") {
            return;
        }
        const serialized = JSON.stringify(value);
        try {
            localStorage.setItem(key, serialized);
        } catch (error) {
            // LocalStorage容量制限（通常5-10MB）に達した場合のハンドリング
            if (error instanceof DOMException && error.name === "QuotaExceededError") {
                console.error(
                    `LocalStorage quota exceeded for key "${key}". Consider clearing old data.`,
                );
            } else {
                console.warn(`Failed to save to localStorage key "${key}":`, error);
            }
        }
        const previous = lastPersistedRef.current;
        lastPersistedRef.current = { key, serialized, userRevision };
        if (previous && (previous.key !== key || previous.serialized !== serialized)) {
            // 自動更新とまとめて保存されても、利用者の編集があれば編集通知を送る。
            const source = previous.userRevision !== userRevision ? "user" : "automatic";
            dispatchLocalStorageSyncEvent(key, source);
        }
    }, [key, value, userRevision]);

    useEffect(() => {
        if (typeof window === "undefined") {
            return;
        }

        const syncFromStorage = (stored: string | null): void => {
            const nextValue = parseStoredValue(key, stored, defaultValue);
            setStored((previous) =>
                isSameStoredValue(previous.value, nextValue)
                    ? previous
                    : { ...previous, value: nextValue },
            );
        };

        const handleStorage = (event: StorageEvent): void => {
            if (event.key !== null && event.key !== key) {
                return;
            }
            syncFromStorage(event.newValue);
        };

        const handleLocalSync = (event: Event): void => {
            const customEvent = event as CustomEvent<LocalStorageSyncDetail>;
            if (customEvent.detail?.key !== key) {
                return;
            }
            syncFromStorage(window.localStorage.getItem(key));
        };

        window.addEventListener("storage", handleStorage);
        window.addEventListener(LOCAL_STORAGE_SYNC_EVENT, handleLocalSync as EventListener);

        return () => {
            window.removeEventListener("storage", handleStorage);
            window.removeEventListener(LOCAL_STORAGE_SYNC_EVENT, handleLocalSync as EventListener);
        };
    }, [defaultValue, key]);

    return [value, setValue];
}
