/**
 * 評価関数ごとの、この端末での探索の速さ（NPS）の記録。
 * 端末ごとの値なので同期しない。値を混ぜてはいけない条件（評価関数・スレッド数・エンジンの版・
 * マルチスレッド版かどうか）ごとに分けて持つ。
 */

/** 速さを比べられる条件。どれかが違う値は別物として扱う。 */
export interface NnueSpeedKey {
    /** 評価関数の SHA-256（16 進） */
    contentHash: string;
    threads: number;
    /** エンジンの版（Web の wasm と Desktop のネイティブで別の値にする） */
    engineVersion: string;
    /** マルチスレッド版で動いたか */
    threaded: boolean;
}

export interface NnueSpeedRecord extends NnueSpeedKey {
    /** 「速さを測る」で決まった局面を探索した値 */
    benchmark?: { nps: number; measuredAt: number };
    /** 対局・解析で実際に出た値。古い順で、最大 NNUE_SPEED_OBSERVED_LIMIT 件 */
    observed: number[];
}

export interface NnueSpeedData {
    version: 1;
    records: NnueSpeedRecord[];
}

/** 実測の中央値に使う直近の回数 */
export const NNUE_SPEED_OBSERVED_LIMIT = 20;

/** 実測として記録する探索の最短時間。短い探索は立ち上がりの遅さで NPS が低く出る。 */
export const NNUE_SPEED_MIN_SEARCH_MS = 1000;

export const EMPTY_NNUE_SPEED_DATA: NnueSpeedData = { version: 1, records: [] };

const isPositiveNumber = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value) && value > 0;

const sameKey = (a: NnueSpeedKey, b: NnueSpeedKey): boolean =>
    a.contentHash === b.contentHash &&
    a.threads === b.threads &&
    a.engineVersion === b.engineVersion &&
    a.threaded === b.threaded;

/** localStorage から読んだ値を検める。壊れた記録は捨てる。 */
export function parseNnueSpeedData(raw: unknown): NnueSpeedData {
    if (!raw || typeof raw !== "object") return EMPTY_NNUE_SPEED_DATA;
    const { version, records } = raw as { version?: unknown; records?: unknown };
    if (version !== 1 || !Array.isArray(records)) return EMPTY_NNUE_SPEED_DATA;
    const parsed: NnueSpeedRecord[] = [];
    for (const item of records) {
        if (!item || typeof item !== "object") continue;
        const record = item as Partial<NnueSpeedRecord>;
        if (
            typeof record.contentHash !== "string" ||
            !isPositiveNumber(record.threads) ||
            typeof record.engineVersion !== "string" ||
            typeof record.threaded !== "boolean"
        ) {
            continue;
        }
        const benchmark =
            record.benchmark &&
            isPositiveNumber(record.benchmark.nps) &&
            typeof record.benchmark.measuredAt === "number"
                ? { nps: record.benchmark.nps, measuredAt: record.benchmark.measuredAt }
                : undefined;
        const observed = Array.isArray(record.observed)
            ? record.observed.filter(isPositiveNumber).slice(-NNUE_SPEED_OBSERVED_LIMIT)
            : [];
        if (!benchmark && observed.length === 0) continue;
        parsed.push({
            contentHash: record.contentHash,
            threads: record.threads,
            engineVersion: record.engineVersion,
            threaded: record.threaded,
            ...(benchmark ? { benchmark } : {}),
            observed,
        });
    }
    return { version: 1, records: parsed };
}

/**
 * 記録を 1 件更新する。エンジンの版が違う記録は、もう比べられないので捨てる
 * （Web と Desktop は保存先が別なので、同じ保存先に複数のエンジンの版は並ばない）。
 */
function updateRecord(
    data: NnueSpeedData,
    key: NnueSpeedKey,
    update: (record: NnueSpeedRecord) => NnueSpeedRecord,
): NnueSpeedData {
    const current = data.records.filter((record) => record.engineVersion === key.engineVersion);
    const existing = current.find((record) => sameKey(record, key));
    const base: NnueSpeedRecord = existing ?? {
        contentHash: key.contentHash,
        threads: key.threads,
        engineVersion: key.engineVersion,
        threaded: key.threaded,
        observed: [],
    };
    const next = update(base);
    return {
        version: 1,
        records: existing
            ? current.map((record) => (record === existing ? next : record))
            : [...current, next],
    };
}

export function addObservedNnueSpeed(
    data: NnueSpeedData,
    key: NnueSpeedKey,
    nps: number,
): NnueSpeedData {
    if (!isPositiveNumber(nps)) return data;
    return updateRecord(data, key, (record) => ({
        ...record,
        observed: [...record.observed, nps].slice(-NNUE_SPEED_OBSERVED_LIMIT),
    }));
}

export function setNnueSpeedBenchmark(
    data: NnueSpeedData,
    key: NnueSpeedKey,
    nps: number,
    measuredAt: number,
): NnueSpeedData {
    if (!isPositiveNumber(nps)) return data;
    return updateRecord(data, key, (record) => ({ ...record, benchmark: { nps, measuredAt } }));
}

function median(values: readonly number[]): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1
        ? (sorted[middle] as number)
        : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

/** 1 つのスレッド数での値。表の 1 行になる。 */
export interface NnueSpeedRow {
    threads: number;
    benchmarkNps: number | null;
    observedNps: number | null;
    observedCount: number;
}

/** その評価関数の、いまのエンジンで比べられる値をスレッド数の順に並べる。値のある行だけ。 */
export function nnueSpeedRows(
    data: NnueSpeedData,
    filter: { contentHash: string; engineVersion: string; threaded: boolean },
): NnueSpeedRow[] {
    return data.records
        .filter(
            (record) =>
                record.contentHash === filter.contentHash &&
                record.engineVersion === filter.engineVersion &&
                record.threaded === filter.threaded,
        )
        .map((record) => ({
            threads: record.threads,
            benchmarkNps: record.benchmark?.nps ?? null,
            observedNps: median(record.observed),
            observedCount: record.observed.length,
        }))
        .filter((row) => row.benchmarkNps !== null || row.observedNps !== null)
        .sort((a, b) => a.threads - b.threads);
}

/**
 * 局面/秒を「120万」のように丸める。参考値なので有効数字 2 桁ほどにする。
 * 千未満はそのまま、1 万未満は百の位、10 万未満は小数 1 桁の万で見せる。
 */
export function formatNodesPerSecond(nps: number): string {
    if (nps >= 100_000_000) return `${(nps / 100_000_000).toFixed(1)}億`;
    if (nps >= 100_000) return `${Math.round(nps / 10_000).toLocaleString("ja-JP")}万`;
    if (nps >= 10_000) return `${(nps / 10_000).toFixed(1)}万`;
    if (nps < 1_000) return Math.round(nps).toLocaleString("ja-JP");
    return (Math.round(nps / 100) * 100).toLocaleString("ja-JP");
}
