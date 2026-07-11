/**
 * 並列解析の設定を管理するユーティリティ
 */

/**
 * 並列処理の設定情報
 */
interface ParallelismConfig {
    /** 解析エンジンプールのワーカー数上限。1 ワーカー = 1 WASM エンジンインスタンス */
    maxWorkers: number;
    /** 検出されたハードウェア並列数 */
    detectedConcurrency: number;
    /** 推奨並列数（エンジンのスレッド数にも解析ワーカー数にも使う基準値） */
    recommendedWorkers: number;
}

/**
 * ハードウェアの並列処理能力を検出し、推奨設定を返す
 */
export function detectParallelism(): ParallelismConfig {
    // navigator.hardwareConcurrency の値を検証し、異常値を防ぐ
    // （カスタムブラウザや開発者ツールで不正な値が設定される可能性があるため）
    const rawConcurrency =
        typeof navigator !== "undefined" &&
        typeof navigator.hardwareConcurrency === "number" &&
        Number.isFinite(navigator.hardwareConcurrency)
            ? navigator.hardwareConcurrency
            : 1;
    const hardwareConcurrency = Math.max(1, Math.min(rawConcurrency, 128));

    // 推奨: コア数の半分（最低1、最大32）
    // Wasm の MAX_WASM_THREADS = 32 制限を考慮
    const recommended = Math.max(1, Math.min(32, Math.floor(hardwareConcurrency / 2)));

    return {
        // 各ワーカーが NNUE と置換表を持つ独立エンジンのため、スレッド数上限 (32) とは
        // 別に小さく抑える。UI の選択肢 (1〜4) と揃える
        maxWorkers: 4,
        detectedConcurrency: hardwareConcurrency,
        recommendedWorkers: recommended,
    };
}

/**
 * ユーザー設定から実際のワーカー数を解決する
 * @param userSetting ユーザー設定（0=自動検出）
 * @returns 実際に使用するワーカー数
 */
export function resolveWorkerCount(userSetting: number): number {
    const config = detectParallelism();
    if (userSetting === 0) {
        return Math.min(config.recommendedWorkers, config.maxWorkers);
    }
    return Math.max(1, Math.min(userSetting, config.maxWorkers));
}
