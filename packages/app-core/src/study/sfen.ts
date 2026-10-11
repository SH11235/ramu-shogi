/**
 * 保存用の開始局面（SFEN 4 フィールド）を同期で局面にする。
 *
 * 研究ノートの盤面は保存せず、読み込み時に開始局面から復元する。`PositionService.parseSfen` は
 * 非同期（Wasm / IPC）なので、文書の復元の中から呼べるように純粋な実装を持つ。
 */

import {
    BOARD_FILES,
    BOARD_RANKS,
    type BoardState,
    type Hands,
    type PieceType,
    type Player,
    type PositionState,
    type Square,
} from "../game/board";

const PIECE_TYPES: ReadonlySet<string> = new Set(["K", "R", "B", "G", "S", "N", "L", "P"]);
const HAND_PIECE_TYPES: ReadonlySet<string> = new Set(["R", "B", "G", "S", "N", "L", "P"]);

function parseBoard(boardPart: string): BoardState {
    const rows = boardPart.split("/");
    if (rows.length !== 9) {
        throw new Error(`SFEN の盤面は 9 段必要です: ${boardPart}`);
    }
    const board = {} as BoardState;
    for (const rank of BOARD_RANKS) {
        for (const file of BOARD_FILES) {
            board[`${file}${rank}` as Square] = null;
        }
    }
    rows.forEach((row, rankIndex) => {
        let fileIndex = 0;
        for (let i = 0; i < row.length; i++) {
            const ch = row[i];
            if (ch >= "1" && ch <= "9") {
                fileIndex += Number(ch);
                continue;
            }
            const promoted = ch === "+";
            const symbol = promoted ? row[++i] : ch;
            const upper = symbol?.toUpperCase();
            if (!symbol || !upper || !PIECE_TYPES.has(upper) || fileIndex >= 9) {
                throw new Error(`SFEN の盤面を解釈できません: ${boardPart}`);
            }
            const owner: Player = symbol === upper ? "sente" : "gote";
            const square = `${BOARD_FILES[fileIndex]}${BOARD_RANKS[rankIndex]}` as Square;
            board[square] = promoted
                ? { owner, type: upper as PieceType, promoted: true }
                : { owner, type: upper as PieceType };
            fileIndex += 1;
        }
        if (fileIndex !== 9) {
            throw new Error(`SFEN の盤面の幅が 9 筋ではありません: ${boardPart}`);
        }
    });
    return board;
}

function parseHands(handsPart: string): Hands {
    const hands: Hands = { sente: {}, gote: {} };
    if (handsPart === "-") return hands;
    let count = "";
    for (const ch of handsPart) {
        if (ch >= "0" && ch <= "9") {
            count += ch;
            continue;
        }
        const upper = ch.toUpperCase();
        if (!HAND_PIECE_TYPES.has(upper)) {
            throw new Error(`SFEN の持ち駒を解釈できません: ${handsPart}`);
        }
        const owner: Player = ch === upper ? "sente" : "gote";
        const type = upper as PieceType;
        hands[owner][type] = (hands[owner][type] ?? 0) + (count === "" ? 1 : Number(count));
        count = "";
    }
    if (count !== "") {
        throw new Error(`SFEN の持ち駒を解釈できません: ${handsPart}`);
    }
    return hands;
}

/** SFEN（盤面・手番・持ち駒・手数）を局面にする。解釈できなければ例外。 */
export function parseStudySfen(sfen: string): PositionState {
    const fields = sfen.trim().split(/\s+/);
    if (fields.length < 3) {
        throw new Error(`SFEN の形式が正しくありません: ${sfen}`);
    }
    const [boardPart, turnPart, handsPart, plyPart] = fields;
    if (turnPart !== "b" && turnPart !== "w") {
        throw new Error(`SFEN の手番を解釈できません: ${sfen}`);
    }
    const ply = plyPart === undefined ? 1 : Number(plyPart);
    return {
        board: parseBoard(boardPart),
        hands: parseHands(handsPart),
        turn: turnPart === "b" ? "sente" : "gote",
        ply: Number.isInteger(ply) && ply > 0 ? ply : 1,
    };
}
