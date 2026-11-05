import { applyMoveWithState, createInitialPositionState, type PositionState } from "../game/board";
import { type BookData, positionToBookKey } from "./book";
import { applyUsiMoveStrict } from "./usi-move";
import { yieldTask } from "./yieldTask";

const BOOK_TREE_AUTO_LIMIT = 20_000;
export interface BookTreeNode {
    id: number;
    key: string;
    position: PositionState;
    parent: number | null;
    move?: string;
    /** 親の局面の定跡に登録された手か（false は、登録は無いが定跡の局面へつながる合法手） */
    inBook?: boolean;
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
    legalMovesFailed: boolean;
}

/**
 * 平手から、定跡の手と、定跡の局面へつながる合法手をたどる木を組み立てる。先手・後手は分けない
 * （定跡のファイルは両方の手番の局面を持ち、どちらの手番でも登録の無い手で定跡へ戻ることがあるため）。
 * builder ごとに状態を持ち、中止したあとに届いた非同期の結果は捨てる。
 */
export function createBookTreeBuilder({
    book,
    legalMoves,
    onChange = () => {},
    limit = BOOK_TREE_AUTO_LIMIT,
}: {
    book: BookData;
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
        legalMovesFailed: false,
    };
    let cancelled = false;
    let started = false;
    let work = Promise.resolve();
    async function expand(source: BookTreeNode) {
        if (source.status !== "pending") return;
        const node = { ...source, children: [...source.children] };
        const registered = (book.positions.get(node.key) ?? []).map((m) => m.usi);
        let legal: string[] = [];
        try {
            legal = await legalMoves(`${node.key} 1`);
        } catch {
            if (cancelled) return;
            node.error = "合法手を取得できませんでした";
            tree.legalMovesFailed = true;
        }
        if (cancelled) return;
        const seen = new Set<string>();
        for (const move of [...registered, ...legal]) {
            if (seen.has(move)) continue;
            seen.add(move);
            const inBook = seen.size <= registered.length;
            const result = inBook
                ? applyUsiMoveStrict(node.position, move)
                : applyMoveWithState(node.position, move);
            if (!result.ok) {
                if (inBook) node.error ??= "指せない定跡の手があります";
                continue;
            }
            const childKey = positionToBookKey(result.next);
            if (!inBook && !book.positions.has(childKey)) continue;
            const mergeTo = tree.firstByKey.get(childKey);
            const id = tree.nodes.length;
            tree.nodes.push({
                id,
                key: childKey,
                position: result.next,
                parent: node.id,
                move,
                inBook,
                children: [],
                status: mergeTo === undefined ? "pending" : "merge",
                mergeTo,
            });
            node.children.push(id);
            if (mergeTo === undefined) tree.firstByKey.set(childKey, id);
        }
        node.status = node.error ? "error" : "ready";
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
