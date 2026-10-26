/**
 * JSON.stringify 用 replacer。素の stringify は ±Infinity をどちらも null に潰して符号を失うため、
 * signature/cache key では手数なし詰み (evalMate=±Infinity) を符号付き文字列として残す。
 */
export const infinitySafeReplacer = (_key: string, value: unknown): unknown =>
    typeof value === "number" && !Number.isNaN(value) && !Number.isFinite(value)
        ? value > 0
            ? "Infinity"
            : "-Infinity"
        : value;
