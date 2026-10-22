import { describe, expect, it } from "vitest";
import { applyMoveWithState, createInitialPositionState, type PositionState } from "../game/board";
import {
    addMove,
    createKifuTree,
    goToNode,
    type KifuTree,
    promoteToMainLine,
    setNodeComment,
    truncateFromCurrent,
} from "../game/kifu-tree";
import { studyChildNodeId, studyLayerId, studyRootNodeId } from "./ids";
import { createStudyDocumentFromKifuTree, createStudyDocumentFromMoves } from "./import";
import { applyStudyOps } from "./ops";
import { parseStudySfen } from "./sfen";
import {
    buildStudyNodeIdIndex,
    diffKifuTreeToStudyOps,
    kifuTreeToStudyTree,
    studyDocumentToKifuTree,
} from "./tree-convert";
import {
    STANDARD_STUDY_RULES,
    STUDY_HIRATE_SFEN,
    type StudyAnalysisResult,
    type StudyDocument,
    type StudyLayerSpec,
} from "./types";

const play = (tree: KifuTree, moves: string[], options?: { elapsedMs?: number }): KifuTree => {
    let next = tree;
    for (const move of moves) {
        const current = next.nodes.get(next.currentNodeId);
        if (!current) throw new Error("current node missing");
        const applied = applyMoveWithState(current.positionAfter, move);
        if (!applied.ok) throw new Error(`cannot apply ${move}: ${applied.error}`);
        next = addMove(next, move, applied.next, options);
    }
    return next;
};

const hirateTree = (): KifuTree => createKifuTree(createInitialPositionState(), "startpos");

const spec: StudyLayerSpec = {
    version: 1,
    engine: { kind: "wasm", name: "rshogi", version: "0.8.1" },
    evaluation: { nnueSha256: null, fvScale: null, progressSha256: null, layerStacks: null },
    limits: { timeMs: 1000, depth: 15, nodes: null },
    multiPv: 2,
    rules: { variant: "standard" },
};

const analysis = (value: number): StudyAnalysisResult => ({
    runId: "9d6783f2-d773-4572-ae4e-bd463bf8f816",
    completion: "completed",
    depth: 15,
    nodes: 123_456,
    timeMs: 1002,
    execution: { threads: 1, hashMb: null, parallelWorkers: 4 },
    candidates: [
        { rank: 1, score: { kind: "cp", value }, depth: 15, seldepth: 22, pv: ["3c3d", "2g2f"] },
        {
            rank: 2,
            score: { kind: "mate", winner: "gote", plies: 9 },
            depth: 14,
            seldepth: null,
            pv: ["8c8d"],
        },
    ],
});

describe("parseStudySfen", () => {
    it("平手の SFEN は初期局面と一致する", () => {
        const parsed = parseStudySfen(STUDY_HIRATE_SFEN);
        const initial = createInitialPositionState();
        expect(parsed.board).toEqual(initial.board);
        expect(parsed.hands).toEqual(initial.hands);
        expect(parsed.turn).toBe("sente");
        expect(parsed.ply).toBe(1);
    });

    it("成駒・持ち駒・後手番・手数を読む", () => {
        const parsed = parseStudySfen("4k4/9/4+P4/9/9/9/9/9/4K4 w 2Pb12p 34");
        expect(parsed.board["5c"]).toEqual({ owner: "sente", type: "P", promoted: true });
        expect(parsed.board["5a"]).toEqual({ owner: "gote", type: "K" });
        expect(parsed.hands).toEqual({ sente: { P: 2 }, gote: { B: 1, P: 12 } });
        expect(parsed.turn).toBe("gote");
        expect(parsed.ply).toBe(34);
    });

    it("解釈できない SFEN は例外にする", () => {
        expect(() => parseStudySfen("4k4/9/9 b - 1")).toThrow();
        expect(() => parseStudySfen("4k4/9/9/9/9/9/9/9/4K3 b - 1")).toThrow();
        expect(() => parseStudySfen("4k4/9/9/9/9/9/9/9/4K4 x - 1")).toThrow();
        expect(() => parseStudySfen("4k4/9/9/9/9/9/9/9/4K4 b 2 1")).toThrow();
    });
});

describe("実行時ツリー → 保存用", () => {
    it("nodeId は手順で決まり、children[0] が本譜", () => {
        let tree = play(hirateTree(), ["7g7f", "3c3d"]);
        const firstRuntimeId = tree.nodes.get(tree.rootId)?.children[0] as string;
        tree = play(goToNode(tree, firstRuntimeId), ["8c8d"]);
        tree = setNodeComment(tree, firstRuntimeId, "初手");

        const { startSfen, tree: stored, index } = kifuTreeToStudyTree(tree, { sourceKind: null });
        const rootId = studyRootNodeId(STUDY_HIRATE_SFEN, STANDARD_STUDY_RULES);
        const first = studyChildNodeId(rootId, "7g7f");
        expect(startSfen).toBe(STUDY_HIRATE_SFEN);
        expect(stored.rootId).toBe(rootId);
        expect(stored.nodes[rootId]).toEqual({
            parentId: null,
            usiMove: null,
            children: [first],
            comment: "",
            bookmarked: false,
            source: null,
        });
        expect(stored.nodes[first].children).toEqual([
            studyChildNodeId(first, "3c3d"),
            studyChildNodeId(first, "8c8d"),
        ]);
        expect(stored.nodes[first].comment).toBe("初手");
        expect(Object.keys(stored.nodes)).toHaveLength(4);
        expect(index.byRuntimeId.get(firstRuntimeId)).toBe(first);
        expect(index.byNodeId.get(first)).toBe(firstRuntimeId);
        expect(index.byRuntimeId.get(tree.rootId)).toBe(rootId);
    });

    it("棋譜から読んだ評価値（先手視点）と消費時間は source に入り、エンジン出力は入らない", () => {
        const initial = createInitialPositionState();
        const afterFirst = applyMoveWithState(initial, "7g7f").next;
        const afterSecond = applyMoveWithState(afterFirst, "3c3d").next;
        let tree = addMove(hirateTree(), "7g7f", afterFirst, {
            elapsedMs: 1500,
            eval: { scoreCp: 80, normalized: true, pv: ["3c3d"] },
        });
        // エンジン出力（手番側視点）の評価値。解析結果であり、対局時の評価値ではない。
        tree = addMove(tree, "3c3d", afterSecond, { eval: { scoreCp: -50 } });

        const withSource = kifuTreeToStudyTree(tree, { sourceKind: "csa" }).tree;
        const rootId = withSource.rootId;
        const first = studyChildNodeId(rootId, "7g7f");
        const second = studyChildNodeId(first, "3c3d");
        expect(withSource.nodes[first].source).toEqual({
            kind: "csa",
            score: { kind: "cp", value: 80 },
            pv: ["3c3d"],
            elapsedMs: 1500,
        });
        expect(withSource.nodes[second].source).toBeNull();

        const withoutSource = kifuTreeToStudyTree(tree, { sourceKind: null }).tree;
        expect(withoutSource.nodes[first].source).toBeNull();
    });

    it("AI が指した手の探索結果は、指した側から見た評価値として先手視点で source に入る", () => {
        const initial = createInitialPositionState();
        const afterFirst = applyMoveWithState(initial, "7g7f").next;
        const afterSecond = applyMoveWithState(afterFirst, "3c3d").next;
        const afterThird = applyMoveWithState(afterSecond, "2g2f").next;
        let tree = addMove(hirateTree(), "7g7f", afterFirst, {
            elapsedMs: 900,
            searchStats: { scoreCp: 60, pv: ["7g7f", "3c3d", "2g2f"], depth: 12 },
            // 指した後の局面を解析した値（手番側視点）は、探索結果より優先しない。
            eval: { scoreCp: 999 },
        });
        tree = addMove(tree, "3c3d", afterSecond, {
            searchStats: { scoreCp: 40, pv: ["3c3d"] },
        });
        tree = addMove(tree, "2g2f", afterThird, {
            elapsedMs: 3000,
            searchStats: { scoreMate: -7 },
        });

        const stored = kifuTreeToStudyTree(tree, { sourceKind: "kifu" }).tree;
        const first = studyChildNodeId(stored.rootId, "7g7f");
        const second = studyChildNodeId(first, "3c3d");
        const third = studyChildNodeId(second, "2g2f");
        expect(stored.nodes[first].source).toEqual({
            kind: "kifu",
            score: { kind: "cp", value: 60 },
            pv: ["3c3d", "2g2f"],
            elapsedMs: 900,
        });
        expect(stored.nodes[second].source).toEqual({
            kind: "kifu",
            score: { kind: "cp", value: -40 },
            pv: null,
            elapsedMs: null,
        });
        expect(stored.nodes[third].source).toEqual({
            kind: "kifu",
            score: { kind: "mate", winner: "gote", plies: 7 },
            pv: null,
            elapsedMs: 3000,
        });
    });

    it("パスを含むツリーも研究ノートにでき、復元すると同じ手順になる", () => {
        const start: PositionState = {
            ...createInitialPositionState(),
            passRights: { sente: 2, gote: 2 },
        };
        const tree = play(createKifuTree(start, "startpos"), ["pass", "3c3d", "pass"]);
        const { startSfen, tree: stored } = kifuTreeToStudyTree(tree, { sourceKind: null });
        const moves = Object.values(stored.nodes)
            .map((node) => node.usiMove)
            .filter((move) => move !== null);
        expect(moves.sort()).toEqual(["3c3d", "pass", "pass"]);

        // 研究ノートはパス権の回数を持たない。復元でも、回数に関係なくパスを再生できる。
        const restored = studyDocumentToKifuTree({
            ...createStudyDocumentFromMoves({
                id: "study",
                title: "パス",
                origin: { kind: "paste", ref: null },
                startSfen,
                moves: ["pass", "3c3d", "pass", "8c8d", "pass", "pass"],
            }),
        });
        expect(restored.errors).toEqual([]);
        expect(restored.tree.nodes.size).toBe(7);
        for (const node of restored.tree.nodes.values()) {
            expect(node.positionAfter.passRights).toBeUndefined();
        }
    });

    it("後手番から始まる局面も SFEN のまま持つ", () => {
        const sfen = "4k4/9/9/9/9/9/9/9/4K4 w - 1";
        const tree = play(createKifuTree(parseStudySfen(sfen), `sfen ${sfen}`), ["5a5b"]);
        const { startSfen, tree: stored } = kifuTreeToStudyTree(tree, { sourceKind: null });
        expect(startSfen).toBe(sfen);
        expect(stored.rootId).toBe(studyRootNodeId(sfen, STANDARD_STUDY_RULES));
    });
});

describe("保存用 → 実行時ツリー", () => {
    const buildDoc = (): StudyDocument => {
        const base = createStudyDocumentFromMoves({
            id: "study-1",
            title: "テスト",
            origin: { kind: "paste", ref: null },
            startSfen: "startpos",
            moves: ["7g7f", "3c3d", "8h2b+"],
            annotations: [
                { score: { kind: "cp", value: 40 }, pv: ["3c3d"], elapsedMs: 3000 },
                null,
                { score: { kind: "mate", winner: "sente", plies: null } },
            ],
        });
        const first = studyChildNodeId(base.tree.rootId, "7g7f");
        return applyStudyOps(base, [
            { type: "addMoves", parentId: first, moves: ["8c8d"] },
            { type: "setComment", nodeId: first, value: "初手" },
            { type: "ensureLayer", spec, display: { label: "RAMU・1 秒" } },
            {
                type: "putAnalysis",
                layerId: studyLayerId(spec),
                nodeId: first,
                result: analysis(55),
            },
            {
                type: "putAnalysis",
                layerId: studyLayerId(spec),
                nodeId: base.tree.rootId,
                result: analysis(30),
            },
        ]);
    };

    it("盤面を開始局面から復元し、実行時ツリーと同じ形になる", () => {
        const doc = buildDoc();
        const { tree, index, errors } = studyDocumentToKifuTree(doc);
        expect(errors).toEqual([]);
        expect(tree.startSfen).toBe(STUDY_HIRATE_SFEN);
        expect(tree.currentNodeId).toBe(tree.rootId);
        expect(tree.nodes.size).toBe(5);

        const first = studyChildNodeId(doc.tree.rootId, "7g7f");
        const second = studyChildNodeId(first, "3c3d");
        const third = studyChildNodeId(second, "8h2b+");
        const reference = play(hirateTree(), ["7g7f", "3c3d", "8h2b+"]);
        const referenceLeaf = reference.nodes.get(reference.currentNodeId);
        const leaf = tree.nodes.get(index.byNodeId.get(third) as string);
        expect(leaf?.ply).toBe(3);
        expect(leaf?.positionAfter).toEqual(referenceLeaf?.positionAfter);
        expect(leaf?.boardBefore).toEqual(referenceLeaf?.boardBefore);
        expect(leaf?.positionAfter.hands.sente).toEqual({ B: 1 });
        expect(leaf?.positionAfter.board["2b"]).toEqual({
            owner: "sente",
            type: "B",
            promoted: true,
        });

        const firstNode = tree.nodes.get(index.byNodeId.get(first) as string);
        expect(firstNode?.children.map((id) => index.byRuntimeId.get(id))).toEqual([
            second,
            studyChildNodeId(first, "8c8d"),
        ]);
        expect(firstNode?.comment).toBe("初手");
        expect(firstNode?.elapsedMs).toBe(3000);
    });

    it("レイヤーを指定しなければ対局時の評価値を載せる", () => {
        const doc = buildDoc();
        const { tree } = studyDocumentToKifuTree(doc);
        const first = studyChildNodeId(doc.tree.rootId, "7g7f");
        const third = studyChildNodeId(studyChildNodeId(first, "3c3d"), "8h2b+");
        expect(tree.nodes.get(first)?.eval).toEqual({
            scoreCp: 40,
            normalized: true,
            pv: ["3c3d"],
        });
        expect(tree.nodes.get(third)?.eval).toEqual({
            scoreMate: Number.POSITIVE_INFINITY,
            normalized: true,
        });
        expect(tree.nodes.get(tree.rootId)?.eval).toBeUndefined();
    });

    it("レイヤーを指定すると、そのレイヤーの結果だけを評価値にする（ルートも対象）", () => {
        const doc = buildDoc();
        const first = studyChildNodeId(doc.tree.rootId, "7g7f");
        const { tree } = studyDocumentToKifuTree(doc, {
            layerId: studyLayerId(spec),
            currentNodeId: first,
        });
        expect(tree.currentNodeId).toBe(first);
        expect(tree.nodes.get(first)?.eval).toEqual({
            scoreCp: 55,
            normalized: true,
            depth: 15,
            seldepth: 22,
            pv: ["3c3d", "2g2f"],
            nodes: 123_456,
            timeMs: 1002,
        });
        expect(tree.nodes.get(first)?.multiPvEvals?.[1]).toEqual({
            scoreMate: -9,
            normalized: true,
            depth: 14,
            pv: ["8c8d"],
            nodes: 123_456,
            timeMs: 1002,
        });
        expect(tree.nodes.get(tree.rootId)?.eval?.scoreCp).toBe(30);
        // 結果の無いノードは、対局時の評価値があっても未解析のまま。
        const third = studyChildNodeId(studyChildNodeId(first, "3c3d"), "8h2b+");
        expect(tree.nodes.get(third)?.eval).toBeUndefined();
        // 存在しないレイヤーを指定しても source にはフォールバックしない。
        const missing = studyDocumentToKifuTree(doc, { layerId: "missing" });
        expect(missing.tree.nodes.get(first)?.eval).toBeUndefined();
    });

    it("再生できない指し手は errors に入り、その配下は復元しない", () => {
        const doc = buildDoc();
        const first = studyChildNodeId(doc.tree.rootId, "7g7f");
        const broken = applyStudyOps(doc, [
            // 5e に駒は無いので動かせない。
            { type: "addMoves", parentId: first, moves: ["5e5d", "5c5d"] },
        ]);
        const { tree, errors } = studyDocumentToKifuTree(broken);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatchObject({ usiMove: "5e5d" });
        expect(tree.nodes.size).toBe(5);
    });

    it("実行時ツリー → 文書 → 実行時ツリーで形が保たれる", () => {
        let runtime = play(hirateTree(), ["7g7f", "3c3d", "2g2f"]);
        const firstRuntimeId = runtime.nodes.get(runtime.rootId)?.children[0] as string;
        runtime = play(goToNode(runtime, firstRuntimeId), ["8c8d", "2g2f"]);
        const { doc } = createStudyDocumentFromKifuTree({
            id: "study-2",
            title: "往復",
            origin: { kind: "paste", ref: null },
            tree: runtime,
            sourceKind: null,
        });
        const restored = studyDocumentToKifuTree(doc).tree;
        expect(kifuTreeToStudyTree(restored, { sourceKind: null }).tree).toEqual(doc.tree);
        expect(restored.nodes.size).toBe(runtime.nodes.size);
    });
});

describe("実行時ツリーの編集を操作にする", () => {
    const setup = () => {
        const doc = createStudyDocumentFromMoves({
            id: "study-3",
            title: "編集",
            origin: { kind: "paste", ref: null },
            startSfen: "startpos",
            moves: ["7g7f", "3c3d"],
        });
        const restored = studyDocumentToKifuTree(doc);
        return { doc, tree: restored.tree, index: restored.index };
    };

    it("変更が無ければ操作は出ない", () => {
        const { doc, tree, index } = setup();
        expect(diffKifuTreeToStudyOps(doc, tree, index)).toEqual([]);
    });

    it("手の追加・コメント・本譜への昇格・削除が操作になり、適用すると実行時ツリーと一致する", () => {
        const { doc, tree, index } = setup();
        const first = studyChildNodeId(doc.tree.rootId, "7g7f");
        const second = studyChildNodeId(first, "3c3d");

        // 分岐を足す（UUID のノードができる）。
        let edited = play(goToNode(tree, first), ["8c8d", "2g2f"]);
        const branchRuntimeId = edited.nodes.get(first)?.children[1] as string;
        edited = setNodeComment(edited, branchRuntimeId, "こちらも有力");
        let nextIndex = buildStudyNodeIdIndex(edited, doc.tree.rootId, index);
        const branch = studyChildNodeId(first, "8c8d");
        expect(nextIndex.byRuntimeId.get(branchRuntimeId)).toBe(branch);
        expect(nextIndex.byNodeId.get(branch)).toBe(branchRuntimeId);

        let ops = diffKifuTreeToStudyOps(doc, edited, nextIndex);
        expect(ops).toEqual([
            { type: "addMoves", parentId: first, moves: ["8c8d"] },
            { type: "addMoves", parentId: branch, moves: ["2g2f"] },
            { type: "setComment", nodeId: branch, value: "こちらも有力" },
        ]);
        let nextDoc = applyStudyOps(doc, ops);
        expect(diffKifuTreeToStudyOps(nextDoc, edited, nextIndex)).toEqual([]);

        // 分岐を本譜に昇格する。
        edited = promoteToMainLine(goToNode(edited, branchRuntimeId));
        nextIndex = buildStudyNodeIdIndex(edited, doc.tree.rootId, nextIndex);
        ops = diffKifuTreeToStudyOps(nextDoc, edited, nextIndex);
        expect(ops).toEqual([
            { type: "reorderChildren", parentId: first, value: [branch, second] },
        ]);
        nextDoc = applyStudyOps(nextDoc, ops);

        // 初手より先をすべて消す。
        edited = truncateFromCurrent(goToNode(edited, first));
        nextIndex = buildStudyNodeIdIndex(edited, doc.tree.rootId, nextIndex);
        ops = diffKifuTreeToStudyOps(nextDoc, edited, nextIndex);
        expect(ops).toHaveLength(2);
        expect(ops).toEqual(
            expect.arrayContaining([
                { type: "deleteSubtree", nodeId: branch },
                { type: "deleteSubtree", nodeId: second },
            ]),
        );
        nextDoc = applyStudyOps(nextDoc, ops);
        expect(nextDoc.tree).toEqual(kifuTreeToStudyTree(edited, { sourceKind: null }).tree);
    });
});

describe("復元できなかった枝の保護", () => {
    /** 本譜 7g7f 3c3d に、空の升から動かす枝（5e5d …）と普通の枝（8c8d）がある文書。 */
    const setup = () => {
        const base = createStudyDocumentFromMoves({
            id: "study-4",
            title: "壊れた枝",
            origin: { kind: "paste", ref: null },
            startSfen: "startpos",
            moves: ["7g7f", "3c3d"],
        });
        const first = studyChildNodeId(base.tree.rootId, "7g7f");
        const doc = applyStudyOps(base, [
            // 5e に駒は無いので、この枝は開始局面から再生できない。
            { type: "addMoves", parentId: first, moves: ["5e5d", "5c5d"] },
            { type: "addMoves", parentId: first, moves: ["8c8d"] },
            {
                type: "setComment",
                nodeId: studyChildNodeId(first, "5e5d"),
                value: "壊れた枝のメモ",
            },
        ]);
        const restored = studyDocumentToKifuTree(doc);
        return {
            doc,
            first,
            second: studyChildNodeId(first, "3c3d"),
            broken: studyChildNodeId(first, "5e5d"),
            branch: studyChildNodeId(first, "8c8d"),
            ...restored,
        };
    };

    it("編集していなければ、復元できなかった枝があっても差分は空", () => {
        const { doc, tree, index, errors, broken } = setup();
        expect(errors.map((error) => error.nodeId)).toEqual([broken]);
        expect(diffKifuTreeToStudyOps(doc, tree, index)).toEqual([]);
        // 対応表を作り直しても（前回の対応表を渡さなくても）同じ。
        const rebuilt = buildStudyNodeIdIndex(tree, doc.tree.rootId);
        expect(diffKifuTreeToStudyOps(doc, tree, rebuilt)).toEqual([]);
    });

    it("他の編集をしても、復元できなかった枝は削除にならず、文書に残る", () => {
        const { doc, tree, index, first, second, broken, branch } = setup();
        // 普通の枝を本譜に昇格し、その先に手を足す。
        let edited = promoteToMainLine(goToNode(tree, branch));
        edited = play(goToNode(edited, branch), ["2g2f"]);
        const nextIndex = buildStudyNodeIdIndex(edited, doc.tree.rootId, index);
        const ops = diffKifuTreeToStudyOps(doc, edited, nextIndex);
        expect(ops.some((op) => op.type === "deleteSubtree")).toBe(false);
        expect(ops).toContainEqual({
            type: "reorderChildren",
            parentId: first,
            // 復元できなかった子も並びに含める（含めないと、子の集合が合わず読み飛ばされる）。
            value: [branch, second, broken],
        });

        const next = applyStudyOps(doc, ops);
        expect(next.tree.nodes[first].children).toEqual([branch, second, broken]);
        expect(next.tree.nodes[broken].comment).toBe("壊れた枝のメモ");
        expect(next.tree.nodes[studyChildNodeId(broken, "5c5d")]).toBeDefined();
        expect(next.tree.nodes[studyChildNodeId(branch, "2g2f")]).toBeDefined();
        expect(diffKifuTreeToStudyOps(next, edited, nextIndex)).toEqual([]);
    });

    it("利用者が消した普通の枝は、これまでどおり削除になる", () => {
        const { doc, tree, index, first, second, broken, branch } = setup();
        // 初手より先をすべて消す。
        const edited = truncateFromCurrent(goToNode(tree, first));
        const nextIndex = buildStudyNodeIdIndex(edited, doc.tree.rootId, index);
        const ops = diffKifuTreeToStudyOps(doc, edited, nextIndex);
        expect(ops).toHaveLength(2);
        expect(ops).toEqual(
            expect.arrayContaining([
                { type: "deleteSubtree", nodeId: second },
                { type: "deleteSubtree", nodeId: branch },
            ]),
        );
        expect(applyStudyOps(doc, ops).tree.nodes[first].children).toEqual([broken]);
    });
});
