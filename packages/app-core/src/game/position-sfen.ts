/** 局面を SFEN の文字列にする。 */

import {
    BOARD_FILES,
    BOARD_RANKS,
    type BoardState,
    type Hands,
    type Piece,
    type PieceType,
    type PositionState,
    type Square,
} from "./board";

/** SFEN の持ち駒の並び順。 */
const SFEN_HAND_ORDER: readonly PieceType[] = ["R", "B", "G", "S", "N", "L", "P"];

const sfenLetter = (piece: Piece): string => {
    const letter = piece.owner === "sente" ? piece.type : piece.type.toLowerCase();
    return piece.promoted ? `+${letter}` : letter;
};

export const boardToSfen = (board: BoardState): string =>
    BOARD_RANKS.map((rank) => {
        let row = "";
        let empty = 0;
        for (const file of BOARD_FILES) {
            const piece = board[`${file}${rank}` as Square];
            if (!piece) {
                empty++;
                continue;
            }
            if (empty > 0) row += String(empty);
            empty = 0;
            row += sfenLetter(piece);
        }
        return empty > 0 ? row + String(empty) : row;
    }).join("/");

export const handsToSfen = (hands: Hands): string => {
    let text = "";
    for (const owner of ["sente", "gote"] as const) {
        for (const type of SFEN_HAND_ORDER) {
            const count = hands[owner][type] ?? 0;
            if (count <= 0) continue;
            const letter = owner === "sente" ? type : type.toLowerCase();
            text += count > 1 ? `${count}${letter}` : letter;
        }
    }
    return text.length > 0 ? text : "-";
};

/** 局面を `<盤> <手番> <持ち駒> 1` の SFEN にする (平手でも `startpos` にしない)。 */
export function positionToSfen(position: PositionState): string {
    const turn = position.turn === "sente" ? "b" : "w";
    return `${boardToSfen(position.board)} ${turn} ${handsToSfen(position.hands)} 1`;
}
