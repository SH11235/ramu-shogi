/**
 * 同じ移動先へ同じ駒が 2 枚以上指せるときに、どの駒が動いたかを示す相対表記
 * （上・寄・引・左・右・直）を、日本将棋連盟の棋譜の表記に合わせて決める。
 *
 * - まず動きの向き（上・寄・引）だけで決まるならそれを使う。
 * - 決まらなければ左・右（金・銀・成駒がまっすぐ上がる手は直）を使う。
 * - それでも決まらなければ、同じ向きに動く駒の中での左・右と向きを組み合わせる（「右上」など）。
 * - 飛・角・竜・馬は直を使わず、左右と向きを組み合わせない（2 枚の左右の位置で決める）。
 * - 左右・上下は指す側から見る（後手は盤の向きと逆）。
 *
 * 動ける駒は、指した後に自玉へ利きが残らない手だけで数える（ピンされた駒は数えない）。
 * `parseKifPv` が移動元なしの読み筋を解決するときの数え方と揃えている。
 */

import { BOARD_FILES, BOARD_RANKS, type BoardState, type Square } from "./board";
import { canMoveOnBoard } from "./csa-move";

const fileOf = (square: Square): number => Number(square[0]);
const rankOf = (square: Square): number =>
    BOARD_RANKS.indexOf(square[1] as (typeof BOARD_RANKS)[number]) + 1;

type Vertical = "上" | "寄" | "引";

/** 盤上の駒の移動 `from` → `to` に付ける相対表記。区別が要らなければ空文字列。 */
export function relativeMoveNotation(board: BoardState, from: Square, to: Square): string {
    const piece = board[from];
    if (!piece) return "";
    const sente = piece.owner === "sente";
    const promoted = piece.promoted === true;
    const candidates: Square[] = [];
    for (const file of BOARD_FILES) {
        for (const rank of BOARD_RANKS) {
            const square = `${file}${rank}` as Square;
            const other = board[square];
            if (
                other &&
                other.owner === piece.owner &&
                other.type === piece.type &&
                (other.promoted === true) === promoted &&
                (square === from || canMoveOnBoard(board, square, to))
            ) {
                candidates.push(square);
            }
        }
    }
    if (candidates.length < 2) return "";

    // 指す側から見て前へ進む量と、右にある度合い（先手は筋の数字が小さいほど右）。
    const forwardOf = (square: Square) =>
        sente ? rankOf(square) - rankOf(to) : rankOf(to) - rankOf(square);
    const rightOf = (square: Square) => (sente ? -fileOf(square) : fileOf(square));
    const verticalOf = (square: Square): Vertical => {
        const forward = forwardOf(square);
        return forward > 0 ? "上" : forward < 0 ? "引" : "寄";
    };
    const horizontalAmong = (group: Square[]): "左" | "右" | null => {
        const others = group.filter((square) => square !== from).map(rightOf);
        if (others.every((value) => value < rightOf(from))) return "右";
        if (others.every((value) => value > rightOf(from))) return "左";
        return null;
    };

    const vertical = verticalOf(from);
    const sameVertical = candidates.filter((square) => verticalOf(square) === vertical);
    if (sameVertical.length === 1) return vertical;

    if (piece.type === "R" || piece.type === "B") return horizontalAmong(candidates) ?? "";

    if (vertical === "上" && fileOf(from) === fileOf(to) && piece.type !== "N") return "直";
    const horizontal = horizontalAmong(candidates);
    if (horizontal) return horizontal;
    const combined = horizontalAmong(sameVertical);
    return combined ? `${combined}${vertical}` : "";
}
