import {
    applyMoveWithState,
    type BookData,
    type BookTree,
    bookTreePath,
    createInitialPositionState,
    findBookBranchesAsync,
    normalizeBookKey,
    type PositionService,
    type PositionState,
    parseBookAsync,
    parseStudySfen,
    positionToBookKey,
    yieldTask,
} from "@shogi/app-core";
import { type ChangeEvent, useEffect, useEffectEvent, useRef, useState } from "react";
import { Button } from "../button";
import { formatMoveSimple } from "../shogi-match/utils/kifFormat";
import { BookPositionDetails } from "./BookPositionDetails";
import { BookTreeDisplay } from "./BookTreeDisplay";
import { useBookTree } from "./useBookTree";

export const MAX_BOOK_FILE_BYTES = 64 * 1024 * 1024;
const PAGE_SIZE = 50;
interface Step {
    root?: boolean;
    position: PositionState;
    label: string;
    move?: string;
}
interface LoadedBook {
    id: number;
    name: string;
    data: BookData;
    branches: Record<PositionState["turn"], string[]>;
}

export function BookTreeViewer({
    fetchLegalMoves,
}: {
    fetchLegalMoves: PositionService["getLegalMoves"];
}) {
    const [book, setBook] = useState<LoadedBook | null>(null);
    const [selection, setSteps] = useState<Step[]>(() => [
        { position: createInitialPositionState(), label: "初期局面", root: true },
    ]);
    const [flip, setFlip] = useState(false);
    const [viewSide, setViewSide] = useState<PositionState["turn"]>("sente");
    const { session, tree, revision } = useBookTree(book?.data, viewSide, fetchLegalMoves);
    const [reveal, setReveal] = useState(0);
    const [unreachableLimit, setUnreachableLimit] = useState(PAGE_SIZE);
    const [jump, setJump] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [limit, setLimit] = useState(PAGE_SIZE);
    const [connections, setConnections] = useState<{
        book: LoadedBook;
        key: string;
        moves: string[];
        error?: string;
    } | null>(null);
    const fileRef = useRef<HTMLInputElement>(null);
    const boardRef = useRef<HTMLDivElement>(null);
    const readId = useRef(0);
    const key = positionToBookKey(selection[selection.length - 1].position);
    const steps = selection;
    let selected: number | undefined = tree && steps[0].root ? 0 : undefined;
    for (const step of steps.slice(1)) {
        if (tree && selected !== undefined) {
            selected = tree.nodes[selected].mergeTo ?? selected;
        }
        selected =
            selected === undefined
                ? undefined
                : tree?.nodes[selected].children.find((id) => tree.nodes[id].move === step.move);
    }
    useEffect(() => {
        if (selection[0].root || !tree) return;
        const id = tree.firstByKey.get(key);
        if (id !== undefined) setSteps(nodeSteps(tree, id));
    }, [selection, tree, key]);
    const position = steps[steps.length - 1].position;
    const bookMoves = book?.data.positions.get(key);
    const ownTurn = position.turn === viewSide;
    const branches = book?.branches[viewSide] ?? [];
    const requestMoves = useEffectEvent(async (sfen: string) =>
        session ? session.legalMoves(sfen) : fetchLegalMoves(sfen, []),
    );

    useEffect(() => {
        if (!book || ownTurn || !session) return;
        let cancelled = false;
        const current = parseStudySfen(key);
        void requestMoves(`${key} 1`)
            .then((moves) => {
                const connected = moves.filter((move) => {
                    const result = applyMoveWithState(current, move);
                    return result.ok && book.data.positions.has(positionToBookKey(result.next));
                });
                if (!cancelled) setConnections({ book, key, moves: connected });
            })
            .catch(() => {
                if (!cancelled)
                    setConnections({ book, key, moves: [], error: "合法手を取得できませんでした" });
            });
        return () => {
            cancelled = true;
        };
    }, [book, ownTurn, key, session]);

    useEffect(
        () => () => {
            readId.current++;
        },
        [],
    );

    async function loadFile(event: ChangeEvent<HTMLInputElement>) {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;
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
            const branches = await findBookBranchesAsync(data, () => id !== readId.current);
            if (id !== readId.current) return;
            setBook({ id, name: file.name, data, branches });
            setSteps([{ position: createInitialPositionState(), label: "初期局面", root: true }]);
            setConnections(null);
            setUnreachableLimit(PAGE_SIZE);
            setLimit(PAGE_SIZE);
        } catch {
            if (id === readId.current) setError("ファイルを読み込めませんでした");
        }
        if (id === readId.current) setBusy(false);
    }
    function selectNode(id: number) {
        if (!tree) return;
        setSteps(nodeSteps(tree, id));
        setError(null);
        setReveal((value) => value + 1);
    }
    function selectStep(index: number) {
        setSteps(steps.slice(0, index + 1));
        setError(null);
        setReveal((value) => value + 1);
    }

    function goTo(sfen: string) {
        let normalized: string;
        let position: PositionState;
        try {
            normalized = normalizeBookKey(sfen);
            position = parseStudySfen(normalized);
        } catch {
            setError("局面キーが正しくありません");
            return;
        }
        const id = tree?.firstByKey.get(normalized);
        if (id !== undefined) selectNode(id);
        else {
            setSteps([{ position, label: "(手順なし)" }]);
            setError(null);
        }
        boardRef.current?.scrollIntoView({ block: "nearest" });
    }
    function advance(move: string) {
        const result = applyMoveWithState(position, move);
        if (!result.ok) {
            setError("この局面では指せない手です");
            return;
        }
        setError(null);
        const target =
            selected === undefined ? undefined : (tree?.nodes[selected].mergeTo ?? selected);
        if (session && target !== undefined && tree?.nodes[target].status === "pending")
            void session.builder.expandFrom(target);
        setReveal((value) => value + 1);
        setSteps([
            ...steps,
            {
                position: result.next,
                move,
                label: formatMoveSimple(move, position.turn, position.board),
            },
        ]);
    }
    const resolved = connections?.book === book && connections.key === key ? connections : null;
    return (
        <div className="flex flex-col gap-4 text-foreground">
            <h1 className="text-xl font-semibold">定跡ビュアー</h1>
            <fieldset className="flex gap-2" aria-label="見る側">
                {(["sente", "gote"] as const).map((side) => (
                    <Button
                        key={side}
                        variant="outline"
                        aria-pressed={viewSide === side}
                        onClick={() => {
                            setViewSide(side);
                            setUnreachableLimit(PAGE_SIZE);
                            setLimit(PAGE_SIZE);
                        }}
                    >
                        {side === "sente" ? "先手" : "後手"}の定跡として見る
                    </Button>
                ))}
            </fieldset>
            <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" onClick={() => fileRef.current?.click()}>
                    定跡ファイルを選ぶ
                </Button>
                <input
                    ref={fileRef}
                    type="file"
                    className="sr-only"
                    aria-label="定跡ファイル"
                    accept=".db,.txt"
                    onChange={(event) => void loadFile(event)}
                />
                <output>{busy ? "読み込み中…" : book?.name}</output>
            </div>
            <p className="text-sm text-muted-foreground">
                UTF-8 のやねうら王形式。読み込んだ定跡はメモリに保持し、リロードすると消えます。
            </p>
            {error && (
                <p role="alert" className="text-destructive">
                    {error}
                </p>
            )}
            {book && (
                <>
                    <p>
                        局面数: {book.data.stats.positions} ／ 手の数: {book.data.stats.moves} ／
                        先手: {book.data.stats.sente} ／ 後手: {book.data.stats.gote} ／ 2 手以上:{" "}
                        {branches.length} ／ 警告: {book.data.warnings.length} 件
                    </p>
                    {book.data.warnings.length > 0 && (
                        <ul className="text-sm text-muted-foreground">
                            {book.data.warnings.slice(0, 5).map((warning) => (
                                <li key={warning.line}>
                                    {warning.line} 行目: {warning.message}
                                </li>
                            ))}
                        </ul>
                    )}
                    <form
                        className="flex flex-wrap gap-2"
                        onSubmit={(event) => {
                            event.preventDefault();
                            goTo(jump);
                        }}
                    >
                        <input
                            aria-label="局面キー"
                            value={jump}
                            onChange={(event) => setJump(event.target.value)}
                            placeholder="SFEN の盤・手番・持ち駒"
                            className="min-w-0 flex-1 rounded border border-border bg-background p-2"
                        />
                        <Button type="submit" variant="outline">
                            局面へ移動
                        </Button>
                    </form>
                    <div className="grid gap-4 lg:grid-cols-2">
                        {tree && session && (
                            <BookTreeDisplay
                                key={`${book.name}-${viewSide}-${book.id}`}
                                tree={tree}
                                revision={revision}
                                side={viewSide}
                                selected={selected}
                                reveal={reveal}
                                onSelect={selectNode}
                                onExpand={(id) => void session.builder.expandFrom(id)}
                            />
                        )}
                        <div className="flex min-w-0 flex-col gap-3">
                            <div ref={boardRef} className="flex min-w-0 flex-col gap-3">
                                <BookPositionDetails
                                    position={position}
                                    steps={steps}
                                    bookMoves={bookMoves}
                                    ownTurn={ownTurn}
                                    resolved={resolved}
                                    flip={flip}
                                    onFlip={() => setFlip(!flip)}
                                    onStep={selectStep}
                                    onReset={() =>
                                        goTo(positionToBookKey(createInitialPositionState()))
                                    }
                                    advance={advance}
                                />
                            </div>
                        </div>
                    </div>
                    {tree?.legalMovesFailed && (
                        <p>
                            合法手を取得できなかった局面があるため、届かない局面は確定していません
                        </p>
                    )}
                    {tree?.complete && (
                        <section className="flex flex-col gap-2" aria-label="平手から届かない局面">
                            <h2 className="font-semibold">
                                平手から届かない局面 ({tree.unreachable.length})
                            </h2>
                            {tree.unreachable.slice(0, unreachableLimit).map((entry) => (
                                <Button
                                    key={entry}
                                    variant="outline"
                                    className="h-auto justify-start break-all whitespace-normal text-left"
                                    onClick={() => goTo(entry)}
                                >
                                    {parseStudySfen(entry).turn === "sente" ? "先手" : "後手"}:{" "}
                                    {book.data.positions
                                        .get(entry)
                                        ?.map((move) => {
                                            const state = parseStudySfen(entry);
                                            return formatMoveSimple(
                                                move.usi,
                                                state.turn,
                                                state.board,
                                            );
                                        })
                                        .join(" ／ ")}
                                    <span className="text-xs text-muted-foreground">{entry}</span>
                                </Button>
                            ))}
                            {tree.unreachable.length > unreachableLimit && (
                                <Button
                                    variant="outline"
                                    onClick={() =>
                                        setUnreachableLimit(unreachableLimit + PAGE_SIZE)
                                    }
                                >
                                    さらに表示
                                </Button>
                            )}
                        </section>
                    )}
                    <section className="flex flex-col gap-2" aria-label="分かれ目の一覧">
                        <h2 className="font-semibold">分かれ目の一覧（{branches.length} 局面）</h2>
                        {branches.slice(0, limit).map((branch) => {
                            const state = parseStudySfen(branch);
                            return (
                                <Button
                                    className="h-auto justify-start whitespace-normal text-left"
                                    variant="outline"
                                    key={branch}
                                    onClick={() => goTo(branch)}
                                >
                                    {state.turn === "sente" ? "先手" : "後手"}:{" "}
                                    {book.data.positions
                                        .get(branch)
                                        ?.map((move) =>
                                            formatMoveSimple(move.usi, state.turn, state.board),
                                        )
                                        .join(" ／ ")}
                                </Button>
                            );
                        })}
                        {limit < branches.length && (
                            <Button variant="outline" onClick={() => setLimit(limit + PAGE_SIZE)}>
                                さらに表示
                            </Button>
                        )}
                    </section>
                </>
            )}
        </div>
    );
}

function nodeSteps(tree: BookTree, id: number): Step[] {
    const path = bookTreePath(tree, id);
    return path.map((node, index) => ({
        position: node.position,
        move: node.move,
        root: index === 0,
        label:
            index === 0
                ? "初期局面"
                : formatMoveSimple(
                      node.move ?? "",
                      path[index - 1].position.turn,
                      path[index - 1].position.board,
                  ),
    }));
}
