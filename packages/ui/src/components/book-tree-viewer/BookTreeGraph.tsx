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
import { BookTreeJump } from "./BookTreeJump";
import { loadBookmarks, saveBookmarks } from "./bookmarks";

/** 木の 1 手の箱と、その並びの間隔（px）。手数が列、分かれた手が行になる。 */
const COL_WIDTH = 172;
const BOX_WIDTH = 132;
const ROW_HEIGHT = 34;
const BOX_HEIGHT = 26;
/** 同じ局面から出る手を囲む帯と、手の箱との間。 */
const BAND_INSET = 3;
const HEADER_HEIGHT = 22;
const PAD = 10;
/**
 * キーや一覧で選んだ手を置いておく範囲（枠の幅・高さに対する割合）。外へ出たら範囲の端まで滑らかに送る
 * （端に寄ってから大きく跳ぶと、どこへ動いたか見失うので）。先へ進む向きの手を見せるため、左寄り・上下の中ほどに取る。
 */
const FOLLOW_ZONE = { left: 0.15, right: 0.45, top: 0.25, bottom: 0.7 };
/** これより遠くへ送るときは、滑らかに送らずに跳ぶ（枠の大きさに対する割合）。 */
const SMOOTH_LIMIT = 1.5;
/** 滑らかに送っている途中とみなす時間。続けて押したキーは、送っている先から次の送り先を決める。 */
const SMOOTH_MS = 400;
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
/** 木に重ねた盤と、木の枠の端との間（`bottom-2 left-2`）。 */
const DOCK_INSET = 8;
const DOCK_LEAVE_MS = 300;
/**
 * 局面の盤のマスの大きさ。広い画面は木の左下に重ねて幅の DOCK_WIDE_WIDTH・高さの DOCK_WIDE_HEIGHT まで、
 * 狭い画面は木の下に高さの DOCK_NARROW_HEIGHT まで使い、盤の画面の盤と同じ上限まで大きくする。
 * 木に重ねるときは持ち駒を盤の上下に置き（左右に置くと、空のときも駒台の幅を取って木を広く隠すので）、
 * 盤の欄はおよそ幅がマス 9.4 個と 40px、高さがマス 10.8 個と 110px（見出し・ボタン・余白）。
 * 木の下に置くときは横幅が余るので持ち駒を左右に置き、幅がマス 10.6 個と 110px、高さがマス 9 個と 110px。
 */
const DOCK_MIN_CELL = 16;
const DOCK_MAX_CELL = 48;
const DOCK_WIDE_WIDTH = 0.4;
const DOCK_WIDE_HEIGHT = 0.65;
const DOCK_NARROW_HEIGHT = 0.45;

function dockCellSize(width: number, height: number, narrow: boolean) {
    const byWidth = narrow ? (width - 110) / 10.6 : (width * DOCK_WIDE_WIDTH - 40) / 9.4;
    const byHeight = narrow
        ? (height * DOCK_NARROW_HEIGHT - 110) / 9
        : (height * DOCK_WIDE_HEIGHT - 110) / 10.8;
    return Math.max(
        DOCK_MIN_CELL,
        Math.min(DOCK_MAX_CELL, Math.floor(Math.min(byWidth, byHeight))),
    );
}

/** 見えている範囲の外にも、この幅（px、拡大率を掛ける前）までは手を描いておく（送ったときに描き遅れが見えないように）。 */
const CULL_MARGIN = 400;
/**
 * 初めからたたんでおく枝の大きさ（その手より先の手の数）。全部開くと、大きな枝の後ろの兄弟の手が何画面も
 * 下へ押し出されるので、後ろに兄弟のある大きな枝だけは閉じておく（最後の兄弟は誰も押し出さないので開く）。
 */
const COLLAPSE_SUBTREE = 40;
/** 道筋の行に出す、分かれ目の手の数（深い手では前を省く）。 */
const TRAIL_LIMIT = 12;
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

/** 手ごとの、その先の手の数。子の番号は親より大きいので、後ろから足し上げれば済む。 */
function descendantCounts(tree: BookTree): Int32Array {
    const counts = new Int32Array(tree.nodes.length);
    for (let id = tree.nodes.length - 1; id > 0; id--) {
        const parent = tree.nodes[id].parent;
        if (parent !== null) counts[parent] += counts[id] + 1;
    }
    return counts;
}

/** 評価値の色。先手よし（正）は先手の印と同じ朱、後手よし（負）は藍。 */
export function valueClass(value: number) {
    if (value > 0) return "text-wafuu-shu";
    if (value < 0) return "text-wafuu-ai";
    return "text-wafuu-sumi-light";
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
    counts,
}: {
    tree: BookTree;
    book: BookData;
    layout: BookGraphLayout;
    isOpen: (node: BookTreeNode) => boolean;
    /** 手ごとの、その先の手の数（たたんだ枝の大きさとして出す）。 */
    counts: Int32Array;
    compact: boolean;
    onSelect: (id: number) => void;
    onToggle: (id: number, open: boolean, deep: boolean) => void;
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
    /** 親ごとの、描いた子の列と行の範囲（同じ局面から出る手を帯で囲む）。 */
    const groups = new Map<number, { col: number; first: number; last: number; size: number }>();
    for (const item of layout.items) {
        const node = tree.nodes[item.id];
        const x = boxLeft(item.col);
        const y = boxTop(item.row);
        if (item.id === keep || near(x, y, x + COL_WIDTH, y + BOX_HEIGHT)) shown.push(item);
        if (node.parent === null) continue;
        const group = groups.get(node.parent);
        if (group) {
            group.first = Math.min(group.first, item.row);
            group.last = Math.max(group.last, item.row);
            group.size += 1;
        } else groups.set(node.parent, { col: item.col, first: item.row, last: item.row, size: 1 });
        const parent = layout.byId.get(node.parent);
        if (!parent) continue;
        // 親から子へ下りる線は、両端が範囲の外でも途中が見えることがあるので、線の囲む範囲で決める。
        if (!near(boxLeft(parent.col) + BOX_WIDTH, boxTop(parent.row), x, y + BOX_HEIGHT)) continue;
        (node.inBook === false ? dashed : solid).push(edgePath(parent, item, area));
    }
    // 子の列には他の親の手が入らない（枝ごとにまとめて並べる）ので、帯どうしは重ならない。
    const bands = [...groups.values()]
        .filter((group) => group.size > 1)
        .map((group) => ({
            x: boxLeft(group.col) - BAND_INSET,
            y: boxTop(group.first) - BAND_INSET,
            width: BOX_WIDTH + BAND_INSET * 2,
            height: boxTop(group.last) - boxTop(group.first) + BOX_HEIGHT + BAND_INSET * 2,
        }))
        .filter((band) => near(band.x, band.y, band.x + band.width, band.y + band.height));
    return (
        <>
            <AreaSvg area={area}>
                {bands.map((band) => (
                    <rect
                        key={`${band.x}:${band.y}`}
                        {...band}
                        rx={6}
                        className="fill-wafuu-kincha/10 stroke-wafuu-kincha/30"
                        strokeWidth={1}
                    />
                ))}
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
                                        <span
                                            className={cn(
                                                "shrink-0 tabular-nums",
                                                valueClass(value),
                                            )}
                                        >
                                            {value}
                                        </span>
                                    )}
                                </>
                            )}
                        </button>
                        {branch && !compact && (
                            <button
                                type="button"
                                aria-label={`${label} の先を${open ? "たたむ" : `開く（${counts[id].toLocaleString("ja-JP")} 手）`}`}
                                aria-expanded={open}
                                title="Shift を押しながらで、先の枝もまとめて開く・たたむ"
                                onClick={(event) => onToggle(id, !open, event.shiftKey)}
                                className="absolute flex items-center justify-center rounded-full border border-wafuu-kincha bg-background text-[10px] leading-none text-wafuu-sumi-light hover:border-wafuu-sumi hover:text-wafuu-sumi"
                                style={{
                                    left: boxLeft(col) + BOX_WIDTH + 3,
                                    top: boxTop(row) + BOX_HEIGHT / 2 - 8,
                                    minWidth: 16,
                                    height: 16,
                                    paddingInline: open ? 0 : 3,
                                }}
                            >
                                {open ? "−" : `${counts[id].toLocaleString("ja-JP")}手`}
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

/** 手と評価値の見出し。 */
function SummaryLine({ tree, book, id }: { tree: BookTree; book: BookData; id: number }) {
    const node = tree.nodes[id];
    const value = bookValue(tree, book, node);
    return (
        <div className="flex items-baseline gap-2 text-xs text-wafuu-sumi">
            <span className="font-medium">
                {node.parent === null
                    ? "開始局面"
                    : `${(node.position.ply ?? 1) - 1}手目 ${moveLabel(tree, node)}`}
            </span>
            {value !== undefined && (
                <span className={cn("tabular-nums", valueClass(value))}>評価値 {value}</span>
            )}
        </div>
    );
}

/** 手を指した後の局面と、その手・評価値の見出し。 */
function PositionSummary({
    tree,
    book,
    id,
    flipBoard,
    cellSize,
    handPlacement,
}: {
    tree: BookTree;
    book: BookData;
    id: number;
    flipBoard: boolean;
    cellSize: number;
    handPlacement: "rows" | "sides";
}) {
    const node = tree.nodes[id];
    return (
        <>
            <SummaryLine tree={tree} book={book} id={id} />
            <StaticBoardView
                position={node.position}
                flipBoard={flipBoard}
                lastMove={deriveLastMove(node.move)}
                cellSize={cellSize}
                handPlacement={handPlacement}
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
    onPointerEnter,
    onPointerLeave,
    collapsed = false,
    onCollapse,
}: {
    tree: BookTree;
    book: BookData;
    id: number;
    hovering: boolean;
    /** 盤をたたんで見出しだけにしている（狭い画面で木を広く見るとき）。 */
    collapsed?: boolean;
    /** 盤をたたむ・出す（狭い画面だけ）。 */
    onCollapse?: (collapsed: boolean) => void;
    flipBoard: boolean;
    cellSize: number;
    overlay: boolean;
    onOpen?: (id: number) => void;
    ref?: Ref<HTMLElement>;
    onPointerEnter?: () => void;
    onPointerLeave?: () => void;
}) {
    return (
        <aside
            ref={ref}
            onPointerEnter={onPointerEnter}
            onPointerLeave={onPointerLeave}
            aria-label="局面"
            className={cn(
                "flex shrink-0 flex-col gap-1 bg-background p-2",
                overlay
                    ? "absolute bottom-2 left-2 z-20 rounded-lg border border-wafuu-border shadow-popover"
                    : "items-center border-t border-wafuu-border",
            )}
        >
            <div className="flex items-center gap-2 self-stretch">
                <p className="text-[11px] text-wafuu-sumi-light">
                    {hovering ? "マウスを置いた手" : "選んでいる手"}
                </p>
                {onCollapse && (
                    <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="ml-auto h-6 px-2 text-xs"
                        aria-expanded={!collapsed}
                        onClick={() => onCollapse(!collapsed)}
                    >
                        {collapsed ? "盤を出す" : "盤をたたむ"}
                    </Button>
                )}
            </div>
            {collapsed ? (
                <SummaryLine tree={tree} book={book} id={id} />
            ) : (
                <PositionSummary
                    tree={tree}
                    book={book}
                    id={id}
                    flipBoard={flipBoard}
                    cellSize={cellSize}
                    handPlacement={overlay ? "rows" : "sides"}
                />
            )}
            {onOpen && !collapsed && (
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
    const [boardCollapsed, setBoardCollapsed] = useState(false);
    const [jumpOpen, setJumpOpen] = useState(false);
    const [bookmarks, setBookmarks] = useState(() => loadBookmarks() ?? []);
    /** しおりを保存できているか。保存できなくなったら、開いている間のしおりだけで付け外しする。 */
    const bookmarksSaved = useRef(true);
    const bookmarked = bookmarks.includes(tree.nodes[selected]?.key ?? "");
    function toggleBookmark() {
        const key = tree.nodes[selected]?.key;
        if (key === undefined) return;
        // 保存できている間は保存されているものに足し引きする（別のタブで付けたしおりを消さないように）。
        const base = (bookmarksSaved.current ? loadBookmarks() : null) ?? bookmarks;
        const next = base.includes(key) ? base.filter((item) => item !== key) : [...base, key];
        bookmarksSaved.current = saveBookmarks(next);
        setBookmarks(next);
    }
    const jumpButton = useRef<HTMLButtonElement>(null);
    /** 一覧を閉じる。局面を選んで閉じたら木へ、それ以外は「移動」へフォーカスを戻す。 */
    function closeJump(selectedFromList: boolean) {
        setJumpOpen(false);
        if (selectedFromList) frame.current?.focus({ preventScroll: true });
        else jumpButton.current?.focus();
    }
    const [overrides, setOverrides] = useState<ReadonlyMap<number, boolean>>(() => new Map());
    const [zoomSetting, setZoomSetting] = useState(1);
    const zoom = explore ? zoomSetting : 1;
    const compact = zoom < COMPACT_ZOOM;
    const counts = descendantCounts(tree);
    const openByDefault = (node: BookTreeNode) => {
        if (node.parent === null || counts[node.id] <= COLLAPSE_SUBTREE) return true;
        const siblings = tree.nodes[node.parent].children;
        // 最後の兄弟は後ろの手を押し下げないので、大きくても開いておく。
        return siblings[siblings.length - 1] === node.id;
    };
    const path = ancestorsOf(tree, selected);
    // 選んでいる手の祖先はいつも開く（組み立て中に枝が大きくなってたたまれ、選んだ手が消えないように）。
    const isOpen = (node: BookTreeNode) =>
        (node.id !== selected && path.has(node.id)) ||
        (overrides.get(node.id) ?? openByDefault(node));
    const layout = layoutBookGraph(tree, isOpen);
    const width = PAD * 2 + layout.cols * COL_WIDTH;
    const height = HEADER_HEIGHT + PAD * 2 + layout.rows * ROW_HEIGHT;

    // たたんだ枝の中の手を選んだら（キー操作・一覧から）、その枝を開き直す。
    const reopenPath = useEffectEvent((ancestors: ReadonlySet<number>) => {
        const closed = [...ancestors].filter(
            (id) =>
                id !== selected &&
                tree.nodes[id] &&
                !(overrides.get(id) ?? openByDefault(tree.nodes[id])),
        );
        if (closed.length === 0) return;
        setOverrides((current) => {
            const next = new Map(current);
            for (const id of closed) next.set(id, true);
            return next;
        });
    });
    useEffect(() => {
        reopenPath(ancestorsOf(tree, selected));
    }, [tree, selected]);
    /** deep のときは、その先の枝もまとめて開く・たたむ。 */
    function toggle(id: number, open: boolean, deep: boolean) {
        // 選んでいる手の祖先をたたむときは、たたんだ手を選び直す（選んだ手が見えなくならないように）。
        if (!open && path.has(id) && id !== selected) onSelect(id);
        setOverrides((current) => {
            const next = new Map(current).set(id, open);
            if (!deep) return next;
            const stack = [...tree.nodes[id].children];
            for (let child = stack.pop(); child !== undefined; child = stack.pop()) {
                const node = tree.nodes[child];
                if (node.children.length === 0) continue;
                next.set(child, open);
                stack.push(...node.children);
            }
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
    /** 木に重ねた盤（広い画面で盤を出すとき）と、その大きさ。 */
    const [dockBox, setDockBox] = useState<HTMLElement | null>(null);
    const [dockSize, setDockSize] = useState({ width: 0, height: 0 });
    useEffect(() => {
        if (!dockBox) {
            setDockSize({ width: 0, height: 0 });
            return;
        }
        const observer = new ResizeObserver(() =>
            setDockSize({ width: dockBox.offsetWidth, height: dockBox.offsetHeight }),
        );
        observer.observe(dockBox);
        return () => observer.disconnect();
    }, [dockBox]);
    const dockHeight = dockSize.height;
    /** 前に送ったときの選んだ手の上端（木の座標）。 */
    const selectedTop = useRef<number | null>(null);
    /** 送り切れなかった横の位置と、そのときの位置。ホイール・引く・拡大縮小で動かされたら捨てる。 */
    const shortOf = useRef<{ wanted: number; left: number; top: number } | null>(null);
    /** 滑らかに送っている送り先と、送り始めた時刻。 */
    const gliding = useRef<{ left: number; top: number; at: number } | null>(null);
    const followSelection = useEffectEvent((placed: BookGraphLayout, key: string) => {
        const element = frame.current;
        const target = placed.byId.get(selected);
        if (!element || !target) return;
        const placedTop = boxTop(target.row);
        const lastTop = selectedTop.current;
        selectedTop.current = placedTop;
        if (scrolledTo.current === key) {
            // 組み立て中に上の枝が伸びて選んだ手が下へずれたら、見えていた手は同じ所に留める。
            if (lastTop !== null && placedTop !== lastTop) {
                const onScreen = lastTop * zoom - element.scrollTop;
                if (onScreen > -BOX_HEIGHT * zoom && onScreen < element.clientHeight) {
                    const glide = gliding.current;
                    element.scrollTop += (placedTop - lastTop) * zoom;
                    // 滑らかに送っている途中なら、ずらした送り先へ送り直す（ずらすと送るのが止まるので）。
                    if (glide && performance.now() - glide.at < SMOOTH_MS) {
                        glide.top += (placedTop - lastTop) * zoom;
                        element.scrollTo({ left: glide.left, top: glide.top, behavior: "smooth" });
                    }
                    if (shortOf.current) shortOf.current.top = element.scrollTop;
                }
            }
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
        const glide = gliding.current;
        const inGlide = !kept && glide !== null && performance.now() - glide.at < SMOOTH_MS;
        const fromX = inGlide ? glide.left : element.scrollLeft;
        const fromY = inGlide ? glide.top : element.scrollTop;
        let x = kept ? left - kept.x : fromX;
        let y = kept ? top - kept.y : fromY;
        const width = element.clientWidth;
        const height = element.clientHeight;
        const header = HEADER_HEIGHT * zoom;
        const box = BOX_HEIGHT * zoom;
        if (kept) {
            // 木の中で押した手は、隠れるときだけ動かす（押した手が指の下から逃げないように）。
            if (left < x) x = left;
            else if (left + colWidth > x + width) x = left + colWidth - width;
            if (top - header < y) y = top - header;
            else if (top + box > y + height) y = top + box - height;
        } else {
            // 狭い枠では、範囲の端を縮めて箱を枠の中に収める。
            const room = Math.max(0, width - colWidth);
            const zoneLeft = Math.min(width * FOLLOW_ZONE.left, room);
            const zoneRight = Math.max(zoneLeft, Math.min(width * FOLLOW_ZONE.right, room));
            if (left < x + zoneLeft) x = left - zoneLeft;
            else if (left > x + zoneRight) x = left - zoneRight;
            const zoneTop = header + (height - header) * FOLLOW_ZONE.top;
            const zoneBottom = Math.max(zoneTop + box, height * FOLLOW_ZONE.bottom);
            if (top < y + zoneTop) y = top - zoneTop;
            else if (top + box > y + zoneBottom) y = top + box - zoneBottom;
        }
        // 左下に重ねた盤の後ろに入るときは、盤の右へ送る。左の端の手で右へ送れなければ、盤の上へ送る。
        const above = element.clientHeight - dockSize.height - DOCK_INSET;
        // 送り先が負なら 0 で止まるので、止まった位置で重なりを見る。
        const behindBoard =
            dockSize.width > 0 &&
            left - Math.max(0, x) < DOCK_INSET + dockSize.width &&
            top + box > Math.max(0, y) + above;
        if (!kept && behindBoard) {
            const right = left - DOCK_INSET * 2 - dockSize.width;
            if (right >= 0) x = right;
            else if (above >= box + header + DOCK_INSET * 2) y = top + box + DOCK_INSET - above;
        }
        const toLeft = Math.max(0, x);
        const toTop = Math.max(0, y);
        // 木の右端より先へは送れない（組み立て中に右へ伸びたら、送り直す）。
        const short = toLeft > element.scrollWidth - width + 1;
        const smooth =
            !kept &&
            !short &&
            lastTop !== null &&
            Math.abs(toLeft - element.scrollLeft) < width * SMOOTH_LIMIT &&
            Math.abs(toTop - element.scrollTop) < height * SMOOTH_LIMIT &&
            !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        // 動かさないときも送り直す（滑らかに送っている途中なら、そこで止める）。
        element.scrollTo({ left: toLeft, top: toTop, behavior: smooth ? "smooth" : "auto" });
        gliding.current = smooth ? { left: toLeft, top: toTop, at: performance.now() } : null;
        if (!smooth && element.scrollLeft < x - 1)
            shortOf.current = { wanted: x, left: element.scrollLeft, top: element.scrollTop };
    });
    // 描く前に送る（組み立て中に選んだ手がずれて見えるフレームを出さない）。
    useLayoutEffect(() => {
        followSelection(layout, `${selected}:${explore}:${dockSize.width}x${dockSize.height}`);
    }, [selected, layout, explore, dockSize]);

    // 描く範囲。AREA_STEP 刻みにそろえ、刻みをまたいだときだけ描き直す（少し送るたびに描き直さないように）。
    const [view, setView] = useState<GraphView>({ left: 0, top: 0, width: 0, height: 0 });
    // 欄に出す手。手の上を通り過ぎるだけで切り替わらないように少し待ち、離れたら少し待って選んでいる手に戻す。
    const [docked, setDocked] = useState<number | null>(null);
    const dockTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    useEffect(() => () => clearTimeout(dockTimer.current), []);
    const hovered = useRef<number | null>(null);
    const hoverable = explore && previewMode === "dock";
    useEffect(() => {
        if (hoverable) return;
        clearTimeout(dockTimer.current);
        hovered.current = null;
        setDocked(null);
    }, [hoverable]);
    // 欄の上にマウスがある間は、出している手を選んでいる手に戻さない（欄のボタンで、見ている局面を開けるように）。
    function keepDocked() {
        clearTimeout(dockTimer.current);
    }
    function releaseDocked() {
        hovered.current = null;
        clearTimeout(dockTimer.current);
        dockTimer.current = setTimeout(() => setDocked(null), DOCK_LEAVE_MS);
    }
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
        gliding.current = null;
        setZoomSetting(target);
    }
    function fitAll() {
        const element = frame.current;
        if (!element) return;
        shortOf.current = null;
        gliding.current = null;
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
        gliding.current = null;
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
        gliding.current = null;
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
    const rootPly = tree.nodes[0].position.ply ?? 1;
    // 開始局面から選んだ手までの、分かれ目で選んだ手（一本道の手は省く）。
    const forks = [...path]
        .map((id) => tree.nodes[id])
        .filter(
            (node) =>
                node.parent === null ||
                node.id === selected ||
                tree.nodes[node.parent].children.length > 1,
        )
        .sort((a, b) => (a.position.ply ?? 0) - (b.position.ply ?? 0));
    const trail = forks.length > TRAIL_LIMIT ? forks.slice(-TRAIL_LIMIT) : forks;
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
            ref={narrow ? undefined : setDockBox}
            onPointerEnter={keepDocked}
            onPointerLeave={releaseDocked}
            collapsed={narrow && boardCollapsed}
            onCollapse={narrow ? setBoardCollapsed : undefined}
        />
    );
    return (
        <div
            ref={setRoot}
            className={cn("flex min-h-0 min-w-0 flex-col overflow-hidden", className)}
        >
            {/* 開始局面でも出す（選び直すたびに木の上端が動かないように）。 */}
            <div
                className={cn(
                    "flex shrink-0 items-center gap-1 border-b border-wafuu-border px-2 py-1 text-xs",
                    // 盤の画面では、右上の「全画面」ボタンの下に入らないようにする。
                    !explore && "pr-20",
                )}
            >
                <nav
                    aria-label="選んだ手までの道筋"
                    className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto whitespace-nowrap"
                >
                    {trail[0].parent !== null && (
                        <span aria-hidden="true" className="text-muted-foreground">
                            …
                        </span>
                    )}
                    {trail.map((node, index) => (
                        <span key={node.id} className="flex items-center gap-1">
                            {index > 0 && (
                                <span aria-hidden="true" className="text-muted-foreground">
                                    ›
                                </span>
                            )}
                            <button
                                type="button"
                                aria-current={node.id === selected ? "step" : undefined}
                                onClick={() => onSelect(node.id)}
                                className={cn(
                                    "rounded px-1 py-0.5 hover:bg-wafuu-washi-warm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                    node.id === selected && "bg-wafuu-kin font-semibold",
                                )}
                            >
                                {node.parent === null
                                    ? "開始"
                                    : `${(node.position.ply ?? 1) - 1} ${moveLabel(tree, node)}`}
                            </button>
                        </span>
                    ))}
                </nav>
                <button
                    type="button"
                    aria-pressed={bookmarked}
                    onClick={toggleBookmark}
                    className={cn(
                        "shrink-0 rounded border border-wafuu-border px-1.5 py-0.5 hover:bg-wafuu-washi-warm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        bookmarked && "border-wafuu-kincha bg-wafuu-kin/40 font-semibold",
                    )}
                >
                    しおり
                </button>
                <button
                    ref={jumpButton}
                    type="button"
                    aria-expanded={jumpOpen}
                    onClick={() => setJumpOpen((open) => !open)}
                    className={cn(
                        "shrink-0 rounded border border-wafuu-border px-1.5 py-0.5 hover:bg-wafuu-washi-warm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        jumpOpen && "bg-wafuu-washi-warm",
                    )}
                >
                    移動
                </button>
            </div>
            <div className="relative flex min-h-0 min-w-0 flex-1">
                {jumpOpen && (
                    <BookTreeJump
                        tree={tree}
                        book={book}
                        counts={counts}
                        bookmarks={bookmarks}
                        onSelect={onSelect}
                        onClose={closeJump}
                    />
                )}
                <section
                    ref={frame}
                    aria-label="定跡の木"
                    // 一覧から選んだあとにフォーカスを戻せるように（木が枠に収まってスクロールしないときも）。
                    tabIndex={-1}
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
                        // 盤を重ねている間は、下の端の手も盤の上まで送れるだけの余白を足す。
                        style={{ width: width * zoom, height: height * zoom + dockHeight }}
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
                                                {col === 0 ? "開始" : `${col + rootPly - 1}手目`}
                                            </span>
                                        ),
                                    )}
                            </div>
                            <GraphNodes
                                tree={tree}
                                book={book}
                                layout={layout}
                                isOpen={isOpen}
                                counts={counts}
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
