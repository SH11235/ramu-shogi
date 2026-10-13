import {
    BOOK_TREE_AUTO_LIMIT,
    type BookTree,
    bookTreeRow,
    type PositionState,
} from "@shogi/app-core";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Button } from "../button";
import { formatMoveSimple } from "../shogi-match/utils/kifFormat";

const INITIAL_ROWS = 200;

function defaultOpenRows(tree: BookTree, previous: Set<number>) {
    const next = new Set(previous);
    const queue = [0];
    let rowCount = 1;
    for (const id of previous) {
        const row = bookTreeRow(tree, id);
        rowCount += row[row.length - 1].children.length;
    }
    for (let head = 0; head < queue.length && head < INITIAL_ROWS; head++) {
        const row = bookTreeRow(tree, queue[head]);
        const last = row[row.length - 1];
        if (!next.has(row[0].id)) {
            if (last.status === "pending") continue;
            if (rowCount + last.children.length > INITIAL_ROWS) continue;
            next.add(row[0].id);
            rowCount += last.children.length;
        }
        queue.push(...last.children);
    }
    return next;
}

export function BookTreeDisplay({
    tree,
    revision,
    side,
    selected,
    reveal,
    onSelect,
    onExpand,
}: {
    tree: BookTree;
    revision: number;
    side: PositionState["turn"];
    selected: number | undefined;
    reveal: number;
    onSelect: (id: number) => void;
    onExpand: (id: number) => void;
}) {
    const [overrides, setOverrides] = useState<Map<number, boolean>>(() => new Map());
    const [collapsed, setCollapsed] = useState(false);
    const container = useRef<HTMLDivElement>(null);
    const [openedPath, setOpenedPath] = useState(() => ({
        ids: new Set<number>(),
        request: reveal,
    }));
    function selectionAncestors(id: number) {
        const path = new Set<number>();
        let node = tree.nodes[id];
        while (node) {
            path.add(node.id);
            if (node.parent === null) break;
            node = tree.nodes[node.parent];
        }
        const ancestors: number[] = [];
        let start: number | undefined = 0;
        while (start !== undefined) {
            const row = bookTreeRow(tree, start);
            if (row.some((node) => node.id === id)) break;
            const last = row[row.length - 1];
            const next = last.children.find((child) => path.has(child));
            if (next === undefined) break;
            ancestors.push(start);
            start = next;
        }
        return ancestors;
    }
    const openSelection = useEffectEvent((id: number, request: number) => {
        const ancestors = selectionAncestors(id);
        setOpenedPath({ ids: new Set([id]), request });
        setOverrides((current) => {
            const next = new Map(current);
            for (const ancestor of ancestors) next.set(ancestor, true);
            return next;
        });
    });
    useEffect(() => {
        if (selected !== undefined) openSelection(selected, reveal);
    }, [selected, reveal]);

    const [defaultState, setDefaultState] = useState(() => ({
        tree,
        ids: defaultOpenRows(tree, new Set()),
    }));
    const defaults =
        defaultState.tree === tree ? defaultState.ids : defaultOpenRows(tree, defaultState.ids);
    if (defaultState.tree !== tree) setDefaultState({ tree, ids: defaults });
    const rows: { ids: ReturnType<typeof bookTreeRow>; depth: number; open: boolean }[] = [];
    const stack = [{ id: 0, depth: 0 }];
    while (stack.length) {
        const entry = stack.pop();
        if (!entry) break;
        const ids = bookTreeRow(tree, entry.id);
        const last = ids[ids.length - 1];
        const open = overrides.get(entry.id) ?? (!collapsed && defaults.has(entry.id));
        rows.push({ ids, depth: entry.depth, open });
        if (open)
            for (const id of [...last.children].reverse())
                stack.push({ id, depth: entry.depth + 1 });
    }
    useEffect(() => {
        if (selected === undefined || openedPath.request !== reveal) return;
        const frame = container.current;
        const target = frame?.querySelector<HTMLElement>(`[data-node="${selected}"]`);
        if (!frame || !target) return;
        const bounds = frame.getBoundingClientRect();
        const rect = target.getBoundingClientRect();
        if (rect.top < bounds.top) frame.scrollTop += rect.top - bounds.top;
        else if (rect.bottom > bounds.bottom) frame.scrollTop += rect.bottom - bounds.bottom;
        if (rect.left < bounds.left) frame.scrollLeft += rect.left - bounds.left;
        else if (rect.right > bounds.right) frame.scrollLeft += rect.right - bounds.right;
    }, [selected, reveal, openedPath]);
    function revealSelected() {
        if (selected === undefined) return;
        const ancestors = selectionAncestors(selected);
        setOpenedPath({ ids: new Set([selected]), request: reveal });
        setOverrides((current) => {
            const next = new Map(current);
            for (const ancestor of ancestors) next.set(ancestor, true);
            return next;
        });
    }
    return (
        <section aria-label="定跡の木" className="flex min-w-0 flex-col gap-2">
            <h2 className="font-semibold">定跡の木</h2>
            <output aria-live="polite">
                {tree.expanded} 局面を展開
                {tree.building
                    ? "・組み立て中…"
                    : tree.capped
                      ? `・自動展開の上限（${BOOK_TREE_AUTO_LIMIT.toLocaleString("en-US")} 展開）。未展開の枝を開くと先を組み立てます`
                      : "・組み立て完了"}
            </output>
            <div className="flex flex-wrap gap-2">
                <Button
                    variant="outline"
                    onClick={() => {
                        setCollapsed(true);
                        setOverrides(new Map());
                        setOpenedPath({ ids: new Set(), request: reveal });
                    }}
                >
                    すべて閉じる
                </Button>
                <Button
                    variant="outline"
                    disabled={selected === undefined}
                    onClick={revealSelected}
                >
                    選択局面まで開く
                </Button>
            </div>
            <div
                ref={container}
                className="max-h-[60dvh] overflow-auto rounded border border-border p-2 lg:h-[36rem]"
                data-revision={revision}
            >
                <ul aria-label="木の行" className="flex flex-col gap-1">
                    {rows.map(({ ids, depth, open }) => {
                        const first = ids[0];
                        const last = ids[ids.length - 1];
                        const expandable = last.children.length > 0 || last.status === "pending";
                        const expanded = open && last.status !== "pending";
                        const moveName =
                            first.move && first.parent !== null
                                ? formatMoveSimple(
                                      first.move,
                                      tree.nodes[first.parent].position.turn,
                                      tree.nodes[first.parent].position.board,
                                  )
                                : "平手初期局面";
                        const action = expanded ? "閉じる" : "開く";
                        return (
                            <li
                                key={first.id}
                                style={{ paddingInlineStart: `${depth * 16}px` }}
                                className="flex items-start gap-1"
                            >
                                {expandable && (
                                    <button
                                        type="button"
                                        aria-label={`${moveName} の枝を${action}`}
                                        aria-expanded={expanded}
                                        className="shrink-0 rounded p-1 hover:bg-muted"
                                        onClick={() => {
                                            const next = last.status === "pending" || !open;
                                            setOverrides(new Map(overrides).set(first.id, next));
                                            if (next && last.status === "pending")
                                                onExpand(last.id);
                                        }}
                                    >
                                        {expanded ? "▾" : "▸"}
                                    </button>
                                )}
                                <div className="flex min-w-0 flex-wrap items-center gap-1">
                                    {ids.map((node, index) => {
                                        const parent =
                                            node.parent === null
                                                ? undefined
                                                : tree.nodes[node.parent];
                                        return (
                                            <button
                                                type="button"
                                                key={node.id}
                                                data-node={node.id}
                                                aria-current={
                                                    selected === node.id ? "step" : undefined
                                                }
                                                className={`rounded px-1 py-1 text-sm hover:bg-muted ${selected === node.id ? "bg-accent text-accent-foreground ring-1 ring-border" : ""}`}
                                                onClick={() => onSelect(node.id)}
                                            >
                                                {node.move && parent
                                                    ? `${index === 0 || parent.id === 0 ? `${(node.position.ply ?? 1) - 1}手目 ` : ""}${formatMoveSimple(node.move, parent.position.turn, parent.position.board)}`
                                                    : "平手初期局面"}
                                                {node.status === "merge" && "（合流）"}
                                            </button>
                                        );
                                    })}
                                    {last.children.length > 1 && (
                                        <span
                                            className={`rounded px-1 text-xs ${last.position.turn === side ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground"}`}
                                        >
                                            {last.position.turn === side
                                                ? "◆ 定跡の分岐"
                                                : "◇ 相手の応手"}
                                        </span>
                                    )}
                                    {last.status === "pending" && (
                                        <span className="text-xs text-muted-foreground">
                                            未展開
                                        </span>
                                    )}
                                    {ids
                                        .filter((node) => node.error)
                                        .map((node) => (
                                            <span
                                                key={node.id}
                                                className="text-xs text-destructive"
                                                title={node.error}
                                            >
                                                ⚠ {node.error}
                                            </span>
                                        ))}
                                </div>
                            </li>
                        );
                    })}
                </ul>
            </div>
        </section>
    );
}
