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
        // 大きさの変わらない結果の置き換えが先、長くなるコメントが後。
        expect(diffStudyDocuments(server, local)).toEqual<StudyOp[]>([
            { type: "putAnalysis", layerId: layerA, nodeId: first, result: result(20) },
            { type: "setComment", nodeId: rootId, value: "ルートのコメント" },
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

describe("diffStudyDocuments: 操作の順序（小さくする操作が先）", () => {
    const bytes = (value: unknown): number =>
        new TextEncoder().encode(JSON.stringify(value)).length;

    /** 操作を 1 つずつ適用し、途中のツリーとレイヤーの結果の大きさ・件数の最大値を返す。 */
    const peaks = (from: StudyDocument, ops: StudyOp[]) => {
        let current = from;
        let tree = bytes(current.tree);
        let nodes = Object.keys(current.tree.nodes).length;
        let layers = current.layers.length;
        let results = Math.max(0, ...current.layers.map((layer) => bytes(layer.results)));
        for (const op of ops) {
            current = applyStudyOps(current, [op]);
            tree = Math.max(tree, bytes(current.tree));
            nodes = Math.max(nodes, Object.keys(current.tree.nodes).length);
            layers = Math.max(layers, current.layers.length);
            results = Math.max(results, ...current.layers.map((layer) => bytes(layer.results)));
        }
        return { tree, nodes, layers, results, final: current };
    };

    const sizes = (doc: StudyDocument) => ({
        tree: bytes(doc.tree),
        nodes: Object.keys(doc.tree.nodes).length,
        layers: doc.layers.length,
        results: Math.max(0, ...doc.layers.map((layer) => bytes(layer.results))),
    });

    /** 途中のどの時点も、差分の両端（どちらも上限内のはず）の大きい方を超えない。 */
    const expectNoOvershoot = (from: StudyDocument, to: StudyDocument): void => {
        const ops = diffStudyDocuments(from, to);
        const peak = peaks(from, ops);
        expect(peak.final.tree).toEqual(to.tree);
        const a = sizes(from);
        const b = sizes(to);
        expect(peak.tree).toBeLessThanOrEqual(Math.max(a.tree, b.tree));
        expect(peak.nodes).toBeLessThanOrEqual(Math.max(a.nodes, b.nodes));
        expect(peak.layers).toBeLessThanOrEqual(Math.max(a.layers, b.layers));
        expect(peak.results).toBeLessThanOrEqual(Math.max(a.results, b.results));
    };

    const shuffle = ["5i5h", "5a5b", "5h5i", "5b5a"];
    const line = (length: number, firstMove: string): string[] => [
        firstMove,
        ...Array.from({ length: length - 1 }, (_, i) => shuffle[i % 4]),
    ];

    it("反例: 大きなコメントを消してノードを足す差分で、途中のツリーが元より大きくならない", () => {
        // サーバー側: 190 ノードに 4 KiB 弱のコメント（ツリーは上限の 768 KiB に近い）。
        const withLine = applyStudyOps(base, [
            { type: "addMoves", parentId: rootId, moves: line(190, "4i4h") },
        ]);
        const commented = Object.keys(withLine.tree.nodes).slice(0, 190);
        const from = applyStudyOps(
            withLine,
            commented.map(
                (nodeId): StudyOp => ({
                    type: "setComment",
                    nodeId,
                    value: "x".repeat(4000),
                }),
            ),
        );
        // ローカル側: コメントを全部消し、別の枝を 600 ノード足した（最終的にはずっと小さい）。
        const to = applyStudyOps(from, [
            ...commented.map((nodeId): StudyOp => ({ type: "setComment", nodeId, value: "" })),
            { type: "addMoves", parentId: rootId, moves: line(600, "6i6h") },
        ]);
        expect(bytes(from.tree)).toBeGreaterThan(700 * 1024);
        expect(bytes(to.tree)).toBeLessThan(200 * 1024);
        const ops = diffStudyDocuments(from, to);
        // コメントを消す操作が、ノードを足す操作より前に並ぶ。
        const lastShrink = ops.map((op) => op.type).lastIndexOf("setComment");
        const firstGrow = ops.findIndex((op) => op.type === "addMoves");
        expect(lastShrink).toBeLessThan(firstGrow);
        expectNoOvershoot(from, to);
    });

    it("性質: 乱数で作った 2 つの文書のどの組でも、途中で両端より大きくならない", () => {
        // 再現できるよう、種を固定した擬似乱数を使う。
        let seed = 20261012;
        const random = (max: number): number => {
            seed = (seed * 1103515245 + 12345) & 0x7fffffff;
            return seed % max;
        };
        const firstMoves = ["7g7f", "2g2f", "5g5f", "4i4h", "6i6h", "3i3h"];
        const randomDoc = (): StudyDocument => {
            let doc = createStudyDocumentFromMoves({
                id: base.id,
                title: "題".repeat(1 + random(20)),
                origin: base.origin,
                startSfen: "startpos",
                moves: [],
            });
            for (const move of firstMoves) {
                if (random(3) === 0) continue;
                doc = applyStudyOps(doc, [
                    {
                        type: "addMoves",
                        parentId: rootId,
                        moves: [move, ...shuffle.slice(0, random(4))],
                    },
                ]);
            }
            const ids = Object.keys(doc.tree.nodes);
            const ops: StudyOp[] = [];
            for (const nodeId of ids) {
                if (random(2) === 0) {
                    ops.push({ type: "setComment", nodeId, value: "あ".repeat(random(40)) });
                }
                if (random(4) === 0) ops.push({ type: "setBookmark", nodeId, value: true });
                if (random(4) === 0) {
                    ops.push({
                        type: "setSource",
                        nodeId,
                        value: {
                            kind: "csa",
                            score: random(2) === 0 ? null : { kind: "cp", value: random(999) },
                            pv: random(2) === 0 ? null : shuffle.slice(0, 1 + random(3)),
                            elapsedMs: random(5000),
                        },
                    });
                }
            }
            for (const timeMs of [1000, 2000, 3000]) {
                if (random(2) === 0) continue;
                ops.push({ type: "ensureLayer", spec: spec(timeMs), display: { label: "L" } });
                for (const nodeId of ids) {
                    if (random(2) === 0) continue;
                    ops.push({
                        type: "putAnalysis",
                        layerId: studyLayerId(spec(timeMs)),
                        nodeId,
                        result: {
                            ...result(1 + random(30)),
                            candidates: [
                                {
                                    rank: 1,
                                    score: { kind: "cp", value: random(2000) },
                                    depth: 10,
                                    seldepth: null,
                                    pv: shuffle.slice(0, random(4)),
                                },
                            ],
                        },
                    });
                }
            }
            const children = doc.tree.nodes[rootId].children;
            if (children.length > 1 && random(2) === 0) {
                ops.push({
                    type: "reorderChildren",
                    parentId: rootId,
                    value: [...children].reverse(),
                });
            }
            return applyStudyOps(doc, ops);
        };
        /** 文書に、利用者の編集に当たる操作（削除・短縮・追加・置き換え）を乱数で加える。 */
        const edit = (doc: StudyDocument): StudyDocument => {
            const ops: StudyOp[] = [];
            const children = doc.tree.nodes[rootId].children;
            if (children.length > 1 && random(2) === 0) {
                ops.push({ type: "deleteSubtree", nodeId: children[random(children.length)] });
            }
            for (const layer of doc.layers) {
                if (random(4) === 0) ops.push({ type: "deleteLayer", layerId: layer.id });
            }
            for (const nodeId of Object.keys(doc.tree.nodes)) {
                if (random(2) === 0) {
                    ops.push({ type: "setComment", nodeId, value: "い".repeat(random(40)) });
                }
                if (random(3) === 0)
                    ops.push({ type: "setBookmark", nodeId, value: random(2) === 0 });
                if (random(4) === 0) ops.push({ type: "setSource", nodeId, value: null });
                for (const layer of doc.layers) {
                    if (random(3) !== 0) continue;
                    // 元より優先度の高い（深い）結果で置き換える。読み筋は長くも短くもなる。
                    ops.push({
                        type: "putAnalysis",
                        layerId: layer.id,
                        nodeId,
                        result: {
                            ...result(40 + random(10)),
                            candidates: [
                                {
                                    rank: 1,
                                    score: { kind: "cp", value: random(2000) },
                                    depth: 40,
                                    seldepth: null,
                                    pv: shuffle.slice(0, random(4)),
                                },
                            ],
                        },
                    });
                }
            }
            ops.push({ type: "addMoves", parentId: rootId, moves: ["9g9f", ...shuffle] });
            ops.push({ type: "ensureLayer", spec: spec(9000), display: { label: "新" } });
            ops.push({ type: "setTitle", value: "題".repeat(1 + random(20)) });
            return applyStudyOps(doc, ops);
        };
        for (let i = 0; i < 60; i++) {
            const from = randomDoc();
            const to = edit(from);
            expectNoOvershoot(from, to);
            const applied = applyStudyOps(from, diffStudyDocuments(from, to));
            expect(applied.title).toBe(to.title);
            expect(applied.layers).toEqual(to.layers);
            expect(diffStudyDocuments(applied, to)).toEqual([]);
        }
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
        // やり直しまでのあいだに統合先のコメントへ追記があっても、二重にならない。
        expect(mergeStudyComments("既存\n\n匿名\n追記", "匿名")).toBe("既存\n\n匿名\n追記");
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
