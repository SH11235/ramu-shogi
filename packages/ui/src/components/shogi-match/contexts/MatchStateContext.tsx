/**
 * MatchStateContext
 *
 * 対局進行状態を管理するContext
 * - 局面状態（position, clocks, grid）
 * - ゲーム状態（isMatchRunning, isPaused, isEditMode等）
 * - 選択状態（selection, promotionSelection, lastMove）
 * - 対局操作ハンドラ
 *
 * 変更頻度: 高（手番ごと）
 */

import type { LastMove, PieceType, Player, PositionState, Square } from "@shogi/app-core";
import { createContext, type ReactNode, useContext } from "react";
import type { ShogiBoardCell, ShogiBoardPiece } from "../../shogi-board";
import type { PassDisabledReason } from "../components/PassButton";
import type { TickState } from "../hooks/useClockManager";
import type {
    DisplaySettings,
    GameMode,
    Message,
    PassRightsSettings,
    PromotionSelection,
    SideSetting,
} from "../types";
import type { HandInfo, MatchStateContextValue, SelectionState } from "./types";

const MatchStateContext = createContext<MatchStateContextValue | null>(null);

interface MatchStateProviderProps {
    // 局面状態
    position: PositionState;
    clocks: TickState;
    grid: ShogiBoardCell[][];

    // ゲーム状態
    isMatchRunning: boolean;
    isPaused: boolean;
    isEditMode: boolean;
    gameMode: GameMode;
    message: Message | null;

    // 選択状態
    selection: SelectionState | null;
    promotionSelection: PromotionSelection | null;
    lastMove?: LastMove;

    // 表示
    flipBoard: boolean;
    onFlipBoardChange: (flip: boolean) => void;
    displaySettings: DisplaySettings;
    passRightsSettings?: PassRightsSettings;

    // 手番・プレイヤー情報
    sides: { sente: SideSetting; gote: SideSetting };
    moves: string[];

    // 編集モード
    editFromSquare: Square | null;
    hideEmptyHandPieces: boolean;

    // ハンドラ
    getHandInfo: (pos: "top" | "bottom") => HandInfo;
    handleSquareSelect: (sq: string, shiftKey?: boolean) => Promise<void>;
    handlePromotionChoice: (promote: boolean) => void;
    handleHandSelect: (piece: PieceType) => void;
    handleHandPiecePointerDown: (
        owner: Player,
        pieceType: PieceType,
        e: React.PointerEvent,
    ) => void;
    handlePiecePointerDown: (square: string, piece: ShogiBoardPiece, e: React.PointerEvent) => void;
    handlePieceTogglePromote: (
        square: string,
        piece: ShogiBoardPiece,
        event: React.MouseEvent<HTMLButtonElement>,
    ) => void;
    handleIncrementHand: (owner: Player, piece: PieceType) => void;
    handleDecrementHand: (owner: Player, piece: PieceType) => void;

    // 対局コントロール
    handleResetToStartpos: () => void;
    pauseAutoPlay: () => void;
    resumeAutoPlay: () => void;
    handleStartReview: () => void;
    handleEnterEditMode: () => void;
    enterEditModeFromPaused: () => void;
    handleResign: () => void;
    handleUndo: () => void;
    onOpenSettings: () => void;

    // パス関連
    shouldRenderPassButton: boolean;
    canMakePassMove: boolean;
    passButtonDisabledReason?: PassDisabledReason;
    handlePassMove: () => void;
    shouldShowPassConfirm: boolean;

    // DnD
    isDraggingPiece: boolean;

    // Refs
    boardSectionRef: React.RefObject<HTMLDivElement | null>;

    children: ReactNode;
}

/**
 * 対局進行状態コンテキストを提供するProvider
 */
export function MatchStateProvider({
    position,
    clocks,
    grid,
    isMatchRunning,
    isPaused,
    isEditMode,
    gameMode,
    message,
    selection,
    promotionSelection,
    lastMove,
    flipBoard,
    onFlipBoardChange,
    displaySettings,
    passRightsSettings,
    sides,
    moves,
    editFromSquare,
    hideEmptyHandPieces,
    getHandInfo,
    handleSquareSelect,
    handlePromotionChoice,
    handleHandSelect,
    handleHandPiecePointerDown,
    handlePiecePointerDown,
    handlePieceTogglePromote,
    handleIncrementHand,
    handleDecrementHand,
    handleResetToStartpos,
    pauseAutoPlay,
    resumeAutoPlay,
    handleStartReview,
    handleEnterEditMode,
    enterEditModeFromPaused,
    handleResign,
    handleUndo,
    onOpenSettings,
    shouldRenderPassButton,
    canMakePassMove,
    passButtonDisabledReason,
    handlePassMove,
    shouldShowPassConfirm,
    isDraggingPiece,
    boardSectionRef,
    children,
}: MatchStateProviderProps): ReactNode {
    const value: MatchStateContextValue = {
        position,
        clocks,
        grid,
        isMatchRunning,
        isPaused,
        isEditMode,
        gameMode,
        message,
        selection,
        promotionSelection,
        lastMove,
        flipBoard,
        onFlipBoardChange,
        displaySettings,
        passRightsSettings,
        sides,
        moves,
        editFromSquare,
        hideEmptyHandPieces,
        getHandInfo,
        handleSquareSelect,
        handlePromotionChoice,
        handleHandSelect,
        handleHandPiecePointerDown,
        handlePiecePointerDown,
        handlePieceTogglePromote,
        handleIncrementHand,
        handleDecrementHand,
        handleResetToStartpos,
        pauseAutoPlay,
        resumeAutoPlay,
        handleStartReview,
        handleEnterEditMode,
        enterEditModeFromPaused,
        handleResign,
        handleUndo,
        onOpenSettings,
        shouldRenderPassButton,
        canMakePassMove,
        passButtonDisabledReason,
        handlePassMove,
        shouldShowPassConfirm,
        isDraggingPiece,
        boardSectionRef,
    };

    return <MatchStateContext.Provider value={value}>{children}</MatchStateContext.Provider>;
}

/**
 * 対局進行状態コンテキストを取得するフック
 *
 * Provider の外で使用した場合はエラーをスロー。
 */
export function useMatchState(): MatchStateContextValue {
    const ctx = useContext(MatchStateContext);
    if (!ctx) {
        throw new Error("useMatchState must be used within a MatchStateProvider");
    }
    return ctx;
}
