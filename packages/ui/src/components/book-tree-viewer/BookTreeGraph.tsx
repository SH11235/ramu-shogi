import type { BookData, BookTree, BookTreeNode } from "@shogi/app-core";
import { cn } from "@shogi/design-system";
import { type ReactElement, useEffect, useEffectEvent, useRef, useState } from "react";
import { formatMoveSimple } from "../shogi-match/utils/kifFormat";

/** 木の 1 手の箱と、その並びの間隔（px）。手数が列、分かれた手が行になる。 */
const COL_WIDTH = 172;
const BOX_WIDTH = 132;
const ROW_HEIGHT = 34;
const BOX_HEIGHT = 26;
const HEADER_HEIGHT = 22;
const PAD = 10;
/** 選んだ手を枠の端から離しておく幅（送ったとき、次の手が枠の外に隠れないように）。 */
const SCROLL_MARGIN = 48;

/** 手の数がこれ以下の木は全部開いて見せる。 */
export const SMALL_TREE_NODES = 200;
/** 選んだ手から先の本線（各局面の最初の手）を開いて見せる手数。 */
const MAIN_LINE_PLIES = 60;

interface Placed {
    id: number;
    col: number;
    row: number;
}
interface BookGraphLayout {
    items: Placed[];
    byId: Map<number, Placed>;
    cols: number;
    rows: number;
}

/**
 * 手数を列、分かれた手を行に置く。最初の手は親と同じ行、2 番目からは前の兄弟の下に置き、
 * 列ごとに空いている一番上の行へ詰める（別の枝が深い列を使っていても、浅い列の分岐は近くに並ぶ）。
 * 先のある手は、同じ列の前の手から下へ伸びる線と重ならない行に置く。深い 1 本道でも呼び出しが
 * 積まれないよう、再帰を使わない。
 */
export function layoutBookGraph(
    tree: BookTree,
    isOpen: (node: BookTreeNode) => boolean,
): BookGraphLayout {
    const colNext: number[] = [];
    const lineEnd: number[] = [];
    const items: Placed[] = [];
    let cols = 0;
    let rows = 0;
    const place = (id: number, col: number, minRow: number) => {
        const node = tree.nodes[id];
        const open = node.children.length > 0 && isOpen(node);
        const row = Math.max(minRow, colNext[col] ?? 0, open ? (lineEnd[col] ?? 0) : 0);
        colNext[col] = row + 1;
        items.push({ id, col, row });
        cols = Math.max(cols, col + 1);
        rows = Math.max(rows, row + 1);
        return { id, col, row, open, next: 0, last: row };
    };
    const stack = [place(0, 0, 0)];
    while (stack.length) {
        const frame = stack[stack.length - 1];
        const children = frame.open ? tree.nodes[frame.id].children : [];
        if (frame.next >= children.length) {
            if (frame.open) lineEnd[frame.col] = Math.max(lineEnd[frame.col] ?? 0, frame.last + 1);
            stack.pop();
            continue;
        }
        const minRow = frame.next === 0 ? frame.row : frame.last + 1;
        const child = place(children[frame.next], frame.col + 1, minRow);
        frame.next++;
        frame.last = child.row;
        stack.push(child);
    }
    return { items, byId: new Map(items.map((item) => [item.id, item])), cols, rows };
}

/** `start` から最初の手をたどった本線のうち、先のある手。 */
export function mainLine(tree: BookTree, start: number): number[] {
    const line: number[] = [];
    let node = tree.nodes[start];
    while (node && node.children.length > 0 && line.length < MAIN_LINE_PLIES) {
        line.push(node.id);
        node = tree.nodes[node.children[0]];
    }
    return line;
}

/**
 * 開いておく手。小さい木は全部。大きい木は、選んだ手までの道筋と、選んだ手から先の本線だけを開き、
 * 途中で分かれた手は閉じた箱で並べる（分かれた手どうしが、間の枝に押されて縦に遠く離れないように）。
 */
export function focusOpenNodes(tree: BookTree, selected: number): Set<number> {
    if (tree.nodes.length <= SMALL_TREE_NODES)
        return new Set(
            tree.nodes.filter((node) => node.children.length > 0).map((node) => node.id),
        );
    const open = ancestorsOf(tree, selected);
    for (const id of mainLine(tree, selected)) open.add(id);
    return open;
}

function ancestorsOf(tree: BookTree, id: number | undefined): Set<number> {
    const path = new Set<number>();
    let node = id === undefined ? undefined : tree.nodes[id];
    while (node) {
        path.add(node.id);
        node = node.parent === null ? undefined : tree.nodes[node.parent];
    }
    return path;
}

function boxLeft(col: number) {
    return PAD + col * COL_WIDTH;
}
function boxTop(row: number) {
    return HEADER_HEIGHT + PAD + row * ROW_HEIGHT;
}
function edgePath(parent: Placed, child: Placed) {
    const x1 = boxLeft(parent.col) + BOX_WIDTH;
    const x2 = boxLeft(child.col);
    // 曲がり角は子の手の近くに置く（親の手の右に出す開閉の丸と重ならないように）。
    const xm = x2 - 10;
    const y1 = boxTop(parent.row) + BOX_HEIGHT / 2;
    const y2 = boxTop(child.row) + BOX_HEIGHT / 2;
    return y1 === y2 ? `M${x1} ${y1}H${x2}` : `M${x1} ${y1}H${xm}V${y2}H${x2}`;
}

export function moveLabel(tree: BookTree, node: BookTreeNode): string {
    if (node.parent === null || !node.move) return "開始局面";
    const parent = tree.nodes[node.parent];
    return formatMoveSimple(node.move, parent.position.turn, parent.position.board);
}

/** 親の局面の定跡に書かれた、この手の評価値（指した側から見た値）。 */
function bookValue(tree: BookTree, book: BookData, node: BookTreeNode): number | undefined {
    if (node.parent === null) return undefined;
    return book.positions.get(tree.nodes[node.parent].key)?.find((move) => move.usi === node.move)
        ?.value;
}

function GraphNodes({
    tree,
    book,
    layout,
    isOpen,
    onSelect,
    onToggle,
}: {
    tree: BookTree;
    book: BookData;
    layout: BookGraphLayout;
    isOpen: (node: BookTreeNode) => boolean;
    onSelect: (id: number) => void;
    onToggle: (id: number, open: boolean) => void;
}) {
    const solid: string[] = [];
    const dashed: string[] = [];
    for (const item of layout.items) {
        const node = tree.nodes[item.id];
        if (node.parent === null) continue;
        const parent = layout.byId.get(node.parent);
        if (parent) (node.inBook === false ? dashed : solid).push(edgePath(parent, item));
    }
    return (
        <>
            <svg
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 overflow-visible"
                width="100%"
                height="100%"
            >
                <path
                    d={solid.join("")}
                    className="fill-none stroke-wafuu-kincha"
                    strokeWidth={1.5}
                />
                <path
                    d={dashed.join("")}
                    className="fill-none stroke-wafuu-kincha"
                    strokeWidth={1.5}
                    strokeDasharray="4 3"
                />
            </svg>
            {layout.items.map(({ id, col, row }) => {
                const node = tree.nodes[id];
                const label = moveLabel(tree, node);
                const value = bookValue(tree, book, node);
                const mark = node.parent === null ? "" : label.slice(0, 1);
                const branch =
                    node.children.length > 1 || (node.children.length > 0 && !isOpen(node));
                const open = isOpen(node);
                const notes = [
                    node.inBook === false && "定跡に登録の無い手（定跡の局面へつながる）",
                    node.status === "merge" && "前に出た局面に合流",
                    node.status === "pending" && "この先は未展開（選ぶと読み込む）",
                    node.error,
                ].filter(Boolean);
                return (
                    <div key={id}>
                        <button
                            type="button"
                            data-node={id}
                            aria-label={[
                                label,
                                value === undefined ? "" : `評価値 ${value}`,
                                ...notes,
                            ]
                                .filter(Boolean)
                                .join("、")}
                            title={[label, ...notes].join("\n")}
                            onClick={() => onSelect(id)}
                            className={cn(
                                "absolute flex items-center gap-1 rounded border px-1.5 text-left text-xs text-wafuu-sumi transition-colors hover:border-wafuu-sumi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                node.inBook === false
                                    ? "border-dashed border-wafuu-kincha bg-background"
                                    : "border-wafuu-border bg-wafuu-washi-warm",
                            )}
                            style={{
                                left: boxLeft(col),
                                top: boxTop(row),
                                width: BOX_WIDTH,
                                height: BOX_HEIGHT,
                            }}
                        >
                            {mark && (
                                <span
                                    aria-hidden="true"
                                    className={mark === "☗" ? "text-wafuu-shu" : "text-wafuu-ai"}
                                >
                                    {mark}
                                </span>
                            )}
                            <span className="min-w-0 flex-1 truncate">
                                {node.parent === null ? label : label.slice(1)}
                            </span>
                            {node.status === "merge" && (
                                <span aria-hidden="true" className="text-muted-foreground">
                                    ↩
                                </span>
                            )}
                            {node.status === "pending" && (
                                <span aria-hidden="true" className="text-muted-foreground">
                                    …
                                </span>
                            )}
                            {node.error && (
                                <span aria-hidden="true" className="text-destructive">
                                    ⚠
                                </span>
                            )}
                            {value !== undefined && (
                                <span className="shrink-0 tabular-nums text-wafuu-sumi-light">
                                    {value}
                                </span>
                            )}
                        </button>
                        {branch && (
                            <button
                                type="button"
                                aria-label={`${label} の先を${open ? "たたむ" : `開く（${node.children.length} 手）`}`}
                                aria-expanded={open}
                                onClick={() => onToggle(id, !open)}
                                className="absolute flex items-center justify-center rounded-full border border-wafuu-kincha bg-background text-[10px] leading-none text-wafuu-sumi-light hover:border-wafuu-sumi hover:text-wafuu-sumi"
                                style={{
                                    left: boxLeft(col) + BOX_WIDTH + 3,
                                    top: boxTop(row) + BOX_HEIGHT / 2 - 8,
                                    minWidth: 16,
                                    height: 16,
                                    paddingInline: open ? 0 : 3,
                                }}
                            >
                                {open ? "−" : `+${node.children.length}`}
                            </button>
                        )}
                    </div>
                );
            })}
        </>
    );
}

/**
 * 定跡の木を横に広げて描く（左から右へ手が進み、分かれた手は下の行に並ぶ）。
 * 選んだ手までの道筋を強調し、選ぶたびにその手が見える位置まで送る。
 */
export function BookTreeGraph({
    tree,
    book,
    selected,
    onSelect,
    className,
}: {
    tree: BookTree;
    book: BookData;
    selected: number;
    onSelect: (id: number) => void;
    className?: string;
}): ReactElement {
    const frame = useRef<HTMLElement>(null);
    const [overrides, setOverrides] = useState<ReadonlyMap<number, boolean>>(() => new Map());
    const focused = focusOpenNodes(tree, selected);
    const isOpen = (node: BookTreeNode) => overrides.get(node.id) ?? focused.has(node.id);
    const layout = layoutBookGraph(tree, isOpen);
    const path = ancestorsOf(tree, selected);

    // たたんだ枝の中の手を選んだら（キー操作・一覧から）、その枝を開き直す。
    const reopenPath = useEffectEvent((ancestors: ReadonlySet<number>) => {
        if (![...ancestors].some((id) => id !== selected && overrides.get(id) === false)) return;
        setOverrides((current) => {
            const next = new Map(current);
            for (const id of ancestors) if (id !== selected) next.delete(id);
            return next;
        });
    });
    useEffect(() => {
        reopenPath(ancestorsOf(tree, selected));
    }, [tree, selected]);
    function toggle(id: number, open: boolean) {
        // 選んでいる手の祖先をたたむときは、たたんだ手を選び直す（選んだ手が見えなくならないように）。
        if (!open && path.has(id) && id !== selected) onSelect(id);
        // 開くときは、その手から先の本線まで開く（1 段だけ開いて、また閉じた箱が並ぶだけにならないように）。
        setOverrides((current) => {
            const next = new Map(current);
            if (open) for (const lineId of mainLine(tree, id)) next.set(lineId, true);
            else next.set(id, false);
            return next;
        });
    }

    // 木の中で押した手は、選び直して木の形が変わっても画面の同じ位置に残す（押した手を見失わないように）。
    const anchor = useRef<{ id: number; x: number; y: number } | null>(null);
    function selectFromGraph(id: number) {
        const placed = layout.byId.get(id);
        const element = frame.current;
        anchor.current =
            placed && element
                ? {
                      id,
                      x: boxLeft(placed.col) - element.scrollLeft,
                      y: boxTop(placed.row) - element.scrollTop,
                  }
                : null;
        onSelect(id);
    }

    const scrolledTo = useRef<number | null>(null);
    useEffect(() => {
        const element = frame.current;
        const target = layout.byId.get(selected);
        if (!element || !target || scrolledTo.current === selected) return;
        scrolledTo.current = selected;
        const left = boxLeft(target.col);
        const top = boxTop(target.row);
        const kept = anchor.current?.id === selected ? anchor.current : null;
        anchor.current = null;
        let x = kept ? left - kept.x : element.scrollLeft;
        let y = kept ? top - kept.y : element.scrollTop;
        if (left - SCROLL_MARGIN < x) x = left - SCROLL_MARGIN;
        else if (left + COL_WIDTH + SCROLL_MARGIN > x + element.clientWidth)
            x = left + COL_WIDTH + SCROLL_MARGIN - element.clientWidth;
        if (top - SCROLL_MARGIN - HEADER_HEIGHT < y) y = top - SCROLL_MARGIN - HEADER_HEIGHT;
        else if (top + BOX_HEIGHT + SCROLL_MARGIN > y + element.clientHeight)
            y = top + BOX_HEIGHT + SCROLL_MARGIN - element.clientHeight;
        element.scrollTo({ left: Math.max(0, x), top: Math.max(0, y) });
    }, [selected, layout]);

    const pathEdges: string[] = [];
    for (const id of path) {
        const node = tree.nodes[id];
        const child = layout.byId.get(id);
        const parent = node.parent === null ? undefined : layout.byId.get(node.parent);
        if (child && parent) pathEdges.push(edgePath(parent, child));
    }
    const width = PAD * 2 + layout.cols * COL_WIDTH;
    const height = HEADER_HEIGHT + PAD * 2 + layout.rows * ROW_HEIGHT;
    return (
        <section
            ref={frame}
            aria-label="定跡の木"
            className={cn("relative overflow-auto overscroll-contain", className)}
        >
            <div className="relative" style={{ width, height }}>
                <div
                    aria-hidden="true"
                    className="sticky top-0 z-10 border-b border-wafuu-border bg-wafuu-washi/95"
                    style={{ width, height: HEADER_HEIGHT }}
                >
                    {Array.from({ length: layout.cols }, (_, col) => col).map((col) => (
                        <span
                            key={col}
                            className="absolute top-0 text-[11px] leading-[22px] tabular-nums text-wafuu-sumi-light"
                            style={{ left: boxLeft(col) + 4 }}
                        >
                            {col === 0 ? "開始" : `${col}手目`}
                        </span>
                    ))}
                </div>
                <GraphNodes
                    tree={tree}
                    book={book}
                    layout={layout}
                    isOpen={isOpen}
                    onSelect={selectFromGraph}
                    onToggle={toggle}
                />
                <svg
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 overflow-visible"
                    width="100%"
                    height="100%"
                >
                    <path
                        d={pathEdges.join("")}
                        className="fill-none stroke-wafuu-sumi"
                        strokeWidth={2.5}
                    />
                </svg>
                {[...path].map((id) => {
                    const placed = layout.byId.get(id);
                    if (!placed) return null;
                    return (
                        <div
                            key={id}
                            aria-hidden="true"
                            className={cn(
                                "pointer-events-none absolute rounded",
                                id === selected
                                    ? "ring-2 ring-wafuu-sumi"
                                    : "ring-1 ring-wafuu-sumi/70",
                            )}
                            style={{
                                left: boxLeft(placed.col),
                                top: boxTop(placed.row),
                                width: BOX_WIDTH,
                                height: BOX_HEIGHT,
                            }}
                        />
                    );
                })}
            </div>
        </section>
    );
}
