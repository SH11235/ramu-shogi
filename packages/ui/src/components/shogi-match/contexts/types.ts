/**
 * ShogiMatch Context 共通型定義
 *
 * 各Contextで使用する型を集約
 */

import type {
    KifuTree,
    NnueMeta,
    NnueSelection,
    PositionState,
    PresetConfig,
    PresetWithStatus,
} from "@shogi/app-core";
import type { ClockSettings, TickState } from "../hooks/useClockManager";
import type {
    AnalysisSettings,
    AnalyzingState,
    DisplaySettings,
    PassRightsSettings,
    SideSetting,
} from "../types";
import type { EvalHistory, KifMove } from "../utils/kifFormat";

// ============================================================================
// MatchSettingsContext Types
// ============================================================================

/**
 * 対局設定コンテキスト値
 *
 * 変更頻度: 低（対局開始前に設定、対局中はロック）
 */
export interface MatchSettingsContextValue {
    // 対局設定
    sides: { sente: SideSetting; gote: SideSetting };
    onSidesChange: (sides: { sente: SideSetting; gote: SideSetting }) => void;
    timeSettings: ClockSettings;
    onTimeSettingsChange: (settings: ClockSettings) => void;
    passRightsSettings: PassRightsSettings;
    onPassRightsSettingsChange: (settings: PassRightsSettings) => void;
    settingsLocked: boolean;

    // NNUE関連
    senteNnueSelection: NnueSelection;
    onSenteNnueSelectionChange: (selection: NnueSelection) => void;
    goteNnueSelection: NnueSelection;
    onGoteNnueSelectionChange: (selection: NnueSelection) => void;

    // NNUE一覧
    nnueList: NnueMeta[];
    presets: PresetWithStatus[];
    internalEngineId: string;

    // ダイアログ制御
    onOpenNnueManager: () => void;
    onOpenDisplaySettings: () => void;
    onOpenPassRightsSettings: () => void;
}

// ============================================================================
// NavigationContext Types
// ============================================================================

/**
 * ナビゲーション状態
 */
export interface NavigationState {
    currentPly: number;
    totalPly: number;
    isRewound: boolean;
    canGoForward: boolean;
    hasBranches: boolean;
    currentBranchIndex: number;
    branchCount: number;
    isOnMainLine: boolean;
}

/**
 * ナビゲーションハンドラ
 */
export interface NavigationHandlers {
    goBack: () => void;
    goForward: (branchNodeId?: string) => void;
    goToStart: () => void;
    goToEnd: () => void;
    switchBranch: (index: number) => void;
    promoteCurrentLine: () => void;
    goToNodeById: (nodeId: string) => void;
    switchBranchAtNode: (parentNodeId: string, branchIndex: number) => void;
}

/**
 * 棋譜ナビゲーションコンテキスト値
 *
 * 変更頻度: 高（ユーザー操作ごと）
 */
export interface NavigationContextValue {
    // ナビゲーション状態
    navigationState: NavigationState;
    navigationHandlers: NavigationHandlers;

    // 棋譜データ
    kifMoves: KifMove[];
    evalHistory: EvalHistory[];
    displayEvalHistory: EvalHistory[];
    positionHistory: PositionState[];
    kifuTree?: KifuTree;

    // 分岐関連
    selectedBranchNodeId: string | null;
    onSelectedBranchChange: (branchNodeId: string | null) => void;
    branchMarkers: Map<number, number>;
    lastAddedBranchInfo: { ply: number; firstMove: string } | null;
    onLastAddedBranchHandled: () => void;
    handleAddPvAsBranch: (ply: number, pv: string[]) => void;
    handlePreviewPv: (ply: number, pv: string[], evalCp?: number, evalMate?: number) => void;

    // 表示モード
    kifuViewMode: KifuViewMode;
    onViewModeChange: (mode: KifuViewMode) => void;

    // 表示設定
    displaySettings: DisplaySettings;
    onDisplaySettingsChange: (updater: (prev: DisplaySettings) => DisplaySettings) => void;

    // 手の選択
    handlePlySelect: (ply: number) => void;
    handleCopyKif: () => string;
    handleMoveDetailSelect: (move: KifMove | null, position: PositionState | null) => void;

    // 対局状態（ナビゲーション無効化用）
    isMatchRunning: boolean;
}

export type KifuViewMode = "main" | "branches" | "selectedBranch";

// ============================================================================
// AnalysisContext Types
// ============================================================================

/**
 * 一括解析状態
 */
export interface BatchAnalysisState {
    isRunning: boolean;
    currentIndex: number;
    totalCount: number;
    inProgress?: number[];
}

/**
 * 分析コンテキスト値
 *
 * 変更頻度: 中（分析実行時に更新）
 */
export interface AnalysisContextValue {
    // 分析設定
    analysisSettings: AnalysisSettings;
    onAnalysisSettingsChange: (settings: AnalysisSettings) => void;

    // 分析用NNUE
    analysisNnueSelection: NnueSelection;
    onAnalysisNnueSelectionChange: (selection: NnueSelection) => void;
    nnueList: NnueMeta[];
    isNnueListLoading: boolean;
    presetConfigs: PresetConfig[];

    // 分析状態
    isAnalyzing: boolean;
    analyzingState: AnalyzingState;
    batchAnalysis: BatchAnalysisState | null;

    // 分析操作
    handleAnalyzePly: (ply: number) => void;
    handleStartBatchAnalysis: () => void;
    handleCancelBatchAnalysis: () => void;
    handleAnalyzeNode: (nodeId: string) => void;
    handleAnalyzeBranch: (branchNodeId: string) => void;
    handleStartTreeBatchAnalysis: (options?: { mainLineOnly?: boolean }) => void;
}

// ============================================================================
// MatchStateContext Types
// ============================================================================

/**
 * 対局進行状態コンテキスト値
 *
 * 変更頻度: 高（手番ごと）
 */
export interface MatchStateContextValue {
    // 局面状態
    position: PositionState;
    clocks: TickState;
    grid: import("../../shogi-board").ShogiBoardCell[][];

    // ゲーム状態
    isMatchRunning: boolean;
    isPaused: boolean;
    isEditMode: boolean;
    gameMode: import("../types").GameMode;
    message: import("../types").Message | null;

    // 選択状態
    selection: SelectionState | null;
    promotionSelection: import("../types").PromotionSelection | null;
    lastMove?: import("@shogi/app-core").LastMove;

    // 表示
    flipBoard: boolean;
    onFlipBoardChange: (flip: boolean) => void;
    displaySettings: DisplaySettings;
    passRightsSettings?: PassRightsSettings;

    // 手番・プレイヤー情報
    sides: { sente: SideSetting; gote: SideSetting };
    moves: string[];

    // 編集モード
    editFromSquare: import("@shogi/app-core").Square | null;
    hideEmptyHandPieces: boolean;

    // ハンドラ
    getHandInfo: (pos: "top" | "bottom") => HandInfo;
    handleSquareSelect: (sq: string, shiftKey?: boolean) => Promise<void>;
    handlePromotionChoice: (promote: boolean) => void;
    handleHandSelect: (piece: import("@shogi/app-core").PieceType) => void;
    handleHandPiecePointerDown: (
        owner: import("@shogi/app-core").Player,
        pieceType: import("@shogi/app-core").PieceType,
        e: React.PointerEvent,
    ) => void;
    handlePiecePointerDown: (
        square: string,
        piece: import("../../shogi-board").ShogiBoardPiece,
        e: React.PointerEvent,
    ) => void;
    handlePieceTogglePromote: (
        square: string,
        piece: import("../../shogi-board").ShogiBoardPiece,
        event: React.MouseEvent<HTMLButtonElement>,
    ) => void;
    handleIncrementHand: (
        owner: import("@shogi/app-core").Player,
        piece: import("@shogi/app-core").PieceType,
    ) => void;
    handleDecrementHand: (
        owner: import("@shogi/app-core").Player,
        piece: import("@shogi/app-core").PieceType,
    ) => void;

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
    passButtonDisabledReason?: import("../components/PassButton").PassDisabledReason;
    handlePassMove: () => void;
    shouldShowPassConfirm: boolean;

    // DnD
    isDraggingPiece: boolean;

    // Refs
    boardSectionRef: React.RefObject<HTMLDivElement | null>;
}

export type SelectionState =
    | { kind: "square"; square: string }
    | { kind: "hand"; piece: import("@shogi/app-core").PieceType };

export interface HandInfo {
    owner: import("@shogi/app-core").Player;
    hand: PositionState["hands"]["sente"] | PositionState["hands"]["gote"];
    isActive: boolean;
    isAI: boolean;
}
