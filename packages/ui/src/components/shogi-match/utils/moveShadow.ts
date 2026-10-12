import type { PieceType, Player } from "@shogi/app-core";
import type { ShogiBoardCell, ShogiBoardMoveShadow } from "../../shogi-board";

type MoveShadowSelection = { kind: "square"; square: string } | { kind: "hand"; piece: PieceType };

interface ComputeMoveShadowParams {
    /** いま選んでいる駒（盤上のマス、または持ち駒） */
    selection: MoveShadowSelection | null;
    grid: ShogiBoardCell[][];
    /** 手番（持ち駒を選んでいるとき、影の駒の持ち主になる） */
    turn: Player;
    /** 現局面の合法手（USI）。まだ分からないときは null */
    legalMoves: Iterable<string> | null;
}

/**
 * 選んでいる駒の「影」を出すマスを、合法手の一覧から求める。
 *
 * 影は合法な行き先だけに出す（駒のあるマスへの打ち込み、二歩、行き所のない段、動けないマスは
 * 合法手に含まれないので出ない）。合法手が分からない間と、行き先が 1 つも無いときは null。
 */
export function computeMoveShadow({
    selection,
    grid,
    turn,
    legalMoves,
}: ComputeMoveShadowParams): ShogiBoardMoveShadow | null {
    if (!selection || !legalMoves) return null;

    const targets = new Set<string>();
    if (selection.kind === "hand") {
        const prefix = `${selection.piece}*`;
        for (const move of legalMoves) {
            if (move.startsWith(prefix)) targets.add(move.slice(2, 4));
        }
        if (targets.size === 0) return null;
        return { piece: { owner: turn, type: selection.piece }, targets };
    }

    const from = selection.square;
    let piece: ShogiBoardCell["piece"] = null;
    for (const row of grid) {
        for (const cell of row) {
            if (cell.id === from) piece = cell.piece;
        }
    }
    if (!piece) return null;
    for (const move of legalMoves) {
        // 打つ手（"P*5e"）とパス（"pass"）は、盤上の駒の行き先ではない
        if (move[1] === "*" || move.length < 4) continue;
        if (move.slice(0, 2) === from) targets.add(move.slice(2, 4));
    }
    if (targets.size === 0) return null;
    return { piece, targets };
}
