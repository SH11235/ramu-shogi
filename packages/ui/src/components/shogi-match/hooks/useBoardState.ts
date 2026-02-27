/**
 * useBoardState
 *
 * 盤面状態と編集モード状態を統合するフック
 * - 局面状態（position, lastMove, selection等）
 * - ゲーム結果・メッセージ
 * - 編集モード状態
 */

import type {
    BoardState,
    GameResult,
    LastMove,
    PieceType,
    Player,
    PositionState,
    Square,
} from "@shogi/app-core";
import { cloneBoard } from "@shogi/app-core";
import { useState } from "react";
import type { Message, PromotionSelection, Selection } from "../types";
import { clonePositionState } from "../utils/positionUtils";

interface UseBoardStateParams {
    /** 初期局面 */
    initialPosition: PositionState;
}

interface UseBoardStateResult {
    // 局面状態
    position: PositionState;
    setPosition: (position: PositionState) => void;
    positionReady: boolean;
    setPositionReady: (ready: boolean) => void;
    setInitialBoard: (board: BoardState | null) => void;
    setBasePosition: (position: PositionState | null) => void;

    // 手の状態
    lastMove: LastMove | undefined;
    setLastMove: (move: LastMove | undefined) => void;
    selection: Selection | null;
    setSelection: (selection: Selection | null) => void;
    promotionSelection: PromotionSelection | null;
    setPromotionSelection: (selection: PromotionSelection | null) => void;

    // メッセージ・結果
    message: Message | null;
    setMessage: (message: Message | null) => void;
    gameResult: GameResult | null;
    setGameResult: (result: GameResult | null) => void;
    showResultDialog: boolean;
    setShowResultDialog: (show: boolean) => void;

    // 編集モード状態
    editOwner: Player;
    setEditOwner: (owner: Player) => void;
    editPieceType: PieceType | null;
    setEditPieceType: (type: PieceType | null) => void;
    editPromoted: boolean;
    setEditPromoted: (promoted: boolean) => void;
    editFromSquare: Square | null;
    setEditFromSquare: (square: Square | null) => void;
    editTool: "place" | "erase";
    setEditTool: (tool: "place" | "erase") => void;

    // SFEN
    startSfen: string;
    setStartSfen: (sfen: string) => void;

    // 一括初期化
    /** 初期局面・SFEN・準備完了フラグを一度に設定する */
    initializeBoard: (pos: PositionState, sfen: string) => void;
}

/**
 * 盤面状態と編集モード状態を統合するフック
 */
export function useBoardState({ initialPosition }: UseBoardStateParams): UseBoardStateResult {
    // 局面状態
    const [position, setPosition] = useState<PositionState>(initialPosition);
    const [positionReady, setPositionReady] = useState(false);
    const [, setInitialBoard] = useState<BoardState | null>(null);
    const [, setBasePosition] = useState<PositionState | null>(null);

    // 手の状態
    const [lastMove, setLastMove] = useState<LastMove | undefined>(undefined);
    const [selection, setSelection] = useState<Selection | null>(null);
    const [promotionSelection, setPromotionSelection] = useState<PromotionSelection | null>(null);

    // メッセージ・結果
    const [message, setMessage] = useState<Message | null>(null);
    const [gameResult, setGameResult] = useState<GameResult | null>(null);
    const [showResultDialog, setShowResultDialog] = useState(false);

    // 編集モード状態
    const [editOwner, setEditOwner] = useState<Player>("sente");
    const [editPieceType, setEditPieceType] = useState<PieceType | null>(null);
    const [editPromoted, setEditPromoted] = useState(false);
    const [editFromSquare, setEditFromSquare] = useState<Square | null>(null);
    const [editTool, setEditTool] = useState<"place" | "erase">("place");

    // SFEN
    const [startSfen, setStartSfen] = useState<string>("startpos");

    // 一括初期化：初期局面・SFEN・準備完了フラグをまとめて設定
    // React Compiler が自動メモ化するため useCallback 不要
    const initializeBoard = (pos: PositionState, sfen: string) => {
        setPosition(pos);
        setInitialBoard(cloneBoard(pos.board));
        setBasePosition(clonePositionState(pos));
        setStartSfen(sfen);
        setPositionReady(true);
    };

    return {
        // 局面状態
        position,
        setPosition,
        positionReady,
        setPositionReady,
        setInitialBoard,
        setBasePosition,
        // 手の状態
        lastMove,
        setLastMove,
        selection,
        setSelection,
        promotionSelection,
        setPromotionSelection,
        // メッセージ・結果
        message,
        setMessage,
        gameResult,
        setGameResult,
        showResultDialog,
        setShowResultDialog,
        // 編集モード状態
        editOwner,
        setEditOwner,
        editPieceType,
        setEditPieceType,
        editPromoted,
        setEditPromoted,
        editFromSquare,
        setEditFromSquare,
        editTool,
        setEditTool,
        // SFEN
        startSfen,
        setStartSfen,
        // 一括初期化
        initializeBoard,
    };
}
