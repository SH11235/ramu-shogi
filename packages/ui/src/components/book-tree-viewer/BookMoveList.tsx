import type { BookData, BookTree } from "@shogi/app-core";
import { cn } from "@shogi/design-system";
import type { ReactElement } from "react";
import { moveLabel } from "./BookTreeGraph";

/** 選んだ局面から指せる手（定跡の手と、定跡の局面へつながる手）。押すとその手へ進む。 */
export function BookMoveList({
    tree,
    book,
    nodeId,
    onSelect,
    className,
}: {
    tree: BookTree | null;
    book: BookData;
    nodeId: number;
    onSelect: (id: number) => void;
    className?: string;
}): ReactElement {
    const current = tree?.nodes[nodeId];
    const source = current?.mergeTo === undefined ? current : tree?.nodes[current.mergeTo];
    const entries = source ? book.positions.get(source.key) : undefined;
    const rows =
        tree && source
            ? source.children.map((id) => {
                  const node = tree.nodes[id];
                  return {
                      node,
                      label: moveLabel(tree, node),
                      entry: entries?.find((move) => move.usi === node.move),
                  };
              })
            : [];
    let message: string | null = null;
    if (!tree || !source) message = "定跡の木を組み立てています…";
    else if (source.status === "pending") message = "この先を読み込んでいます…";
    else if (rows.length === 0) message = "この先は定跡にありません";
    return (
        <section
            aria-label="この局面の指し手"
            className={cn("flex min-h-0 flex-col overflow-auto", className)}
        >
            {current?.status === "merge" && (
                <p className="px-2 py-1 text-xs text-muted-foreground">
                    前に出た局面に合流しています。この先は合流先の手順と同じです。
                </p>
            )}
            {source?.error && (
                <p role="alert" className="px-2 py-1 text-xs text-destructive">
                    {source.error}
                </p>
            )}
            {message ? (
                <p className="px-2 py-3 text-sm text-muted-foreground">{message}</p>
            ) : (
                <table className="w-full text-sm text-wafuu-sumi">
                    <thead className="sticky top-0 bg-wafuu-washi text-xs text-wafuu-sumi-light">
                        <tr className="border-b border-wafuu-border">
                            <th className="px-2 py-1 text-left font-medium">手</th>
                            <th className="px-2 py-1 text-right font-medium">評価値</th>
                            <th className="px-2 py-1 text-right font-medium">深さ</th>
                            <th className="px-2 py-1 text-right font-medium">採択数</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map(({ node: child, label, entry }) => {
                            return (
                                <tr
                                    key={child.id}
                                    className="border-b border-wafuu-border/60 last:border-b-0"
                                >
                                    <td className="p-0">
                                        <button
                                            type="button"
                                            onClick={() => onSelect(child.id)}
                                            className="flex w-full items-center gap-1 px-2 py-1.5 text-left hover:bg-wafuu-washi-warm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                                        >
                                            <span
                                                aria-hidden="true"
                                                className={
                                                    label.startsWith("☗")
                                                        ? "text-wafuu-shu"
                                                        : "text-wafuu-ai"
                                                }
                                            >
                                                {label.slice(0, 1)}
                                            </span>
                                            <span>{label.slice(1)}</span>
                                            {child.inBook === false && (
                                                <span className="text-xs text-muted-foreground">
                                                    （登録なし・定跡へつながる）
                                                </span>
                                            )}
                                        </button>
                                    </td>
                                    <td className="px-2 text-right tabular-nums">
                                        {entry?.value ?? ""}
                                    </td>
                                    <td className="px-2 text-right tabular-nums">
                                        {entry?.depth ?? ""}
                                    </td>
                                    <td className="px-2 text-right tabular-nums">
                                        {entry?.count ?? ""}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            )}
        </section>
    );
}
