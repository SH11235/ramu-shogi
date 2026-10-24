/** 対局中のヒントで読む長さの上限。読み終えるか「止める」まで、候補と読み筋を更新し続ける。 */
export const HINT_SEARCH_TIME_MS = 30_000;
/** 深さの上限（時間の上限より先に届くのは、手の少ない局面だけ）。 */
export const HINT_SEARCH_MAX_DEPTH = 60;

/** ヒントで並べる候補の数（MultiPV）。 */
export const HINT_MULTI_PV_CHOICES = [1, 3, 5] as const;
export const DEFAULT_HINT_MULTI_PV = 3;

export function normalizeHintMultiPv(value: unknown): number {
    return typeof value === "number" && (HINT_MULTI_PV_CHOICES as readonly number[]).includes(value)
        ? value
        : DEFAULT_HINT_MULTI_PV;
}
