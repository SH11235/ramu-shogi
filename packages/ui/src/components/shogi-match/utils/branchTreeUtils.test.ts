import {
    addMove,
    applyMoveWithState,
    createInitialPositionState,
    createKifuTree,
    goToNode,
    type KifuTree,
    setNodeEval,
} from "@shogi/app-core";
import { describe, expect, it } from "vitest";
import {
    collectBranchAnalysisJobs,
    collectTreeAnalysisJobs,
    normalizeEvalToSentePerspective,
} from "./branchTreeUtils";
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

describe("collectTreeAnalysisJobs", () => {
    const play = (tree: KifuTree, moves: string[]): KifuTree => {
        let next = tree;
        for (const move of moves) {
            const current = next.nodes.get(next.currentNodeId);
            if (!current) throw new Error("current node missing");
            next = addMove(next, move, applyMoveWithState(current.positionAfter, move).next);
        }
        return next;
    };

    /** 本譜 7g7f 3c3d と、初手のあとの分岐 8c8d を持つツリー。 */
    const createTree = () => {
        let tree = play(createKifuTree(createInitialPositionState(), "startpos"), ["7g7f", "3c3d"]);
        const first = tree.nodes.get(tree.rootId)?.children[0] as string;
        const second = tree.nodes.get(first)?.children[0] as string;
        tree = play(goToNode(tree, first), ["8c8d"]);
        const branch = tree.nodes.get(first)?.children[1] as string;
        return { tree, first, second, branch };
    };

    it("既定ではルートを含めず、評価値の無いノードを対象にする（既存の画面の動作）", () => {
        const { tree, first, second, branch } = createTree();
        const withEval = setNodeEval(tree, first, { scoreCp: 30 });
        expect(collectTreeAnalysisJobs(withEval).map((job) => job.nodeId)).toEqual([
            second,
            branch,
        ]);
        expect(collectTreeAnalysisJobs(withEval, { mainLineOnly: true })).toEqual([
            {
                nodeId: second,
                ply: 2,
                moves: ["7g7f", "3c3d"],
                isMainLine: true,
                // 2 手指した後の局面は先手番。
                sideToMove: "sente",
            },
        ]);
    });

    it("開始局面（ルート）も解析対象にできる", () => {
        const { tree, first, second, branch } = createTree();
        const jobs = collectTreeAnalysisJobs(tree, { includeRoot: true });
        expect(jobs.map((job) => job.nodeId)).toEqual([tree.rootId, first, second, branch]);
        expect(jobs[0]).toEqual({
            nodeId: tree.rootId,
            ply: 0,
            moves: [],
            isMainLine: true,
            sideToMove: "sente",
        });
        expect(jobs[1]).toMatchObject({ ply: 1, moves: ["7g7f"], sideToMove: "gote" });
        expect(jobs[3]).toMatchObject({ isMainLine: false, moves: ["7g7f", "8c8d"] });
    });

    it("「未解析」の判定を、指定したレイヤーの結果の有無で行える", () => {
        const { tree, first, second, branch } = createTree();
        // ノードに評価値（対局時の評価値など）があっても、レイヤーに結果が無ければ未解析。
        const withEval = setNodeEval(setNodeEval(tree, first, { scoreCp: 30 }), second, {
            scoreCp: 10,
        });
        const analyzedInLayer = new Set([tree.rootId, second]);
        const jobs = collectTreeAnalysisJobs(withEval, {
            includeRoot: true,
            isAnalyzed: (node) => analyzedInLayer.has(node.id),
        });
        expect(jobs.map((job) => job.nodeId)).toEqual([first, branch]);
        expect(
            collectBranchAnalysisJobs(withEval, first, {
                isAnalyzed: (node) => analyzedInLayer.has(node.id),
            }).map((job) => [job.nodeId, job.sideToMove]),
        ).toEqual([
            [first, "gote"],
            [branch, "sente"],
        ]);
    });
});
