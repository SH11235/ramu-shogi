import { type BookTree, type BookTreeNode, createInitialPositionState } from "@shogi/app-core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { BookTreeGraph, layoutBookGraph } from "./BookTreeGraph";

const position = createInitialPositionState();
/** 親の番号の並びから木を作る（`parents[i]` が i 番の手の親）。 */
function treeOf(parents: (number | null)[]): BookTree {
    const nodes: BookTreeNode[] = parents.map((parent, id) => ({
        id,
        key: String(id),
        position,
        parent,
        children: [],
        status: "ready",
    }));
    for (const node of nodes) if (node.parent !== null) nodes[node.parent].children.push(node.id);
    return {
        nodes,
        firstByKey: new Map(),
        expanded: nodes.length,
        building: false,
        capped: false,
        legalMovesFailed: false,
        roots: [],
        goal: 0,
    };
}
const rows = (tree: BookTree, open: (node: BookTreeNode) => boolean) =>
    Object.fromEntries(
        layoutBookGraph(tree, open).items.map(({ id, col, row }) => [id, [col, row]]),
    );

describe("layoutBookGraph", () => {
    it("最初の手は親と同じ行、分かれた手は、深い列の枝に押されずに親のすぐ下の行に置く", () => {
        // 0 → 1 → 2 → 3 / 2 → 4 / 2 → 5、0 → 6
        const tree = treeOf([null, 0, 1, 2, 2, 2, 0]);
        expect(rows(tree, () => true)).toEqual({
            0: [0, 0],
            1: [1, 0],
            2: [2, 0],
            3: [3, 0],
            4: [3, 1],
            5: [3, 2],
            6: [1, 1],
        });
    });
    it("先のある手は、同じ列の前の手から伸びる線と重ならない行に置く", () => {
        // 0 → 1 → {2, 3, 4}、0 → 5 → 6
        const tree = treeOf([null, 0, 1, 1, 1, 0, 5]);
        const placed = rows(tree, () => true);
        expect(placed[5]).toEqual([1, 3]);
        expect(placed[6]).toEqual([2, 3]);
    });
    it("閉じた手の先は置かない", () => {
        const tree = treeOf([null, 0, 1, 0]);
        expect(Object.keys(rows(tree, (node) => node.id !== 1))).toEqual(["0", "1", "3"]);
    });
});

describe("BookTreeGraph", () => {
    afterEach(cleanup);
    const book = {
        positions: new Map(),
        warnings: [],
        stats: { positions: 0, moves: 0, sente: 0, gote: 0, branches: 0 },
    };
    // 0 → 1 → 2 → … → 42（1 の先に 41 手）、0 → 43
    const parents = [null, 0, ...Array.from({ length: 41 }, (_, index) => index + 1), 0];
    const draw = (selected: number) =>
        render(
            createElement(BookTreeGraph, {
                tree: treeOf(parents),
                book,
                selected,
                onSelect: () => {},
            }),
        );
    it("後ろに兄弟のある大きな枝は初めからたたみ、先の手の数を添える", () => {
        const { container } = draw(0);
        expect(screen.getByRole("button", { name: /の先を開く（41 手）/ }).textContent).toBe("+41");
        expect(container.querySelector('[data-node="2"]')).toBeNull();
        expect(container.querySelector('[data-node="43"]')).not.toBeNull();
    });
    it("たたんだ枝の中の手を選ぶと、その枝を開く", () => {
        const { container } = draw(2);
        expect(container.querySelector('[data-node="2"]')).not.toBeNull();
        expect(container.querySelector('[data-node="3"]')).not.toBeNull();
    });
    it("たたんだ枝は開ける", () => {
        const { container } = draw(0);
        fireEvent.click(screen.getByRole("button", { name: /の先を開く（41 手）/ }));
        expect(container.querySelector('[data-node="2"]')).not.toBeNull();
    });
});
