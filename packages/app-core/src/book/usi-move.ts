import { BOARD_RANKS, type PositionState, parseMove, type Square } from "../game/board";
import { applyCsaMoveStrict } from "../game/csa-move";
import { CSA_PIECE_CODES } from "../game/csa-position";

const csaSquare = (square: Square): string =>
    `${square[0]}${BOARD_RANKS.indexOf(square[1] as (typeof BOARD_RANKS)[number]) + 1}`;

/**
 * USI の手を局面に照らして厳密に検証し、入力を変更せずに適用する。
 * 打ち歩詰めは検証しない。
 */
export function applyUsiMoveStrict(
    state: PositionState,
    move: string,
): { ok: true; next: PositionState } | { ok: false } {
    const parsed = parseMove(move);
    if (!parsed || parsed.kind === "pass") return { ok: false };
    const piece =
        parsed.kind === "drop" ? { type: parsed.piece, promoted: false } : state.board[parsed.from];
    if (!piece) return { ok: false };
    if (parsed.kind === "move" && parsed.promote && piece.promoted) return { ok: false };
    const promoted = piece.promoted === true || (parsed.kind === "move" && parsed.promote);
    const code = Object.entries(CSA_PIECE_CODES).find(
        ([, spec]) => spec?.type === piece.type && spec.promoted === promoted,
    )?.[0];
    if (!code) return { ok: false };
    const from = parsed.kind === "drop" ? "00" : csaSquare(parsed.from);
    const token = `${state.turn === "sente" ? "+" : "-"}${from}${csaSquare(parsed.to)}${code}`;
    try {
        return { ok: true, next: applyCsaMoveStrict(token, state).nextState };
    } catch {
        return { ok: false };
    }
}
