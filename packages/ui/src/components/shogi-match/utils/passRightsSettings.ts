/**
 * パス権設定のユーティリティ関数
 */

import type { PassRightsSettings } from "../types";

/**
 * パス権カウント値を正規化
 */
function normalizePassRightsCount(value: unknown, fallback: number): number {
    if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
    if (value < 0) return fallback;
    return Math.trunc(value);
}

/**
 * パス権確認ダイアログしきい値を正規化
 */
function normalizePassRightsThreshold(value: unknown, fallback: number): number {
    if (typeof value !== "number" || Number.isNaN(value)) return fallback;
    if (value < 0) return fallback;
    return value;
}

/**
 * パス権設定を正規化
 *
 * localStorage から読み込んだ値を正規化し、
 * 無効な値をデフォルト値で補完する
 *
 * @param settings - 正規化する設定
 * @param defaults - デフォルト値
 * @returns 正規化されたパス権設定
 */
export function normalizePassRightsSettings(
    settings: PassRightsSettings | null | undefined,
    defaults: PassRightsSettings,
): PassRightsSettings {
    if (!settings || typeof settings !== "object") {
        return defaults;
    }

    return {
        enabled: typeof settings.enabled === "boolean" ? settings.enabled : defaults.enabled,
        senteInitialCount: normalizePassRightsCount(
            settings.senteInitialCount,
            defaults.senteInitialCount,
        ),
        goteInitialCount: normalizePassRightsCount(
            settings.goteInitialCount,
            defaults.goteInitialCount,
        ),
        confirmDialogThresholdMs: normalizePassRightsThreshold(
            settings.confirmDialogThresholdMs,
            defaults.confirmDialogThresholdMs,
        ),
    };
}

/**
 * 2つのパス権設定が同一かどうかを比較
 *
 * @param a - 比較対象1
 * @param b - 比較対象2
 * @returns 同一の場合 true
 */
export function isSamePassRightsSettings(
    a: PassRightsSettings,
    b: PassRightsSettings | null | undefined,
): boolean {
    if (!b) return false;
    return (
        a.enabled === b.enabled &&
        a.senteInitialCount === b.senteInitialCount &&
        a.goteInitialCount === b.goteInitialCount &&
        a.confirmDialogThresholdMs === b.confirmDialogThresholdMs
    );
}

/**
 * パス権設定と棋譜からgetLegalMovesのオプションを生成するヘルパー関数
 *
 * 注意: 棋譜に"pass"が含まれる場合は、設定が無効でもpassRightsを送る必要がある。
 * これは、Rust側でパス手を適用する際にパス権が必須なため。
 * （パス権有効で対局後に設定をOFFにした場合や、パス入り棋譜を読み込んだ場合など）
 *
 * @param passRightsSettings - パス権設定
 * @param moves - 棋譜（USI形式の指し手配列）
 * @returns getLegalMoves 用のオプション
 */
export function buildPassRightsOptionForLegalMoves(
    passRightsSettings:
        | { enabled: boolean; senteInitialCount: number; goteInitialCount: number }
        | undefined,
    moves: string[],
): { passRights?: { sente: number; gote: number } } {
    // 大文字小文字を区別せずにパス手を検出（parseMoveと同様）
    const hasPassInMoves = moves.some((m) => m.toLowerCase() === "pass");

    if (passRightsSettings?.enabled) {
        // 設定が有効: 初期値を使用
        return {
            passRights: {
                sente: passRightsSettings.senteInitialCount,
                gote: passRightsSettings.goteInitialCount,
            },
        };
    }

    if (hasPassInMoves) {
        // 設定は無効だが棋譜にpassが含まれる: 十分な数のパス権を設定
        // （各プレイヤーのパス回数を使用）
        let sentePassCount = 0;
        let gotePassCount = 0;
        let isSenteTurn = true; // 平手初期局面は先手番
        for (const move of moves) {
            if (move.toLowerCase() === "pass") {
                if (isSenteTurn) {
                    sentePassCount++;
                } else {
                    gotePassCount++;
                }
            }
            isSenteTurn = !isSenteTurn;
        }
        // 最低でも現在のパス数 + 1 を確保（追加パスの余地を残す）
        return {
            passRights: {
                sente: sentePassCount + 1,
                gote: gotePassCount + 1,
            },
        };
    }

    // 設定無効かつパスなし: passRights不要
    return {};
}
