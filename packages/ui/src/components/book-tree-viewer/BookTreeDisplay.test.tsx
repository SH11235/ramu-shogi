import {
    applyMoveWithState,
    createBookTreeBuilder,
    createInitialPositionState,
    parseBook,
    positionToBookKey,
} from "@shogi/app-core";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Profiler, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BookTreeDisplay } from "./BookTreeDisplay";

afterEach(cleanup);
beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
});
const initial = createInitialPositionState();
const key = positionToBookKey(initial);
const first = applyMoveWithState(initial, "7g7f").next;
const second = applyMoveWithState(first, "8c8d").next;

describe("BookTreeDisplay", () => {
    it("子が判明した最初のコミットから既定の枝を開く", () => {
        const { tree } = createBookTreeBuilder({
            book: parseBook(""),
            side: "sente",
            legalMoves: async () => [],
        });
        const commits: (string | null)[] = [];
        const props = {
            side: "sente" as const,
            selected: undefined,
            reveal: 0,
            onSelect: () => {},
            onExpand: () => {},
        };
        function display(current: typeof tree) {
            return (
                <Profiler
                    id="tree"
                    onRender={() => {
                        commits.push(
                            document
                                .querySelector("[aria-expanded]")
                                ?.getAttribute("aria-expanded") ?? null,
                        );
                    }}
                >
                    <BookTreeDisplay {...props} tree={current} revision={0} />
                </Profiler>
            );
        }
        const { rerender } = render(display(tree));
        const next = {
            ...tree,
            nodes: [
                { ...tree.nodes[0], status: "ready" as const, children: [1, 2] },
                ...[1, 2].map((id) => ({
                    ...tree.nodes[0],
                    id,
                    parent: 0,
                    move: "7g7f",
                    status: "ready" as const,
                    children: [],
                })),
            ],
        };
        commits.length = 0;
        rerender(display(next));
        expect(commits).toEqual(["true"]);
    });
    it("未展開の行に順次子が付いても既定の表示行数を予算内に保つ", () => {
        const { tree } = createBookTreeBuilder({
            book: parseBook(""),
            side: "sente",
            legalMoves: async () => [],
        });
        tree.nodes[0].status = "ready";
        for (let id = 1; id <= 30; id++) {
            tree.nodes.push({
                ...tree.nodes[0],
                id,
                parent: 0,
                move: "7g7f",
                children: [],
                status: "pending",
            });
            tree.nodes[0].children.push(id);
        }
        const props = {
            side: "sente" as const,
            selected: undefined,
            reveal: 0,
            onSelect: () => {},
            onExpand: () => {},
        };
        const { rerender } = render(<BookTreeDisplay {...props} tree={{ ...tree }} revision={0} />);
        expect(screen.getAllByRole("listitem")).toHaveLength(31);
        for (let parent = 1; parent <= 30; parent++) {
            const children = [];
            for (let child = 0; child < 30; child++) {
                const id = tree.nodes.length;
                tree.nodes.push({
                    ...tree.nodes[0],
                    id,
                    parent,
                    move: "8c8d",
                    children: [],
                    status: "ready",
                });
                children.push(id);
            }
            tree.nodes[parent] = { ...tree.nodes[parent], status: "ready", children };
            rerender(
                <BookTreeDisplay
                    {...props}
                    tree={{ ...tree, nodes: [...tree.nodes] }}
                    revision={parent}
                />,
            );
            expect(screen.getAllByRole("listitem").length).toBeLessThanOrEqual(200);
        }
        expect(screen.getAllByRole("listitem").length).toBeGreaterThan(150);
    });
    it("手で開いた圧縮行の途中を選んでも、その行の子を閉じない", () => {
        const { tree } = createBookTreeBuilder({
            book: parseBook(""),
            side: "sente",
            legalMoves: async () => [],
        });
        const parents = [null, 0, 0, 1, 3, 4, 4];
        tree.nodes = parents.map((parent, id) => ({
            ...tree.nodes[0],
            id,
            parent,
            move: id ? "7g7f" : undefined,
            children: parents.flatMap((p, child) => (p === id ? [child] : [])),
            status: "ready",
        }));
        function Harness() {
            const [selected, select] = useState<number>();
            return (
                <BookTreeDisplay
                    tree={tree}
                    revision={0}
                    side="sente"
                    selected={selected}
                    reveal={0}
                    onSelect={select}
                    onExpand={() => {}}
                />
            );
        }
        render(<Harness />);
        fireEvent.click(screen.getByRole("button", { name: "すべて閉じる" }));
        fireEvent.click(screen.getByRole("button", { name: "平手初期局面 の枝を開く" }));
        const row = screen.getAllByRole("listitem")[1];
        fireEvent.click(within(row).getByRole("button", { name: /枝を開く/ }));
        expect(screen.getAllByRole("listitem")).toHaveLength(5);
        const middle = row.querySelector<HTMLElement>('[data-node="3"]');
        expect(middle).toBeTruthy();
        if (middle) fireEvent.click(middle);
        expect(screen.getAllByRole("listitem")).toHaveLength(5);
        expect(
            within(row)
                .getByRole("button", { name: /枝を閉じる/ })
                .getAttribute("aria-expanded"),
        ).toBe("true");
    });

    it("前方の枝が増えても一度既定で開いた後方の行を保持する", () => {
        const { tree } = createBookTreeBuilder({
            book: parseBook(""),
            side: "sente",
            legalMoves: async () => [],
        });
        const parents = [null, 0, 0, 1, 1, 2, 2];
        tree.nodes = parents.map((parent, id) => ({
            ...tree.nodes[0],
            id,
            parent,
            move: id ? "7g7f" : undefined,
            children: parents.flatMap((p, child) => (p === id ? [child] : [])),
            status: "ready",
        }));
        const props = {
            revision: 0,
            side: "sente" as const,
            selected: undefined,
            reveal: 0,
            onSelect: () => {},
            onExpand: () => {},
        };
        const { rerender } = render(<BookTreeDisplay {...props} tree={tree} />);
        expect(screen.getAllByRole("listitem")).toHaveLength(7);
        const next = {
            ...tree,
            nodes: tree.nodes.map((node) => ({ ...node, children: [...node.children] })),
        };
        for (let index = 0; index < 194; index++) {
            const id = next.nodes.length;
            next.nodes.push({ ...next.nodes[3], id, children: [] });
            next.nodes[1].children.push(id);
        }
        rerender(<BookTreeDisplay {...props} tree={next} revision={1} />);
        expect(document.querySelector('[data-node="5"]')).toBeTruthy();
        expect(document.querySelector('[data-node="6"]')).toBeTruthy();
        const row = document.querySelector('[data-node="2"]')?.closest("li");
        expect(row).toBeTruthy();
        if (!row) return;
        fireEvent.click(within(row).getByRole("button", { name: /枝を閉じる/ }));
        rerender(<BookTreeDisplay {...props} tree={{ ...next }} revision={2} />);
        expect(document.querySelector('[data-node="5"]')).toBeNull();
    });

    it("選択ノードを木の枠内だけでスクロールする", () => {
        const { tree } = createBookTreeBuilder({
            book: parseBook(""),
            side: "sente",
            legalMoves: async () => [],
        });
        const bounds = vi
            .spyOn(Element.prototype, "getBoundingClientRect")
            .mockImplementation(function (this: Element) {
                return (
                    this.hasAttribute("data-node")
                        ? { top: 160, bottom: 180, left: 150, right: 170 }
                        : { top: 0, bottom: 100, left: 0, right: 100 }
                ) as DOMRect;
            });
        try {
            render(
                <BookTreeDisplay
                    tree={tree}
                    revision={0}
                    side="sente"
                    selected={0}
                    reveal={0}
                    onSelect={() => {}}
                    onExpand={() => {}}
                />,
            );
            const frame = screen.getByRole("list", { name: "木の行" }).parentElement;
            expect(frame?.scrollTop).toBeGreaterThanOrEqual(80);
            expect(frame?.scrollLeft).toBeGreaterThanOrEqual(70);
            expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
        } finally {
            bounds.mockRestore();
        }
    });
    it("初期表示は約 200 行までを開き、閉じた枝の行を描画しない", () => {
        const { tree } = createBookTreeBuilder({
            book: parseBook(""),
            side: "sente",
            legalMoves: async () => [],
        });
        tree.nodes[0].status = "ready";
        for (let parent = 0; parent < 250; parent++) {
            for (const move of ["7g7f", "2g2f", "6g6f"]) {
                const id = tree.nodes.length;
                tree.nodes.push({ ...tree.nodes[0], id, parent, move, children: [] });
                tree.nodes[parent].children.push(id);
            }
        }
        render(
            <BookTreeDisplay
                tree={tree}
                revision={0}
                side="sente"
                selected={undefined}
                reveal={0}
                onSelect={() => {}}
                onExpand={() => {}}
            />,
        );
        expect(screen.getAllByRole("listitem").length).toBeLessThanOrEqual(200);
        expect(screen.getAllByRole("listitem").length).toBeGreaterThan(100);
        fireEvent.click(screen.getByRole("button", { name: "すべて閉じる" }));
        expect(screen.getAllByRole("listitem")).toHaveLength(1);
    });
    it("未展開を開くとその先を組み立て、一本道を同じ行に並べる", async () => {
        let changed = () => {};
        const builder = createBookTreeBuilder({
            book: parseBook(`sfen ${key}\n7g7f\nsfen ${positionToBookKey(second)}\n2g2f`),
            side: "sente",
            legalMoves: async () => ["8c8d"],
            limit: 1,
            onChange: () => changed(),
        });
        await builder.start();
        function Harness() {
            const [revision, setRevision] = useState(0);
            const [tree, setTree] = useState(() => ({ ...builder.tree }));
            changed = () => {
                setTree({
                    ...builder.tree,
                    nodes: [...builder.tree.nodes],
                    firstByKey: new Map(builder.tree.firstByKey),
                    unreachable: [...builder.tree.unreachable],
                });
                setRevision((value) => value + 1);
            };
            return (
                <BookTreeDisplay
                    tree={tree}
                    revision={revision}
                    side="sente"
                    selected={0}
                    reveal={0}
                    onSelect={() => {}}
                    onExpand={(id) => void builder.expandFrom(id)}
                />
            );
        }
        render(<Harness />);
        expect(screen.getByText("未展開")).toBeTruthy();
        expect(screen.queryByRole("button", { name: /8四歩/ })).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "平手初期局面 の枝を開く" }));
        await screen.findByRole("button", { name: /8四歩/ });
        expect(screen.getAllByRole("listitem")).toHaveLength(1);
        const row = within(screen.getByRole("listitem"));
        expect(row.getByRole("button", { name: /1手目.*7六歩/ })).toBeTruthy();
        expect(row.getByRole("button", { name: /8四歩/ })).toBeTruthy();
    });
    it("行を開閉し、選択局面まで開く操作で隠れた選択を再表示する", async () => {
        const builder = createBookTreeBuilder({
            book: parseBook(`sfen ${key}\n7g7f\n2g2f`),
            side: "sente",
            legalMoves: async () => [],
        });
        await builder.start();
        render(
            <BookTreeDisplay
                tree={builder.tree}
                revision={0}
                side="sente"
                selected={1}
                reveal={0}
                onSelect={() => {}}
                onExpand={() => {}}
            />,
        );
        expect(screen.getAllByRole("listitem")).toHaveLength(3);
        expect(screen.getByText("◆ 定跡の分岐")).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: "平手初期局面 の枝を閉じる" }));
        expect(screen.getAllByRole("listitem")).toHaveLength(1);
        fireEvent.click(screen.getByRole("button", { name: "選択局面まで開く" }));
        await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(3));
        fireEvent.click(screen.getByRole("button", { name: "すべて閉じる" }));
        expect(screen.getAllByRole("listitem")).toHaveLength(1);
        expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    });
});
