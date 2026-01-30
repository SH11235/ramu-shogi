/**
 * PC版レイアウト
 *
 * 3カラム構成: 左サイドバー | 将棋盤 | 棋譜セクション
 * ダイアログ類も含む
 *
 * Context の前提:
 * - MatchSettingsContext: 親で Provider 済み
 * - AnalysisContext: 親で Provider 済み
 * - MatchStateContext: このコンポーネント内で Provider
 * - NavigationContext: このコンポーネント内で Provider
 */

import type {
    EngineControllerErrorLog,
    EngineControllerEvent,
    KifuTree,
    LastMove,
    PieceType,
    Player,
    PositionState,
    Square,
} from "@shogi/app-core";
import type { ReactElement, RefObject } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../dialog";
import type { ShogiBoardCell, ShogiBoardPiece } from "../../shogi-board";
import { Switch } from "../../switch";
import type { EngineErrorDetails } from "../components/EngineLogsPanel";
import { EngineLogsPanel } from "../components/EngineLogsPanel";
import { KifuImportPanel } from "../components/KifuImportPanel";
import { LeftSidebar } from "../components/LeftSidebar";
import type { PassDisabledReason } from "../components/PassButton";
import { PCBoardSection } from "../components/PCBoardSection";
import { PCKifuSection } from "../components/PCKifuSection";
import { SettingsModal } from "../components/SettingsModal";
import { MatchStateProvider, NavigationProvider } from "../contexts";
import type {
    HandInfo,
    KifuViewMode,
    NavigationHandlers,
    NavigationState,
} from "../contexts/types";
import type { TickState } from "../hooks/useClockManager";
import type {
    DisplaySettings,
    GameMode,
    Message,
    PassRightsSettings,
    PromotionSelection,
    SideSetting,
} from "../types";
import type { EvalHistory, KifMove } from "../utils/kifFormat";
import type { KifMoveData } from "../utils/kifParser";

type Selection = { kind: "square"; square: string } | { kind: "hand"; piece: PieceType };

export interface PCLayoutProps {
    // レイアウト
    matchLayoutClasses: string;

    // MatchStateProvider 用
    position: PositionState;
    clocks: TickState;
    grid: ShogiBoardCell[][];
    isMatchRunning: boolean;
    isPaused: boolean;
    isEditMode: boolean;
    gameMode: GameMode;
    message: Message | null;
    selection: Selection | null;
    promotionSelection: PromotionSelection | null;
    lastMove?: LastMove;
    flipBoard: boolean;
    onFlipBoardChange: (flip: boolean) => void;
    displaySettings: DisplaySettings;
    passRightsSettings: PassRightsSettings;
    sides: { sente: SideSetting; gote: SideSetting };
    moves: string[];
    editFromSquare: Square | null;
    hideEmptyHandPieces: boolean;
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
    handleResetToStartpos: () => void;
    pauseAutoPlay: () => void;
    resumeAutoPlay: () => void;
    handleStartReview: () => void;
    handleEnterEditMode: () => void;
    enterEditModeFromPaused: () => void;
    handleResign: () => void;
    handleUndo: () => void;
    onOpenSettings: () => void;
    shouldRenderPassButton: boolean;
    canMakePassMove: boolean;
    passButtonDisabledReason?: PassDisabledReason;
    handlePassMove: () => void;
    shouldShowPassConfirm: boolean;
    isDraggingPiece: boolean;
    boardSectionRef: RefObject<HTMLDivElement | null>;

    // PCBoardSection 用
    candidateNote: string | null;

    // NavigationProvider 用
    navigationState: NavigationState;
    navigationHandlers: NavigationHandlers;
    kifMoves: KifMove[];
    evalHistory: EvalHistory[];
    displayEvalHistory: EvalHistory[];
    positionHistory: PositionState[];
    kifuTree?: KifuTree;
    selectedBranchNodeId: string | null;
    onSelectedBranchChange: (branchNodeId: string | null) => void;
    branchMarkers: Map<number, number>;
    lastAddedBranchInfo: { ply: number; firstMove: string } | null;
    onLastAddedBranchHandled: () => void;
    handleAddPvAsBranch: (ply: number, pv: string[]) => void;
    handlePreviewPv: (ply: number, pv: string[], evalCp?: number, evalMate?: number) => void;
    kifuViewMode: KifuViewMode;
    onViewModeChange: (mode: KifuViewMode) => void;
    onDisplaySettingsChange: (updater: (prev: DisplaySettings) => DisplaySettings) => void;
    handlePlySelect: (ply: number) => void;
    handleCopyKif: () => string;
    handleMoveDetailSelect: (move: KifMove | null, position: PositionState | null) => void;

    // SettingsModal 用
    isSettingsModalOpen: boolean;
    onSettingsModalOpenChange: (open: boolean) => void;
    importSfen: (sfen: string, moves: string[]) => Promise<void>;
    importKif: (moves: string[], moveData: KifMoveData[], startSfen?: string) => Promise<void>;
    positionReady: boolean;
    isDevMode: boolean;
    eventLogs: EngineControllerEvent[];
    errorLogs: EngineControllerErrorLog[];
    engineErrorDetails?: Record<Player, EngineErrorDetails | null>;
    retryEngine: (side: Player) => Promise<void>;
    isRetrying?: Record<Player, boolean>;

    // 表示設定ダイアログ
    isDisplaySettingsOpen: boolean;
    onDisplaySettingsOpenChange: (open: boolean) => void;
    setDisplaySettings: (settings: DisplaySettings) => void;

    // パス権設定ダイアログ
    isPassRightsSettingsOpen: boolean;
    onPassRightsSettingsOpenChange: (open: boolean) => void;
    handlePassRightsSettingsChange: (settings: PassRightsSettings) => void;
    settingsLocked: boolean;
}

/**
 * PC版3カラムレイアウト
 */
export function PCLayout({
    // レイアウト
    matchLayoutClasses,

    // MatchStateProvider 用
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

    // PCBoardSection 用
    candidateNote,

    // NavigationProvider 用
    navigationState,
    navigationHandlers,
    kifMoves,
    evalHistory,
    displayEvalHistory,
    positionHistory,
    kifuTree,
    selectedBranchNodeId,
    onSelectedBranchChange,
    branchMarkers,
    lastAddedBranchInfo,
    onLastAddedBranchHandled,
    handleAddPvAsBranch,
    handlePreviewPv,
    kifuViewMode,
    onViewModeChange,
    onDisplaySettingsChange,
    handlePlySelect,
    handleCopyKif,
    handleMoveDetailSelect,

    // SettingsModal 用
    isSettingsModalOpen,
    onSettingsModalOpenChange,
    importSfen,
    importKif,
    positionReady,
    isDevMode,
    eventLogs,
    errorLogs,
    engineErrorDetails,
    retryEngine,
    isRetrying,

    // 表示設定ダイアログ
    isDisplaySettingsOpen,
    onDisplaySettingsOpenChange,
    setDisplaySettings,

    // パス権設定ダイアログ
    isPassRightsSettingsOpen,
    onPassRightsSettingsOpenChange,
    handlePassRightsSettingsChange,
    settingsLocked,
}: PCLayoutProps): ReactElement {
    return (
        <section className={matchLayoutClasses}>
            <div className="flex min-h-[calc(100dvh-1rem)] w-full gap-4 p-4">
                {/* 左サイドバー（固定幅） */}
                <div className="shrink-0">
                    <LeftSidebar />
                </div>

                {/* 将棋盤エリア（中央配置、残りスペースを使用） */}
                <MatchStateProvider
                    position={position}
                    clocks={clocks}
                    grid={grid}
                    isMatchRunning={isMatchRunning}
                    isPaused={isPaused}
                    isEditMode={isEditMode}
                    gameMode={gameMode}
                    message={message}
                    selection={selection}
                    promotionSelection={promotionSelection}
                    lastMove={lastMove}
                    flipBoard={flipBoard}
                    onFlipBoardChange={onFlipBoardChange}
                    displaySettings={displaySettings}
                    passRightsSettings={passRightsSettings}
                    sides={sides}
                    moves={moves}
                    editFromSquare={editFromSquare}
                    hideEmptyHandPieces={hideEmptyHandPieces}
                    getHandInfo={getHandInfo}
                    handleSquareSelect={handleSquareSelect}
                    handlePromotionChoice={handlePromotionChoice}
                    handleHandSelect={handleHandSelect}
                    handleHandPiecePointerDown={handleHandPiecePointerDown}
                    handlePiecePointerDown={handlePiecePointerDown}
                    handlePieceTogglePromote={handlePieceTogglePromote}
                    handleIncrementHand={handleIncrementHand}
                    handleDecrementHand={handleDecrementHand}
                    handleResetToStartpos={handleResetToStartpos}
                    pauseAutoPlay={pauseAutoPlay}
                    resumeAutoPlay={resumeAutoPlay}
                    handleStartReview={handleStartReview}
                    handleEnterEditMode={handleEnterEditMode}
                    enterEditModeFromPaused={enterEditModeFromPaused}
                    handleResign={handleResign}
                    handleUndo={handleUndo}
                    onOpenSettings={onOpenSettings}
                    shouldRenderPassButton={shouldRenderPassButton}
                    canMakePassMove={canMakePassMove}
                    passButtonDisabledReason={passButtonDisabledReason}
                    handlePassMove={handlePassMove}
                    shouldShowPassConfirm={shouldShowPassConfirm}
                    isDraggingPiece={isDraggingPiece}
                    boardSectionRef={boardSectionRef}
                >
                    <div className="flex-1 flex items-start justify-center">
                        <PCBoardSection candidateNote={candidateNote} />
                    </div>
                </MatchStateProvider>

                {/* 棋譜セクション（固定幅） */}
                <NavigationProvider
                    navigationState={navigationState}
                    navigationHandlers={navigationHandlers}
                    kifMoves={kifMoves}
                    evalHistory={evalHistory}
                    displayEvalHistory={displayEvalHistory}
                    positionHistory={positionHistory}
                    kifuTree={kifuTree}
                    selectedBranchNodeId={selectedBranchNodeId}
                    onSelectedBranchChange={onSelectedBranchChange}
                    branchMarkers={branchMarkers}
                    lastAddedBranchInfo={lastAddedBranchInfo}
                    onLastAddedBranchHandled={onLastAddedBranchHandled}
                    handleAddPvAsBranch={handleAddPvAsBranch}
                    handlePreviewPv={handlePreviewPv}
                    kifuViewMode={kifuViewMode}
                    onViewModeChange={onViewModeChange}
                    displaySettings={displaySettings}
                    onDisplaySettingsChange={onDisplaySettingsChange}
                    handlePlySelect={handlePlySelect}
                    handleCopyKif={handleCopyKif}
                    handleMoveDetailSelect={handleMoveDetailSelect}
                    isMatchRunning={isMatchRunning}
                >
                    <div className="shrink-0">
                        <PCKifuSection />
                    </div>
                </NavigationProvider>

                {/* 設定モーダル（棋譜インポート等） */}
                <SettingsModal open={isSettingsModalOpen} onOpenChange={onSettingsModalOpenChange}>
                    <div className="flex flex-col gap-6">
                        {/* インポート */}
                        <KifuImportPanel
                            onImportSfen={importSfen}
                            onImportKif={importKif}
                            positionReady={positionReady}
                        />

                        {/* エンジンログ（開発モード） */}
                        {isDevMode && (
                            <EngineLogsPanel
                                eventLogs={eventLogs}
                                errorLogs={errorLogs}
                                engineErrorDetails={engineErrorDetails}
                                onRetry={retryEngine}
                                isRetrying={isRetrying}
                            />
                        )}
                    </div>
                </SettingsModal>

                {/* 表示設定ダイアログ */}
                <Dialog open={isDisplaySettingsOpen} onOpenChange={onDisplaySettingsOpenChange}>
                    <DialogContent className="w-[min(450px,calc(100%-24px))]">
                        <DialogHeader>
                            <DialogTitle>表示設定</DialogTitle>
                        </DialogHeader>
                        <div className="flex flex-col gap-4 pt-2">
                            {/* マス内座標表示 */}
                            <div className="flex flex-col gap-2">
                                <span className="text-sm font-medium">マス内座標表示</span>
                                <div className="flex gap-2">
                                    {(
                                        [
                                            { value: "none", label: "なし" },
                                            { value: "sfen", label: "SFEN (5e)" },
                                            { value: "japanese", label: "日本式 (５五)" },
                                        ] as const
                                    ).map((opt) => (
                                        <button
                                            key={opt.value}
                                            type="button"
                                            onClick={() =>
                                                setDisplaySettings({
                                                    ...displaySettings,
                                                    squareNotation: opt.value,
                                                })
                                            }
                                            className={`px-3 py-1.5 rounded text-sm transition-colors ${
                                                displaySettings.squareNotation === opt.value
                                                    ? "bg-wafuu-kincha text-white"
                                                    : "bg-wafuu-washi text-wafuu-sumi hover:bg-wafuu-border border border-wafuu-border"
                                            }`}
                                        >
                                            {opt.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="h-px bg-wafuu-border" />

                            {/* チェックボックス項目 */}
                            <label className="flex items-center gap-3 text-sm cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={displaySettings.showBoardLabels}
                                    onChange={(e) =>
                                        setDisplaySettings({
                                            ...displaySettings,
                                            showBoardLabels: e.target.checked,
                                        })
                                    }
                                    className="w-4 h-4"
                                />
                                <span>盤外ラベル表示（筋・段）</span>
                            </label>
                            <label className="flex items-center gap-3 text-sm cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={displaySettings.highlightLastMove}
                                    onChange={(e) =>
                                        setDisplaySettings({
                                            ...displaySettings,
                                            highlightLastMove: e.target.checked,
                                        })
                                    }
                                    className="w-4 h-4"
                                />
                                <span>最終手を強調</span>
                            </label>
                            <label className="flex items-center gap-3 text-sm cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={displaySettings.showKifuEval}
                                    onChange={(e) =>
                                        setDisplaySettings({
                                            ...displaySettings,
                                            showKifuEval: e.target.checked,
                                        })
                                    }
                                    className="w-4 h-4"
                                />
                                <span>棋譜パネルに評価値を表示</span>
                            </label>
                            <label className="flex items-center gap-3 text-sm cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={displaySettings.enableWheelNavigation}
                                    onChange={(e) =>
                                        setDisplaySettings({
                                            ...displaySettings,
                                            enableWheelNavigation: e.target.checked,
                                        })
                                    }
                                    className="w-4 h-4"
                                />
                                <span>ホイールナビゲーション</span>
                            </label>
                        </div>
                    </DialogContent>
                </Dialog>

                {/* 変則ルールダイアログ */}
                {passRightsSettings && (
                    <Dialog
                        open={isPassRightsSettingsOpen}
                        onOpenChange={onPassRightsSettingsOpenChange}
                    >
                        <DialogContent className="w-[min(400px,calc(100%-24px))]">
                            <DialogHeader>
                                <DialogTitle>変則ルール</DialogTitle>
                            </DialogHeader>
                            <div className="flex flex-col gap-4 pt-2">
                                {/* パス権セクション */}
                                <div className="flex flex-col gap-3 p-3 rounded-lg border border-wafuu-border bg-wafuu-washi/50">
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm font-medium">パス権</span>
                                        <Switch
                                            id="pass-rights-toggle"
                                            checked={passRightsSettings.enabled}
                                            onCheckedChange={(checked) =>
                                                handlePassRightsSettingsChange({
                                                    ...passRightsSettings,
                                                    enabled: checked,
                                                })
                                            }
                                            disabled={settingsLocked}
                                        />
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                        王手されていない時に手番をパスできます
                                    </p>

                                    {/* 初期パス権数（先手・後手別） */}
                                    <div
                                        className={`flex flex-col gap-2 ${!passRightsSettings.enabled ? "opacity-50" : ""}`}
                                    >
                                        <span className="text-sm">初期パス権数</span>
                                        {/* 先手/後手ラベル */}
                                        <div className="grid grid-cols-2 gap-3">
                                            <div className="text-xs font-semibold text-wafuu-shu text-center">
                                                ☗先手
                                            </div>
                                            <div className="text-xs font-semibold text-wafuu-ai text-center">
                                                ☖後手
                                            </div>
                                        </div>
                                        {/* 先手/後手パス権数設定 */}
                                        <div className="grid grid-cols-2 gap-3">
                                            {/* 先手 */}
                                            <div className="flex items-center justify-center gap-1">
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        handlePassRightsSettingsChange({
                                                            ...passRightsSettings,
                                                            senteInitialCount: Math.max(
                                                                0,
                                                                passRightsSettings.senteInitialCount -
                                                                    1,
                                                            ),
                                                        })
                                                    }
                                                    disabled={
                                                        settingsLocked ||
                                                        !passRightsSettings.enabled ||
                                                        passRightsSettings.senteInitialCount <= 0
                                                    }
                                                    className="flex h-8 w-8 items-center justify-center rounded border border-border bg-card text-sm disabled:opacity-50"
                                                >
                                                    -
                                                </button>
                                                <span className="w-8 text-center text-sm font-semibold">
                                                    {passRightsSettings.senteInitialCount}
                                                </span>
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        handlePassRightsSettingsChange({
                                                            ...passRightsSettings,
                                                            senteInitialCount: Math.min(
                                                                10,
                                                                passRightsSettings.senteInitialCount +
                                                                    1,
                                                            ),
                                                        })
                                                    }
                                                    disabled={
                                                        settingsLocked ||
                                                        !passRightsSettings.enabled ||
                                                        passRightsSettings.senteInitialCount >= 10
                                                    }
                                                    className="flex h-8 w-8 items-center justify-center rounded border border-border bg-card text-sm disabled:opacity-50"
                                                >
                                                    +
                                                </button>
                                            </div>
                                            {/* 後手 */}
                                            <div className="flex items-center justify-center gap-1">
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        handlePassRightsSettingsChange({
                                                            ...passRightsSettings,
                                                            goteInitialCount: Math.max(
                                                                0,
                                                                passRightsSettings.goteInitialCount -
                                                                    1,
                                                            ),
                                                        })
                                                    }
                                                    disabled={
                                                        settingsLocked ||
                                                        !passRightsSettings.enabled ||
                                                        passRightsSettings.goteInitialCount <= 0
                                                    }
                                                    className="flex h-8 w-8 items-center justify-center rounded border border-border bg-card text-sm disabled:opacity-50"
                                                >
                                                    -
                                                </button>
                                                <span className="w-8 text-center text-sm font-semibold">
                                                    {passRightsSettings.goteInitialCount}
                                                </span>
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        handlePassRightsSettingsChange({
                                                            ...passRightsSettings,
                                                            goteInitialCount: Math.min(
                                                                10,
                                                                passRightsSettings.goteInitialCount +
                                                                    1,
                                                            ),
                                                        })
                                                    }
                                                    disabled={
                                                        settingsLocked ||
                                                        !passRightsSettings.enabled ||
                                                        passRightsSettings.goteInitialCount >= 10
                                                    }
                                                    className="flex h-8 w-8 items-center justify-center rounded border border-border bg-card text-sm disabled:opacity-50"
                                                >
                                                    +
                                                </button>
                                            </div>
                                        </div>
                                    </div>

                                    {/* パス確認ダイアログしきい値 */}
                                    <div
                                        className={`flex flex-col gap-2 ${!passRightsSettings.enabled ? "opacity-50" : ""}`}
                                    >
                                        <span className="text-sm">
                                            パス確認ダイアログしきい値（ms）
                                        </span>
                                        <div className="flex items-center gap-2">
                                            <input
                                                type="number"
                                                min={0}
                                                step={500}
                                                value={passRightsSettings.confirmDialogThresholdMs}
                                                onChange={(e) =>
                                                    handlePassRightsSettingsChange({
                                                        ...passRightsSettings,
                                                        confirmDialogThresholdMs: Math.max(
                                                            0,
                                                            Number(e.target.value) || 0,
                                                        ),
                                                    })
                                                }
                                                disabled={
                                                    settingsLocked || !passRightsSettings.enabled
                                                }
                                                className="w-28 rounded border border-border bg-card px-2 py-1 text-sm disabled:opacity-50"
                                            />
                                            <span className="text-xs text-muted-foreground">
                                                0で即時、時間が多ければ確認
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </DialogContent>
                    </Dialog>
                )}
            </div>
        </section>
    );
}
