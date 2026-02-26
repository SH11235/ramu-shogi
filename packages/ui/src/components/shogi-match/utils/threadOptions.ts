import { detectParallelism } from "@shogi/app-core";

type ThreadSelectOption = { value: number; label: string };

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
