import type { RshogiGameResult } from "@shogi/match-client";
import { describe, expect, it } from "vitest";
import { resolveDisplayedResult } from "./rshogi-csa-result";

describe("resolveDisplayedResult", () => {
    const resignation: RshogiGameResult = {
        kind: "resignation",
        endReason: "RESIGN",
        winner: "sente",
    };

    it("投了と詰みと勝者が一致すると表示だけ詰みにする", () => {
        expect(resolveDisplayedResult(resignation, "gote")).toEqual({
            ...resignation,
            kind: "checkmate",
        });
        expect(resignation.kind).toBe("resignation");
        expect(resolveDisplayedResult({ ...resignation, winner: "gote" }, "sente")?.kind).toBe(
            "checkmate",
        );
    });

    it("詰みでない場合と勝者が食い違う場合は元の結果を返す", () => {
        expect(resolveDisplayedResult(resignation, undefined)).toBe(resignation);
        expect(resolveDisplayedResult(resignation, "sente")).toBe(resignation);
        const unknownWinner = { ...resignation, winner: undefined };
        expect(resolveDisplayedResult(unknownWinner, "gote")).toBe(unknownWinner);
        expect(resolveDisplayedResult(undefined, "gote")).toBeUndefined();
    });

    it.each([
        { ...resignation, endReason: "ILLEGAL" },
        { ...resignation, endReason: undefined },
        { ...resignation, kind: "time_expired", endReason: "TIME_UP" },
        { ...resignation, kind: "draw", endReason: "SENNICHITE" },
        { ...resignation, kind: "abort", endReason: "CHUDAN" },
        { ...resignation, kind: "jishogi", endReason: "JISHOGI" },
        { ...resignation, kind: "oute_sennichite", endReason: "OUTE_SENNICHITE" },
        { ...resignation, kind: "max_moves", endReason: "MAX_MOVES" },
        { ...resignation, kind: "abnormal", endReason: "ERROR" },
    ] satisfies RshogiGameResult[])("投了以外の結果は変更しない: $endReason", (result) => {
        expect(resolveDisplayedResult(result, "gote")).toBe(result);
    });
});
