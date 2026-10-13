import { applyMoveWithState, createInitialPositionState, type PositionState } from "../game/board";
import { type BookData, positionToBookKey } from "./book";
import { applyUsiMoveStrict } from "./usi-move";
import { yieldTask } from "./yieldTask";

export const BOOK_TREE_AUTO_LIMIT = 20_000;
export interface BookTreeNode {
    id: number;
    key: string;
    position: PositionState;
    parent: number | null;
    move?: string;
    children: number[];
    status: "pending" | "ready" | "error" | "merge";
    mergeTo?: number;
    error?: string;
}
export interface BookTree {
    nodes: BookTreeNode[];
    firstByKey: Map<string, number>;
    expanded: number;
    building: boolean;
    capped: boolean;
    complete: boolean;
    legalMovesFailed: boolean;
    unreachable: string[];
}

/** Each builder owns its state; cancellation discards any outstanding async result. */
export function createBookTreeBuilder({
    book,
    side,
    legalMoves,
    onChange = () => {},
    limit = BOOK_TREE_AUTO_LIMIT,
}: {
    book: BookData;
    side: PositionState["turn"];
    legalMoves: (sfen: string) => Promise<string[]>;
    onChange?: () => void;
    limit?: number;
}) {
    const position = createInitialPositionState();
    const key = positionToBookKey(position);
    const tree: BookTree = {
        nodes: [{ id: 0, key, position, parent: null, children: [], status: "pending" }],
        firstByKey: new Map([[key, 0]]),
        expanded: 0,
        building: true,
        capped: false,
        complete: false,
        legalMovesFailed: false,
        unreachable: [],
    };
    let cancelled = false;
    let started = false;
    let work = Promise.resolve();
    async function expand(source: BookTreeNode) {
        if (source.status !== "pending") return;
        const node = { ...source, children: [...source.children] };
        try {
            const own = node.position.turn === side;
            const moves = own
                ? (book.positions.get(node.key) ?? []).map((m) => m.usi)
                : await legalMoves(`${node.key} 1`);
            if (cancelled) return;
            for (const move of moves) {
                const result = own
                    ? applyUsiMoveStrict(node.position, move)
                    : applyMoveWithState(node.position, move);
                if (!result.ok) {
                    if (own) node.error = "指せない定跡の手があります";
                    continue;
                }
                const childKey = positionToBookKey(result.next);
                if (!own && !book.positions.has(childKey)) continue;
                const mergeTo = tree.firstByKey.get(childKey);
                const id = tree.nodes.length;
                tree.nodes.push({
                    id,
                    key: childKey,
                    position: result.next,
                    parent: node.id,
                    move,
                    children: [],
                    status: mergeTo === undefined ? "pending" : "merge",
                    mergeTo,
                });
                node.children.push(id);
                if (mergeTo === undefined) tree.firstByKey.set(childKey, id);
            }
            node.status = node.error ? "error" : "ready";
        } catch {
            if (cancelled) return;
            node.status = "error";
            node.error = "合法手を取得できませんでした";
            tree.legalMovesFailed = true;
        }
        tree.nodes[node.id] = node;
        tree.expanded++;
    }
    async function run(root: number, automatic: boolean) {
        if (cancelled) return;
        tree.building = true;
        onChange();
        await yieldTask();
        if (cancelled) return;
        let sliceStart = performance.now();
        const queue = [root];
        let head = 0;
        let count = 0;
        while (head < queue.length && count < limit && !cancelled) {
            const node = tree.nodes[queue[head++]];
            if (node.status === "pending") {
                if (node.position.turn !== side) onChange();
                await expand(node);
                if (cancelled) return;
                count++;
            }
            if (cancelled) return;
            queue.push(...tree.nodes[node.id].children);
            if (performance.now() - sliceStart >= 12) {
                onChange();
                await yieldTask();
                if (cancelled) return;
                sliceStart = performance.now();
            }
        }
        if (cancelled) return;
        if (automatic)
            tree.capped = queue.slice(head).some((id) => tree.nodes[id].status === "pending");
        if (automatic && !tree.capped && !tree.legalMovesFailed) {
            sliceStart = performance.now();
            for (const entry of book.positions.keys()) {
                if (
                    entry.split(" ")[1] === (side === "sente" ? "b" : "w") &&
                    !tree.firstByKey.has(entry)
                )
                    tree.unreachable.push(entry);
                if (performance.now() - sliceStart >= 12) {
                    await yieldTask();
                    if (cancelled) return;
                    sliceStart = performance.now();
                }
            }
            tree.complete = true;
        }
        tree.building = false;
        onChange();
    }
    return {
        tree,
        start() {
            if (!started) {
                started = true;
                work = run(0, true);
            }
            return work;
        },
        expandFrom(id: number) {
            work = work.then(() => run(id, false));
            return work;
        },
        cancel() {
            cancelled = true;
        },
    };
}

export function bookTreePath(tree: BookTree, id: number): BookTreeNode[] {
    const path: BookTreeNode[] = [];
    let node: BookTreeNode | undefined = tree.nodes[id];
    if (node?.mergeTo !== undefined) node = tree.nodes[node.mergeTo];
    while (node) {
        path.push(node);
        node = node.parent === null ? undefined : tree.nodes[node.parent];
    }
    return path.reverse();
}

/** Compress a single-child chain without recursion, including its terminal fork or leaf. */
export function bookTreeRow(tree: BookTree, start: number): BookTreeNode[] {
    const row = [tree.nodes[start]];
    let node = row[0];
    while (node.children.length === 1) {
        node = tree.nodes[node.children[0]];
        row.push(node);
    }
    return row;
}
