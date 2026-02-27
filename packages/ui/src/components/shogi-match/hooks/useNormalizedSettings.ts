import { useEffect } from "react";
import type { UseLocalStorageReturn } from "./useLocalStorage";
import { useLocalStorage } from "./useLocalStorage";

/**
 * LocalStorage に保存された設定を正規化して返すフック
 *
 * @template T 設定の型
 * @param key LocalStorage のキー
 * @param defaultValue デフォルト値
 * @param normalize 正規化関数（保存された値とデフォルト値を受け取り、正規化された値を返す）
 * @param isSame 2つの値が同じかどうかを判定する関数
 * @returns [正規化された設定値, 設定更新関数]
 *
 * @example
 * ```ts
 * const [timeSettings, setTimeSettings] = useNormalizedSettings(
 *     "shogi-time-settings",
 *     defaultTimeSettings,
 *     normalizeTimeSettings,
 *     isSameTimeSettings
 * );
 * ```
 */
export function useNormalizedSettings<T>(
    key: string,
    defaultValue: T,
    normalize: (value: T, defaults: T) => T,
    isSame: (a: T, b: T) => boolean,
): UseLocalStorageReturn<T> {
    const [stored, setStored] = useLocalStorage(key, defaultValue);

    const normalized = normalize(stored, defaultValue);

    useEffect(() => {
        if (!isSame(normalized, stored)) {
            setStored(normalized);
        }
    }, [normalized, stored, setStored, isSame]);

    // isSame で同一と判定されるなら stored（安定した参照）を返す
    // これにより normalize() が毎レンダーで新オブジェクトを生成しても
    // 参照が変化しないため、依存配列を持つフックが不要な再実行をしない
    const result = isSame(normalized, stored) ? stored : normalized;
    return [result, setStored] as const;
}
