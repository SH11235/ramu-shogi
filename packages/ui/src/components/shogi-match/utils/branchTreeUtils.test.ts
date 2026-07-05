import { describe, expect, it } from "vitest";
import { normalizeEvalToSentePerspective } from "./branchTreeUtils";

describe("normalizeEvalToSentePerspective", () => {
    it("保存済みの先手視点 eval は normalized:true で奇数/偶数 ply とも bit 一致で往復する", () => {
        const cases = [
            { ply: 1, evalCp: 123, evalMate: undefined },
            { ply: 2, evalCp: -456, evalMate: undefined },
            { ply: 3, evalCp: undefined, evalMate: 7 },
            { ply: 4, evalCp: undefined, evalMate: -9 },
        ];

        for (const { ply, evalCp, evalMate } of cases) {
            const restored = normalizeEvalToSentePerspective(
                {
                    scoreCp: evalCp,
                    scoreMate: evalMate,
                    normalized: true,
                },
                ply,
            );

            expect(Object.is(restored.evalCp, evalCp)).toBe(true);
            expect(Object.is(restored.evalMate, evalMate)).toBe(true);
        }
    });
});
