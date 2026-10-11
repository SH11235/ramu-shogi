import { describe, expect, it } from "vitest";
import { diffStudyDocuments } from "./doc-diff";
import { studyChildNodeId, studyLayerId } from "./ids";
import { createStudyDocumentFromMoves } from "./import";
import { applyStudyOps, mergeStudyComments, studyDocumentToOps } from "./ops";
import type { StudyAnalysisResult, StudyDocument, StudyLayerSpec, StudyOp } from "./types";

const baseDoc = (): StudyDocument =>
    createStudyDocumentFromMoves({
        id: "b1181ba0-5387-4d97-9e3c-e89bdfb94c7b",
        title: "差分",
        origin: { kind: "paste", ref: null },
        startSfen: "startpos",
        moves: ["7g7f", "3c3d", "2g2f"],
    });

const spec = (timeMs: number): StudyLayerSpec => ({
    version: 1,
    engine: { kind: "wasm", name: "rshogi", version: "0.8.1" },
    evaluation: { nnueSha256: null, fvScale: null, progressSha256: null, layerStacks: null },
    limits: { timeMs, depth: 15, nodes: null },
    multiPv: 1,
    rules: { variant: "standard" },
});

const result = (depth: number): StudyAnalysisResult => ({
    runId: "9d6783f2-d773-4572-ae4e-bd463bf8f816",
    completion: "completed",
    depth,
    nodes: null,
    timeMs: null,
    execution: { threads: null, hashMb: null, parallelWorkers: null },
    candidates: [{ rank: 1, score: { kind: "cp", value: depth }, depth, seldepth: null, pv: [] }],
});

const base = baseDoc();
const rootId = base.tree.rootId;
const first = studyChildNodeId(rootId, "7g7f");
const second = studyChildNodeId(first, "3c3d");
const third = studyChildNodeId(second, "2g2f");
const layerA = studyLayerId(spec(1000));
const layerB = studyLayerId(spec(2000));

/** サーバー側の文書（他の端末の変更を含む）。 */
const server = applyStudyOps(base, [
    { type: "setComment", nodeId: first, value: "サーバーのコメント" },
    { type: "addMoves", parentId: first, moves: ["4c4d"] },
    { type: "ensureLayer", spec: spec(1000), display: { label: "A" } },
    { type: "putAnalysis", layerId: layerA, nodeId: first, result: result(10) },
    { type: "putAnalysis", layerId: layerA, nodeId: third, result: result(10) },
]);

describe("diffStudyDocuments", () => {
    it("差分を適用すると、ツリー・表題・レイヤーがローカルの文書と同じになる", () => {
        const local = applyStudyOps(server, [
            // 本譜の 3 手目より先を消し、分岐を足して本譜に昇格する。
            { type: "deleteSubtree", nodeId: third },
            { type: "addMoves", parentId: first, moves: ["8c8d", "2g2f"] },
            {
                type: "reorderChildren",
                parentId: first,
                value: [studyChildNodeId(first, "8c8d"), second, studyChildNodeId(first, "4c4d")],
            },
            { type: "setComment", nodeId: first, value: "ローカルで書き直したコメント" },
            { type: "setComment", nodeId: second, value: "" },
            { type: "setBookmark", nodeId: second, value: true },
            {
                type: "setSource",
                nodeId: second,
                value: { kind: "csa", score: { kind: "cp", value: 30 }, pv: null, elapsedMs: 1000 },
            },
            { type: "setTitle", value: "新しい表題" },
            { type: "deleteLayer", layerId: layerA },
            { type: "ensureLayer", spec: spec(2000), display: { label: "B" } },
            { type: "putAnalysis", layerId: layerB, nodeId: rootId, result: result(12) },
            { type: "putAnalysis", layerId: layerB, nodeId: second, result: result(14) },
        ]);

        const ops = diffStudyDocuments(server, local);
        const applied = applyStudyOps(server, ops);
        expect(applied.tree).toEqual(local.tree);
        expect(applied.title).toBe(local.title);
        expect(applied.layers).toEqual(local.layers);
        // 適用後は差分が無い。
        expect(diffStudyDocuments(applied, local)).toEqual([]);
        expect(ops.filter((op) => op.type === "deleteSubtree")).toEqual([
            { type: "deleteSubtree", nodeId: third },
        ]);
    });

    it("同じ文書なら差分は無い。変えた項目だけが操作になる", () => {
        expect(diffStudyDocuments(server, server)).toEqual([]);
        const local = applyStudyOps(server, [
            { type: "setComment", nodeId: rootId, value: "ルートのコメント" },
            { type: "putAnalysis", layerId: layerA, nodeId: first, result: result(20) },
        ]);
        expect(diffStudyDocuments(server, local)).toEqual<StudyOp[]>([
            { type: "setComment", nodeId: rootId, value: "ルートのコメント" },
            { type: "putAnalysis", layerId: layerA, nodeId: first, result: result(20) },
        ]);
    });

    it("サーバーの方が優先度の高い結果は、適用しても変わらない（ローカルの低い結果で上書きしない）", () => {
        const local = applyStudyOps(base, [
            { type: "ensureLayer", spec: spec(1000), display: { label: "A" } },
            { type: "putAnalysis", layerId: layerA, nodeId: first, result: result(5) },
        ]);
        const ops = diffStudyDocuments(server, local);
        const applied = applyStudyOps(server, ops);
        expect(applied.layers[0].results[first]).toEqual(result(10));
    });

    it("空の文書との差分は、文書の全体を再現する操作になる", () => {
        const empty = createStudyDocumentFromMoves({
            id: base.id,
            title: base.title,
            origin: base.origin,
            startSfen: "startpos",
            moves: [],
        });
        expect(applyStudyOps(empty, diffStudyDocuments(empty, server))).toEqual(server);
    });
});

describe("mergeStudyComments", () => {
    it("片方が空なら空でない方、同じなら 1 つ、違えば既存側の後ろに改行 2 つでつなぐ", () => {
        expect(mergeStudyComments("", "匿名")).toBe("匿名");
        expect(mergeStudyComments("既存", "")).toBe("既存");
        expect(mergeStudyComments("同じ", "同じ")).toBe("同じ");
        expect(mergeStudyComments("既存", "匿名")).toBe("既存\n\n匿名");
        // 取り込みのやり直しでは、もう一度つながない。
        expect(mergeStudyComments("既存\n\n匿名", "匿名")).toBe("既存\n\n匿名");
    });

    it("つなぐと上限（4 KiB）を超えるなら、既存側を残す", () => {
        const existing = "あ".repeat(1300);
        expect(mergeStudyComments(existing, "い".repeat(100))).toBe(existing);
        expect(mergeStudyComments(existing, "い".repeat(60))).toBe(
            `${existing}\n\n${"い".repeat(60)}`,
        );
    });

    it("studyDocumentToOps は、統合先を渡すとコメントをつないだ値にする", () => {
        const local = applyStudyOps(base, [
            { type: "setComment", nodeId: first, value: "匿名のコメント" },
            { type: "setComment", nodeId: second, value: "匿名だけ" },
        ]);
        const merged = applyStudyOps(server, studyDocumentToOps(local, { mergeInto: server }));
        expect(merged.tree.nodes[first].comment).toBe("サーバーのコメント\n\n匿名のコメント");
        expect(merged.tree.nodes[second].comment).toBe("匿名だけ");
        // 統合先を渡さなければ、これまでどおり手元のコメントで置き換える。
        const replaced = applyStudyOps(server, studyDocumentToOps(local));
        expect(replaced.tree.nodes[first].comment).toBe("匿名のコメント");
    });
});
