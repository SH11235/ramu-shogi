import {
    type BookData,
    bookTreeRow,
    createInitialPositionState,
    deriveLastMove,
    type PositionService,
    parseBookAsync,
    positionToBookKey,
    yieldTask,
} from "@shogi/app-core";
import { cn } from "@shogi/design-system";
import { type ReactElement, useEffect, useEffectEvent, useRef, useState } from "react";
import { Button } from "../button";
import { ChoiceGroup } from "../choice-group";
import { StaticBoardView } from "../static-board-view";
import { BookMoveList } from "./BookMoveList";
import { BookTreeGraph, type BookTreePreviewMode } from "./BookTreeGraph";
import { moveLabel } from "./bookLabels";
import { loadLastBookFile, saveLastBookFile } from "./lastBookFile";
import { useBookTree } from "./useBookTree";

const HIRATE_KEY = positionToBookKey(createInitialPositionState());

export const MAX_BOOK_FILE_BYTES = 64 * 1024 * 1024;
/**
 * 盤・指し手の列と木を左右に並べる幅。これより狭ければ盤を上、木を下に置く。
 * 横長で高さの低い画面（横向きのスマホ）は、縦に積むと収まらないので、狭くても左右に並べる。
 */
const WIDE_MIN_WIDTH = 900;
const LANDSCAPE_MIN_WIDTH = 480;
const MIN_CELL = 14;
/** 横に並べるとき、盤の下に指し手の一覧を出す本文の高さ（px）。 */
const MOVE_LIST_MIN_BODY_HEIGHT = 400;
/** 横に並べるとき、盤の下に操作の行を置ける本文の高さ（px）。 */
const CONTROLS_BELOW_MIN_HEIGHT = 260;
const NARROW_MIN_CELL = 16;
/** 縦に並べるとき、木の欄に残したい高さ（px）。 */
const NARROW_TREE_MIN_HEIGHT = 160;
const MAX_CELL = 48;
/** 盤の大きさの見積もりに使う寸法（px）。盤の枠と座標、盤の下の操作の行、スマホの木と指し手の切り替え。 */
const BOARD_FRAME_HEIGHT = 48;
const CONTROLS_HEIGHT = 40;
const PANE_SWITCH_HEIGHT = 36;
/** 縦に並べるときの、盤・操作の行・切り替え・木の間の 3 つの隙間。 */
const NARROW_GAPS_HEIGHT = 24;
/** 全画面で局面を出す所の選択肢（見出しは「局面」）。 */
const PREVIEW_MODES = [
    { value: "dock", label: "出す" },
    { value: "off", label: "出さない" },
] as const satisfies readonly { value: BookTreePreviewMode; label: string }[];
/** 盤の上下の持ち駒の段の、マスに比例しない部分（枠と余白、2 段分）。 */
const HAND_ROWS_FIXED_HEIGHT = 32;
/** 盤の左右の駒台の、マスに比例しない部分（枠・余白と盤との隙間、2 列分）と盤の枠。 */
const SIDE_HANDS_FIXED_WIDTH = 100;
/** 盤と持ち駒 2 列（段）がマス何個分か（9 + 0.8 × 2）。 */
const BOARD_WIDTH_IN_CELLS = 10.6;
/** 横に並べるとき、盤の下に残す指し手の一覧の高さ（px）。 */
const MOVE_LIST_MIN_HEIGHT = 150;
const INITIAL_POSITION = createInitialPositionState();

interface LoadedBook {
    id: number;
    name: string;
    data: BookData;
}

function useElementSize(element: HTMLElement | null) {
    const [size, setSize] = useState<{ width: number; height: number } | null>(null);
    useEffect(() => {
        if (!element) return;
        const observer = new ResizeObserver(([entry]) => {
            const { width, height } = entry.contentRect;
            if (width > 0) setSize({ width, height });
        });
        observer.observe(element);
        return () => observer.disconnect();
    }, [element]);
    return size;
}

/**
 * 盤（持ち駒は盤の左右）の 1 マスの大きさ。盤の高さはおよそマス 9 個と枠、幅はマス 9 個と左右の駒台。
 * 横に並べるときは、盤の下に指し手の一覧と操作の行が入る高さと、木に半分以上の幅を残す。
 */
function wideCellSize(width: number, height: number) {
    // 高さの低い画面では指し手の一覧の高さを諦め、盤と操作の行を収める。
    const listHeight = height >= 600 ? MOVE_LIST_MIN_HEIGHT : 0;
    const byHeight = (height - listHeight - BOARD_FRAME_HEIGHT - CONTROLS_HEIGHT) / 9;
    // 幅はマス 9 個と左右の駒台（それぞれマスの 0.8 倍）、駒台の枠・余白と盤の枠。
    const byWidth = (width * 0.5 - SIDE_HANDS_FIXED_WIDTH) / BOARD_WIDTH_IN_CELLS;
    return Math.max(MIN_CELL, Math.min(MAX_CELL, Math.floor(Math.min(byHeight, byWidth))));
}

/**
 * 縦に並べるとき（スマホ）の 1 マスの上限。盤の上下の持ち駒の段（マスの 0.8 倍と枠）と、
 * 盤の下の操作の行・切り替え・木の欄が画面の高さに収まる大きさにする。
 */
function narrowMaxCell(height: number) {
    const rest =
        NARROW_TREE_MIN_HEIGHT +
        CONTROLS_HEIGHT +
        PANE_SWITCH_HEIGHT +
        NARROW_GAPS_HEIGHT +
        HAND_ROWS_FIXED_HEIGHT +
        BOARD_FRAME_HEIGHT;
    // 高さはマス 9 個と上下の持ち駒の段（それぞれマスの 0.8 倍）。
    return Math.max(
        NARROW_MIN_CELL,
        Math.min(MAX_CELL, Math.floor((height - rest) / BOARD_WIDTH_IN_CELLS)),
    );
}

/**
 * やねうら王形式の定跡を、平手からたどる木と盤で見る画面。
 * 画面の高さに収め、盤を常に見せたまま、木と指し手の一覧だけを中で送る。
 */
export function BookTreeViewer({
    fetchLegalMoves,
    className,
}: {
    fetchLegalMoves: PositionService["getLegalMoves"];
    className?: string;
}): ReactElement {
    const [book, setBook] = useState<LoadedBook | null>(null);
    const [selected, setSelected] = useState(0);
    const [flip, setFlip] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [dragging, setDragging] = useState(false);
    const [mobilePane, setMobilePane] = useState<"tree" | "moves">("tree");
    const [fullscreen, setFullscreen] = useState(false);
    const [previewMode, setPreviewMode] = useState<BookTreePreviewMode>("dock");
    const [dialog, setDialog] = useState<HTMLDivElement | null>(null);
    const fullscreenButton = useRef<HTMLButtonElement>(null);
    const restoreFocus = useRef(false);
    function closeFullscreen() {
        restoreFocus.current = true;
        setFullscreen(false);
    }
    // 閉じたら、開いたボタンへフォーカスを戻す（全画面の中のボタンは消えるので）。
    useEffect(() => {
        if (fullscreen || !restoreFocus.current) return;
        restoreFocus.current = false;
        fullscreenButton.current?.focus();
    }, [fullscreen]);
    // 全画面の間は Tab を中で回す（隠れた盤の画面のボタンへ移って、見えないまま押さないように）。
    useEffect(() => {
        if (!dialog) return;
        const trap = (event: KeyboardEvent) => {
            if (event.key !== "Tab") return;
            const items = [
                ...dialog.querySelectorAll<HTMLElement>("button:not(:disabled), [tabindex]"),
            ].filter((element) => element.tabIndex >= 0);
            if (items.length === 0) return;
            const first = items[0];
            const last = items[items.length - 1];
            const active = document.activeElement;
            const outside = !dialog.contains(active);
            if (outside || (event.shiftKey ? active === first : active === last)) {
                event.preventDefault();
                (event.shiftKey ? last : first).focus();
            }
        };
        // 押したボタンが無効になってフォーカスが外れても回せるように、文書全体で受ける。
        document.addEventListener("keydown", trap);
        return () => document.removeEventListener("keydown", trap);
    }, [dialog]);
    const [rootKey, setRootKey] = useState<string | undefined>(undefined);
    const { session, tree } = useBookTree(book?.data, fetchLegalMoves, rootKey);
    /**
     * 開始局面の候補。開始局面を選んで作り直した木は候補を持たないので、最初の木の候補を覚えておく。
     */
    const [roots, setRoots] = useState<string[]>([]);
    useEffect(() => {
        if (rootKey !== undefined || !tree) return;
        setRoots((current) =>
            current.length === tree.roots.length &&
            current.every((root, i) => root === tree.roots[i])
                ? current
                : tree.roots,
        );
    }, [tree, rootKey]);
    const [body, setBody] = useState<HTMLDivElement | null>(null);
    const size = useElementSize(body);
    const fileRef = useRef<HTMLInputElement>(null);
    const readId = useRef(0);

    useEffect(
        () => () => {
            readId.current++;
        },
        [],
    );

    const node = tree?.nodes[selected];
    const position = node?.position ?? INITIAL_POSITION;

    // 自動の組み立てが上限で止まったあと、未展開の手を選んだら、その先を組み立てる。組み立て中は
    // 自動の展開がいずれ届くので頼まない。同じ手は一度だけ頼む（木が更新されるたびに積まないように）。
    const requested = useRef<{ session: unknown; ids: Set<number> }>({
        session: null,
        ids: new Set(),
    });
    useEffect(() => {
        if (!session || !tree || tree.building) return;
        const target = tree.nodes[selected];
        const source = target?.mergeTo === undefined ? target : tree.nodes[target.mergeTo];
        if (source?.status !== "pending") return;
        if (requested.current.session !== session) requested.current = { session, ids: new Set() };
        if (requested.current.ids.has(source.id)) return;
        requested.current.ids.add(source.id);
        void session.builder.expandFrom(source.id);
    }, [session, tree, selected]);

    // 開始局面から一本道が続く定跡（課題局面から先だけを並べたもの）は、最初に分かれる手を選んで、
    // そこを開いた状態で見せる。読み込んでから何も選んでいないうちに一度だけ行う。
    const skipped = useRef<number | null>(null);
    useEffect(() => {
        if (!book || !tree || skipped.current === book.id) return;
        if (selected !== 0) {
            skipped.current = book.id;
            return;
        }
        const row = bookTreeRow(tree, 0);
        // 警告のある局面は飛ばさない。最後まで一本道の定跡は、開始局面のままにする。
        const stop = row.findIndex((node) => node.error !== undefined);
        const last = row[stop === -1 ? row.length - 1 : stop];
        if (last.status === "pending" && tree.building) return;
        skipped.current = book.id;
        if (last.id !== 0 && last.children.length > 1) setSelected(last.id);
    }, [book, tree, selected]);

    async function loadFile(file: File) {
        setError(null);
        if (file.size > MAX_BOOK_FILE_BYTES) {
            setError(`ファイルが大きすぎます（上限 ${MAX_BOOK_FILE_BYTES / (1024 * 1024)} MB）`);
            return;
        }
        const id = ++readId.current;
        session?.builder.cancel();
        setBook(null);
        setBusy(true);
        try {
            const text = await file.text();
            await yieldTask();
            if (id !== readId.current) return;
            const data = await parseBookAsync(text, () => id !== readId.current);
            if (id !== readId.current) return;
            setBook({ id, name: file.name, data });
            setRootKey(undefined);
            setRoots([]);
            setSelected(0);
            void saveLastBookFile(file);
        } catch {
            if (id === readId.current) setError("ファイルを読み込めませんでした");
        } finally {
            if (id === readId.current) setBusy(false);
        }
    }
    // 再読み込みしたら、最後に開いた定跡を開き直す（開くより先にファイルを選んでいたら、そちらを優先する）。
    const picked = useRef(false);
    const restore = useEffectEvent((file: File) => {
        if (!picked.current) void loadFile(file);
    });
    useEffect(() => {
        let active = true;
        void loadLastBookFile().then((file) => {
            if (active && file) restore(file);
        });
        return () => {
            active = false;
        };
    }, []);
    // 画面のどこへ落としても読み込む（ファイルを選ぶ欄を探さなくてよいように）。
    const [root, setRoot] = useState<HTMLDivElement | null>(null);
    const dropFile = useEffectEvent((file: File) => {
        picked.current = true;
        void loadFile(file);
    });
    useEffect(() => {
        if (!root) return;
        const over = (event: DragEvent) => {
            if (!event.dataTransfer?.types.includes("Files")) return;
            event.preventDefault();
            setDragging(true);
        };
        // 子の要素の境目でも dragleave が起きるので、画面の外へ出たときだけ消す。
        const leave = (event: DragEvent) => {
            if (!(event.relatedTarget instanceof Node && root.contains(event.relatedTarget)))
                setDragging(false);
        };
        const drop = (event: DragEvent) => {
            event.preventDefault();
            setDragging(false);
            const file = event.dataTransfer?.files[0];
            if (file) dropFile(file);
        };
        root.addEventListener("dragover", over);
        root.addEventListener("dragleave", leave);
        root.addEventListener("drop", drop);
        return () => {
            root.removeEventListener("dragover", over);
            root.removeEventListener("dragleave", leave);
            root.removeEventListener("drop", drop);
        };
    }, [root]);

    const goParent = () => {
        const parent = node?.parent;
        if (parent !== null && parent !== undefined) setSelected(parent);
    };
    const goChild = () => {
        if (!tree || !node) return;
        const source = node.mergeTo === undefined ? node : tree.nodes[node.mergeTo];
        if (source.children[0] !== undefined) setSelected(source.children[0]);
    };
    const goSibling = (step: number) => {
        if (!tree || !node || node.parent === null) return;
        const siblings = tree.nodes[node.parent].children;
        const next = siblings[siblings.indexOf(node.id) + step];
        if (next !== undefined) setSelected(next);
    };
    // ←→ で手を戻す・進める、↑↓ で同じ局面からの別の手へ移る。
    const onKey = useEffectEvent((event: KeyboardEvent) => {
        if (event.altKey || event.ctrlKey || event.metaKey) return;
        if (event.key === "Escape" && fullscreen) {
            event.preventDefault();
            closeFullscreen();
            return;
        }
        const target = event.target;
        if (
            target instanceof Element &&
            target.closest("input, textarea, select, [contenteditable='true']")
        )
            return;
        const actions: Record<string, () => void> = {
            ArrowLeft: goParent,
            ArrowRight: goChild,
            ArrowUp: () => goSibling(-1),
            ArrowDown: () => goSibling(1),
        };
        const action = actions[event.key];
        if (!action || !tree) return;
        event.preventDefault();
        action();
    });
    useEffect(() => {
        const listener = (event: KeyboardEvent) => onKey(event);
        window.addEventListener("keydown", listener);
        return () => window.removeEventListener("keydown", listener);
    }, []);

    const wide =
        !!size &&
        (size.width >= WIDE_MIN_WIDTH ||
            (size.width >= LANDSCAPE_MIN_WIDTH && size.width > size.height));
    const ply = (position.ply ?? 1) - 1;
    // 高さのごく低い画面（横向きの小さいスマホ）では、盤の下に操作の行が入らないので木の上に置く。
    const controlsBesideTree = wide && !!size && size.height < CONTROLS_BELOW_MIN_HEIGHT;
    // 横に並べて高さの低いときは、盤の下の指し手の一覧が細い帯になって読めないので出さない（評価値は木の箱にも出る）。
    const showMoveList = !wide || (!!size && size.height >= MOVE_LIST_MIN_BODY_HEIGHT);
    const board = (
        <StaticBoardView
            position={position}
            flipBoard={flip}
            lastMove={deriveLastMove(node?.move)}
            handPlacement={wide ? "sides" : "rows"}
            handFrame="outline"
            handSize={wide ? "medium" : "auto"}
            hideEmptyHandPieces
            reserveHandHeight
            cellSize={wide && size ? wideCellSize(size.width, size.height) : undefined}
            fit={
                wide
                    ? undefined
                    : {
                          minCellSize: NARROW_MIN_CELL,
                          maxCellSize: size ? narrowMaxCell(size.height) : MAX_CELL,
                          viewportInset: 32,
                      }
            }
            className={wide ? "self-center" : "w-full items-center gap-1"}
        />
    );
    const controls = (
        <div className="flex items-center gap-1.5">
            <Button
                variant="outline"
                size="sm"
                disabled={selected === 0}
                onClick={() => setSelected(0)}
                aria-label="開始局面へ"
                title="開始局面へ"
            >
                |&lt;
            </Button>
            <Button
                variant="outline"
                size="sm"
                disabled={!node || node.parent === null}
                onClick={goParent}
                aria-label="1 手戻る"
                title="1 手戻る（←）"
            >
                &lt;
            </Button>
            <output className="min-w-0 flex-1 truncate text-center text-sm text-wafuu-sumi">
                {tree && node && node.parent !== null
                    ? `${ply}手目 ${moveLabel(tree, node)}`
                    : "開始局面"}
            </output>
            <Button
                variant="outline"
                size="sm"
                aria-pressed={flip}
                onClick={() => setFlip(!flip)}
                title="盤を反転"
            >
                反転
            </Button>
        </div>
    );
    // 全画面では木の欄そのものを画面いっぱいに広げる（別に描き直すと、開いた枝や送った位置が戻るので）。
    const treePane = book && tree && (
        <div
            ref={fullscreen ? setDialog : undefined}
            {...(fullscreen && {
                role: "dialog",
                "aria-modal": true,
                "aria-label": "定跡の木（全画面）",
            })}
            className={cn(
                "flex min-h-0 min-w-0 flex-col",
                fullscreen
                    ? "fixed inset-0 z-modal gap-2 bg-background p-3 text-wafuu-sumi"
                    : "relative flex-1",
            )}
        >
            {fullscreen && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <h2 className="shrink-0 whitespace-nowrap font-display text-base">定跡の木</h2>
                    <output className="min-w-0 flex-1 truncate text-sm lg:flex-none">
                        {node && node.parent !== null
                            ? `${ply}手目 ${moveLabel(tree, node)}`
                            : "開始局面"}
                    </output>
                    <p className="hidden min-w-0 flex-1 truncate text-xs text-muted-foreground lg:block">
                        Ctrl＋ホイールで拡大縮小、Esc で閉じます。
                    </p>
                    <fieldset className="order-last flex basis-full items-center gap-1.5 sm:order-none sm:ml-auto sm:basis-auto">
                        <legend className="sr-only">局面</legend>
                        <span aria-hidden="true" className="text-xs text-wafuu-sumi-light">
                            局面
                        </span>
                        <ChoiceGroup
                            size="sm"
                            options={PREVIEW_MODES}
                            value={previewMode}
                            onChange={setPreviewMode}
                            className="flex-nowrap gap-1"
                            optionClassName="px-2 py-1 text-xs"
                        />
                    </fieldset>
                    <Button
                        autoFocus
                        variant="outline"
                        size="sm"
                        className="shrink-0"
                        onClick={closeFullscreen}
                    >
                        盤に戻る
                    </Button>
                </div>
            )}
            <BookTreeGraph
                key={book.id}
                tree={tree}
                book={book.data}
                selected={selected}
                onSelect={setSelected}
                flipBoard={flip}
                explore={fullscreen}
                preview={previewMode}
                onActivate={(id) => {
                    setSelected(id);
                    closeFullscreen();
                }}
                className="flex-1 rounded-lg border border-wafuu-border bg-wafuu-washi"
            />
            {!fullscreen && (
                <Button
                    ref={fullscreenButton}
                    variant="outline"
                    size="sm"
                    className="absolute top-0.5 right-1 z-20 h-6 bg-background px-2 text-xs"
                    title="盤を隠して木を画面いっぱいに広げる"
                    onClick={() => setFullscreen(true)}
                >
                    全画面
                </Button>
            )}
        </div>
    );
    const status = !tree
        ? null
        : `${tree.expanded.toLocaleString("ja-JP")} 局面を展開${tree.building ? "・組み立て中…" : tree.capped ? "・自動で展開する上限に達しました（未展開の手は選ぶと読み込みます）" : ""}`;
    // 組み立ての進み具合。分母は定跡の局面数（と自動で展開する上限）なので、届かない局面があれば 100% の前で終わる。
    const progress =
        tree?.building && tree.goal > 0
            ? Math.min(99, Math.floor((tree.expanded / tree.goal) * 100))
            : null;
    const withHirate = roots[0] === HIRATE_KEY;
    const rootLabel = (key: string, index: number) => {
        if (key === HIRATE_KEY) return "平手";
        const ply = book?.data.plies?.get(key);
        const number = withHirate ? index : index + 1;
        return `候補 ${number}${ply === undefined ? "" : `（${ply}手目の局面）`}`;
    };

    return (
        <div
            ref={setRoot}
            className={cn("relative flex min-h-0 flex-col gap-2 text-wafuu-sumi", className)}
        >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                    定跡ファイルを選ぶ
                </Button>
                <input
                    ref={fileRef}
                    type="file"
                    className="sr-only"
                    aria-label="定跡ファイル"
                    accept=".db,.txt"
                    onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        if (!file) return;
                        picked.current = true;
                        void loadFile(file);
                    }}
                />
                <output className="min-w-0 truncate text-sm font-medium">
                    {busy ? "読み込み中…" : book?.name}
                </output>
                {book && (
                    <span className="hidden text-xs text-muted-foreground sm:inline">
                        {book.data.stats.positions.toLocaleString("ja-JP")} 局面・
                        {book.data.stats.moves.toLocaleString("ja-JP")} 手
                    </span>
                )}
                {book && book.data.warnings.length > 0 && (
                    <details className="text-xs text-status-warning">
                        <summary className="cursor-pointer">
                            警告 {book.data.warnings.length} 件
                        </summary>
                        <ul className="absolute z-20 mt-1 max-w-md rounded-md border border-wafuu-border bg-background p-2 shadow-md">
                            {book.data.warnings.slice(0, 10).map((warning) => (
                                <li key={warning.line}>
                                    {warning.line} 行目: {warning.message}
                                </li>
                            ))}
                        </ul>
                    </details>
                )}
                {tree && roots.length > 0 && (
                    <div className="flex items-center gap-1 text-xs text-wafuu-sumi-light">
                        <span
                            title={
                                withHirate
                                    ? "平手から始まる手順と、定跡の中の局面から始まる手順があります"
                                    : "平手から定跡に入れないので、定跡の中の局面から始めます"
                            }
                        >
                            開始局面
                        </span>
                        {roots.length > 1 ? (
                            <select
                                aria-label="開始局面"
                                value={rootKey ?? roots[0]}
                                onChange={(event) => {
                                    setRootKey(event.target.value);
                                    setSelected(0);
                                    skipped.current = null;
                                }}
                                className="rounded border border-wafuu-border bg-background px-1 py-0.5 text-xs text-wafuu-sumi"
                            >
                                {roots.map((key, index) => (
                                    <option key={key} value={key}>
                                        {rootLabel(key, index)}
                                    </option>
                                ))}
                            </select>
                        ) : (
                            <span className="text-wafuu-sumi">定跡の中の局面</span>
                        )}
                    </div>
                )}
                {status && (
                    <div className="ml-auto flex items-center gap-2">
                        {progress !== null && (
                            <div
                                role="progressbar"
                                aria-label="木の組み立て"
                                aria-valuemin={0}
                                aria-valuemax={100}
                                aria-valuenow={progress}
                                className="h-1.5 w-20 overflow-hidden rounded-full bg-wafuu-washi-warm"
                            >
                                <div
                                    className="h-full bg-wafuu-kincha transition-[width]"
                                    style={{ width: `${progress}%` }}
                                />
                            </div>
                        )}
                        <output aria-live="polite" className="text-xs text-muted-foreground">
                            {progress !== null && `${progress}%・`}
                            {status}
                        </output>
                    </div>
                )}
            </div>
            {error && (
                <p role="alert" className="text-sm text-destructive">
                    {error}
                </p>
            )}
            <div ref={setBody} className="flex min-h-0 min-w-0 flex-1">
                {!book ? (
                    <div
                        className={cn(
                            "flex flex-1 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-wafuu-border p-6 text-center text-sm",
                            dragging && "border-wafuu-sumi bg-wafuu-washi-warm",
                        )}
                    >
                        <p>
                            やねうら王形式（UTF-8）の定跡ファイルを選ぶか、ここへドロップしてください。
                        </p>
                        <p className="text-xs text-muted-foreground">
                            ファイルはこの画面の中だけで読み、送信しません。リロードすると消えます。
                        </p>
                        <Button variant="outline" onClick={() => fileRef.current?.click()}>
                            定跡ファイルを選ぶ
                        </Button>
                    </div>
                ) : wide ? (
                    <div className="flex min-h-0 min-w-0 flex-1 gap-3">
                        <div className="flex min-h-0 shrink-0 flex-col gap-2">
                            {board}
                            {!controlsBesideTree && controls}
                            {showMoveList && (
                                <BookMoveList
                                    tree={tree}
                                    book={book.data}
                                    nodeId={selected}
                                    onSelect={setSelected}
                                    className="w-0 min-w-full flex-1 rounded-lg border border-wafuu-border bg-background"
                                />
                            )}
                        </div>
                        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
                            {controlsBesideTree && controls}
                            {treePane || (
                                <div className="flex-1 rounded-lg border border-wafuu-border" />
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
                        {board}
                        {controls}
                        <ChoiceGroup
                            options={[
                                { value: "tree", label: "定跡の木" },
                                { value: "moves", label: "この局面の指し手" },
                            ]}
                            value={mobilePane}
                            onChange={setMobilePane}
                            size="sm"
                        />
                        {mobilePane === "moves" || !tree ? (
                            <BookMoveList
                                tree={tree}
                                book={book.data}
                                nodeId={selected}
                                onSelect={setSelected}
                                className="min-h-0 flex-1 rounded-lg border border-wafuu-border bg-background"
                            />
                        ) : (
                            treePane
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
