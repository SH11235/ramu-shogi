import { describe, expect, it } from "vitest";
import type { CommentaryInput } from "./commentaryService";
import { buildFallbackCommentary, shouldGenerateCommentary } from "./commentaryService";
import type { KifMove } from "./kifFormat";

describe("shouldGenerateCommentary", () => {
    const baseMove: KifMove = {
        ply: 10,
        kifText: "▲５五歩(56)",
        displayText: "☗5五歩(56)",
        usiMove: "5f5e",
        evalCp: 50,
    };

    const basePrevMove: KifMove = {
        ply: 9,
        kifText: "△３三銀(42)",
        displayText: "☖3三銀(42)",
        usiMove: "4b3c",
        evalCp: 100,
    };

    it("prevKifMoveがない場合はfalse", () => {
        expect(shouldGenerateCommentary(baseMove, undefined)).toBe(false);
    });

    it("evalCpがundefinedの場合はfalse", () => {
        const move: KifMove = { ...baseMove, evalCp: undefined };
        expect(shouldGenerateCommentary(move, basePrevMove)).toBe(false);
    });

    it("前の手のevalCpがundefinedの場合はfalse", () => {
        const prev: KifMove = { ...basePrevMove, evalCp: undefined };
        expect(shouldGenerateCommentary(baseMove, prev)).toBe(false);
    });

    it("後手の手で評価値差が200未満ならfalse（後手ply=10）", () => {
        // ply 10 = 後手の手。後手の悪手 = eval上昇（先手有利に）
        // prevEval=100, currentEval=200 → loss = 200-100 = 100 < 200
        const move: KifMove = { ...baseMove, ply: 10, evalCp: 200 };
        const prev: KifMove = { ...basePrevMove, ply: 9, evalCp: 100 };
        expect(shouldGenerateCommentary(move, prev)).toBe(false);
    });

    it("後手の手で評価値差が200以上ならtrue（後手ply=10）", () => {
        // ply 10 = 後手の手。後手の悪手 = eval上昇（先手有利に）
        // prevEval=-100, currentEval=200 → loss = 200-(-100) = 300 >= 200
        const move: KifMove = { ...baseMove, ply: 10, evalCp: 200 };
        const prev: KifMove = { ...basePrevMove, ply: 9, evalCp: -100 };
        expect(shouldGenerateCommentary(move, prev)).toBe(true);
    });

    it("先手の手で評価値差が200以上ならtrue（先手ply=11）", () => {
        // ply 11 = 先手の手。先手の悪手 = eval下降
        // prevEval=300, currentEval=50 → loss = 300-50 = 250 >= 200
        const move: KifMove = { ...baseMove, ply: 11, evalCp: 50 };
        const prev: KifMove = { ...basePrevMove, ply: 10, evalCp: 300 };
        expect(shouldGenerateCommentary(move, prev)).toBe(true);
    });

    it("先手の手で評価値差がちょうど200ならtrue", () => {
        // ply 11 = 先手の手。loss = 200-0 = 200
        const move: KifMove = { ...baseMove, ply: 11, evalCp: 0 };
        const prev: KifMove = { ...basePrevMove, ply: 10, evalCp: 200 };
        expect(shouldGenerateCommentary(move, prev)).toBe(true);
    });

    it("先手の手で評価値が上昇（良い手）ならfalse", () => {
        // ply 11 = 先手の手。loss = 50-200 = -150 < 0
        const move: KifMove = { ...baseMove, ply: 11, evalCp: 200 };
        const prev: KifMove = { ...basePrevMove, ply: 10, evalCp: 50 };
        expect(shouldGenerateCommentary(move, prev)).toBe(false);
    });
});

describe("buildFallbackCommentary", () => {
    it("疑問手のフォールバック文を生成", () => {
        const input: CommentaryInput = {
            ply: 15,
            side: "sente",
            moveKif: "▲８六歩(87)",
            moveFeatures: {
                movedPiece: "P",
                movedPiecePromoted: false,
                isCapture: false,
                isPromote: false,
                isDrop: false,
            },
            playedEvalCp: -50,
            bestEvalCp: 200,
            gapCp: 250,
            bestMoveKif: "▲７六歩(77)",
            bestPvDisplay: "☗7六歩 ☖3四歩 ☗2六歩",
            verdict: "inaccuracy",
        };

        const result = buildFallbackCommentary(input);
        expect(result).toContain("疑問手");
        expect(result).toContain("250cp");
        expect(result).toContain("▲７六歩(77)");
    });

    it("悪手のフォールバック文を生成", () => {
        const input: CommentaryInput = {
            ply: 20,
            side: "gote",
            moveKif: "△５五角(22)",
            moveFeatures: {
                movedPiece: "B",
                movedPiecePromoted: false,
                isCapture: false,
                isPromote: false,
                isDrop: false,
            },
            playedEvalCp: 500,
            bestEvalCp: 0,
            gapCp: 500,
            bestMoveKif: "△３三銀(42)",
            bestPvDisplay: undefined,
            verdict: "blunder",
        };

        const result = buildFallbackCommentary(input);
        expect(result).toContain("悪手");
        expect(result).toContain("500cp");
        expect(result).toContain("後手");
    });
});
