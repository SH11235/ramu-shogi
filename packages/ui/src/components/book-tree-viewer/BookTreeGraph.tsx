import { type BookData, type BookTree, type BookTreeNode, deriveLastMove } from "@shogi/app-core";
import { cn } from "@shogi/design-system";
import {
    type ReactElement,
    type ReactNode,
    type PointerEvent as ReactPointerEvent,
    type Ref,
    useEffect,
    useEffectEvent,
    useLayoutEffect,
    useRef,
    useState,
} from "react";
import { Button } from "../button";
import { useIsMobile } from "../shogi-match/hooks/useMediaQuery";
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
/** 手の上にマウスを置いてから局面を出すまで（通り過ぎただけで出ないように）と、その盤のマス。 */
/** 盤の欄。手の上を通り過ぎるだけで盤が切り替わらないように少し待ち、手から離れたら少し待って選んでいる手に戻す。 */
const DOCK_ENTER_MS = 80;
const DOCK_LEAVE_MS = 300;
/**
 * 局面の盤のマスの大きさ。広い画面は木の左下に重ねて幅の DOCK_WIDE_WIDTH・高さの DOCK_WIDE_HEIGHT まで、
 * 狭い画面は木の下に高さの DOCK_NARROW_HEIGHT まで使い、盤の画面の盤と同じ上限まで大きくする。
 * 盤の幅はおよそマス 10.6 個（盤と左右の駒台）と DOCK_FIXED_WIDTH、高さはマス 9 個と DOCK_FIXED_HEIGHT
 * （見出し・座標・余白）。
 */
const DOCK_MIN_CELL = 16;
const DOCK_MAX_CELL = 48;
const DOCK_WIDE_WIDTH = 0.4;
const DOCK_WIDE_HEIGHT = 0.6;
const DOCK_NARROW_HEIGHT = 0.45;
const DOCK_FIXED_WIDTH = 110;
const DOCK_FIXED_HEIGHT = 110;
const DOCK_WIDTH_IN_CELLS = 10.6;

function dockCellSize(width: number, height: number, narrow: boolean) {
    const byWidth =
        ((narrow ? width : width * DOCK_WIDE_WIDTH) - DOCK_FIXED_WIDTH) / DOCK_WIDTH_IN_CELLS;
    const byHeight =
        (height * (narrow ? DOCK_NARROW_HEIGHT : DOCK_WIDE_HEIGHT) - DOCK_FIXED_HEIGHT) / 9;
    return Math.max(
        DOCK_MIN_CELL,
        Math.min(DOCK_MAX_CELL, Math.floor(Math.min(byWidth, byHeight))),
    );
}

/** 見えている範囲の外にも、この幅（px、拡大率を掛ける前）までは手を描いておく（送ったときに描き遅れが見えないように）。 */
const CULL_MARGIN = 400;
const AREA_STEP = 200;

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
/**
 * 親から子への線。描く範囲の外は切り落とす（遠い親から下りる縦線が数万 px になり、そのまま描くと
 * 送るたびの描き直しが重い）。
 */
function edgePath(parent: Placed, child: Placed, area: GraphView) {
    const x1 = boxLeft(parent.col) + BOX_WIDTH;
    const x2 = boxLeft(child.col);
    // 曲がり角は子の手の近くに置く（親の手の右に出す開閉の丸と重ならないように）。
    const xm = x2 - 10;
    const y1 = boxTop(parent.row) + BOX_HEIGHT / 2;
    const y2 = boxTop(child.row) + BOX_HEIGHT / 2;
    const top = area.top;
    const bottom = area.top + area.height;
    const inside = (y: number) => y >= top && y <= bottom;
    if (y1 === y2) return inside(y1) ? `M${x1} ${y1}H${x2}` : "";
    const from = Math.max(y1, top);
    const to = Math.min(y2, bottom);
    return [
        inside(y1) ? `M${x1} ${y1}H${xm}` : "",
        from < to ? `M${xm} ${from}V${to}` : "",
        inside(y2) ? `M${xm} ${y2}H${x2}` : "",
    ].join("");
}

export function moveLabel(tree: BookTree, node: BookTreeNode): string {
    if (node.parent === null || !node.move) return "開始局面";
    const parent = tree.nodes[node.parent];
    return formatMoveSimple(node.move, parent.position.turn, parent.position.board);
}

/** 親の局面の定跡に書かれた、この手の評価値。定跡は指した側から見た値なので、先手から見た値に直す。 */
export function bookValue(tree: BookTree, book: BookData, node: BookTreeNode): number | undefined {
    if (node.parent === null) return undefined;
    const parent = tree.nodes[node.parent];
    const value = book.positions.get(parent.key)?.find((move) => move.usi === node.move)?.value;
    if (value === undefined) return undefined;
    return parent.position.turn === "gote" ? -value : value;
}

/**
 * 線の層。木全体の大きさの SVG は、大きな定跡で描き直すたびに重くなるので、描く範囲の大きさにして、
 * 木の座標のまま描けるように viewBox をずらす。
 */
function AreaSvg({ area, children }: { area: GraphView; children: ReactNode }) {
    return (
        <svg
            aria-hidden="true"
            className="pointer-events-none absolute"
            style={{ left: area.left, top: area.top }}
            width={area.width}
            height={area.height}
            viewBox={`${area.left} ${area.top} ${area.width} ${area.height}`}
        >
            {children}
        </svg>
    );
}

function GraphNodes({
    tree,
    book,
    layout,
    isOpen,
    compact,
    onSelect,
    onToggle,
    onHover,
    area,
    keep,
}: {
    tree: BookTree;
    book: BookData;
    layout: BookGraphLayout;
    isOpen: (node: BookTreeNode) => boolean;
    compact: boolean;
    onSelect: (id: number) => void;
    onToggle: (id: number, open: boolean) => void;
    onHover?: (id: number | null) => void;
    /** 描く範囲（見えている範囲と、その周り）。この中の手と線だけを描く（大きな定跡を全部開いても重くならないように）。 */
    area: GraphView;
    /** 範囲の外でも描く手（フォーカスを持ち続けられるように、選んでいる手）。 */
    keep: number;
}) {
    const near = (x1: number, y1: number, x2: number, y2: number) =>
        x2 >= area.left &&
        x1 <= area.left + area.width &&
        y2 >= area.top &&
        y1 <= area.top + area.height;
    const solid: string[] = [];
    const dashed: string[] = [];
    const shown: Placed[] = [];
    for (const item of layout.items) {
        const node = tree.nodes[item.id];
        const x = boxLeft(item.col);
        const y = boxTop(item.row);
        if (item.id === keep || near(x, y, x + COL_WIDTH, y + BOX_HEIGHT)) shown.push(item);
        if (node.parent === null) continue;
        const parent = layout.byId.get(node.parent);
        if (!parent) continue;
        // 親から子へ下りる線は、両端が範囲の外でも途中が見えることがあるので、線の囲む範囲で決める。
        if (!near(boxLeft(parent.col) + BOX_WIDTH, boxTop(parent.row), x, y + BOX_HEIGHT)) continue;
        (node.inBook === false ? dashed : solid).push(edgePath(parent, item, area));
    }
    return (
        <>
            <AreaSvg area={area}>
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
            </AreaSvg>
            {shown.map(({ id, col, row }) => {
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
                            onPointerMove={
                                onHover &&
                                ((event) => {
                                    if (event.pointerType === "mouse") onHover(id);
                                })
                            }
                            onPointerLeave={onHover && (() => onHover(null))}
                            className={cn(
                                "absolute flex items-center gap-1 rounded border px-1.5 text-left text-xs text-wafuu-sumi transition-colors hover:border-wafuu-sumi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                node.inBook === false
                                    ? "border-dashed border-wafuu-kincha bg-background"
                                    : "border-wafuu-border bg-wafuu-washi-warm",
                                // 選んでいる手は盤の最後の一手と同じ金色で塗る（枠の太さだけでは見分けにくいので）。
                                id === keep &&
                                    "border-solid border-wafuu-sumi bg-wafuu-kin font-semibold",
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

/** 手を指した後の局面と、その手・評価値の見出し。 */
function PositionSummary({
    tree,
    book,
    id,
    flipBoard,
    cellSize,
}: {
    tree: BookTree;
    book: BookData;
    id: number;
    flipBoard: boolean;
    cellSize: number;
}) {
    const node = tree.nodes[id];
    const value = bookValue(tree, book, node);
    return (
        <>
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
                cellSize={cellSize}
                handPlacement="sides"
                handFrame="outline"
                handSize="compact"
                hideEmptyHandPieces
                reserveHandHeight
            />
        </>
    );
}

/**
 * 局面の盤。広い画面は木の左下に重ねる（木は右と上へ伸びるので、左下は空きやすい）。狭い画面は木の下に置く。
 */
function DockedPosition({
    tree,
    book,
    id,
    hovering,
    flipBoard,
    cellSize,
    overlay,
    onOpen,
    ref,
}: {
    tree: BookTree;
    book: BookData;
    id: number;
    hovering: boolean;
    flipBoard: boolean;
    cellSize: number;
    overlay: boolean;
    onOpen?: (id: number) => void;
    ref?: Ref<HTMLElement>;
}) {
    return (
        <aside
            ref={ref}
            aria-label="局面"
            className={cn(
                "flex shrink-0 flex-col gap-1 bg-background p-2",
                overlay
                    ? "absolute bottom-2 left-2 z-20 rounded-lg border border-wafuu-border shadow-popover"
                    : "items-center border-t border-wafuu-border",
            )}
        >
            <p className="text-[11px] text-wafuu-sumi-light">
                {hovering ? "マウスを置いた手" : "選んでいる手"}
            </p>
            <PositionSummary
                tree={tree}
                book={book}
                id={id}
                flipBoard={flipBoard}
                cellSize={cellSize}
            />
            {onOpen && (
                <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="self-stretch"
                    onClick={() => onOpen(id)}
                >
                    この局面を盤で開く
                </Button>
            )}
        </aside>
    );
}

/** 全画面で局面の盤を出すか。 */
export type BookTreePreviewMode = "dock" | "off";

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
 * `explore` では、拡大縮小・木の全体図と、局面の欄を出す（盤の画面を隠して木を眺めるとき）。
 */
export function BookTreeGraph({
    tree,
    book,
    selected,
    onSelect,
    flipBoard = false,
    explore = false,
    preview: previewMode = "dock",
    onActivate,
    className,
}: {
    tree: BookTree;
    book: BookData;
    selected: number;
    onSelect: (id: number) => void;
    /** 局面の欄の盤を、後手を手前にして描く。 */
    flipBoard?: boolean;
    explore?: boolean;
    /** `explore` で局面を出す所。 */
    preview?: BookTreePreviewMode;
    /** 局面の欄の「この局面を盤で開く」を押したとき（`explore` のときだけ）。 */
    onActivate?: (id: number) => void;
    className?: string;
}): ReactElement {
    const frame = useRef<HTMLElement>(null);
    const [root, setRoot] = useState<HTMLDivElement | null>(null);
    const [rootSize, setRootSize] = useState({ width: 0, height: 0 });
    const narrow = useIsMobile();
    useEffect(() => {
        if (!root) return;
        const observer = new ResizeObserver(([entry]) =>
            setRootSize({ width: entry.contentRect.width, height: entry.contentRect.height }),
        );
        observer.observe(root);
        return () => observer.disconnect();
    }, [root]);
    const [overrides, setOverrides] = useState<ReadonlyMap<number, boolean>>(() => new Map());
    const [zoomSetting, setZoomSetting] = useState(1);
    const zoom = explore ? zoomSetting : 1;
    const compact = zoom < COMPACT_ZOOM;
    const isOpen = (node: BookTreeNode) => overrides.get(node.id) ?? true;
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
        setOverrides((current) => {
            const next = new Map(current);
            if (open) next.delete(id);
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
    const scrolledTo = useRef<string | null>(null);
    /** 木に重ねた盤（広い画面で盤を出すとき）。 */
    const dockBox = useRef<HTMLElement>(null);
    /** 送り切れなかった横の位置と、そのときの位置。ホイール・引く・拡大縮小で動かされたら捨てる。 */
    const shortOf = useRef<{ wanted: number; left: number; top: number } | null>(null);
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
        // 木の中で押した手は、隠れるときだけ動かす（押した手が指の下から逃げないように）。
        const margin = kept ? 0 : SCROLL_MARGIN;
        const offLeft = left - margin < x;
        const offRight = left + colWidth + margin > x + element.clientWidth;
        if (!kept && (offLeft || offRight)) x = left - element.clientWidth / FOLLOW_FRACTION;
        else if (offLeft) x = left - margin;
        else if (offRight) x = left + colWidth + margin - element.clientWidth;
        const header = HEADER_HEIGHT * zoom;
        // 左下に重ねた盤の下へは送らない（盤の上に出す）。枠が低くて盤の上に収まらないときは盤を気にしない。
        const covered = dockBox.current?.offsetHeight ?? 0;
        const visible =
            element.clientHeight - covered >= (BOX_HEIGHT * zoom + margin) * 2 + header
                ? element.clientHeight - covered
                : element.clientHeight;
        if (top - margin - header < y) y = top - margin - header;
        else if (top + BOX_HEIGHT * zoom + margin > y + visible)
            y = top + BOX_HEIGHT * zoom + margin - visible;
        element.scrollTo({ left: Math.max(0, x), top: Math.max(0, y) });
        if (element.scrollLeft < x - 1)
            shortOf.current = { wanted: x, left: element.scrollLeft, top: element.scrollTop };
    });
    useEffect(() => {
        followSelection(layout, `${selected}:${explore}`);
    }, [selected, layout, explore]);

    // 描く範囲。AREA_STEP 刻みにそろえ、刻みをまたいだときだけ描き直す（少し送るたびに描き直さないように）。
    const [view, setView] = useState<GraphView>({ left: 0, top: 0, width: 0, height: 0 });
    // 欄に出す手。手の上を通り過ぎるだけで切り替わらないように少し待ち、離れたら少し待って選んでいる手に戻す。
    const [docked, setDocked] = useState<number | null>(null);
    const dockTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    useEffect(() => () => clearTimeout(dockTimer.current), []);
    const hovered = useRef<number | null>(null);
    const hoverable = explore && previewMode !== "off";
    useEffect(() => {
        if (hoverable) return;
        clearTimeout(dockTimer.current);
        hovered.current = null;
        setDocked(null);
    }, [hoverable]);
    function hover(id: number | null) {
        if (id === hovered.current) return;
        hovered.current = id;
        clearTimeout(dockTimer.current);
        dockTimer.current = setTimeout(
            () => setDocked(id),
            id === null ? DOCK_LEAVE_MS : DOCK_ENTER_MS,
        );
    }
    const measureView = useEffectEvent((scale: number) => {
        const element = frame.current;
        if (!element) return;
        const snap = (value: number) => Math.floor(value / AREA_STEP) * AREA_STEP;
        const left = Math.max(0, snap(element.scrollLeft / scale - CULL_MARGIN));
        const top = Math.max(0, snap(element.scrollTop / scale - CULL_MARGIN));
        const next = {
            left,
            top,
            width:
                snap((element.scrollLeft + element.clientWidth) / scale + CULL_MARGIN) +
                AREA_STEP -
                left,
            height:
                snap((element.scrollTop + element.clientHeight) / scale + CULL_MARGIN) +
                AREA_STEP -
                top,
        };
        setView((current) =>
            current.left === next.left &&
            current.top === next.top &&
            current.width === next.width &&
            current.height === next.height
                ? current
                : next,
        );
    });
    const onResize = useEffectEvent(() => measureView(zoom));
    useEffect(() => {
        const element = frame.current;
        if (!element) return;
        const observer = new ResizeObserver(() => onResize());
        observer.observe(element);
        return () => observer.disconnect();
    }, []);

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
        setZoomSetting(target);
    }
    function fitAll() {
        const element = frame.current;
        if (!element) return;
        shortOf.current = null;
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

    // 枠の大きさを測るまで（測れない環境も）は全部描く。
    // 範囲は木の外へはみ出させない（線の層が木より大きいと、その分だけ送れる幅が増えてしまう）。
    const area =
        view.width > 0 && view.height > 0
            ? {
                  left: Math.min(view.left, width),
                  top: Math.min(view.top, height),
                  width: Math.max(0, Math.min(view.left + view.width, width) - view.left),
                  height: Math.max(0, Math.min(view.top + view.height, height) - view.top),
              }
            : { left: 0, top: 0, width, height };
    const pathEdges: string[] = [];
    for (const id of path) {
        const node = tree.nodes[id];
        const child = layout.byId.get(id);
        const parent = node.parent === null ? undefined : layout.byId.get(node.parent);
        if (child && parent) pathEdges.push(edgePath(parent, child, area));
    }
    const dock = explore && previewMode === "dock";
    const dockedId = docked !== null && tree.nodes[docked] ? docked : selected;
    const dockCell = dockCellSize(rootSize.width, rootSize.height, narrow);
    const board = (
        <DockedPosition
            tree={tree}
            book={book}
            id={dockedId}
            hovering={dockedId !== selected}
            flipBoard={flipBoard}
            cellSize={dockCell}
            overlay={!narrow}
            onOpen={onActivate}
            ref={narrow ? undefined : dockBox}
        />
    );
    return (
        <div
            ref={setRoot}
            className={cn(
                "flex min-h-0 min-w-0 overflow-hidden",
                dock && narrow && "flex-col",
                className,
            )}
        >
            <div className="relative flex min-h-0 min-w-0 flex-1">
                <section
                    ref={frame}
                    aria-label="定跡の木"
                    onScroll={() => {
                        measureView(zoom);
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
                    <div
                        className="relative"
                        style={{ width: width * zoom, height: height * zoom }}
                    >
                        <div className="absolute top-0 left-0" style={{ width, height, zoom }}>
                            <div
                                aria-hidden="true"
                                className="sticky top-0 z-10 border-b border-wafuu-border bg-wafuu-washi/95"
                                style={{ width, height: HEADER_HEIGHT }}
                            >
                                {!compact &&
                                    Array.from({ length: layout.cols }, (_, col) => col).map(
                                        (col) => (
                                            <span
                                                key={col}
                                                className="absolute top-0 text-[11px] leading-[22px] tabular-nums text-wafuu-sumi-light"
                                                style={{ left: boxLeft(col) + 4 }}
                                            >
                                                {col === 0 ? "開始" : `${col}手目`}
                                            </span>
                                        ),
                                    )}
                            </div>
                            <GraphNodes
                                tree={tree}
                                book={book}
                                layout={layout}
                                isOpen={isOpen}
                                compact={compact}
                                onSelect={selectFromGraph}
                                onToggle={toggle}
                                onHover={hoverable ? hover : undefined}
                                area={area}
                                keep={selected}
                            />
                            <AreaSvg area={area}>
                                <path
                                    d={pathEdges.join("")}
                                    className="fill-none stroke-wafuu-sumi"
                                    strokeWidth={compact ? 2.5 / zoom : 2.5}
                                />
                            </AreaSvg>
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
                    <div className="absolute right-2 bottom-2 z-20 flex items-center gap-1 rounded-md border border-wafuu-border bg-background/90 p-1 text-xs shadow-popover">
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
                {dock && !narrow && board}
            </div>
            {dock && narrow && board}
        </div>
    );
}
