import { applyStudyOps } from "@shogi/app-core";
import { describe, expect, it } from "vitest";
import { cp, createTestStudy, TEST_LAYER_ID } from "./study-test-support";
import { studyGraphFromKifuTree } from "./studyTreeGraph";
import { buildStudyViewTree } from "./studyView";

function studyWithBranch() {
    const { doc, ids } = createTestStudy([null, cp(50), cp(-30), null, null]);
    const branched = applyStudyOps(doc, [
        { type: "addMoves", parentId: ids[0], moves: ["5g5f", "3c3d"] },
    ]);
    return { tree: buildStudyViewTree(branched, TEST_LAYER_ID).tree, ids };
}

describe("studyGraphFromKifuTree", () => {
    it("子の並び（先頭が本譜）を保ち、子の番号を親より大きく振る", () => {
        const { tree, ids } = studyWithBranch();
        const graph = studyGraphFromKifuTree(tree);
        expect(graph.tree.nodes).toHaveLength(7);
        const root = graph.tree.nodes[0];
        expect(graph.ids[0]).toBe(ids[0]);
        expect(root.children.map((child) => graph.tree.nodes[child].move)).toEqual([
            "7g7f",
            "5g5f",
        ]);
        for (const node of graph.tree.nodes) {
            expect(graph.indexOf.get(graph.ids[node.id])).toBe(node.id);
            for (const child of node.children) expect(child).toBeGreaterThan(node.id);
        }
        // 図は position.ply を次に指す手の手数として読む。
        expect(root.position.ply).toBe(1);
        expect(graph.tree.nodes[graph.indexOf.get(ids[2]) ?? -1].position.ply).toBe(3);
    });

    it("評価値は手順の一覧と同じ表記で出し、符号で色を決める", () => {
        const { tree, ids } = studyWithBranch();
        const graph = studyGraphFromKifuTree(tree);
        const at = (id: string) => graph.tree.nodes[graph.indexOf.get(id) ?? -1];
        expect(graph.valueFor(at(ids[1]))).toEqual({ value: 1, text: "+50" });
        expect(graph.valueFor(at(ids[2]))).toEqual({ value: -1, text: "-30" });
        expect(graph.valueFor(at(ids[3]))).toBeUndefined();
    });
});
