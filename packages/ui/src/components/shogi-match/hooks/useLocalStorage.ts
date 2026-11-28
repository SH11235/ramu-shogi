// ⚠️ このファイルのパスは apps/web/vite.config.ts の manualChunks で
// "ui-storage" chunk へ振り分けるためにハードコードされている。移動・リネームする
// 場合は vite.config.ts の該当ルールも必ず更新すること。放置すると本 util が
// shogi-match chunk に取り込まれ、eager path 全体が ~440KB の shogi-match を
// 引き込む回帰になる (ビルドエラーにはならずサイレントに劣化する)。
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

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

/**
 * キーの保存値（文字列のまま）を読むだけで購読する。書き込みはしない（別の画面が持つキーを
 * 覗くときに、既定値で上書きしないため）。
 */
export function useStoredString(key: string): string | null {
    return useSyncExternalStore(
        (onChange) => {
            const handleLocalSync = (event: Event): void => {
                if ((event as CustomEvent<LocalStorageSyncDetail>).detail?.key === key) onChange();
            };
            const handleStorage = (event: StorageEvent): void => {
                if (event.key === null || event.key === key) onChange();
            };
            window.addEventListener("storage", handleStorage);
            window.addEventListener(LOCAL_STORAGE_SYNC_EVENT, handleLocalSync);
            return () => {
                window.removeEventListener("storage", handleStorage);
                window.removeEventListener(LOCAL_STORAGE_SYNC_EVENT, handleLocalSync);
            };
        },
        () => {
            try {
                return localStorage.getItem(key);
            } catch {
                return null;
            }
        },
        () => null,
    );
}

/** 保存してある最新の値（無い・読めない・使えないときは `fallback`）。 */
export function readStoredValue<T>(key: string, fallback: T): T {
    if (typeof window === "undefined") return fallback;
    try {
        return parseStoredValue(key, localStorage.getItem(key), fallback);
    } catch {
        return fallback;
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
    // `fromStorage`: いまの値は保存値から読んだもの（別のタブ・別の hook が保存した）。保存し直さない。
    // 保存し直すと、遅れて届いた古い通知の値で、その後に保存された値を書き戻してしまう。
    const [{ value, userRevision, fromStorage }, setStored] = useState(() => ({
        value:
            typeof window === "undefined"
                ? defaultValue
                : parseStoredValue(key, localStorage.getItem(key), defaultValue),
        userRevision: 0,
        fromStorage: false,
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
                        fromStorage: false,
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
        if (fromStorage) {
            lastPersistedRef.current = { key, serialized, userRevision };
            return;
        }
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
    }, [key, value, userRevision, fromStorage]);

    useEffect(() => {
        if (typeof window === "undefined") {
            return;
        }

        // 通知に載った値ではなく、いまの保存値を読む（通知が遅れて届いても、後の値を見る）。
        const syncFromStorage = (): void => {
            let stored: string | null = null;
            try {
                stored = window.localStorage.getItem(key);
            } catch {
                return;
            }
            const nextValue = parseStoredValue(key, stored, defaultValue);
            setStored((previous) =>
                isSameStoredValue(previous.value, nextValue)
                    ? previous
                    : { ...previous, value: nextValue, fromStorage: true },
            );
        };

        const handleStorage = (event: StorageEvent): void => {
            if (event.key !== null && event.key !== key) {
                return;
            }
            syncFromStorage();
        };

        const handleLocalSync = (event: Event): void => {
            const customEvent = event as CustomEvent<LocalStorageSyncDetail>;
            if (customEvent.detail?.key !== key) {
                return;
            }
            syncFromStorage();
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
