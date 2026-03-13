/**
 * ShogiMatchLayout への props グループ化の型定義
 * props を関心ごとにグループ化し、保守性を向上させる
 */

import type {
    LastMove,
    NnueMeta,
    NnueSelection,
    PositionState,
    PresetWithStatus,
} from "@shogi/app-core";
import type { RemoteNnueManager } from "../../nnue/types";
import type { ShogiBoardCell } from "../../shogi-board";
import type { SelectionState } from "../contexts/MatchStateContext.types";
import type { ClockSettings, TickState } from "../hooks/useClockManager";
import type {
    DisplaySettings,
    EngineThreadSettings,
    GameMode,
    Message,
    PassRightsSettings,
    PromotionSelection,
    SideSetting,
} from "../types";

/**
 * 対局設定グループ
 * - 対局者（先手・後手）の設定
 * - 持ち時間設定
 * - パス権設定
 * - NNUE ファイル選択
 */
export interface MatchSettingsProps {
    sides: { sente: SideSetting; gote: SideSetting };
    handleSidesChange: (sides: { sente: SideSetting; gote: SideSetting }) => void;
    timeSettings: ClockSettings;
    setTimeSettings: (settings: ClockSettings) => void;
    passRightsSettings: PassRightsSettings;
    handlePassRightsSettingsChange: (settings: PassRightsSettings) => void;
    settingsLocked: boolean;
    isDevMode: boolean;
    engineThreads: EngineThreadSettings;
    setEngineThreads: (threads: EngineThreadSettings) => void;
    senteNnueSelection: NnueSelection;
    handleSenteNnueSelectionChange: (selection: NnueSelection) => void;
    goteNnueSelection: NnueSelection;
    handleGoteNnueSelectionChange: (selection: NnueSelection) => void;
    nnueList: NnueMeta[];
    presets: PresetWithStatus[];
    internalEngineId: string;
    setIsDisplaySettingsOpen: (open: boolean) => void;
    setIsPassRightsSettingsOpen: (open: boolean) => void;
}

/**
 * 盤面状態グループ
 * - 現在の局面（position）
 * - 時計の状態
 * - 盤面グリッド
 * - ゲームモード
 * - メッセージ表示
 * - 選択状態
 * - 最後の手
 */
export interface BoardStateProps {
    position: PositionState;
    clocks: TickState;
    grid: ShogiBoardCell[][];
    gameMode: GameMode;
    message: Message | null;
    selection: SelectionState | null;
    promotionSelection: PromotionSelection | null;
    lastMove?: LastMove;
    moves: string[];
    editFromSquare: import("@shogi/app-core").Square | null;
    flipBoard: boolean;
    displaySettings: DisplaySettings;
    onFlipBoardChange: (flip: boolean) => void;
}

/**
 * ダイアログ状態グループ
 * - ゲーム結果ダイアログ
 * - PVプレビューダイアログ
 * - NNUEマネージャーダイアログ
 * - 手の詳細ウィンドウ
 * - Aboutダイアログ
 */
export interface DialogStateProps {
    gameResult: import("@shogi/app-core").GameResult | null;
    showResultDialog: boolean;
    setShowResultDialog: (show: boolean) => void;
    pvPreview: {
        ply: number;
        pv: string[];
        startPosition: PositionState;
        evalCp?: number;
        evalMate?: number;
    } | null;
    setPvPreview: (
        state: {
            ply: number;
            pv: string[];
            startPosition: PositionState;
            evalCp?: number;
            evalMate?: number;
        } | null,
    ) => void;
    isNnueManagerOpen: boolean;
    openNnueManager: () => void;
    closeNnueManager: () => void;
    nnueManagerOpenReason: "missing-sente" | "missing-gote" | "missing-analysis" | null;
    clearNnueManagerOpenReason: () => void;
    manifestUrl?: string;
    onRequestNnueFilePath?: () => Promise<string | null>;
    remoteNnueManager?: RemoteNnueManager;
    selectedMoveDetail: {
        move: import("../utils/kifFormat").KifMove;
        position: PositionState;
    } | null;
    setSelectedMoveDetailPly: (state: { ply: number; position: PositionState } | null) => void;
    isAboutOpen: boolean;
    setIsAboutOpen: (open: boolean) => void;
}

/**
 * 解析機能グループ
 * - 解析設定
 * - NNUE選択
 * - 一括解析
 * - 個別解析
 */
export interface AnalysisProps {
    analysisSettings: import("../types").AnalysisSettings;
    setAnalysisSettings: (settings: import("../types").AnalysisSettings) => void;
    analysisNnueSelection: NnueSelection;
    setAnalysisNnueSelection: (selection: NnueSelection) => void;
    isNnueListLoading: boolean;
    presetConfigs: import("@shogi/app-core").PresetConfig[];
    isAnalyzing: boolean;
    analyzingState: import("../types").AnalyzingState;
    batchAnalysis: import("../contexts/types").BatchAnalysisState | null;
    handleAnalyzePly: (ply: number) => void;
    handleStartBatchAnalysis: () => void;
    handleCancelBatchAnalysis: () => void;
    handleAnalyzeNode: (nodeId: string) => void;
    handleAnalyzeBranch: (branchNodeId: string) => void;
    handleStartTreeBatchAnalysis: (options?: { mainLineOnly?: boolean }) => void;
}

/**
 * ナビゲーション・棋譜グループ
 * - 棋譜ナビゲーション状態
 * - ナビゲーションハンドラー
 * - 棋譜データ
 * - 評価値履歴
 * - 分岐管理
 */
export interface NavigationProps {
    navigationState: import("../contexts/types").NavigationState;
    navigationHandlers: import("../contexts/types").NavigationHandlers;
    kifMoves: import("../utils/kifFormat").KifMove[];
    evalHistory: import("../utils/kifFormat").EvalHistory[];
    displayEvalHistory: import("../utils/kifFormat").EvalHistory[];
    positionHistory: PositionState[];
    kifuTree?: import("@shogi/app-core").KifuTree;
    selectedBranchNodeId: string | null;
    setSelectedBranchNodeId: (id: string | null) => void;
    branchMarkers: Map<number, number>;
    /** AI 解析使用マーカー */
    analysisMarkers: Array<{ seat: "b" | "w"; ply: number }>;
    lastAddedBranchInfo: { ply: number; firstMove: string } | null;
    setLastAddedBranchInfo: (info: { ply: number; firstMove: string } | null) => void;
    handleAddPvAsBranch: (ply: number, pv: string[]) => void;
    handlePreviewPv: (ply: number, pv: string[], evalCp?: number, evalMate?: number) => void;
    kifuViewMode: import("../components/KifuPanel").KifuViewMode;
    setKifuViewMode: (mode: import("../components/KifuPanel").KifuViewMode) => void;
    setDisplaySettings: import("react").Dispatch<import("react").SetStateAction<DisplaySettings>>;
    handlePlySelect: (ply: number) => void;
    handleCopyKif: () => string;
    handleMoveDetailSelect: (
        move: import("../utils/kifFormat").KifMove | null,
        position: PositionState | null,
    ) => void;
}

/**
 * 盤面操作ハンドラーグループ
 * - マス目選択
 * - 持ち駒選択
 * - DnDハンドラー
 * - ゲームコントロール（投了・待った・パス等）
 */
export interface BoardHandlersProps {
    hideEmptyHandPieces: boolean;
    getHandInfo: (pos: "top" | "bottom") => import("../contexts/types").HandInfo;
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
    handleResetToStartpos: () => void;
    pauseAutoPlay: () => void;
    resumeAutoPlay: () => void;
    handleStartReview: () => void;
    handleEnterEditMode: () => void;
    enterEditModeFromPaused: () => void;
    handleResign: () => void;
    handleUndo: () => void;
    setIsSettingsModalOpen: (open: boolean) => void;
    shouldRenderPassButton: boolean;
    canMakePassMove: boolean;
    passButtonDisabledReason?: import("../components/PassButton").PassDisabledReason;
    handlePassMove: () => void;
    shouldShowPassConfirm: boolean;
    isDraggingPiece: boolean;
    boardSectionRef: import("react").RefObject<HTMLDivElement | null>;
}

/**
 * PC専用propsグループ
 * - 設定モーダル
 * - 棋譜インポート
 * - エンジンログパネル
 * - 表示設定ダイアログ
 */
export interface PCSpecificProps {
    matchLayoutClasses: string;
    candidateNote: string | null;
    isSettingsModalOpen: boolean;
    importSfen: (sfen: string, moves: string[]) => Promise<void>;
    importKif: (
        moves: string[],
        moveData: import("../utils/kifParser").KifMoveData[],
        startSfen?: string,
    ) => Promise<void>;
    positionReady: boolean;
    isDevMode: boolean;
    eventLogs: import("@shogi/app-controller").EngineControllerEvent[];
    errorLogs: import("@shogi/app-controller").EngineControllerErrorLog[];
    engineErrorDetails?: Record<
        import("@shogi/app-core").Player,
        import("@shogi/app-controller").EngineErrorDetails | null
    >;
    retryEngine: (side: import("@shogi/app-core").Player) => Promise<void>;
    isRetrying?: Record<import("@shogi/app-core").Player, boolean>;
    isDisplaySettingsOpen: boolean;
    onDisplaySettingsOpenChange: (open: boolean) => void;
    isPassRightsSettingsOpen: boolean;
    onPassRightsSettingsOpenChange: (open: boolean) => void;
}

/**
 * Mobile専用propsグループ
 * - 検討モード判定
 * - Aboutダイアログ表示
 * - 棋譜インポート（Mobile版）
 * - 表示設定変更（Mobile版）
 */
export interface MobileSpecificProps {
    isReviewMode: boolean;
    onOpenAbout: () => void;
    onImportSfen: (sfen: string, moves: string[]) => Promise<void>;
    onImportKif: (
        moves: string[],
        moveData: import("../utils/kifParser").KifMoveData[],
        startSfen?: string,
    ) => Promise<void>;
    onDisplaySettingsChange: (settings: DisplaySettings) => void;
}
