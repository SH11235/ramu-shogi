import type { BookData, BookTree, BookTreeNode } from "@shogi/app-core";
import { formatMoveSimple } from "../shogi-match/utils/kifFormat";

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

/** 評価値の色。先手よし（正）は先手の印と同じ朱、後手よし（負）は藍。 */
export function valueClass(value: number) {
    if (value > 0) return "text-wafuu-shu";
    if (value < 0) return "text-wafuu-ai";
    return "text-wafuu-sumi-light";
}
