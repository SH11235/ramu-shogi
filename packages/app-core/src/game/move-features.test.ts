import { describe, expect, it } from "vitest";
import type { BoardState, Piece } from "./board";
import { createInitialBoard } from "./board";
import { extractMoveFeatures } from "./move-features";

/** テスト用にマスに駒を配置するヘルパー */
function withPiece(board: BoardState, square: string, piece: Piece): BoardState {
    return { ...board, [square]: piece };
}

describe("extractMoveFeatures", () => {
    it("通常移動: 7g7f（歩を前進）", () => {
        const board = createInitialBoard();
        const result = extractMoveFeatures("7g7f", board);

        expect(result).toEqual({
            movedPiece: "P",
            movedPiecePromoted: false,
            isCapture: false,
            isPromote: false,
            isDrop: false,
        });
    });

    it("駒取り: 移動先に相手の駒がある", () => {
        let board = createInitialBoard();
        // 5eに後手の歩を配置
        board = withPiece(board, "5e", { owner: "gote", type: "P" });
        // 5fに先手の銀を配置
        board = withPiece(board, "5f", { owner: "sente", type: "S" });

        const result = extractMoveFeatures("5f5e", board);

        expect(result).toEqual({
            movedPiece: "S",
            movedPiecePromoted: false,
            isCapture: true,
            capturedPiece: "P",
            capturedPiecePromoted: false,
            isPromote: false,
            isDrop: false,
        });
    });

    it("成り付き移動: 2b3a+（角が成る）", () => {
        let board = createInitialBoard();
        // 2bに先手の角を配置（初期配置から移動済み想定）
        board = withPiece(board, "2b", { owner: "sente", type: "B" });
        // 3aに後手の銀を配置
        board = withPiece(board, "3a", { owner: "gote", type: "S" });

        const result = extractMoveFeatures("2b3a+", board);

        expect(result).toEqual({
            movedPiece: "B",
            movedPiecePromoted: false,
            isCapture: true,
            capturedPiece: "S",
            capturedPiecePromoted: false,
            isPromote: true,
            isDrop: false,
        });
    });

    it("駒打ち: P*5e（歩を5五に打つ）", () => {
        const board = createInitialBoard();
        const result = extractMoveFeatures("P*5e", board);

        expect(result).toEqual({
            movedPiece: "P",
            movedPiecePromoted: false,
            isCapture: false,
            isPromote: false,
            isDrop: true,
        });
    });

    it("成り駒の取り: 成り銀を取る", () => {
        let board = createInitialBoard();
        // 5eに後手の成銀を配置
        board = withPiece(board, "5e", { owner: "gote", type: "S", promoted: true });
        // 5fに先手の飛車を配置
        board = withPiece(board, "5f", { owner: "sente", type: "R" });

        const result = extractMoveFeatures("5f5e", board);

        expect(result).toEqual({
            movedPiece: "R",
            movedPiecePromoted: false,
            isCapture: true,
            capturedPiece: "S",
            capturedPiecePromoted: true,
            isPromote: false,
            isDrop: false,
        });
    });

    it("成り駒が移動: 馬が移動", () => {
        let board = createInitialBoard();
        // 5eに先手の馬を配置
        board = withPiece(board, "5e", { owner: "sente", type: "B", promoted: true });

        const result = extractMoveFeatures("5e4d", board);

        expect(result).toEqual({
            movedPiece: "B",
            movedPiecePromoted: true,
            isCapture: false,
            isPromote: false,
            isDrop: false,
        });
    });

    it("パス手: null を返す", () => {
        const board = createInitialBoard();
        const result = extractMoveFeatures("pass", board);
        expect(result).toBeNull();
    });

    it("無効な指し手: null を返す", () => {
        const board = createInitialBoard();
        const result = extractMoveFeatures("invalid", board);
        expect(result).toBeNull();
    });

    it("移動元に駒がない場合: null を返す", () => {
        const board = createInitialBoard();
        // 5eは初期配置では空
        const result = extractMoveFeatures("5e5d", board);
        expect(result).toBeNull();
    });
});
