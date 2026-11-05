import {
    type BookData,
    createInitialPositionState,
    deriveLastMove,
    type PositionService,
    parseBookAsync,
    yieldTask,
} from "@shogi/app-core";
import { cn } from "@shogi/design-system";
import { type ReactElement, useEffect, useEffectEvent, useRef, useState } from "react";
import { Button } from "../button";
import { ChoiceGroup } from "../choice-group";
import { StaticBoardView } from "../static-board-view";
import { BookMoveList } from "./BookMoveList";
import { BookTreeGraph, moveLabel } from "./BookTreeGraph";
import { useBookTree } from "./useBookTree";

export const MAX_BOOK_FILE_BYTES = 64 * 1024 * 1024;
/** 盤・指し手の列と木を左右に並べる幅。これより狭ければ盤を上、木を下に置く。 */
const WIDE_MIN_WIDTH = 900;
const MIN_CELL = 24;
const MAX_CELL = 48;
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
    const byHeight = (height - MOVE_LIST_MIN_HEIGHT - 48 - 40) / 9;
    const byWidth = (width * 0.5 - 100) / 10.6;
    return Math.max(MIN_CELL, Math.min(MAX_CELL, Math.floor(Math.min(byHeight, byWidth))));
}

/**
 * 縦に並べるとき（スマホ）の 1 マスの上限。盤の上下の持ち駒の段（マスの 0.8 倍と枠）と、
 * 盤の下の操作の行・切り替え・木の欄（最低 220px）が画面の高さに収まる大きさにする。
 */
function narrowMaxCell(height: number) {
    return Math.max(
        22,
        Math.min(MAX_CELL, Math.floor((height - 220 - 40 - 36 - 24 - 32 - 33) / 10.6)),
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
    const { session, tree } = useBookTree(book?.data, fetchLegalMoves);
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

    // 未展開の手を選んだら、その先を組み立てる。
    useEffect(() => {
        if (!session || !tree) return;
        const target = tree.nodes[selected];
        const source = target?.mergeTo === undefined ? target : tree.nodes[target.mergeTo];
        if (source?.status === "pending") void session.builder.expandFrom(source.id);
    }, [session, tree, selected]);

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
            setSelected(0);
        } catch {
            if (id === readId.current) setError("ファイルを読み込めませんでした");
        } finally {
            if (id === readId.current) setBusy(false);
        }
    }
    // 画面のどこへ落としても読み込む（ファイルを選ぶ欄を探さなくてよいように）。
    const [root, setRoot] = useState<HTMLDivElement | null>(null);
    const dropFile = useEffectEvent((file: File) => void loadFile(file));
    useEffect(() => {
        if (!root) return;
        const over = (event: DragEvent) => {
            if (!event.dataTransfer?.types.includes("Files")) return;
            event.preventDefault();
            setDragging(true);
        };
        const leave = (event: DragEvent) => {
            if (event.target === root) setDragging(false);
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

    const wide = (size?.width ?? 0) >= WIDE_MIN_WIDTH;
    const ply = (position.ply ?? 1) - 1;
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
                          minCellSize: 22,
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
    const status = !tree
        ? null
        : `${tree.expanded.toLocaleString("ja-JP")} 局面を展開${tree.building ? "・組み立て中…" : tree.capped ? "・自動で展開する上限に達しました（未展開の手は選ぶと読み込みます）" : ""}`;

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
                        if (file) void loadFile(file);
                    }}
                />
                <output className="min-w-0 truncate text-sm font-medium">
                    {busy ? "読み込み中…" : book?.name}
                </output>
                {book && (
                    <span className="text-xs text-muted-foreground">
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
                {status && (
                    <output aria-live="polite" className="ml-auto text-xs text-muted-foreground">
                        {status}
                    </output>
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
                            {controls}
                            <BookMoveList
                                tree={tree}
                                book={book.data}
                                nodeId={selected}
                                onSelect={setSelected}
                                className="flex-1 rounded-lg border border-wafuu-border bg-background"
                            />
                        </div>
                        {tree ? (
                            <BookTreeGraph
                                key={book.id}
                                tree={tree}
                                book={book.data}
                                selected={selected}
                                onSelect={setSelected}
                                className="min-w-0 flex-1 rounded-lg border border-wafuu-border bg-wafuu-washi"
                            />
                        ) : (
                            <div className="flex-1 rounded-lg border border-wafuu-border" />
                        )}
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
                                className="min-h-40 flex-1 rounded-lg border border-wafuu-border bg-background"
                            />
                        ) : (
                            <BookTreeGraph
                                key={book.id}
                                tree={tree}
                                book={book.data}
                                selected={selected}
                                onSelect={setSelected}
                                className="min-h-40 flex-1 rounded-lg border border-wafuu-border bg-wafuu-washi"
                            />
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
