import type { KifuTree } from "@shogi/app-core";
import type { KeyboardEvent, ReactElement, RefObject } from "react";
import { BookTreeGraph } from "../book-tree-viewer/BookTreeGraph";
import { moveLabel } from "../book-tree-viewer/bookLabels";
import { Button } from "../button";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "../dialog";
import { studyGraphFromKifuTree } from "./studyTreeGraph";

/**
 * 研究ノートの本譜と変化を、定跡の木と同じ図で画面いっぱいに描く。木で選んだ手は、そのまま研究ノートの
 * いまの局面になる（閉じると、盤はその局面のまま）。
 */
export function StudyTreeDialog({
    open,
    onOpenChange,
    tree,
    currentNodeId,
    onSelect,
    flipBoard,
    returnFocus,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    tree: KifuTree;
    currentNodeId: string;
    onSelect: (nodeId: string) => void;
    flipBoard: boolean;
    /**
     * 閉じたときにフォーカスを戻す要素（開いたボタン）。開くボタンを Radix の Trigger にしていないので、
     * Radix は戻さない。クリックでボタンにフォーカスが移らないブラウザもあるので、押された要素を渡す。
     */
    returnFocus: RefObject<HTMLElement | null>;
}): ReactElement {
    // 閉じている間は木を写さない（研究ノートを編集するたびに写し直さないように）。
    const graph = open ? studyGraphFromKifuTree(tree) : null;
    const selected = graph?.indexOf.get(currentNodeId) ?? 0;
    const node = graph?.tree.nodes[selected];
    const select = (index: number) => {
        const id = graph?.ids[index];
        if (id !== undefined && id !== currentNodeId) onSelect(id);
    };
    // ←→ で手を戻す・進める（進むのは先頭の子）、↑↓ で同じ局面からの別の手へ移る。
    function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
        if (!graph || !node || event.altKey || event.ctrlKey || event.metaKey) return;
        const siblings = node.parent === null ? [] : graph.tree.nodes[node.parent].children;
        const at = siblings.indexOf(node.id);
        const next: Record<string, number | null | undefined> = {
            ArrowLeft: node.parent,
            ArrowRight: node.children[0],
            ArrowUp: siblings[at - 1],
            ArrowDown: siblings[at + 1],
        };
        if (!(event.key in next)) return;
        event.preventDefault();
        const target = next[event.key];
        if (target !== null && target !== undefined) select(target);
    }
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            {/* 木の中のどこにフォーカスがあっても矢印キーで手を移れるように、画面全体で受ける。 */}
            <DialogContent
                onKeyDown={onKeyDown}
                onCloseAutoFocus={(event) => {
                    event.preventDefault();
                    if (returnFocus.current?.isConnected) returnFocus.current.focus();
                }}
                className="top-0 left-0 flex h-dvh max-h-none w-full translate-x-0 translate-y-0 flex-col gap-2 rounded-none border-0 bg-background p-3 text-wafuu-sumi"
            >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <DialogTitle className="shrink-0 whitespace-nowrap font-display text-base">
                        変化の木
                    </DialogTitle>
                    <output className="min-w-0 flex-1 truncate text-sm lg:flex-none">
                        {!graph || !node || node.parent === null
                            ? "開始局面"
                            : `${(node.position.ply ?? 1) - 1}手目 ${moveLabel(graph.tree, node)}`}
                    </output>
                    <p className="hidden min-w-0 flex-1 truncate text-xs text-muted-foreground lg:block">
                        矢印キーで手を移り、Ctrl＋ホイールで拡大縮小、Esc で閉じます。
                    </p>
                    <DialogClose asChild>
                        <Button autoFocus variant="outline" size="sm" className="ml-auto shrink-0">
                            盤に戻る
                        </Button>
                    </DialogClose>
                </div>
                {graph && (
                    <BookTreeGraph
                        // 図は開閉・盤に出す手を番号で覚えている。別の画面の変更で枝が増減すると番号が
                        // ずれるので、木の形が変わったら作り直す。
                        key={graph.ids.join(",")}
                        tree={graph.tree}
                        valueFor={graph.valueFor}
                        label="変化の木"
                        selected={selected}
                        onSelect={select}
                        flipBoard={flipBoard}
                        explore
                        onActivate={(index) => {
                            select(index);
                            onOpenChange(false);
                        }}
                        className="flex-1 rounded-lg border border-wafuu-border bg-wafuu-washi"
                    />
                )}
            </DialogContent>
        </Dialog>
    );
}
