import { detectParallelism } from "@shogi/app-core";
import type { EngineOption } from "../types";

type ThreadSelectOption = { value: number; label: string };

export const PARALLEL_WORKER_OPTIONS: ThreadSelectOption[] = [
    { value: 0, label: "自動" },
    { value: 1, label: "1" },
    { value: 2, label: "2" },
    { value: 3, label: "3" },
    { value: 4, label: "4" },
];

export const ANALYSIS_TIME_OPTIONS: ThreadSelectOption[] = [
    { value: 500, label: "0.5秒" },
    { value: 1000, label: "1秒" },
    { value: 2000, label: "2秒" },
    { value: 3000, label: "3秒" },
];

const DEFAULT_MAX_OPTIONS = 32;

/**
 * その AI（エンジン）が使えるスレッド数の上限。複数の AI に同じ数を当てるときは小さいほうに合わせる。
 * engineId の無い AI は、対局と同じく先頭のエンジンとみなす（useEngineManager の resolveSides）。
 */
export function threadCapOf(
    engineOptions: EngineOption[] | undefined,
    engineIds: Array<string | undefined>,
): number | undefined {
    const caps = engineIds
        .map((id) => id ?? engineOptions?.[0]?.id)
        .map((id) => engineOptions?.find((option) => option.id === id)?.maxThreads)
        .filter((cap): cap is number => cap !== undefined);
    return caps.length > 0 ? Math.min(...caps) : undefined;
}

/** 上限を超えて保存してある数は、上限として見せる（エンジンも上限に丸めて動く）。0 は自動のまま。 */
export const clampThreads = (threads: number, maxThreads: number | undefined): number =>
    maxThreads !== undefined && threads > maxThreads ? maxThreads : threads;

function maxSelectableThreads(maxThreads: number | undefined): number {
    const { detectedConcurrency } = detectParallelism();
    return Math.max(1, Math.min(detectedConcurrency, DEFAULT_MAX_OPTIONS, maxThreads ?? Infinity));
}

/** 「自動」で実際に使うスレッド数。 */
function autoThreadCount(maxThreads: number | undefined): number {
    return Math.min(detectParallelism().recommendedWorkers, maxSelectableThreads(maxThreads));
}

/** 設定したスレッド数（0 は自動）で、実際に使う数。 */
export const resolveThreadCount = (threads: number, maxThreads: number | undefined): number =>
    threads > 0 ? clampThreads(threads, maxThreads) : autoThreadCount(maxThreads);

/**
 * スレッド数の選択肢。`maxThreads` はエンジンの上限（Web の wasm は 8）で、それより多い数は出さない
 * （選んでも黙って丸められる）。`compact` は幅の狭い選択欄用（「自動（推奨: 4）」を「自動（4）」と書く）。
 */
export function buildThreadOptions(options?: {
    compact?: boolean;
    maxThreads?: number;
}): ThreadSelectOption[] {
    const maxSelectable = maxSelectableThreads(options?.maxThreads);
    const auto = autoThreadCount(options?.maxThreads);
    const result: ThreadSelectOption[] = [
        { value: 0, label: options?.compact ? `自動（${auto}）` : `自動（推奨: ${auto}）` },
    ];
    for (let i = 1; i <= maxSelectable; i += 1) {
        result.push({ value: i, label: String(i) });
    }
    return result;
}
