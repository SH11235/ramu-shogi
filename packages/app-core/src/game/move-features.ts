/**
 * 指し手の特徴抽出ユーティリティ
 *
 * USI形式の指し手と盤面状態から、駒種・駒取り・成り等の特徴を導出する。
 * 将棋解説AI向けの入力データ生成に使用。
 */

import type { BoardState, PieceType } from "./board";
import { parseMove } from "./board";

/** 指し手の特徴情報 */
export interface MoveFeatures {
    /** 動かした駒種 */
    movedPiece: PieceType;
    /** 移動前に成り駒だったか */
    movedPiecePromoted: boolean;
    /** 駒を取ったか */
    isCapture: boolean;
    /** 取った駒種（取ってない場合 undefined） */
    capturedPiece?: PieceType;
    /** 取った駒が成り駒だったか */
    capturedPiecePromoted?: boolean;
    /** この手で成ったか */
    isPromote: boolean;
    /** 駒打ちか */
    isDrop: boolean;
    /** 王手か（WASM版のみ提供、TypeScript版では undefined） */
    isCheck?: boolean;
}

/**
 * USI形式の指し手と盤面状態から、指し手の特徴を抽出する
 *
 * @param usiMove USI形式の指し手（例: "7g7f", "P*5e", "7g7f+", "pass"）
 * @param boardBefore 指し手適用前の盤面状態
 * @returns 特徴情報。パス手や無効な手の場合は null
 */
export function extractMoveFeatures(usiMove: string, boardBefore: BoardState): MoveFeatures | null {
    const parsed = parseMove(usiMove);
    if (!parsed || parsed.kind === "pass") {
        return null;
    }

    if (parsed.kind === "drop") {
        return {
            movedPiece: parsed.piece,
            movedPiecePromoted: false,
            isCapture: false,
            isPromote: false,
            isDrop: true,
        };
    }

    // 通常移動
    const fromPiece = boardBefore[parsed.from];
    if (!fromPiece) {
        return null;
    }

    const toPiece = boardBefore[parsed.to];
    const isCapture = toPiece != null;

    return {
        movedPiece: fromPiece.type,
        movedPiecePromoted: fromPiece.promoted ?? false,
        isCapture,
        capturedPiece: isCapture ? toPiece.type : undefined,
        capturedPiecePromoted: isCapture ? (toPiece.promoted ?? false) : undefined,
        isPromote: parsed.promote,
        isDrop: false,
    };
}
