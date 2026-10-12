import { describe, expect, it } from "vitest";
import {
    kifuEvalToStudyScore,
    legacyEvalToStudyScore,
    STUDY_LEGACY_MATE_WITHOUT_PLY,
    studyScoreToKifuEval,
    studyScoreToLegacyEval,
} from "./score";

describe("kifuEvalToStudyScore", () => {
    it("エンジン出力（手番側視点）は、解析した局面の手番で先手視点に直す", () => {
        expect(kifuEvalToStudyScore({ scoreCp: 120 }, "sente")).toEqual({ kind: "cp", value: 120 });
        expect(kifuEvalToStudyScore({ scoreCp: 120 }, "gote")).toEqual({ kind: "cp", value: -120 });
        expect(kifuEvalToStudyScore({ scoreCp: -80, normalized: false }, "gote")).toEqual({
            kind: "cp",
            value: 80,
        });
    });

    it("正規化済み（先手視点）の値は手番に関係なくそのまま", () => {
        expect(kifuEvalToStudyScore({ scoreCp: 120, normalized: true }, "gote")).toEqual({
            kind: "cp",
            value: 120,
        });
        expect(kifuEvalToStudyScore({ scoreMate: -7, normalized: true }, "sente")).toEqual({
            kind: "mate",
            winner: "gote",
            plies: 7,
        });
    });

    it("詰みは勝者と手数にする", () => {
        expect(kifuEvalToStudyScore({ scoreMate: 5 }, "sente")).toEqual({
            kind: "mate",
            winner: "sente",
            plies: 5,
        });
        expect(kifuEvalToStudyScore({ scoreMate: 5 }, "gote")).toEqual({
            kind: "mate",
            winner: "gote",
            plies: 5,
        });
        expect(kifuEvalToStudyScore({ scoreMate: -3 }, "gote")).toEqual({
            kind: "mate",
            winner: "sente",
            plies: 3,
        });
        // mate 0 は手番側が既に詰んでいる。
        expect(kifuEvalToStudyScore({ scoreMate: 0 }, "sente")).toEqual({
            kind: "mate",
            winner: "gote",
            plies: 0,
        });
    });

    it("手数不明の詰み（±Infinity、±100000）は plies を null にする", () => {
        expect(
            kifuEvalToStudyScore({ scoreMate: Number.POSITIVE_INFINITY, normalized: true }, "gote"),
        ).toEqual({ kind: "mate", winner: "sente", plies: null });
        expect(
            kifuEvalToStudyScore(
                { scoreMate: -STUDY_LEGACY_MATE_WITHOUT_PLY, normalized: true },
                "sente",
            ),
        ).toEqual({ kind: "mate", winner: "gote", plies: null });
    });

    it("詰みと評価値の両方があれば詰みを採る", () => {
        expect(kifuEvalToStudyScore({ scoreCp: 30000, scoreMate: 3 }, "sente")).toEqual({
            kind: "mate",
            winner: "sente",
            plies: 3,
        });
    });

    it("欠測は null（0 で代用しない）", () => {
        expect(kifuEvalToStudyScore(undefined, "sente")).toBeNull();
        expect(kifuEvalToStudyScore({}, "sente")).toBeNull();
        expect(kifuEvalToStudyScore({ scoreCp: Number.NaN }, "sente")).toBeNull();
        expect(kifuEvalToStudyScore({ scoreMate: 0, normalized: true }, "sente")).toBeNull();
        expect(kifuEvalToStudyScore({ scoreCp: 0 }, "gote")).toEqual({ kind: "cp", value: 0 });
    });
});

describe("studyScoreToKifuEval", () => {
    it("先手視点・正規化済みの実行時の値にする", () => {
        expect(studyScoreToKifuEval({ kind: "cp", value: -45 })).toEqual({
            scoreCp: -45,
            normalized: true,
        });
        expect(studyScoreToKifuEval({ kind: "mate", winner: "gote", plies: 9 })).toEqual({
            scoreMate: -9,
            normalized: true,
        });
        expect(studyScoreToKifuEval({ kind: "mate", winner: "sente", plies: null })).toEqual({
            scoreMate: Number.POSITIVE_INFINITY,
            normalized: true,
        });
        expect(studyScoreToKifuEval(null)).toBeUndefined();
    });

    it("往復しても値が変わらない", () => {
        const scores = [
            { kind: "cp", value: 321 },
            { kind: "mate", winner: "sente", plies: 11 },
            { kind: "mate", winner: "gote", plies: null },
        ] as const;
        for (const score of scores) {
            for (const side of ["sente", "gote"] as const) {
                expect(kifuEvalToStudyScore(studyScoreToKifuEval(score), side)).toEqual(score);
            }
        }
    });
});

describe("既存 API の評価値との変換", () => {
    it("evalMate = ±100000 は手数不明の詰み", () => {
        expect(legacyEvalToStudyScore({ evalCp: null, evalMate: 100_000 })).toEqual({
            kind: "mate",
            winner: "sente",
            plies: null,
        });
        expect(legacyEvalToStudyScore({ evalMate: -100_000 })).toEqual({
            kind: "mate",
            winner: "gote",
            plies: null,
        });
        expect(legacyEvalToStudyScore({ evalMate: -13 })).toEqual({
            kind: "mate",
            winner: "gote",
            plies: 13,
        });
        expect(legacyEvalToStudyScore({ evalCp: 250, evalMate: null })).toEqual({
            kind: "cp",
            value: 250,
        });
        expect(legacyEvalToStudyScore({ evalCp: null, evalMate: null })).toBeNull();
    });

    it("保存用の値を既存 API の表現に戻す", () => {
        expect(studyScoreToLegacyEval({ kind: "mate", winner: "gote", plies: null })).toEqual({
            evalCp: null,
            evalMate: -100_000,
        });
        expect(studyScoreToLegacyEval({ kind: "mate", winner: "sente", plies: 7 })).toEqual({
            evalCp: null,
            evalMate: 7,
        });
        expect(studyScoreToLegacyEval({ kind: "cp", value: -12 })).toEqual({
            evalCp: -12,
            evalMate: null,
        });
        expect(studyScoreToLegacyEval(null)).toEqual({ evalCp: null, evalMate: null });
    });
});
