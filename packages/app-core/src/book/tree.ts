import { applyMoveWithState, createInitialPositionState, type PositionState } from "../game/board";
import { parseStudySfen } from "../study/sfen";
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
    /**
     * 平手が定跡に無いときの、開始局面の候補（定跡の中で、他の局面から定跡の手で来ていない局面）。
     * 平手から始めるときは空。
     */
    roots: string[];
    /** 自動で展開する局面数の見込み（定跡の局面数と自動で展開する上限の小さい方）。進み具合の分母。 */
    goal: number;
}

/** 定跡の局面を、手数（定跡に書かれていれば）付きで局面にする。 */
function bookPosition(book: BookData, key: string): PositionState {
    const position = parseStudySfen(key);
    return { ...position, ply: book.plies?.get(key) ?? position.ply };
}

/**
 * 定跡の中で、他の局面から定跡の手で来ていない局面（開始局面の候補）を、手数の小さい順・ファイルの順に返す。
 * 大きな定跡でも画面を止めないよう、少しずつ進める。
 */
async function findBookRoots(book: BookData, cancelled: () => boolean): Promise<string[]> {
    const reached = new Set<string>();
    let sliceStart = performance.now();
    for (const [key, moves] of book.positions) {
        let position: PositionState;
        try {
            position = parseStudySfen(key);
        } catch {
            continue;
        }
        for (const move of moves) {
            const result = applyUsiMoveStrict(position, move.usi);
            if (result.ok) reached.add(positionToBookKey(result.next));
        }
        if (performance.now() - sliceStart >= 12) {
            await yieldTask();
            if (cancelled()) return [];
            sliceStart = performance.now();
        }
    }
    const keys = [...book.positions.keys()];
    const ply = (key: string) => book.plies?.get(key) ?? Number.POSITIVE_INFINITY;
    const ordered = (list: string[]) =>
        list
            .map((key, order) => ({ key, order }))
            .sort((a, b) => ply(a.key) - ply(b.key) || a.order - b.order)
            .map(({ key }) => key);
    const roots = ordered(keys.filter((key) => !reached.has(key)));
    // 全部の局面が他の局面から来ている（手順が輪になっている）ときは、手数の最も小さい局面から始める。
    return roots.length > 0 ? roots : ordered(keys).slice(0, 1);
}

/**
 * 平手（平手が定跡に無いときは、定跡の中の開始局面。`rootKey` で選べる）から、定跡の手と、定跡の局面へつながる合法手をたどる木を組み立てる。先手・後手は分けない
 * （定跡のファイルは両方の手番の局面を持ち、どちらの手番でも登録の無い手で定跡へ戻ることがあるため）。
 * builder ごとに状態を持ち、中止したあとに届いた非同期の結果は捨てる。
 */
export function createBookTreeBuilder({
    book,
    legalMoves,
    onChange = () => {},
    limit = BOOK_TREE_AUTO_LIMIT,
    rootKey,
}: {
    book: BookData;
    legalMoves: (sfen: string) => Promise<string[]>;
    onChange?: () => void;
    limit?: number;
    /** 平手が定跡に無いときに始める局面（`roots` の 1 つ）。省くと最初の候補。 */
    rootKey?: string;
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
        roots: [],
        goal: Math.min(book.positions.size, limit),
    };
    /** 平手からも、平手の次の局面からも定跡に入れなければ、開始局面を定跡の中の局面に差し替える。 */
    async function chooseRoot() {
        if (book.positions.has(key)) return;
        // 合法手を取れなければ、平手からは定跡の登録の手でしか進めないので、平手の次の局面は調べない。
        let firstMoves: string[] = [];
        try {
            firstMoves = await legalMoves(`${key} 1`);
        } catch {
            firstMoves = [];
        }
        if (cancelled) return;
        for (const move of firstMoves) {
            const result = applyMoveWithState(position, move);
            if (result.ok && book.positions.has(positionToBookKey(result.next))) return;
        }
        const roots = await findBookRoots(book, () => cancelled);
        if (cancelled || roots.length === 0) return;
        tree.roots = roots;
        const start = rootKey !== undefined && roots.includes(rootKey) ? rootKey : roots[0];
        tree.nodes[0] = { ...tree.nodes[0], key: start, position: bookPosition(book, start) };
        tree.firstByKey = new Map([[start, 0]]);
    }
    let cancelled = false;
    let started = false;
    let work = Promise.resolve();
    async function expand(source: BookTreeNode) {
        if (source.status !== "pending") return;
        const node = { ...source, children: [...source.children] };
        // 定跡の値は手番側から見た値なので、大きい順に並べると手番側の良い順になる（同じ値はファイルの順）。
        const registered = [...(book.positions.get(node.key) ?? [])]
            .sort((a, b) => b.value - a.value)
            .map((m) => m.usi);
        let legal: string[] = [];
        try {
            legal = await legalMoves(`${node.key} 1`);
        } catch {
            if (cancelled) return;
            node.error = "合法手を取得できませんでした";
            tree.legalMovesFailed = true;
        }
        if (cancelled) return;
        const inBookMoves = new Set(registered);
        const seen = new Set<string>();
        for (const move of [...registered, ...legal]) {
            if (seen.has(move)) continue;
            seen.add(move);
            const inBook = inBookMoves.has(move);
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
                work = chooseRoot().then(() => run(0, true));
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
