/**
 * ミリ秒を MM:SS 形式にフォーマットする
 *
 * @param ms - ミリ秒
 * @returns MM:SS 形式の文字列
 *
 * @example
 * ```typescript
 * formatTime(125000); // => "02:05"
 * formatTime(5000);   // => "00:05"
 * formatTime(-1000);  // => "00:00" (負の値は 0 として扱う)
 * ```
 */
export function formatTime(ms: number): string {
    if (ms < 0) ms = 0;
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60)
        .toString()
        .padStart(2, "0");
    const seconds = (totalSeconds % 60).toString().padStart(2, "0");
    return `${minutes}:${seconds}`;
}

/**
 * 1 手の消費時間を「3秒」「1分5秒」のように表す。
 * 1 秒未満の端数がある 10 秒未満の値は小数 1 桁まで出す (例: 0.3秒)。
 */
export function formatElapsedTime(ms: number): string {
    const clamped = Math.max(0, ms);
    if (clamped < 10_000 && clamped % 1000 !== 0) {
        return `${(Math.floor(clamped / 100) / 10).toFixed(1)}秒`;
    }
    const totalSeconds = Math.floor(clamped / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return minutes > 0 ? `${minutes}分${seconds}秒` : `${seconds}秒`;
}
