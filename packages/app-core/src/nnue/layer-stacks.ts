import type { LayerStacksConfig } from "./types";

export const PROGRESS_COEFFICIENTS_SIZE = 81 * 1548 * 8;

export function encodeProgressCoefficients(
    bytes: Uint8Array,
    mode: LayerStacksConfig["bucketMode"] = "progresskpabs",
): string {
    if (bytes.byteLength !== PROGRESS_COEFFICIENTS_SIZE) {
        throw new Error(
            "進行度係数ファイルは " +
                PROGRESS_COEFFICIENTS_SIZE +
                " バイトの f64 LE 形式が必要です",
        );
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = 0; i < bytes.byteLength; i += 8) {
        const value = view.getFloat64(i, true);
        if (!Number.isFinite(mode === "progresskpabsq16" ? value : Math.fround(value)))
            throw new Error("進行度係数に非有限値が含まれています");
    }
    let binary = "";
    for (let i = 0; i < bytes.length; i += 8192) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }
    return btoa(binary);
}

export function validateLayerStacks(config: LayerStacksConfig): void {
    if (config.bucketMode === "kingrank9") return;
    if (config.bucketMode !== "progresskpabs" && config.bucketMode !== "progresskpabsq16")
        throw new Error("LayerStacks の振り分け方式を選択してください");
    if (
        !Number.isInteger(config.progressBuckets) ||
        (config.progressBuckets ?? 0) < 1 ||
        (config.progressBuckets ?? 0) > 16
    ) {
        throw new Error("進行度バケット数は 1〜16 の整数を指定してください");
    }
    if (
        config.bucketMode === "progresskpabsq16" &&
        ![2, 4, 8, 16].includes(config.progressBuckets ?? 0)
    ) {
        throw new Error(
            "YaneuraOu / BulletOu の進行度バケット数は 2、4、8、16 のいずれかを指定してください",
        );
    }
    if ((config.progressBuckets ?? 0) > 1 && !config.progressCoeffBase64) {
        throw new Error("進行度バケット数が 2 以上の場合は進行度係数ファイルが必要です");
    }
}
