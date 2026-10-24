import type { Hands, PieceType, Player, PositionState } from "@shogi/app-core";
import { PIECE_CAP, PIECE_LABELS } from "./constants";

/**
 * 持ち駒の状態をクローンする
 *
 * @param hands - クローン対象の持ち駒
 * @returns クローンされた持ち駒
 */
export function cloneHandsState(hands: Hands): Hands {
    return {
        sente: { ...hands.sente },
        gote: { ...hands.gote },
    };
}

/**
 * 持ち駒に駒を追加する（イミュータブル）
 *
 * @param hands - 元の持ち駒
 * @param owner - 駒の所有者
 * @param pieceType - 追加する駒の種類
 * @returns 新しい持ち駒の状態
 *
 * @example
 * ```typescript
 * const hands = { sente: { P: 1 }, gote: {} };
 * const newHands = addToHand(hands, "sente", "P");
 * // => { sente: { P: 2 }, gote: {} }
 * ```
 */
export function addToHand(hands: Hands, owner: Player, pieceType: PieceType): Hands {
    const next = cloneHandsState(hands);
    const current = next[owner][pieceType] ?? 0;
    next[owner][pieceType] = current + 1;
    return next;
}

/**
 * 持ち駒から駒を消費する（イミュータブル）
 *
 * @param hands - 元の持ち駒
 * @param owner - 駒の所有者
 * @param pieceType - 消費する駒の種類
 * @returns 新しい持ち駒の状態。駒が不足している場合は null
 *
 * @example
 * ```typescript
 * const hands = { sente: { P: 2 }, gote: {} };
 * const newHands = consumeFromHand(hands, "sente", "P");
 * // => { sente: { P: 1 }, gote: {} }
 *
 * const emptyHands = consumeFromHand(hands, "sente", "R");
 * // => null (駒が不足)
 * ```
 */
export function consumeFromHand(hands: Hands, owner: Player, pieceType: PieceType): Hands | null {
    const next = cloneHandsState(hands);
    const current = next[owner][pieceType] ?? 0;
    if (current <= 0) return null;
    if (current === 1) {
        delete next[owner][pieceType];
    } else {
        next[owner][pieceType] = current - 1;
    }
    return next;
}

/**
 * 局面内の全駒数をカウントする（盤上＋持ち駒）
 *
 * @param position - カウント対象の局面
 * @returns 各プレイヤーごとの駒種類別カウント
 *
 * @example
 * ```typescript
 * const position = { board: {...}, hands: {...}, turn: "sente", ply: 1 };
 * const counts = countPieces(position);
 * // => { sente: { K: 1, R: 1, ... }, gote: { K: 1, R: 1, ... } }
 * ```
 */
export function countPieces(position: PositionState): Record<Player, Record<PieceType, number>> {
    const counts: Record<Player, Record<PieceType, number>> = {
        sente: { K: 0, R: 0, B: 0, G: 0, S: 0, N: 0, L: 0, P: 0 },
        gote: { K: 0, R: 0, B: 0, G: 0, S: 0, N: 0, L: 0, P: 0 },
    };

    // 盤上の駒をカウント
    for (const piece of Object.values(position.board)) {
        if (!piece) continue;
        counts[piece.owner][piece.type] += 1;
    }

    // 持ち駒をカウント
    for (const owner of ["sente", "gote"] as Player[]) {
        const hand = position.hands[owner];
        for (const key of Object.keys(hand) as PieceType[]) {
            counts[owner][key] += hand[key] ?? 0;
        }
    }

    return counts;
}

const INVENTORY_ORDER: PieceType[] = ["R", "B", "G", "S", "N", "L", "P"];

const OWNER_LABELS: Record<Player, string> = { sente: "先手", gote: "後手" };

/**
 * 局面内の駒数を、先手・後手を合算して数える（盤上＋双方の持ち駒）
 *
 * 駒の枚数の上限（歩 18・香桂銀金 4・角飛 2）は一組の駒についてのものなので、
 * 持ち主ごとではなく、この合計で比べる。
 */
export function countTotalPieces(position: PositionState): Record<PieceType, number> {
    const counts = countPieces(position);
    const total: Record<PieceType, number> = { K: 0, R: 0, B: 0, G: 0, S: 0, N: 0, L: 0, P: 0 };
    for (const key of Object.keys(total) as PieceType[]) {
        total[key] = counts.sente[key] + counts.gote[key];
    }
    return total;
}

/**
 * 駒の枚数が上限を超えるときのメッセージ
 */
export function pieceCapMessage(pieceType: PieceType): string {
    return `${PIECE_LABELS[pieceType]}は先手・後手あわせて最大${PIECE_CAP[pieceType]}枚までです。`;
}

/**
 * 編集した局面が、局面として成り立つかを確かめる
 *
 * エンジン側（rshogi の `Position::from_board_state_json`）が受け付ける条件と揃えてある。
 * ここを通らない局面は SFEN に変換できないので、盤へ反映する前に弾く。
 *
 * - 玉は先手・後手それぞれ盤上に 1 枚まで（持ち駒にはできない）。詰将棋の攻め方のように、
 *   玉の無い側があってもよい（取り込んだ局面。対局は始められない。`missingKingReason` を参照）
 * - それ以外の駒は、先手・後手の盤上と持ち駒を合わせて一組の枚数まで
 *
 * @returns 成り立つなら null、成り立たないなら理由のメッセージ
 */
export function validateEditedPosition(position: PositionState): string | null {
    for (const owner of ["sente", "gote"] as Player[]) {
        if ((position.hands[owner].K ?? 0) > 0) {
            return "玉は持ち駒にできません。";
        }
    }
    if (Object.values(kingsOnBoard(position)).some((count) => count > PIECE_CAP.K)) {
        return "玉はそれぞれ1枚まで配置できます。";
    }

    const total = countTotalPieces(position);
    for (const pieceType of INVENTORY_ORDER) {
        if (total[pieceType] > PIECE_CAP[pieceType]) {
            return pieceCapMessage(pieceType);
        }
    }
    return null;
}

function kingsOnBoard(position: PositionState): Record<Player, number> {
    const kings: Record<Player, number> = { sente: 0, gote: 0 };
    for (const piece of Object.values(position.board)) {
        if (piece?.type === "K") kings[piece.owner] += 1;
    }
    return kings;
}

/** 玉の無い側（先手・後手の順）。玉を取る手は無いので、手順の途中でも開始局面と同じ。 */
export function sidesWithoutKing(position: PositionState): Player[] {
    const kings = kingsOnBoard(position);
    return (["sente", "gote"] as Player[]).filter((owner) => kings[owner] === 0);
}

/**
 * 対局を始められない、玉の無い側がある局面なら、その理由（無ければ null）。
 */
export function missingKingReason(position: PositionState): string | null {
    const missing = sidesWithoutKing(position);
    if (missing.length === 0) return null;
    const who = missing.map((owner) => OWNER_LABELS[owner]).join("・");
    return `${who}の玉が無い局面では対局できません。`;
}
