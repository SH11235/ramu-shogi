import {
    type BookData,
    type BookTree,
    type BookTreeNode,
    createInitialPositionState,
} from "@shogi/app-core";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BookTreeJump } from "./BookTreeJump";

const position = createInitialPositionState();
const book: BookData = {
    positions: new Map(),
    warnings: [],
    stats: { positions: 0, moves: 0, sente: 0, gote: 0, branches: 0 },
};
/** 開始局面の下に、それぞれ 2 手に分かれる手を forks 個並べた木。 */
function forkedTree(forks: number): BookTree {
    const nodes: BookTreeNode[] = [
        { id: 0, key: "0", position, parent: null, children: [], status: "ready" },
    ];
    for (let index = 0; index < forks; index++) {
        const id = nodes.length;
        nodes[0].children.push(id);
        nodes.push({
            id,
            key: String(id),
            position,
            parent: 0,
            move: "7g7f",
            children: [id + 1, id + 2],
            status: "ready",
        });
        for (const leaf of [id + 1, id + 2])
            nodes.push({
                id: leaf,
                key: String(leaf),
                position,
                parent: id,
                move: "7g7f",
                children: [],
                status: "ready",
            });
    }
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

afterEach(cleanup);

describe("BookTreeJump", () => {
    it("一覧は 200 件ずつ出し、続きを足して後ろの局面へも移れる", () => {
        const tree = forkedTree(250);
        const onSelect = vi.fn();
        render(
            <BookTreeJump
                tree={tree}
                book={book}
                counts={new Int32Array(tree.nodes.length)}
                bookmarks={[]}
                onSelect={onSelect}
                onClose={() => {}}
            />,
        );
        const list = () =>
            within(screen.getByRole("list", { name: "移る局面" })).getAllByRole("button");
        expect(list()).toHaveLength(200);
        fireEvent.click(screen.getByRole("button", { name: /続きを出す（ほか 51 件）/ }));
        expect(list()).toHaveLength(251);
        expect(screen.queryByRole("button", { name: /続きを出す/ })).toBeNull();
        fireEvent.click(list()[250]);
        expect(onSelect).toHaveBeenCalledWith(tree.nodes[0].children[249]);
    });
});
