/**
 * 時計設定のユーティリティ関数
 */

import type { Player } from "@shogi/app-core";
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
    const normalizeSide = (side: Player): ClockSettings[Player] => {
        const value = settings[side];
        const fallback = defaults[side];
        return {
            mainMs: normalizeTimeValueMs(value.mainMs, fallback.mainMs),
            byoyomiMs: normalizeTimeValueMs(value.byoyomiMs, fallback.byoyomiMs),
            // 加算の無かった版で保存した設定には項目が無い（加算なしとして読む）。
            incrementMs:
                value.incrementMs === undefined
                    ? 0
                    : normalizeTimeValueMs(value.incrementMs, fallback.incrementMs),
            enabled: value.enabled ?? fallback.enabled,
        };
    };
    return { sente: normalizeSide("sente"), gote: normalizeSide("gote") };
}

/**
 * 2つの時計設定が同一かどうかを比較
 *
 * @param a - 比較対象1
 * @param b - 比較対象2
 * @returns 同一の場合 true
 */
export function isSameTimeSettings(a: ClockSettings, b: ClockSettings): boolean {
    return isSameClock(a.sente, b.sente) && isSameClock(a.gote, b.gote);
}

export function isSameClock(a: ClockSettings[Player], b: ClockSettings[Player]): boolean {
    return (
        a.enabled === b.enabled &&
        a.mainMs === b.mainMs &&
        a.byoyomiMs === b.byoyomiMs &&
        a.incrementMs === b.incrementMs
    );
}

/** 「10分」「1分30秒」「30秒」。0 なら空文字。 */
function formatDuration(ms: number): string {
    const total = Math.round(ms / 1000);
    const minutes = Math.floor(total / 60);
    const rest = total % 60;
    if (minutes > 0) return rest > 0 ? `${minutes}分${rest}秒` : `${minutes}分`;
    return rest > 0 ? `${rest}秒` : "";
}

/**
 * 時間の決まりを言葉にする。「+」は加算（フィッシャー）だけに使い、秒読みは「秒読み」と書く
 * （「10分+30秒」は将棋では秒読み、チェスでは加算と読まれて紛らわしい）。
 * - 秒読み: 「10分 秒読み30秒」、持ち時間なしは「秒読み30秒」（`perMove` なら「1手30秒」。AI の考慮時間）
 * - 加算: 「5分 +10秒」
 * - どちらも無い: 「10分 切れ負け」
 * 時間を決めていない（無制限）ときの書き方は呼び出し側が決める。
 */
export function formatTimeRule(
    clock: Pick<ClockSettings[Player], "mainMs" | "byoyomiMs" | "incrementMs">,
    options?: { perMove?: boolean },
): string {
    const main = formatDuration(clock.mainMs);
    const byoyomiSeconds = Math.round(clock.byoyomiMs / 1000);
    const incrementSeconds = Math.round(clock.incrementMs / 1000);
    const parts: string[] = [];
    if (main) parts.push(main);
    if (incrementSeconds > 0) parts.push(`+${incrementSeconds}秒`);
    if (byoyomiSeconds > 0) {
        parts.push(
            !main && incrementSeconds === 0 && options?.perMove
                ? `1手${byoyomiSeconds}秒`
                : `秒読み${byoyomiSeconds}秒`,
        );
    }
    if (main && incrementSeconds === 0 && byoyomiSeconds === 0) parts.push("切れ負け");
    return parts.join(" ");
}
