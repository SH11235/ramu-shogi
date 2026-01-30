import type { PieceType, Player } from "@shogi/app-core";

/**
 * 駒の種類ごとの上限枚数
 */
export const PIECE_CAP: Record<PieceType, number> = {
    P: 18,
    L: 4,
    N: 4,
    S: 4,
    G: 4,
    B: 2,
    R: 2,
    K: 1,
};

/**
 * 駒の種類ごとの日本語ラベル
 */
export const PIECE_LABELS: Record<PieceType, string> = {
    K: "玉",
    R: "飛",
    B: "角",
    G: "金",
    S: "銀",
    N: "桂",
    L: "香",
    P: "歩",
};

/**
 * 駒の種類から画像ファイル名のベース部分を取得
 */
const PIECE_IMAGE_NAMES: Record<PieceType, { normal: string; promoted?: string }> = {
    K: { normal: "king" },
    R: { normal: "rook", promoted: "dragon" },
    B: { normal: "bishop", promoted: "horse" },
    G: { normal: "gold" },
    S: { normal: "silver", promoted: "prom_silver" },
    N: { normal: "knight", promoted: "prom_knight" },
    L: { normal: "lance", promoted: "prom_lance" },
    P: { normal: "pawn", promoted: "prom_pawn" },
};

/**
 * 駒の画像パスを取得
 *
 * 注意: 先手・後手とも同じ画像（black_*）を使用し、後手の駒はCSSで180度回転させる。
 * 理由: sunfish-shogiの画像セットでは white_* 画像が既に180度回転済みのため、
 *       CSS回転と組み合わせると後手の駒が正しく表示されない。
 *
 * 王将の区別: 先手は「玉」(black_king.png)、後手は「王」(black_king2.png) を使用。
 *
 * @param owner 駒の所有者 ("sente" | "gote")
 * @param type 駒の種類 ("K" | "R" | "B" | ...)
 * @param promoted 成り駒かどうか
 * @returns 画像パス（例: "/pieces/black_pawn.png"）
 */
export function getPieceImagePath(owner: Player, type: PieceType, promoted?: boolean): string {
    const imageInfo = PIECE_IMAGE_NAMES[type];
    // 王将の場合: 先手は玉(king)、後手は王(king2)
    if (type === "K") {
        const kingImage = owner === "sente" ? "king" : "king2";
        return `/pieces/black_${kingImage}.png`;
    }
    // その他の駒: 先手・後手とも黒画像を使用（回転はCSSで制御）
    const pieceName = promoted && imageInfo.promoted ? imageInfo.promoted : imageInfo.normal;
    return `/pieces/black_${pieceName}.png`;
}

/**
 * 駒が成れるかどうかを判定する
 *
 * @param type - 駒の種類
 * @returns 成れる場合は true
 */
export function isPromotable(type: PieceType): boolean {
    return type !== "K" && type !== "G";
}
