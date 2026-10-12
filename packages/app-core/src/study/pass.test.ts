import { describe, expect, it } from "vitest";
import { createInitialPositionState } from "../game/board";
import { computeStudyHighlights } from "./highlights";
import { studyChildNodeId, studyLayerId } from "./ids";
import { createStudyDocumentFromMoves } from "./import";
import { applyStudyOps } from "./ops";
import {
    applyMoveAllowingStudyPass,
    applyStudyMoveWithState,
    STUDY_MAX_PASSES_PER_SIDE,
    studyLineFitsPassLimit,
    studyPassRightsForLine,
} from "./pass";
import type { StudyLayerSpec, StudyOp, StudyScore } from "./types";

describe("studyPassRightsForLine", () => {
    it("パスを含まない手順には、パス権を渡さない", () => {
        expect(studyPassRightsForLine("startpos", [])).toBeUndefined();
        expect(studyPassRightsForLine("startpos", ["7g7f", "3c3d"])).toBeUndefined();
    });

    it("パスを含む手順は、各側が使った回数 + 1", () => {
        expect(studyPassRightsForLine("startpos", ["pass"])).toEqual({ sente: 2, gote: 1 });
        expect(studyPassRightsForLine("startpos", ["7g7f", "pass"])).toEqual({
            sente: 1,
            gote: 2,
        });
        expect(
            studyPassRightsForLine("startpos", ["pass", "3c3d", "pass", "pass", "7g7f"]),
        ).toEqual({ sente: 3, gote: 2 });
    });

    it("後手番から始まる局面では、最初の手を後手の手として数える", () => {
        const sfen = "4k4/9/9/9/9/9/9/9/4K4 w - 1";
        for (const startSfen of [sfen, `sfen ${sfen}`, `position sfen ${sfen}`]) {
            expect(studyPassRightsForLine(startSfen, ["pass", "5i5h", "pass"])).toEqual({
                sente: 1,
                gote: 3,
            });
        }
    });
});

describe("studyLineFitsPassLimit", () => {
    it("各側のパスが上限までなら収まり、超えると収まらない", () => {
        // 先手だけがパスし続ける手順（後手は玉を往復させる）。
        const line = (sentePasses: number): string[] => {
            const moves: string[] = [];
            for (let index = 0; index < sentePasses; index++) {
                moves.push("pass", index % 2 === 0 ? "5a5b" : "5b5a");
            }
            return moves;
        };
        expect(studyLineFitsPassLimit("startpos", ["7g7f"])).toBe(true);
        expect(studyLineFitsPassLimit("startpos", line(STUDY_MAX_PASSES_PER_SIDE))).toBe(true);
        expect(studyLineFitsPassLimit("startpos", line(STUDY_MAX_PASSES_PER_SIDE + 1))).toBe(false);
    });
});

describe("パスの適用", () => {
    it("研究ノートの局面では、パス権が無くてもパスで手番だけが替わり、パス権の状態は付かない", () => {
        const start = createInitialPositionState();
        const applied = applyStudyMoveWithState(start, "pass");
        expect(applied.ok).toBe(true);
        expect(applied.next.turn).toBe("gote");
        expect(applied.next.board).toEqual(start.board);
        expect(applied.next.passRights).toBeUndefined();
    });

    it("読み筋を進めるとき: パス権を数えていない局面ではパスを進め、数えている局面では残りに従う", () => {
        const start = createInitialPositionState();
        expect(applyMoveAllowingStudyPass(start, "pass").ok).toBe(true);
        expect(applyMoveAllowingStudyPass(start, "PASS").ok).toBe(true);
        expect(applyMoveAllowingStudyPass(start, "7g7f").ok).toBe(true);
        // 対局画面の局面（残り 0）。
        const counted = { ...start, passRights: { sente: 0, gote: 1 } };
        expect(applyMoveAllowingStudyPass(counted, "pass").ok).toBe(false);
    });
});

describe("注目局面とパス", () => {
    const spec: StudyLayerSpec = {
        version: 1,
        engine: { kind: "wasm", name: "rshogi", version: "0.8.1" },
        evaluation: { nnueSha256: null, fvScale: null, progressSha256: null, layerStacks: null },
        limits: { timeMs: 1000, depth: 15, nodes: null },
        multiPv: 1,
        rules: { variant: "standard" },
    };
    const layerId = studyLayerId(spec);
    const cp = (value: number): StudyScore => ({ kind: "cp", value });

    it("手順の中の最初のパスは判定しない（前後で解析の前提が違う）。2 回目からは判定する", () => {
        const moves = ["7g7f", "pass", "2g2f", "pass"];
        const base = createStudyDocumentFromMoves({
            id: "44444444-4444-4444-8444-444444444444",
            title: "パス",
            origin: { kind: "paste", ref: null },
            startSfen: "startpos",
            moves,
        });
        const ids = [base.tree.rootId];
        for (const move of moves) ids.push(studyChildNodeId(ids[ids.length - 1], move));
        // 後手のパスのたびに、後手から見て大きく悪くなる評価値。
        const scores = [0, 0, 2000, 0, 2000];
        const ops: StudyOp[] = [{ type: "ensureLayer", spec, display: { label: "RAMU・1 秒" } }];
        scores.forEach((value, index) => {
            ops.push({
                type: "putAnalysis",
                layerId,
                nodeId: ids[index],
                result: {
                    runId: "run",
                    completion: "completed",
                    depth: 15,
                    nodes: null,
                    timeMs: null,
                    execution: { threads: null, hashMb: null, parallelWorkers: null },
                    candidates: [{ rank: 1, score: cp(value), depth: 15, seldepth: null, pv: [] }],
                },
            });
        });
        const highlights = computeStudyHighlights(applyStudyOps(base, ops), layerId);

        const kindOf = (nodeId: string) =>
            highlights.find((highlight) => highlight.nodeId === nodeId)?.kind ?? null;
        expect(kindOf(ids[2])).toBeNull();
        expect(kindOf(ids[4])).toBe("blunder");
    });
});
