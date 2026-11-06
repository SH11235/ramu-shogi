import { type BookData, type BookTree, type BookTreeNode, deriveLastMove } from "@shogi/app-core";
import { cn } from "@shogi/design-system";
import {
    type ReactElement,
    type PointerEvent as ReactPointerEvent,
    useEffect,
    useEffectEvent,
    useLayoutEffect,
    useRef,
    useState,
} from "react";
import { Button } from "../button";
import { formatMoveSimple } from "../shogi-match/utils/kifFormat";
import { StaticBoardView } from "../static-board-view";

/** 木の 1 手の箱と、その並びの間隔（px）。手数が列、分かれた手が行になる。 */
const COL_WIDTH = 172;
const BOX_WIDTH = 132;
const ROW_HEIGHT = 34;
const BOX_HEIGHT = 26;
const HEADER_HEIGHT = 22;
const PAD = 10;
/** 選んだ手を枠の端から離しておく幅（送ったとき、次の手が枠の外に隠れないように）。 */
const SCROLL_MARGIN = 48;
/** キーや一覧で選んだ手が端に寄ったとき、枠の幅の何分の 1 の所へ送るか。 */
const FOLLOW_FRACTION = 3;
/** 拡大率の幅と、ボタン 1 回で変える倍率。これより小さいと手の名前を省き、箱と線だけで形を見せる。 */
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 1.5;
const ZOOM_STEP = 1.25;
const COMPACT_ZOOM = 0.6;
/** Ctrl＋ホイールの 1px あたりの拡大率の変わり方（指数で変える）。 */
const WHEEL_ZOOM_RATE = 0.002;
const WHEEL_LINE_PX = 16;
/** 木の全体図の大きさの上限（px）。 */
const MINIMAP_WIDTH = 220;
const MINIMAP_HEIGHT = 130;
/** 全体図を拡大縮小のボタンと並べるとき、ボタンの列に空けておく幅（px）と、全体図を出す最小の幅。 */
const ZOOM_CONTROLS_WIDTH = 250;
const MINIMAP_MIN_WIDTH = 80;
/** 手の上にマウスを置いてから局面を出すまで（通り過ぎただけで出ないように）と、その盤のマス。 */
const PREVIEW_DELAY_MS = 250;
const PREVIEW_CELL = 22;
const PREVIEW_GAP = 8;

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
    compact,
    onSelect,
    onToggle,
    onActivate,
    onHover,
}: {
    tree: BookTree;
    book: BookData;
    layout: BookGraphLayout;
    isOpen: (node: BookTreeNode) => boolean;
    compact: boolean;
    onSelect: (id: number) => void;
    onToggle: (id: number, open: boolean) => void;
    onActivate?: (id: number) => void;
    onHover?: (id: number | null, element?: HTMLElement) => void;
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
                            title={onHover ? undefined : [label, ...notes].join("\n")}
                            onClick={() => onSelect(id)}
                            onDoubleClick={onActivate && (() => onActivate(id))}
                            onPointerMove={
                                onHover &&
                                ((event) => {
                                    if (event.pointerType === "mouse")
                                        onHover(id, event.currentTarget);
                                })
                            }
                            onPointerLeave={onHover && (() => onHover(null))}
                            className={cn(
                                "absolute flex items-center gap-1 rounded border px-1.5 text-left text-xs text-wafuu-sumi transition-colors hover:border-wafuu-sumi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                node.inBook === false
                                    ? "border-dashed border-wafuu-kincha bg-background"
                                    : "border-wafuu-border bg-wafuu-washi-warm",
                                compact && mark === "☗" && "bg-wafuu-shu/25",
                                compact && mark === "☖" && "bg-wafuu-ai/25",
                            )}
                            style={{
                                left: boxLeft(col),
                                top: boxTop(row),
                                width: BOX_WIDTH,
                                height: BOX_HEIGHT,
                            }}
                        >
                            {!compact && (
                                <>
                                    {mark && (
                                        <span
                                            aria-hidden="true"
                                            className={
                                                mark === "☗" ? "text-wafuu-shu" : "text-wafuu-ai"
                                            }
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
                                </>
                            )}
                        </button>
                        {branch && !compact && (
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

/** 木の中で今見えている範囲（拡大率を掛ける前の木の座標）。 */
interface GraphView {
    left: number;
    top: number;
    width: number;
    height: number;
}

/** 木全体の縮図と、今見えている範囲の枠。押した所・引いた所を画面の中央へ送る。 */
function Minimap({
    layout,
    path,
    width,
    height,
    maxWidth,
    view,
    onJump,
}: {
    layout: BookGraphLayout;
    path: ReadonlySet<number>;
    width: number;
    height: number;
    maxWidth: number;
    view: GraphView;
    onJump: (x: number, y: number) => void;
}) {
    const scale = Math.min(maxWidth / width, MINIMAP_HEIGHT / height);
    const boxes: string[] = [];
    const pathBoxes: string[] = [];
    for (const { id, col, row } of layout.items) {
        const w = Math.max(1, BOX_WIDTH * scale);
        const h = Math.max(1, BOX_HEIGHT * scale);
        (path.has(id) ? pathBoxes : boxes).push(
            `M${boxLeft(col) * scale} ${boxTop(row) * scale}h${w}v${h}h${-w}z`,
        );
    }
    const dragging = useRef(false);
    function jump(event: ReactPointerEvent<SVGSVGElement>) {
        const box = event.currentTarget.getBoundingClientRect();
        onJump((event.clientX - box.left) / scale, (event.clientY - box.top) / scale);
    }
    return (
        <div className="absolute right-2 bottom-2 z-20 rounded-md border border-wafuu-border bg-background/90 p-1 shadow-popover">
            <svg
                role="img"
                aria-label="木の全体図"
                width={width * scale}
                height={height * scale}
                className="block cursor-pointer touch-none"
                onPointerDown={(event) => {
                    if (event.button !== 0) return;
                    dragging.current = true;
                    event.currentTarget.setPointerCapture(event.pointerId);
                    jump(event);
                }}
                onPointerMove={(event) => {
                    if (dragging.current) jump(event);
                }}
                onPointerUp={() => {
                    dragging.current = false;
                }}
                onPointerCancel={() => {
                    dragging.current = false;
                }}
            >
                <path d={boxes.join("")} className="fill-wafuu-kincha/60" />
                <path d={pathBoxes.join("")} className="fill-wafuu-sumi" />
                <rect
                    x={view.left * scale}
                    y={view.top * scale}
                    width={view.width * scale}
                    height={view.height * scale}
                    className="fill-wafuu-sumi/10 stroke-wafuu-shu"
                    strokeWidth={1.5}
                />
            </svg>
        </div>
    );
}

/** 手の上にマウスを置いたときに浮かせる、その手を指した後の局面。 */
function PositionPreview({
    tree,
    book,
    id,
    anchor,
    flipBoard,
}: {
    tree: BookTree;
    book: BookData;
    id: number;
    anchor: DOMRect;
    flipBoard: boolean;
}) {
    const element = useRef<HTMLDivElement>(null);
    const node = tree.nodes[id];
    const value = bookValue(tree, book, node);
    // 大きさは描いてから測り、手の右（入らなければ左）に、画面からはみ出さないように置く。
    useLayoutEffect(() => {
        const box = element.current;
        if (!box) return;
        const { width, height } = box.getBoundingClientRect();
        const right = anchor.right + PREVIEW_GAP;
        const left =
            right + width + PREVIEW_GAP <= window.innerWidth
                ? right
                : Math.max(PREVIEW_GAP, anchor.left - width - PREVIEW_GAP);
        const top = Math.min(
            Math.max(PREVIEW_GAP, anchor.top + anchor.height / 2 - height / 2),
            window.innerHeight - height - PREVIEW_GAP,
        );
        box.style.left = `${left}px`;
        box.style.top = `${Math.max(PREVIEW_GAP, top)}px`;
        box.style.visibility = "visible";
    }, [anchor]);
    return (
        <div
            ref={element}
            aria-hidden="true"
            className="pointer-events-none invisible fixed top-0 left-0 z-popover flex flex-col gap-1 rounded-lg border border-wafuu-border bg-background p-2 shadow-popover"
        >
            <div className="flex items-baseline gap-2 text-xs text-wafuu-sumi">
                <span className="font-medium">
                    {node.parent === null
                        ? "開始局面"
                        : `${(node.position.ply ?? 1) - 1}手目 ${moveLabel(tree, node)}`}
                </span>
                {value !== undefined && (
                    <span className="tabular-nums text-wafuu-sumi-light">評価値 {value}</span>
                )}
            </div>
            <StaticBoardView
                position={node.position}
                flipBoard={flipBoard}
                lastMove={deriveLastMove(node.move)}
                cellSize={PREVIEW_CELL}
                handPlacement="sides"
                handFrame="outline"
                handSize="compact"
                hideEmptyHandPieces
                reserveHandHeight
            />
        </div>
    );
}

const clampZoom = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
/** ホイールの 1 目盛り（行・ページ単位で届く端末もある）を px にそろえる。 */
function wheelPixels(event: WheelEvent, delta: number, page: number) {
    if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return delta * WHEEL_LINE_PX;
    if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return delta * page;
    return delta;
}

/**
 * 定跡の木を横に広げて描く（左から右へ手が進み、分かれた手は下の行に並ぶ）。
 * 選んだ手までの道筋を強調し、選ぶたびにその手が見える位置まで送る。
 * 縦に送る余地が無いときは、ホイールを横に送る向きに使う。空いた所はマウスで引いて動かせる。
 * `explore` では、拡大縮小・木の全体図・手の上に置いたときの局面を出す（盤を隠して木を眺めるとき）。
 */
export function BookTreeGraph({
    tree,
    book,
    selected,
    onSelect,
    flipBoard = false,
    explore = false,
    onActivate,
    className,
}: {
    tree: BookTree;
    book: BookData;
    selected: number;
    onSelect: (id: number) => void;
    /** 手の上に置いたときに出す盤を、後手を手前にして描く。 */
    flipBoard?: boolean;
    explore?: boolean;
    /** 手をダブルクリックしたとき（`explore` のときだけ）。 */
    onActivate?: (id: number) => void;
    className?: string;
}): ReactElement {
    const frame = useRef<HTMLElement>(null);
    const [overrides, setOverrides] = useState<ReadonlyMap<number, boolean>>(() => new Map());
    const [zoomSetting, setZoomSetting] = useState(1);
    const zoom = explore ? zoomSetting : 1;
    const compact = zoom < COMPACT_ZOOM;
    const focused = focusOpenNodes(tree, selected);
    const isOpen = (node: BookTreeNode) => overrides.get(node.id) ?? focused.has(node.id);
    const layout = layoutBookGraph(tree, isOpen);
    const path = ancestorsOf(tree, selected);
    const width = PAD * 2 + layout.cols * COL_WIDTH;
    const height = HEADER_HEIGHT + PAD * 2 + layout.rows * ROW_HEIGHT;

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
                      x: boxLeft(placed.col) * zoom - element.scrollLeft,
                      y: boxTop(placed.row) * zoom - element.scrollTop,
                  }
                : null;
        onSelect(id);
    }

    // 選んだ手を見える位置へ送る。キーや一覧で選んだ手が端に寄ったら、左から 3 分の 1 の所まで送り、
    // この先の手を広く見せる（1 手ずつ進めるたびに少しずつ送られて、先が見えないままにならないように）。
    const followSelection = useEffectEvent((placed: BookGraphLayout, key: string) => {
        const element = frame.current;
        const target = placed.byId.get(selected);
        if (!element || !target) return;
        if (scrolledTo.current === key) {
            // 木の右端の手を選んで送り切れなかったときは、その先が描かれたら送り直す（動かされていなければ）。
            const short = shortOf.current;
            shortOf.current = null;
            if (
                !short ||
                Math.abs(element.scrollLeft - short.left) > 1 ||
                Math.abs(element.scrollTop - short.top) > 1
            )
                return;
            element.scrollTo({ left: short.wanted, top: element.scrollTop });
            if (element.scrollLeft < short.wanted - 1)
                shortOf.current = {
                    wanted: short.wanted,
                    left: element.scrollLeft,
                    top: element.scrollTop,
                };
            return;
        }
        scrolledTo.current = key;
        shortOf.current = null;
        const left = boxLeft(target.col) * zoom;
        const top = boxTop(target.row) * zoom;
        // 押した手は箱そのものが見えていればよい。キーで選んだ手は、右の開閉の丸と線まで見せる。
        const kept = anchor.current?.id === selected ? anchor.current : null;
        const colWidth = (kept ? BOX_WIDTH : COL_WIDTH) * zoom;
        anchor.current = null;
        let x = kept ? left - kept.x : element.scrollLeft;
        let y = kept ? top - kept.y : element.scrollTop;
        // 木の中で押した手は、隠れるときだけ動かす（端に寄せた余白の分だけ動くと、ダブルクリックの 2 回目が外れる）。
        const margin = kept ? 0 : SCROLL_MARGIN;
        const offLeft = left - margin < x;
        const offRight = left + colWidth + margin > x + element.clientWidth;
        if (!kept && (offLeft || offRight)) x = left - element.clientWidth / FOLLOW_FRACTION;
        else if (offLeft) x = left - margin;
        else if (offRight) x = left + colWidth + margin - element.clientWidth;
        const header = HEADER_HEIGHT * zoom;
        if (top - margin - header < y) y = top - margin - header;
        else if (top + BOX_HEIGHT * zoom + margin > y + element.clientHeight)
            y = top + BOX_HEIGHT * zoom + margin - element.clientHeight;
        element.scrollTo({ left: Math.max(0, x), top: Math.max(0, y) });
        if (element.scrollLeft < x - 1)
            shortOf.current = { wanted: x, left: element.scrollLeft, top: element.scrollTop };
    });
    const scrolledTo = useRef<string | null>(null);
    /** 送り切れなかった横の位置と、そのときの位置。ホイール・引く・拡大縮小で動かされたら捨てる。 */
    const shortOf = useRef<{ wanted: number; left: number; top: number } | null>(null);
    useEffect(() => {
        followSelection(layout, `${selected}:${explore}`);
    }, [selected, layout, explore]);

    const [view, setView] = useState<GraphView>({ left: 0, top: 0, width: 0, height: 0 });
    const [preview, setPreview] = useState<{ id: number; anchor: DOMRect } | null>(null);
    const previewTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    useEffect(() => () => clearTimeout(previewTimer.current), []);
    // マウスを動かすたびに呼ばれる。同じ手の上で待っている・出している間は何もしない（送ったり拡大縮小
    // したりして消えたあとは、手の上で少し動かせばまた出す）。
    const hovered = useRef<number | null>(null);
    function hover(id: number | null, element?: HTMLElement) {
        if (id !== null && id === hovered.current) return;
        hidePreview();
        if (id === null || !element) return;
        hovered.current = id;
        // 出すときの位置を測る（待つ間に送ったり拡大縮小したりして、手が動いていることがある）。
        previewTimer.current = setTimeout(() => {
            previewTimer.current = undefined;
            if (element.isConnected) setPreview({ id, anchor: element.getBoundingClientRect() });
        }, PREVIEW_DELAY_MS);
    }
    function hidePreview() {
        clearTimeout(previewTimer.current);
        previewTimer.current = undefined;
        hovered.current = null;
        setPreview(null);
    }
    const measureView = useEffectEvent((scale: number) => {
        const element = frame.current;
        if (!element) return;
        setView({
            left: element.scrollLeft / scale,
            top: element.scrollTop / scale,
            width: element.clientWidth / scale,
            height: element.clientHeight / scale,
        });
    });
    const onResize = useEffectEvent(() => measureView(zoom));
    useEffect(() => {
        const element = frame.current;
        if (!element || !explore) return;
        const observer = new ResizeObserver(() => onResize());
        observer.observe(element);
        return () => observer.disconnect();
    }, [explore]);

    // 拡大率を変えても、`at`（枠の中の位置。省くと枠の中央）の下にある木の位置を動かさない。
    const pendingScroll = useRef<{ left: number; top: number } | null>(null);
    function zoomTo(next: number, at?: { x: number; y: number }) {
        const element = frame.current;
        const target = clampZoom(next);
        if (!element || target === zoom) return;
        const x = at?.x ?? element.clientWidth / 2;
        const y = at?.y ?? element.clientHeight / 2;
        pendingScroll.current = {
            left: ((element.scrollLeft + x) / zoom) * target - x,
            top: ((element.scrollTop + y) / zoom) * target - y,
        };
        shortOf.current = null;
        hidePreview();
        setZoomSetting(target);
    }
    function fitAll() {
        const element = frame.current;
        if (!element) return;
        shortOf.current = null;
        hidePreview();
        const target = clampZoom(
            Math.min(1, element.clientWidth / width, element.clientHeight / height),
        );
        // 拡大率が変わらないときは、拡大率の変化を待つ処理が走らないので、ここで原点へ送る。
        if (target === zoom) element.scrollTo({ left: 0, top: 0 });
        else pendingScroll.current = { left: 0, top: 0 };
        setZoomSetting(target);
    }
    useLayoutEffect(() => {
        const element = frame.current;
        const target = pendingScroll.current;
        pendingScroll.current = null;
        if (element && target) element.scrollTo({ left: target.left, top: target.top });
        measureView(zoom);
    }, [zoom]);
    function jumpTo(x: number, y: number) {
        const element = frame.current;
        if (!element) return;
        shortOf.current = null;
        element.scrollTo({
            left: x * zoom - element.clientWidth / 2,
            top: y * zoom - element.clientHeight / 2,
        });
    }

    const onWheel = useEffectEvent((event: WheelEvent) => {
        const element = frame.current;
        if (!element) return;
        shortOf.current = null;
        if (explore && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            const box = element.getBoundingClientRect();
            const delta = wheelPixels(event, event.deltaY, element.clientHeight);
            zoomTo(zoom * Math.exp(-delta * WHEEL_ZOOM_RATE), {
                x: event.clientX - box.left,
                y: event.clientY - box.top,
            });
            return;
        }
        // 縦に送れない木では、縦のホイールを横に送る（Shift を押さなくても深い手へ進めるように）。
        if (event.shiftKey || event.deltaX !== 0 || event.ctrlKey) return;
        if (element.scrollHeight > element.clientHeight + 1) return;
        if (element.scrollWidth <= element.clientWidth + 1) return;
        event.preventDefault();
        element.scrollLeft += wheelPixels(event, event.deltaY, element.clientWidth);
    });
    useEffect(() => {
        const element = frame.current;
        if (!element) return;
        const listener = (event: WheelEvent) => onWheel(event);
        element.addEventListener("wheel", listener, { passive: false });
        return () => element.removeEventListener("wheel", listener);
    }, []);

    // 手の箱の無い所をマウスで引くと、木をつかんで動かす（タッチは指で送れるので、ブラウザに任せる）。
    const pan = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
    const [panning, setPanning] = useState(false);
    function startPan(event: ReactPointerEvent<HTMLElement>) {
        const element = event.currentTarget;
        if (event.pointerType !== "mouse" || event.button !== 0) return;
        // スクロールバーの上と、手・開閉の丸は引いて動かす対象にしない。
        const frameBox = element.getBoundingClientRect();
        if (
            event.clientX - frameBox.left - element.clientLeft >= element.clientWidth ||
            event.clientY - frameBox.top - element.clientTop >= element.clientHeight
        )
            return;
        if (event.target instanceof Element && event.target.closest("button")) return;
        event.preventDefault();
        shortOf.current = null;
        element.setPointerCapture(event.pointerId);
        pan.current = {
            x: event.clientX,
            y: event.clientY,
            left: element.scrollLeft,
            top: element.scrollTop,
        };
        setPanning(true);
    }
    function movePan(event: ReactPointerEvent<HTMLElement>) {
        const start = pan.current;
        if (!start) return;
        event.currentTarget.scrollLeft = start.left - (event.clientX - start.x);
        event.currentTarget.scrollTop = start.top - (event.clientY - start.y);
    }
    function endPan() {
        pan.current = null;
        setPanning(false);
    }

    const pathEdges: string[] = [];
    for (const id of path) {
        const node = tree.nodes[id];
        const child = layout.byId.get(id);
        const parent = node.parent === null ? undefined : layout.byId.get(node.parent);
        if (child && parent) pathEdges.push(edgePath(parent, child));
    }
    // 狭い画面では、拡大縮小のボタンと重ならない幅に縮める。
    const minimapWidth = Math.min(MINIMAP_WIDTH, view.width * zoom - ZOOM_CONTROLS_WIDTH);
    const showMinimap =
        explore &&
        minimapWidth >= MINIMAP_MIN_WIDTH &&
        (view.width < width - 1 || view.height < height - 1);
    return (
        <div className={cn("relative flex min-h-0 min-w-0 overflow-hidden", className)}>
            <section
                ref={frame}
                aria-label="定跡の木"
                onScroll={() => {
                    if (preview || previewTimer.current !== undefined) hidePreview();
                    if (explore) measureView(zoom);
                }}
                onPointerDown={startPan}
                onPointerMove={movePan}
                onPointerUp={endPan}
                onPointerCancel={endPan}
                className={cn(
                    "relative min-h-0 min-w-0 flex-1 overflow-auto overscroll-contain",
                    panning ? "cursor-grabbing select-none" : "cursor-grab",
                )}
            >
                <div className="relative" style={{ width: width * zoom, height: height * zoom }}>
                    <div className="absolute top-0 left-0" style={{ width, height, zoom }}>
                        <div
                            aria-hidden="true"
                            className="sticky top-0 z-10 border-b border-wafuu-border bg-wafuu-washi/95"
                            style={{ width, height: HEADER_HEIGHT }}
                        >
                            {!compact &&
                                Array.from({ length: layout.cols }, (_, col) => col).map((col) => (
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
                            compact={compact}
                            onSelect={selectFromGraph}
                            onToggle={toggle}
                            onActivate={explore ? onActivate : undefined}
                            onHover={explore ? hover : undefined}
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
                                strokeWidth={compact ? 2.5 / zoom : 2.5}
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
                                        compact
                                            ? id === selected
                                                ? "bg-wafuu-shu"
                                                : "bg-wafuu-sumi"
                                            : id === selected
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
                </div>
            </section>
            {explore && (
                <div className="absolute bottom-2 left-2 z-20 flex items-center gap-1 rounded-md border border-wafuu-border bg-background/90 p-1 text-xs shadow-popover">
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        aria-label="縮小"
                        title="縮小（Ctrl＋ホイール）"
                        disabled={zoom <= MIN_ZOOM}
                        onClick={() => zoomTo(zoom / ZOOM_STEP)}
                    >
                        −
                    </Button>
                    <output className="w-10 text-center tabular-nums">
                        {Math.round(zoom * 100)}%
                    </output>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        aria-label="拡大"
                        title="拡大（Ctrl＋ホイール）"
                        disabled={zoom >= MAX_ZOOM}
                        onClick={() => zoomTo(zoom * ZOOM_STEP)}
                    >
                        ＋
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 px-2" onClick={fitAll}>
                        全体
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2"
                        disabled={zoom === 1}
                        onClick={() => zoomTo(1)}
                    >
                        100%
                    </Button>
                </div>
            )}
            {showMinimap && (
                <Minimap
                    layout={layout}
                    path={path}
                    width={width}
                    height={height}
                    maxWidth={minimapWidth}
                    view={view}
                    onJump={jumpTo}
                />
            )}
            {explore && preview && tree.nodes[preview.id] && (
                <PositionPreview
                    tree={tree}
                    book={book}
                    id={preview.id}
                    anchor={preview.anchor}
                    flipBoard={flipBoard}
                />
            )}
        </div>
    );
}
