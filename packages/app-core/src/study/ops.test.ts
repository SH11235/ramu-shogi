import { describe, expect, it } from "vitest";
import { studyChildNodeId, studyLayerId } from "./ids";
import { createStudyDocumentFromMoves } from "./import";
import {
    applyStudyOp,
    applyStudyOps,
    compareStudyAnalysisPriority,
    isStudyUsiMove,
    StudyOpError,
    studyDocumentToOps,
} from "./ops";
import type {
    StudyAnalysisResult,
    StudyDocument,
    StudyLayerSpec,
    StudyOp,
    StudySource,
} from "./types";

const baseDoc = (moves: string[] = ["7g7f", "3c3d"]): StudyDocument =>
    createStudyDocumentFromMoves({
        id: "b1181ba0-5387-4d97-9e3c-e89bdfb94c7b",
        title: "テスト",
        origin: { kind: "paste", ref: null },
        startSfen: "startpos",
        moves,
    });

const spec = (timeMs = 1000): StudyLayerSpec => ({
    version: 1,
    engine: { kind: "wasm", name: "rshogi", version: "0.8.1" },
    evaluation: { nnueSha256: null, fvScale: null, progressSha256: null, layerStacks: null },
    limits: { timeMs, depth: 15, nodes: null },
    multiPv: 1,
    rules: { variant: "standard" },
});

const result = (overrides: Partial<StudyAnalysisResult> = {}): StudyAnalysisResult => ({
    runId: "9d6783f2-d773-4572-ae4e-bd463bf8f816",
    completion: "completed",
    depth: 15,
    nodes: 1000,
    timeMs: 1000,
    execution: { threads: 1, hashMb: null, parallelWorkers: 4 },
    candidates: [
        { rank: 1, score: { kind: "cp", value: 120 }, depth: 15, seldepth: 22, pv: ["3c3d"] },
    ],
    ...overrides,
});

const nodeAt = (doc: StudyDocument, moves: string[]): string =>
    moves.reduce((parentId, move) => studyChildNodeId(parentId, move), doc.tree.rootId);

/** 同じ操作を 2 回適用しても結果が変わらないことを確かめる。 */
const expectIdempotent = (doc: StudyDocument, op: StudyOp): StudyDocument => {
    const once = applyStudyOp(doc, op);
    const twice = applyStudyOp(once, op);
    expect(twice).toBe(once);
    return once;
};

describe("isStudyUsiMove", () => {
    it("USI の指し手の書式だけを通す", () => {
        expect(isStudyUsiMove("7g7f")).toBe(true);
        expect(isStudyUsiMove("8h2b+")).toBe(true);
        expect(isStudyUsiMove("P*5e")).toBe(true);
        expect(isStudyUsiMove("p*5e")).toBe(false);
        expect(isStudyUsiMove("K*5e")).toBe(false);
        expect(isStudyUsiMove("pass")).toBe(false);
        expect(isStudyUsiMove("resign")).toBe(false);
        expect(isStudyUsiMove("0a1a")).toBe(false);
        expect(isStudyUsiMove(null)).toBe(false);
    });
});

describe("addMoves", () => {
    it("親から 1 本の手順を足し、nodeId は手順で決まる", () => {
        const doc = baseDoc([]);
        const next = expectIdempotent(doc, {
            type: "addMoves",
            parentId: doc.tree.rootId,
            moves: ["7g7f", "3c3d"],
        });
        const first = nodeAt(doc, ["7g7f"]);
        const second = nodeAt(doc, ["7g7f", "3c3d"]);
        expect(next.tree.nodes[doc.tree.rootId].children).toEqual([first]);
        expect(next.tree.nodes[first]).toEqual({
            parentId: doc.tree.rootId,
            usiMove: "7g7f",
            children: [second],
            comment: "",
            bookmarked: false,
            source: null,
        });
        expect(next.tree.nodes[second].parentId).toBe(first);
        // 元の文書は変えない。
        expect(Object.keys(doc.tree.nodes)).toHaveLength(1);
    });

    it("既にある手は足さずにたどり、新しい兄弟は末尾に入る", () => {
        const doc = baseDoc(["7g7f", "3c3d"]);
        const next = applyStudyOp(doc, {
            type: "addMoves",
            parentId: doc.tree.rootId,
            moves: ["7g7f", "8c8d", "2g2f"],
        });
        const first = nodeAt(doc, ["7g7f"]);
        expect(next.tree.nodes[first].children).toEqual([
            nodeAt(doc, ["7g7f", "3c3d"]),
            nodeAt(doc, ["7g7f", "8c8d"]),
        ]);
        expect(Object.keys(next.tree.nodes)).toHaveLength(5);
        // 本譜（先頭の子）は変わらない。
        expect(next.tree.nodes[first].children[0]).toBe(doc.tree.nodes[first].children[0]);
    });

    it("親が無ければ読み飛ばす", () => {
        const doc = baseDoc();
        expect(applyStudyOp(doc, { type: "addMoves", parentId: "missing", moves: ["7g7f"] })).toBe(
            doc,
        );
    });

    it("空の手順・USI の書式でない指し手は入力不正", () => {
        const doc = baseDoc();
        expect(() =>
            applyStudyOp(doc, { type: "addMoves", parentId: doc.tree.rootId, moves: [] }),
        ).toThrow(StudyOpError);
        expect(() =>
            applyStudyOp(doc, { type: "addMoves", parentId: doc.tree.rootId, moves: ["pass"] }),
        ).toThrow(StudyOpError);
    });
});

describe("ノードの属性", () => {
    it("setComment / setBookmark / setSource は置き換えで、冪等", () => {
        const doc = baseDoc();
        const nodeId = nodeAt(doc, ["7g7f"]);
        const source: StudySource = {
            kind: "csa",
            score: { kind: "mate", winner: "gote", plies: null },
            pv: ["3c3d"],
            elapsedMs: 1000,
        };
        let next = expectIdempotent(doc, { type: "setComment", nodeId, value: "ここを確認" });
        next = expectIdempotent(next, { type: "setBookmark", nodeId, value: true });
        next = expectIdempotent(next, { type: "setSource", nodeId, value: source });
        expect(next.tree.nodes[nodeId]).toMatchObject({
            comment: "ここを確認",
            bookmarked: true,
            source,
        });
        // 同じ内容の別オブジェクトでも変化なしと判定する。
        expect(applyStudyOp(next, { type: "setSource", nodeId, value: { ...source } })).toBe(next);
        next = applyStudyOp(next, { type: "setSource", nodeId, value: null });
        expect(next.tree.nodes[nodeId].source).toBeNull();
    });

    it("対象のノードが無ければ読み飛ばす", () => {
        const doc = baseDoc();
        const ops: StudyOp[] = [
            { type: "setComment", nodeId: "missing", value: "x" },
            { type: "setBookmark", nodeId: "missing", value: true },
            { type: "setSource", nodeId: "missing", value: null },
            { type: "reorderChildren", parentId: "missing", value: [] },
            { type: "deleteSubtree", nodeId: "missing" },
            { type: "deleteLayer", layerId: "missing" },
            { type: "putAnalysis", layerId: "missing", nodeId: doc.tree.rootId, result: result() },
        ];
        expect(applyStudyOps(doc, ops)).toBe(doc);
    });

    it("setTitle", () => {
        const doc = baseDoc();
        const next = expectIdempotent(doc, { type: "setTitle", value: "新しい表題" });
        expect(next.title).toBe("新しい表題");
    });
});

describe("reorderChildren", () => {
    const withBranches = (): StudyDocument => {
        const doc = baseDoc(["7g7f"]);
        return applyStudyOps(doc, [
            { type: "addMoves", parentId: doc.tree.rootId, moves: ["2g2f"] },
            { type: "addMoves", parentId: doc.tree.rootId, moves: ["5g5f"] },
        ]);
    };

    it("兄弟の順序を入れ替える（先頭が本譜）", () => {
        const doc = withBranches();
        const [a, b, c] = doc.tree.nodes[doc.tree.rootId].children;
        const next = expectIdempotent(doc, {
            type: "reorderChildren",
            parentId: doc.tree.rootId,
            value: [c, a, b],
        });
        expect(next.tree.nodes[doc.tree.rootId].children).toEqual([c, a, b]);
    });

    it("現在の子の集合と一致しなければ読み飛ばす", () => {
        const doc = withBranches();
        const [a, b, c] = doc.tree.nodes[doc.tree.rootId].children;
        const parentId = doc.tree.rootId;
        expect(applyStudyOp(doc, { type: "reorderChildren", parentId, value: [a, b] })).toBe(doc);
        expect(applyStudyOp(doc, { type: "reorderChildren", parentId, value: [a, b, b] })).toBe(
            doc,
        );
        expect(applyStudyOp(doc, { type: "reorderChildren", parentId, value: [a, b, "x"] })).toBe(
            doc,
        );
        expect(
            applyStudyOp(doc, { type: "reorderChildren", parentId, value: [a, b, c, "x"] }),
        ).toBe(doc);
    });
});

describe("レイヤーと解析結果", () => {
    it("ensureLayer はレイヤーを作り、あれば何もしない（表示名も変えない）", () => {
        const doc = baseDoc();
        const next = expectIdempotent(doc, {
            type: "ensureLayer",
            spec: spec(),
            display: { label: "RAMU・1 秒" },
        });
        expect(next.layers).toEqual([
            {
                id: studyLayerId(spec()),
                spec: spec(),
                display: { label: "RAMU・1 秒" },
                results: {},
            },
        ]);
        expect(
            applyStudyOp(next, { type: "ensureLayer", spec: spec(), display: { label: "別名" } }),
        ).toBe(next);
        // 探索上限が違えば別のレイヤー。
        const two = applyStudyOp(next, {
            type: "ensureLayer",
            spec: spec(10_000),
            display: { label: "RAMU・10 秒" },
        });
        expect(two.layers.map((layer) => layer.id)).toEqual([
            studyLayerId(spec()),
            studyLayerId(spec(10_000)),
        ]);
    });

    const withLayer = (): { doc: StudyDocument; layerId: string; nodeId: string } => {
        const base = baseDoc();
        const doc = applyStudyOp(base, {
            type: "ensureLayer",
            spec: spec(),
            display: { label: "RAMU・1 秒" },
        });
        return { doc, layerId: studyLayerId(spec()), nodeId: nodeAt(base, ["7g7f"]) };
    };

    it("putAnalysis はルートを含むノードに結果を置く。ノードやレイヤーが無ければ読み飛ばす", () => {
        const { doc, layerId, nodeId } = withLayer();
        let next = expectIdempotent(doc, {
            type: "putAnalysis",
            layerId,
            nodeId,
            result: result(),
        });
        next = applyStudyOp(next, {
            type: "putAnalysis",
            layerId,
            nodeId: doc.tree.rootId,
            result: result(),
        });
        expect(Object.keys(next.layers[0].results).sort()).toEqual(
            [nodeId, doc.tree.rootId].sort(),
        );
        expect(
            applyStudyOp(next, {
                type: "putAnalysis",
                layerId,
                nodeId: "missing",
                result: result(),
            }),
        ).toBe(next);
    });

    it("候補が 1 本も無い結果は入力不正", () => {
        const { doc, layerId, nodeId } = withLayer();
        expect(() =>
            applyStudyOp(doc, {
                type: "putAnalysis",
                layerId,
                nodeId,
                result: result({ candidates: [] }),
            }),
        ).toThrow(StudyOpError);
    });

    it("採用優先度: 完了 > 深さ > ノード数 > runId。到着順に依存しない", () => {
        const { doc, layerId, nodeId } = withLayer();
        const cases: Array<[StudyAnalysisResult, StudyAnalysisResult]> = [
            // [優先される側, 負ける側]
            [
                result({ completion: "completed", depth: 5 }),
                result({ completion: "aborted", depth: 30 }),
            ],
            [result({ depth: 16, nodes: 1 }), result({ depth: 15, nodes: 999_999 })],
            [result({ nodes: 2000 }), result({ nodes: 1000 })],
            [result({ nodes: 0 }), result({ nodes: null })],
            [result({ runId: "b" }), result({ runId: "a" })],
        ];
        for (const [winner, loser] of cases) {
            expect(compareStudyAnalysisPriority(winner, loser)).toBeGreaterThan(0);
            expect(compareStudyAnalysisPriority(loser, winner)).toBeLessThan(0);
            for (const order of [
                [winner, loser],
                [loser, winner],
            ]) {
                const next = applyStudyOps(
                    doc,
                    order.map((item) => ({ type: "putAnalysis", layerId, nodeId, result: item })),
                );
                expect(next.layers[0].results[nodeId]).toEqual(winner);
            }
        }
        expect(compareStudyAnalysisPriority(result(), result())).toBe(0);
    });

    it("deleteLayer はレイヤーと結果を消す", () => {
        const { doc, layerId, nodeId } = withLayer();
        const filled = applyStudyOp(doc, {
            type: "putAnalysis",
            layerId,
            nodeId,
            result: result(),
        });
        const next = expectIdempotent(filled, { type: "deleteLayer", layerId });
        expect(next.layers).toEqual([]);
    });
});

describe("deleteSubtree", () => {
    it("部分木と、全レイヤーの配下の結果を消す", () => {
        const base = baseDoc(["7g7f", "3c3d", "2g2f"]);
        const rootId = base.tree.rootId;
        const first = nodeAt(base, ["7g7f"]);
        const second = nodeAt(base, ["7g7f", "3c3d"]);
        const third = nodeAt(base, ["7g7f", "3c3d", "2g2f"]);
        const branch = nodeAt(base, ["7g7f", "8c8d"]);
        const layerA = studyLayerId(spec());
        const layerB = studyLayerId(spec(10_000));
        const doc = applyStudyOps(base, [
            { type: "addMoves", parentId: first, moves: ["8c8d"] },
            { type: "ensureLayer", spec: spec(), display: { label: "A" } },
            { type: "ensureLayer", spec: spec(10_000), display: { label: "B" } },
            ...[rootId, first, second, third, branch].flatMap((nodeId): StudyOp[] => [
                { type: "putAnalysis", layerId: layerA, nodeId, result: result() },
                { type: "putAnalysis", layerId: layerB, nodeId, result: result() },
            ]),
        ]);

        const next = expectIdempotent(doc, { type: "deleteSubtree", nodeId: second });
        expect(Object.keys(next.tree.nodes).sort()).toEqual([rootId, first, branch].sort());
        expect(next.tree.nodes[first].children).toEqual([branch]);
        for (const layer of next.layers) {
            expect(Object.keys(layer.results).sort()).toEqual([rootId, first, branch].sort());
        }
    });

    it("消して同じ手順で作り直すと同じ nodeId に戻る", () => {
        const doc = baseDoc(["7g7f", "3c3d"]);
        const first = nodeAt(doc, ["7g7f"]);
        const next = applyStudyOps(doc, [
            { type: "deleteSubtree", nodeId: first },
            { type: "addMoves", parentId: doc.tree.rootId, moves: ["7g7f", "3c3d"] },
        ]);
        expect(next.tree).toEqual(doc.tree);
    });

    it("ルートは削除できない（入力不正）", () => {
        const doc = baseDoc();
        expect(() => applyStudyOp(doc, { type: "deleteSubtree", nodeId: doc.tree.rootId })).toThrow(
            StudyOpError,
        );
    });
});

describe("再送と再適用", () => {
    it("操作の列を丸ごと 2 回適用しても結果が変わらない", () => {
        const doc = baseDoc(["7g7f"]);
        const first = nodeAt(doc, ["7g7f"]);
        const layerId = studyLayerId(spec());
        const ops: StudyOp[] = [
            { type: "addMoves", parentId: first, moves: ["3c3d", "2g2f"] },
            { type: "addMoves", parentId: first, moves: ["8c8d"] },
            { type: "setComment", nodeId: first, value: "角交換を検討" },
            { type: "ensureLayer", spec: spec(), display: { label: "RAMU・1 秒" } },
            { type: "putAnalysis", layerId, nodeId: first, result: result() },
            { type: "deleteSubtree", nodeId: nodeAt(doc, ["7g7f", "8c8d"]) },
            { type: "setTitle", value: "表題" },
        ];
        const once = applyStudyOps(doc, ops);
        expect(applyStudyOps(once, ops)).toEqual(once);
    });

    it("studyDocumentToOps: 別の文書の上に同じ中身を再現できる", () => {
        const base = baseDoc(["7g7f", "3c3d"]);
        const first = nodeAt(base, ["7g7f"]);
        const layerId = studyLayerId(spec());
        const local = applyStudyOps(base, [
            { type: "addMoves", parentId: first, moves: ["8c8d", "2g2f"] },
            { type: "setComment", nodeId: first, value: "メモ" },
            { type: "setBookmark", nodeId: nodeAt(base, ["7g7f", "8c8d"]), value: true },
            {
                type: "setSource",
                nodeId: first,
                value: { kind: "csa", score: { kind: "cp", value: 30 }, pv: null, elapsedMs: 2000 },
            },
            { type: "ensureLayer", spec: spec(), display: { label: "RAMU・1 秒" } },
            { type: "putAnalysis", layerId, nodeId: base.tree.rootId, result: result() },
            { type: "putAnalysis", layerId, nodeId: first, result: result({ depth: 20 }) },
        ]);

        // 同じ元棋譜から作られた、本譜だけの別のノート。
        const remote = { ...baseDoc(["7g7f", "3c3d"]), id: "other", title: "既存のノート" };
        const merged = applyStudyOps(remote, studyDocumentToOps(local));
        expect(merged.tree).toEqual(local.tree);
        expect(merged.layers).toEqual(local.layers);
        expect(merged.id).toBe("other");
        expect(merged.title).toBe("既存のノート");
        // 既に同じ中身なら何も変わらない。
        expect(applyStudyOps(merged, studyDocumentToOps(local))).toBe(merged);
    });
});
