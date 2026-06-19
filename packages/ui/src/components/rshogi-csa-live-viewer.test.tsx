import { describe, expect, it } from "vitest";
import { computeRemaining } from "./rshogi-csa-live-viewer";

describe("computeRemaining", () => {
    it("手番側 (sideToMove) のみ経過分を減算し、相手側は据え置く", () => {
        const remaining = computeRemaining(
            { sente: 60_000, gote: 45_000, sideToMove: "sente" },
            5_000,
        );
        expect(remaining).toEqual({ sente: 55_000, gote: 45_000 });
    });

    it("後手番では後手側のみ減算する", () => {
        const remaining = computeRemaining(
            { sente: 60_000, gote: 45_000, sideToMove: "gote" },
            5_000,
        );
        expect(remaining).toEqual({ sente: 60_000, gote: 40_000 });
    });

    it("手番側の残時間が経過分を下回っても 0 で止める", () => {
        const remaining = computeRemaining(
            { sente: 3_000, gote: 45_000, sideToMove: "sente" },
            5_000,
        );
        expect(remaining).toEqual({ sente: 0, gote: 45_000 });
    });

    it("clocks 未取得時は両者 0 を返す", () => {
        expect(computeRemaining(null, 5_000)).toEqual({ sente: 0, gote: 0 });
    });
});
