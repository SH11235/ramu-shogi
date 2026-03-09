import { useEffect, useRef, useState } from "react";

export const LOCAL_STORAGE_SYNC_EVENT = "shogi-local-storage-sync";

interface LocalStorageSyncDetail {
    key: string;
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

export function dispatchLocalStorageSyncEvent(key: string): void {
    if (typeof window === "undefined") {
        return;
    }

    window.dispatchEvent(
        new CustomEvent<LocalStorageSyncDetail>(LOCAL_STORAGE_SYNC_EVENT, {
            detail: { key },
        }),
    );
}

/**
 * useLocalStorage の戻り値の型
 */
export type UseLocalStorageReturn<T> = readonly [T, (value: T | ((prev: T) => T)) => void];

/**
 * localStorage と同期する useState フック
 *
 * @param key - localStorage のキー
 * @param defaultValue - デフォルト値（localStorage に値がない場合に使用）
 * @returns [value, setValue] - useState と同じインターフェース
 */
export function useLocalStorage<T>(key: string, defaultValue: T): UseLocalStorageReturn<T> {
    // 初期値を localStorage から読み込む
    const [value, setValue] = useState<T>(() => {
        if (typeof window === "undefined") {
            return defaultValue;
        }
        return parseStoredValue(key, localStorage.getItem(key), defaultValue);
    });
    const hasPersistedRef = useRef(false);

    // 値が変更されたら localStorage に保存
    useEffect(() => {
        if (typeof window === "undefined") {
            return;
        }
        try {
            localStorage.setItem(key, JSON.stringify(value));
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
        if (hasPersistedRef.current) {
            dispatchLocalStorageSyncEvent(key);
        } else {
            hasPersistedRef.current = true;
        }
    }, [key, value]);

    useEffect(() => {
        if (typeof window === "undefined") {
            return;
        }

        const syncFromStorage = (stored: string | null): void => {
            const nextValue = parseStoredValue(key, stored, defaultValue);
            setValue((prev) => (isSameStoredValue(prev, nextValue) ? prev : nextValue));
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

    // useStateのsetValueは安定した参照なので直接返す
    return [value, setValue];
}
