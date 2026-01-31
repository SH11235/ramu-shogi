import type { BoardState, PositionState } from "@shogi/app-core";
import { boardToMatrix, cloneBoard } from "@shogi/app-core";
import type { ShogiBoardCell } from "../../shogi-board";
import { cloneHandsState } from "./boardUtils";

/**
 * PositionState のディープコピーを作成
 */
export const clonePositionState = (pos: PositionState): PositionState => ({
    board: cloneBoard(pos.board),
    hands: cloneHandsState(pos.hands),
    turn: pos.turn,
    ply: pos.ply,
    passRights: pos.passRights
        ? { sente: pos.passRights.sente, gote: pos.passRights.gote }
        : undefined,
});

/**
 * BoardState を UI 表示用のグリッド形式に変換
 */
export function boardToGrid(board: BoardState): ShogiBoardCell[][] {
    const matrix = boardToMatrix(board);
    return matrix.map((row) =>
        row.map((cell) => ({
            id: cell.square,
            piece: cell.piece
                ? {
                      owner: cell.piece.owner,
                      type: cell.piece.type,
                      promoted: cell.piece.promoted,
                  }
                : null,
        })),
    );
}
