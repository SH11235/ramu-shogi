/**
 * 時計設定のユーティリティ関数
 */

import type { ClockSettings } from "../hooks/useClockManager";

/**
 * 旧バージョンの「秒」保存値をmsに復元するためのしきい値
 * 1000未満の値は秒として扱い、1000倍する
 */
const LEGACY_TIME_THRESHOLD_MS = 1000;

/**
 * 時間値を正規化（ミリ秒単位）
 *
 * @param value - 正規化する値
 * @param fallback - 無効な値の場合のフォールバック値
 * @returns 正規化された時間値（ミリ秒）
 */
function normalizeTimeValueMs(value: number, fallback: number): number {
    if (!Number.isFinite(value)) return fallback;
    if (value < 0) return fallback;
    // 旧バージョン互換: 1000未満は秒として扱う
    if (value > 0 && value < LEGACY_TIME_THRESHOLD_MS) {
        return value * 1000;
    }
    return Math.trunc(value);
}

/**
 * 時計設定を正規化
 *
 * 旧バージョンで「秒」として保存された値をミリ秒に変換し、
 * 無効な値をデフォルト値で補完する
 *
 * @param settings - 正規化する設定
 * @param defaults - デフォルト値
 * @returns 正規化された時計設定
 */
export function normalizeTimeSettings(
    settings: ClockSettings,
    defaults: ClockSettings,
): ClockSettings {
    return {
        sente: {
            mainMs: normalizeTimeValueMs(settings.sente.mainMs, defaults.sente.mainMs),
            byoyomiMs: normalizeTimeValueMs(settings.sente.byoyomiMs, defaults.sente.byoyomiMs),
            enabled: settings.sente.enabled ?? defaults.sente.enabled,
        },
        gote: {
            mainMs: normalizeTimeValueMs(settings.gote.mainMs, defaults.gote.mainMs),
            byoyomiMs: normalizeTimeValueMs(settings.gote.byoyomiMs, defaults.gote.byoyomiMs),
            enabled: settings.gote.enabled ?? defaults.gote.enabled,
        },
    };
}

/**
 * 2つの時計設定が同一かどうかを比較
 *
 * @param a - 比較対象1
 * @param b - 比較対象2
 * @returns 同一の場合 true
 */
export function isSameTimeSettings(a: ClockSettings, b: ClockSettings): boolean {
    return (
        a.sente.mainMs === b.sente.mainMs &&
        a.sente.byoyomiMs === b.sente.byoyomiMs &&
        a.sente.enabled === b.sente.enabled &&
        a.gote.mainMs === b.gote.mainMs &&
        a.gote.byoyomiMs === b.gote.byoyomiMs &&
        a.gote.enabled === b.gote.enabled
    );
}
