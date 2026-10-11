import { describe, expect, it } from "vitest";
import { normalizeEvalToSentePerspective } from "./branchTreeUtils";
import { MATE_WITHOUT_PLY } from "./kifFormat";

describe("normalizeEvalToSentePerspective", () => {
    it("保存済みの先手視点 eval は normalized:true で奇数/偶数 ply とも bit 一致で往復する", () => {
        const cases = [
            { ply: 1, evalCp: 123, evalMate: undefined },
            { ply: 2, evalCp: -456, evalMate: undefined },
            { ply: 3, evalCp: undefined, evalMate: 7 },
            { ply: 4, evalCp: undefined, evalMate: -9 },
            { ply: 1, evalCp: undefined, evalMate: MATE_WITHOUT_PLY },
            { ply: 2, evalCp: undefined, evalMate: -MATE_WITHOUT_PLY },
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

describe("normalizeEvalToSentePerspective: 後手番から始まる棋譜", () => {
    it("局面の手番を渡すと、手数の偶奇ではなく手番で符号を決める", () => {
        // 後手番開始の 1 手目 (後手が指した後 = 先手番)。エンジン値は先手視点なので反転しない。
        expect(normalizeEvalToSentePerspective({ scoreCp: 120 }, 1, "sente")).toEqual({
            evalCp: 120,
            evalMate: undefined,
        });
        // 2 手目 (先手が指した後 = 後手番)。後手視点の値なので反転する。
        expect(normalizeEvalToSentePerspective({ scoreCp: 120 }, 2, "gote")).toEqual({
            evalCp: -120,
            evalMate: undefined,
        });
    });

    it("先手視点に正規化済みの値は手番に関係なくそのまま", () => {
        expect(
            normalizeEvalToSentePerspective({ scoreCp: -35, normalized: true }, 1, "sente"),
        ).toEqual({ evalCp: -35, evalMate: undefined });
        expect(
            normalizeEvalToSentePerspective({ scoreCp: -35, normalized: true }, 2, "gote"),
        ).toEqual({ evalCp: -35, evalMate: undefined });
    });

    it("手番を渡さなければ従来どおり手数の偶奇で決める", () => {
        expect(normalizeEvalToSentePerspective({ scoreCp: 120 }, 1).evalCp).toBe(-120);
        expect(normalizeEvalToSentePerspective({ scoreCp: 120 }, 2).evalCp).toBe(120);
    });
});
