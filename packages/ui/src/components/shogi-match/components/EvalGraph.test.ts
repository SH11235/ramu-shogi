import { describe, expect, it } from "vitest";
import type { EvalHistory } from "../utils/kifFormat";
import { computeEvalGraphScale } from "./EvalGraph";

const history = (values: (number | null)[]): EvalHistory[] =>
    values.map((evalCp, ply) => ({ ply, evalCp, evalMate: null }));

describe("computeEvalGraphScale", () => {
    it("評価値の最大に合わせて、きりのよい値に丸める", () => {
        expect(computeEvalGraphScale(history([0, 30, -120, 80]), 500)).toBe(500);
        expect(computeEvalGraphScale(history([0, 300, -1800]), 500)).toBe(2000);
    });

    it("極端な評価値 (31998 など) で縦軸が振り切れず、詰みと同じ上限で頭打ちになる", () => {
        const extreme = computeEvalGraphScale(history([0, 120, -300, 31998]), 500);
        const mate = computeEvalGraphScale(
            [...history([0, 120, -300]), { ply: 3, evalCp: null, evalMate: 5 }],
            500,
        );
        expect(extreme).toBe(mate);
        expect(extreme).toBe(20000);
        expect(computeEvalGraphScale(history([0, -99999]), 500)).toBe(20000);
    });

    it("値が無ければ最小の目盛りを使う", () => {
        expect(computeEvalGraphScale(history([null, null]), 500)).toBe(500);
        expect(computeEvalGraphScale([], 500)).toBe(500);
    });
});
