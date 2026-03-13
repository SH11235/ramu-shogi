import { detectParallelism } from "@shogi/app-core";

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

export function buildThreadOptions(): ThreadSelectOption[] {
    const { detectedConcurrency, recommendedWorkers } = detectParallelism();
    const maxSelectable = Math.max(1, Math.min(detectedConcurrency, DEFAULT_MAX_OPTIONS));
    const options: ThreadSelectOption[] = [
        { value: 0, label: `自動（推奨: ${recommendedWorkers}）` },
    ];
    for (let i = 1; i <= maxSelectable; i += 1) {
        options.push({ value: i, label: String(i) });
    }
    if (detectedConcurrency > maxSelectable) {
        options.push({ value: detectedConcurrency, label: `最大: ${detectedConcurrency}` });
    }
    return options;
}
