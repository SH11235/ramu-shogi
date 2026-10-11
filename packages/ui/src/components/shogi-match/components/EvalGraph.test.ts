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

    it("極端な評価値 (31998 など) でも縦軸は 10000 で止まる", () => {
        expect(computeEvalGraphScale(history([0, 120, -300, 31998]), 500)).toBe(10000);
        expect(computeEvalGraphScale(history([0, -99999]), 500)).toBe(10000);
        // 10000 に近い値でも、余白と丸めで 10000 を超えない。
        expect(computeEvalGraphScale(history([0, 9500]), 500)).toBe(10000);
        expect(computeEvalGraphScale(history([0, 10000]), 500)).toBe(10000);
    });

    it("通常の評価値域では従来どおりの目盛りになる", () => {
        expect(computeEvalGraphScale(history([0, 450]), 500)).toBe(500);
        expect(computeEvalGraphScale(history([0, 460]), 500)).toBe(1000);
        expect(computeEvalGraphScale(history([0, 2800]), 500)).toBe(5000);
        expect(computeEvalGraphScale(history([0, -4600]), 500)).toBe(10000);
        expect(computeEvalGraphScale(history([0, 9000]), 500)).toBe(10000);
    });

    it("詰み (evalMate) を含むグラフの縦軸は従来どおり", () => {
        const withMate: EvalHistory[] = [
            ...history([0, 120, -300]),
            { ply: 3, evalCp: null, evalMate: 5 },
        ];
        expect(computeEvalGraphScale(withMate, 500)).toBe(20000);
    });

    it("値が無ければ最小の目盛りを使う", () => {
        expect(computeEvalGraphScale(history([null, null]), 500)).toBe(500);
        expect(computeEvalGraphScale([], 500)).toBe(500);
    });
});
