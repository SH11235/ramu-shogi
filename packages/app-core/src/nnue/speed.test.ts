import { describe, expect, it } from "vitest";
import {
    addObservedNnueSpeed,
    EMPTY_NNUE_SPEED_DATA,
    formatNodesPerSecond,
    NNUE_SPEED_OBSERVED_LIMIT,
    nnueSpeedRows,
    parseNnueSpeedData,
    primaryNnueSpeed,
    setNnueSpeedBenchmark,
} from "./speed";

const key = { contentHash: "aa", threads: 4, engineVersion: "wasm:1", threaded: true };
const filter = { contentHash: "aa", engineVersion: "wasm:1", threaded: true };

describe("nnue speed records", () => {
    it("実測は直近の回数だけ残し、中央値を出す", () => {
        let data = EMPTY_NNUE_SPEED_DATA;
        for (let i = 1; i <= NNUE_SPEED_OBSERVED_LIMIT + 5; i++) {
            data = addObservedNnueSpeed(data, key, i * 1000);
        }
        const [row] = nnueSpeedRows(data, filter);
        expect(row?.observedCount).toBe(NNUE_SPEED_OBSERVED_LIMIT);
        // 6000〜25000 の 20 件の中央値
        expect(row?.observedNps).toBe(15_500);
    });

    it("実測があれば実測を、なければ計測を 1 行に出す", () => {
        let data = setNnueSpeedBenchmark(EMPTY_NNUE_SPEED_DATA, key, 900_000, 1);
        expect(primaryNnueSpeed(nnueSpeedRows(data, filter)[0])).toEqual({
            nps: 900_000,
            source: "benchmark",
        });
        data = addObservedNnueSpeed(data, key, 1_200_000);
        expect(primaryNnueSpeed(nnueSpeedRows(data, filter)[0])).toEqual({
            nps: 1_200_000,
            source: "observed",
        });
    });

    it("スレッド数ごとに分け、順に並べる", () => {
        let data = addObservedNnueSpeed(EMPTY_NNUE_SPEED_DATA, key, 100);
        data = setNnueSpeedBenchmark(data, { ...key, threads: 1 }, 50, 1);
        expect(nnueSpeedRows(data, filter).map((row) => row.threads)).toEqual([1, 4]);
    });

    it("マルチスレッド版かどうか・評価関数が違う値は混ぜない", () => {
        let data = addObservedNnueSpeed(EMPTY_NNUE_SPEED_DATA, { ...key, threaded: false }, 100);
        data = addObservedNnueSpeed(data, { ...key, contentHash: "bb" }, 100);
        expect(nnueSpeedRows(data, filter)).toEqual([]);
    });

    it("エンジンの版が変わったら、古い版の値を捨てる", () => {
        const old = setNnueSpeedBenchmark(EMPTY_NNUE_SPEED_DATA, key, 100, 1);
        const next = addObservedNnueSpeed(old, { ...key, engineVersion: "wasm:2" }, 200);
        expect(next.records).toHaveLength(1);
        expect(next.records[0]?.engineVersion).toBe("wasm:2");
    });

    it("壊れた保存値は捨てる", () => {
        expect(parseNnueSpeedData("x")).toEqual(EMPTY_NNUE_SPEED_DATA);
        expect(
            parseNnueSpeedData({
                version: 1,
                records: [{ ...key, observed: ["a", -1, 5] }, { contentHash: 1 }],
            }).records,
        ).toEqual([{ ...key, observed: [5] }]);
    });

    it("局面/秒を丸めて見せる", () => {
        expect(formatNodesPerSecond(1_234_567)).toBe("123万");
        expect(formatNodesPerSecond(34_567)).toBe("3.5万");
        expect(formatNodesPerSecond(8_449)).toBe("8,400");
    });
});
