/**
 * CSA の指し手 1 つを、局面に照らして検証してから適用する。
 *
 * `parseSingleCsaMove` (観戦の逐次適用用) は書式と手番しか見ないので、保存済み棋譜や
 * 利用者が開いたファイルを読むときはこちらを使い、壊れた棋譜を正常な棋譜として
 * 取り込まないようにする。
 *
 * 検証する内容:
 * - 移動元に手番側の駒があること、移動先が自分の駒でも相手の玉でもないこと
 * - CSA の駒コードが「移動元の駒」か「その成り駒 (成れる駒が敵陣に出入りするとき)」で
 *   あること
 * - 駒の動き (利きと飛び越え) として可能であること
 * - 駒打ちは持ち駒にあり、移動先が空で、二歩・行き所のない駒でないこと
 * - 行き所のない駒になる不成でないこと
 * - 自玉への王手を放置していないこと
 *
 * 打ち歩詰めと千日手は見ない (詰みの判定が要るため)。
 */

import {
    applyMoveWithState,
    BOARD_FILES,
    BOARD_RANKS,
    type BoardState,
    type Piece,
    type PieceType,
    type Player,
    type PositionState,
    type Square,
} from "./board";
import { CSA_PIECE_CODES } from "./csa-position";

const PROMOTABLE: ReadonlySet<PieceType> = new Set(["P", "L", "N", "S", "B", "R"]);

const fileOf = (square: Square): number => Number(square[0]);
const rankOf = (square: Square): number =>
    BOARD_RANKS.indexOf(square[1] as (typeof BOARD_RANKS)[number]) + 1;
const toSquare = (file: number, rank: number): Square =>
    `${file}${BOARD_RANKS[rank - 1]}` as Square;

/** CSA のマス表記 (`76` = 7 筋 6 段) を内部のマスに直す。 */
const parseSquare = (value: string): Square | null => {
    const file = Number(value[0]);
    const rank = Number(value[1]);
    if (!(file >= 1 && file <= 9 && rank >= 1 && rank <= 9)) return null;
    return toSquare(file, rank);
};

/** その側から見て何段目か (1 = 最も奥の敵陣)。 */
const relativeRank = (square: Square, owner: Player): number =>
    owner === "sente" ? rankOf(square) : 10 - rankOf(square);

const inPromotionZone = (square: Square, owner: Player): boolean =>
    relativeRank(square, owner) <= 3;

const isKingStep = (df: number, forward: number): boolean =>
    Math.abs(df) <= 1 && Math.abs(forward) <= 1 && (df !== 0 || forward !== 0);

const isGoldStep = (df: number, forward: number): boolean =>
    (forward === 1 && Math.abs(df) <= 1) ||
    (forward === 0 && Math.abs(df) === 1) ||
    (forward === -1 && df === 0);

const isPathClear = (board: BoardState, from: Square, to: Square): boolean => {
    const stepFile = Math.sign(fileOf(to) - fileOf(from));
    const stepRank = Math.sign(rankOf(to) - rankOf(from));
    let file = fileOf(from) + stepFile;
    let rank = rankOf(from) + stepRank;
    while (file !== fileOf(to) || rank !== rankOf(to)) {
        if (board[toSquare(file, rank)]) return false;
        file += stepFile;
        rank += stepRank;
    }
    return true;
};

/** `from` にある `piece` が、駒の動きとして `to` に行けるか (移動先の駒の有無は見ない)。 */
const canReach = (board: BoardState, from: Square, to: Square, piece: Piece): boolean => {
    const df = fileOf(to) - fileOf(from);
    const dr = rankOf(to) - rankOf(from);
    if (df === 0 && dr === 0) return false;
    // 先手は段の数字が減る向きが前。
    const forward = piece.owner === "sente" ? -dr : dr;
    const diagonal = Math.abs(df) === Math.abs(dr);
    const straight = df === 0 || dr === 0;

    switch (piece.type) {
        case "K":
            return isKingStep(df, forward);
        case "G":
            return isGoldStep(df, forward);
        case "B":
            if (diagonal) return isPathClear(board, from, to);
            return piece.promoted === true && isKingStep(df, forward);
        case "R":
            if (straight) return isPathClear(board, from, to);
            return piece.promoted === true && isKingStep(df, forward);
        default:
            break;
    }
    if (piece.promoted) return isGoldStep(df, forward);
    switch (piece.type) {
        case "P":
            return df === 0 && forward === 1;
        case "L":
            return df === 0 && forward > 0 && isPathClear(board, from, to);
        case "N":
            return Math.abs(df) === 1 && forward === 2;
        case "S":
            return (forward === 1 && Math.abs(df) <= 1) || (forward === -1 && Math.abs(df) === 1);
        default:
            return false;
    }
};

/** 成らずにそのマスへ進むと二度と動けなくなる駒か。 */
const isDeadEnd = (type: PieceType, to: Square, owner: Player): boolean => {
    const rank = relativeRank(to, owner);
    if (type === "P" || type === "L") return rank === 1;
    if (type === "N") return rank <= 2;
    return false;
};

const hasUnpromotedPawnOnFile = (board: BoardState, file: number, owner: Player): boolean => {
    for (let rank = 1; rank <= 9; rank++) {
        const piece = board[toSquare(file, rank)];
        if (piece && piece.owner === owner && piece.type === "P" && !piece.promoted) return true;
    }
    return false;
};

/**
 * `owner` の玉に相手の駒の利きがあるか (王手放置の判定)。
 *
 * `owner` の玉が盤上に無い局面では false を返し、判定そのものをスキップする。
 * 詰将棋の攻め方のように玉を置かない局面も CSA の開始局面として受け付けているので、
 * 玉が無いことを「王手放置」として弾かないための意図的な扱い。
 */
const isKingAttacked = (board: BoardState, owner: Player): boolean => {
    let kingSquare: Square | null = null;
    for (const rank of BOARD_RANKS) {
        for (const file of BOARD_FILES) {
            const square = `${file}${rank}` as Square;
            const piece = board[square];
            if (piece && piece.owner === owner && piece.type === "K") kingSquare = square;
        }
    }
    // 玉の無い局面 (詰将棋の攻め方など) では見ない。
    if (!kingSquare) return false;
    for (const rank of BOARD_RANKS) {
        for (const file of BOARD_FILES) {
            const square = `${file}${rank}` as Square;
            const piece = board[square];
            if (piece && piece.owner !== owner && canReach(board, square, kingSquare, piece)) {
                return true;
            }
        }
    }
    return false;
};

const CSA_MOVE_PATTERN = /^([+-])(\d{2})(\d{2})([A-Z]{2})$/;

/**
 * CSA の指し手 (`+7776FU` / `-0055KA`) を検証して適用し、USI と適用後の局面を返す。
 * 書式として指し手でないもの、局面に照らして指せない手は、理由つきの例外にする。
 */
export function applyCsaMoveStrict(
    token: string,
    state: PositionState,
): { move: string; nextState: PositionState } {
    const match = CSA_MOVE_PATTERN.exec(token.trim());
    if (!match) throw new Error("指し手として解釈できません");
    const owner: Player = match[1] === "+" ? "sente" : "gote";
    if (owner !== state.turn) {
        throw new Error(`手番が違います (${state.turn === "sente" ? "先手" : "後手"}番です)`);
    }
    const to = parseSquare(match[3]);
    const spec = CSA_PIECE_CODES[match[4]];
    if (!to) throw new Error(`移動先のマスを解釈できません: ${match[3]}`);
    if (!spec) throw new Error(`駒コードを解釈できません: ${match[4]}`);
    const target = state.board[to];

    let usi: string;
    if (match[2] === "00") {
        if (spec.promoted || spec.type === "K") throw new Error("打てない駒です");
        if ((state.hands[owner][spec.type] ?? 0) <= 0) throw new Error("持ち駒にありません");
        if (target) throw new Error("駒のあるマスには打てません");
        if (isDeadEnd(spec.type, to, owner)) throw new Error("行き所のない駒は打てません");
        if (spec.type === "P" && hasUnpromotedPawnOnFile(state.board, fileOf(to), owner)) {
            throw new Error("二歩です");
        }
        usi = `${spec.type}*${to}`;
    } else {
        const from = parseSquare(match[2]);
        if (!from) throw new Error(`移動元のマスを解釈できません: ${match[2]}`);
        const piece = state.board[from];
        if (!piece) throw new Error("移動元に駒がありません");
        if (piece.owner !== owner) throw new Error("移動元の駒は相手の駒です");
        if (target && target.owner === owner) throw new Error("移動先に自分の駒があります");
        if (target && target.type === "K") throw new Error("玉は取れません");

        const alreadyPromoted = piece.promoted === true;
        let promote = false;
        if (spec.type !== piece.type || (!spec.promoted && alreadyPromoted)) {
            throw new Error("駒コードが移動元の駒と一致しません");
        }
        if (spec.promoted && !alreadyPromoted) {
            const canPromote =
                PROMOTABLE.has(piece.type) &&
                (inPromotionZone(from, owner) || inPromotionZone(to, owner));
            if (!canPromote) throw new Error("その駒はそこでは成れません");
            promote = true;
        }
        if (!canReach(state.board, from, to, piece)) {
            throw new Error("その駒はそのマスへ動けません");
        }
        if (!promote && !alreadyPromoted && isDeadEnd(piece.type, to, owner)) {
            throw new Error("行き所のない駒になります (成る必要があります)");
        }
        usi = `${from}${to}${promote ? "+" : ""}`;
    }

    const result = applyMoveWithState(state, usi, { validateTurn: true });
    if (!result.ok) throw new Error(result.error ?? "盤面に適用できません");
    if (isKingAttacked(result.next.board, owner)) throw new Error("王手を放置しています");
    return { move: usi, nextState: result.next };
}
