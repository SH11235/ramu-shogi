/**
 * MatchStateContext 型定義
 *
 * 対局進行状態コンテキストの型を定義
 */

import type { LastMove, PieceType, Player, PositionState, Square } from "@shogi/app-core";
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

/**
 * 選択状態
 */
export type SelectionState =
    | { kind: "square"; square: string }
    | { kind: "hand"; piece: PieceType };

/**
 * 持ち駒情報
 */
export interface HandInfo {
    owner: Player;
    hand: PositionState["hands"]["sente"] | PositionState["hands"]["gote"];
    isActive: boolean;
    isAI: boolean;
}

/**
 * 対局進行状態コンテキスト値
 *
 * 変更頻度: 高（手番ごと）
 *
 * 責務:
 * - 現在局面・時計・盤面グリッドの管理
 * - 対局状態（進行中/一時停止/編集モード）
 * - 駒の選択・移動・成り処理
 * - 対局コントロール（開始/一時停止/投了等）
 * - パス機能
 */
export interface MatchStateContextValue {
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
}
