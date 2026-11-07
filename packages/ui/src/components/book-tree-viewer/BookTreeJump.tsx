import {
    type BookData,
    type BookTree,
    type BookTreeNode,
    bookKeyFromPositionText,
} from "@shogi/app-core";
import { cn } from "@shogi/design-system";
import { type ReactElement, type ReactNode, useEffect, useRef, useState } from "react";
import { ChoiceGroup } from "../choice-group";
import { bookValue, moveLabel, valueClass } from "./bookLabels";

/** 一覧に一度に出す数（大きな定跡で分かれ目や合流が数千になっても、描く量を抑える）。続きはボタンで足す。 */
const LIST_PAGE = 200;

type JumpKind = "forks" | "exits" | "warnings" | "links" | "bookmarks";
type ExitOrder = "ply" | "sente" | "gote";

const byPly = (a: BookTreeNode, b: BookTreeNode) =>
    (a.position.ply ?? 0) - (b.position.ply ?? 0) || a.id - b.id;

/** 子が 2 つ以上ある局面（合流は除く）。 */
function forkNodes(tree: BookTree): BookTreeNode[] {
    return tree.nodes
        .filter((node) => node.status !== "merge" && node.children.length > 1)
        .sort(byPly);
}

/** 先に手が無い局面（定跡にその局面の手が登録されていない）。合流と未展開は除く。 */
function exitNodes(tree: BookTree): BookTreeNode[] {
    return tree.nodes
        .filter(
            (node) =>
                node.parent !== null &&
                node.children.length === 0 &&
                (node.status === "ready" || node.status === "error"),
        )
        .sort(byPly);
}

function warningNodes(tree: BookTree): BookTreeNode[] {
    return tree.nodes.filter((node) => node.error !== undefined).sort(byPly);
}

/** 登録の無い手で定跡の局面へつながる所と、前に出た局面に合流する所。 */
function linkNodes(tree: BookTree): BookTreeNode[] {
    return tree.nodes
        .filter((node) => node.inBook === false || node.status === "merge")
        .sort(byPly);
}

function nodeTitle(tree: BookTree, node: BookTreeNode) {
    if (node.parent === null) return "開始局面";
    return `${(node.position.ply ?? 1) - 1} ${moveLabel(tree, node)}`;
}

/**
 * 定跡の木の中の局面へ移る欄。分かれ目・出口・警告・点線と合流・しおりの一覧と、局面（SFEN）で探す欄を持つ。
 * 押した局面を選び、欄を閉じる。
 */
export function BookTreeJump({
    tree,
    book,
    counts,
    bookmarks,
    onSelect,
    onClose,
}: {
    tree: BookTree;
    book: BookData;
    /** 手ごとの、その先の手の数。 */
    counts: Int32Array;
    bookmarks: readonly string[];
    onSelect: (id: number) => void;
    /** 局面を選んで閉じたときは true。 */
    onClose: (selected: boolean) => void;
}): ReactElement {
    // 開いたら欄へフォーカスを移す（Esc がこの欄を閉じ、全画面を閉じないように）。
    const panel = useRef<HTMLDivElement>(null);
    useEffect(() => {
        panel.current?.focus();
    }, []);
    const [limit, setLimit] = useState(LIST_PAGE);
    const warnings = warningNodes(tree);
    const [kind, setKind] = useState<JumpKind>("forks");
    const [exitOrder, setExitOrder] = useState<ExitOrder>("ply");
    const [query, setQuery] = useState("");
    const [message, setMessage] = useState<string | null>(null);
    const shownKind = kind === "warnings" && warnings.length === 0 ? "forks" : kind;
    const kinds: { value: JumpKind; label: string }[] = [
        { value: "forks", label: "分かれ目" },
        { value: "exits", label: "出口" },
        ...(warnings.length > 0
            ? [{ value: "warnings" as const, label: `警告 ${warnings.length}` }]
            : []),
        { value: "links", label: "点線・合流" },
        { value: "bookmarks", label: "しおり" },
    ];

    function jump(id: number) {
        onSelect(id);
        onClose(true);
    }
    function choose(next: JumpKind) {
        setKind(next);
        setLimit(LIST_PAGE);
    }
    function search() {
        let key: string;
        try {
            key = bookKeyFromPositionText(query);
        } catch {
            setMessage("局面を読めませんでした");
            return;
        }
        const id = tree.firstByKey.get(key);
        if (id !== undefined) {
            setMessage(null);
            jump(id);
        } else if (book.positions.has(key))
            setMessage(
                "定跡にはありますが、木にはまだ出ていません（開始局面が違うか、展開していない枝の先です）",
            );
        else setMessage("この局面は定跡にありません");
    }

    let nodes: BookTreeNode[];
    let detail: (node: BookTreeNode) => ReactNode;
    let empty: string;
    if (shownKind === "forks") {
        nodes = forkNodes(tree);
        detail = (node) =>
            `${node.children.length} 通り・先に ${counts[node.id].toLocaleString("ja-JP")} 手`;
        empty = "分かれ目はありません";
    } else if (shownKind === "exits") {
        nodes = exitNodes(tree);
        const values = new Map(nodes.map((node) => [node.id, bookValue(tree, book, node)]));
        if (exitOrder !== "ply") {
            // 値は先手から見た値なので、先手よし順は大きい順。値の無い出口は後ろに置く。
            const sign = exitOrder === "sente" ? -1 : 1;
            const value = (node: BookTreeNode) => values.get(node.id) ?? 0;
            nodes = [
                ...nodes
                    .filter((node) => values.get(node.id) !== undefined)
                    .sort((a, b) => sign * (value(a) - value(b)) || byPly(a, b)),
                ...nodes.filter((node) => values.get(node.id) === undefined),
            ];
        }
        detail = (node) => {
            const value = values.get(node.id);
            return value === undefined ? null : (
                <span className={cn("tabular-nums", valueClass(value))}>{value}</span>
            );
        };
        empty = tree.capped
            ? "出口はまだありません（展開していない枝があります）"
            : "出口はありません";
    } else if (shownKind === "warnings") {
        nodes = warnings;
        detail = (node) => <span className="text-destructive">{node.error}</span>;
        empty = "";
    } else if (shownKind === "links") {
        nodes = linkNodes(tree);
        detail = (node) => (node.status === "merge" ? "合流" : "登録の無い手");
        empty = "点線の手も合流もありません";
    } else {
        const marked = new Set(bookmarks);
        nodes = tree.nodes
            .filter((node) => node.status !== "merge" && marked.has(node.key))
            .sort(byPly);
        detail = () => null;
        empty =
            bookmarks.length > 0
                ? "この木の中にしおりの局面はありません"
                : "しおりはありません（局面を選んで「しおり」を押すと付きます）";
    }
    const shown = nodes.slice(0, limit);

    return (
        <div
            ref={panel}
            role="dialog"
            aria-label="局面へ移動"
            tabIndex={-1}
            onKeyDown={(event) => {
                if (event.key === "Escape") {
                    event.stopPropagation();
                    onClose(false);
                }
                // 矢印キーは一覧の中で使う（木の選択を動かす窓のキー操作へ渡さない）。
                if (event.key.startsWith("Arrow")) event.stopPropagation();
            }}
            className="absolute top-1 right-2 z-30 flex max-h-[70%] w-80 max-w-[calc(100%-1rem)] flex-col gap-2 rounded-md border border-wafuu-border bg-background p-2 text-xs text-wafuu-sumi shadow-popover"
        >
            <form
                className="flex gap-1"
                onSubmit={(event) => {
                    event.preventDefault();
                    search();
                }}
            >
                <input
                    aria-label="局面（SFEN）"
                    placeholder="SFEN・position コマンドを貼る"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    className="min-w-0 flex-1 rounded border border-input bg-transparent px-2 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <button
                    type="submit"
                    disabled={query.trim() === ""}
                    className="rounded border border-wafuu-border px-2 py-1 hover:bg-wafuu-washi-warm disabled:opacity-50"
                >
                    探す
                </button>
            </form>
            {message && <output className="text-wafuu-sumi-light">{message}</output>}
            <ChoiceGroup
                size="sm"
                options={kinds}
                value={shownKind}
                onChange={choose}
                className="flex-wrap gap-1"
                optionClassName="px-2 py-1 text-xs"
            />
            {shownKind === "exits" && (
                <ChoiceGroup
                    size="sm"
                    options={[
                        { value: "ply", label: "手数順" },
                        { value: "sente", label: "先手よし順" },
                        { value: "gote", label: "後手よし順" },
                    ]}
                    value={exitOrder}
                    onChange={setExitOrder}
                    className="flex-wrap gap-1"
                    optionClassName="px-2 py-0.5 text-xs"
                />
            )}
            <ul aria-label="移る局面" className="min-h-0 flex-1 overflow-y-auto">
                {shown.map((node) => (
                    <li key={node.id}>
                        <button
                            type="button"
                            onClick={() => jump(node.id)}
                            className="flex w-full items-center gap-2 rounded px-1 py-1 text-left hover:bg-wafuu-washi-warm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                            <span className="min-w-0 flex-1 truncate">{nodeTitle(tree, node)}</span>
                            <span className="shrink-0 text-wafuu-sumi-light">{detail(node)}</span>
                        </button>
                    </li>
                ))}
            </ul>
            {nodes.length === 0 && empty && <p className="text-wafuu-sumi-light">{empty}</p>}
            {nodes.length > limit && (
                <button
                    type="button"
                    onClick={() => setLimit((current) => current + LIST_PAGE)}
                    className="rounded border border-wafuu-border px-2 py-1 hover:bg-wafuu-washi-warm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                    続きを出す（ほか {(nodes.length - limit).toLocaleString("ja-JP")} 件）
                </button>
            )}
        </div>
    );
}
