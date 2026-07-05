/**
 * MobileLayout
 *
 * スマホ用レイアウト - Context から状態を取得
 *
 * Context の前提:
 * - MatchSettingsContext: 親で Provider 済み
 * - MatchStateContext: 親で Provider 済み
 * - NavigationContext: 親で Provider 済み
 */

import type { PositionState } from "@shogi/app-core";
import type { ReactElement } from "react";
import { useRef, useState } from "react";
import {
    BottomSheet,
    GLASS_SURFACE_BLUR_PX,
    GLASS_SURFACE_OPACITY,
} from "../components/BottomSheet";
import { ClockDisplay } from "../components/ClockDisplay";
import { CurrentPositionAiHintPanel } from "../components/CurrentPositionAiHintPanel";
import { EvalGraph } from "../components/EvalGraph";
import { PausedModeControls, PlayingModeControls } from "../components/GameModeControls";
import { MobileBoardSection } from "../components/MobileBoardSection";
import type { KifuMove } from "../components/MobileKifuBar";
import { MobileKifuBar } from "../components/MobileKifuBar";
import { MobileNavigation } from "../components/MobileNavigation";
import { MobileSettingsActions } from "../components/MobileSettingsActions";
import { MobileSettingsSheet } from "../components/MobileSettingsSheet";
import { MoveDetailBottomSheet } from "../components/MoveDetailBottomSheet";
import { PassButton } from "../components/PassButton";
import { useMatchSettings } from "../contexts/MatchSettingsContext";
import { useMatchState } from "../contexts/MatchStateContext";
import { useNavigation } from "../contexts/NavigationContext";
import type { DisplaySettings } from "../types";
import { type KifMove as FullKifMove, formatEval } from "../utils/kifFormat";
import type { KifMoveData } from "../utils/kifParser";

export function formatMobileCompactEval(evalCp?: number, evalMate?: number): string {
    const formatted = formatEval(evalCp, evalMate);
    if (formatted === "") return "-";
    if (formatted === "+詰") return "詰み";
    if (formatted === "-詰") return "詰まされ";
    if (formatted.startsWith("+詰")) return `詰み${formatted.slice("+詰".length)}手`;
    if (formatted.startsWith("-詰")) return `詰まされ${formatted.slice("-詰".length)}手`;
    return formatted;
}

/**
 * MobileLayout 固有の Props
 *
 * Context では取得できない、MobileLayout 特有の機能用の Props
 */
interface MobileLayoutProps {
    /** 候補手の注釈（盤面表示用） */
    candidateNote: string | null;

    /** 検討モードか（対局中でも棋譜がある状態でもない） */
    isReviewMode: boolean;

    /** Aboutダイアログを開く */
    onOpenAbout?: () => void;

    /** SFENインポート時のコールバック */
    onImportSfen?: (sfen: string, moves: string[]) => Promise<void>;

    /** KIFインポート時のコールバック */
    onImportKif?: (moves: string[], moveData: KifMoveData[], startSfen?: string) => Promise<void>;

    /** 局面が準備完了しているか */
    positionReady?: boolean;

    /** 表示設定変更コールバック（BottomSheet用） */
    onDisplaySettingsChange: (settings: DisplaySettings) => void;
}

/**
 * スマホ用レイアウト
 * 「盤面優先 + Flexbox」方式
 * - 盤面は画面幅から計算した固定サイズ
 * - コントロール部分は残りの高さを使い、必要に応じて縮小
 */
export function MobileLayout({
    candidateNote,
    isReviewMode,
    onOpenAbout,
    onImportSfen,
    onImportKif,
    positionReady = true,
    onDisplaySettingsChange,
}: MobileLayoutProps): ReactElement {
    // Context から状態を取得
    const matchState = useMatchState();
    const matchSettings = useMatchSettings();
    const navigation = useNavigation();

    // MatchStateContext から取得
    const {
        grid,
        position,
        flipBoard,
        onFlipBoardChange,
        lastMove,
        selection,
        promotionSelection,
        isEditMode,
        isMatchRunning,
        gameMode,
        editFromSquare,
        moves,
        displaySettings,
        passRightsSettings,
        clocks,
        message,
        getHandInfo,
        boardSectionRef,
        isDraggingPiece,
        handleSquareSelect,
        handlePromotionChoice,
        handleHandSelect,
        handlePiecePointerDown,
        handlePieceTogglePromote,
        handleHandPiecePointerDown,
        handleIncrementHand,
        handleDecrementHand,
        handleResetToStartpos,
        pauseAutoPlay,
        resumeAutoPlay,
        enterEditModeFromPaused,
        handleResign,
        handleUndo,
        shouldRenderPassButton,
        canMakePassMove,
        passButtonDisabledReason,
        handlePassMove,
        shouldShowPassConfirm,
        sides,
    } = matchState;

    // MatchSettingsContext から取得
    const {
        onSidesChange,
        analysisEngineId,
        onAnalysisEngineIdChange,
        timeSettings,
        onTimeSettingsChange,
        senteNnueSelection,
        onSenteNnueSelectionChange,
        goteNnueSelection,
        onGoteNnueSelectionChange,
        nnueList,
        presets,
        internalEngineId,
        engineOptions,
        isDevMode,
        engineThreads,
        onEngineThreadsChange,
        settingsLocked,
        onOpenEngineManager,
        onOpenNnueManager,
        onPassRightsSettingsChange,
    } = matchSettings;

    // NavigationContext から取得
    const {
        navigationState,
        navigationHandlers,
        kifMoves: fullKifMoves,
        displayEvalHistory,
        positionHistory,
        handleAddPvAsBranch,
        handlePreviewPv,
        handlePlySelect,
    } = navigation;

    const { currentPly, totalPly, isOnMainLine } = navigationState;
    const { goBack, goForward, goToStart, goToEnd } = navigationHandlers;

    // 待った可否の計算
    const canUndo =
        moves.length > 0 &&
        !(sides.sente.role === "engine" && sides.gote.role === "engine") &&
        sides[position.turn].role === "human";

    // 評価値の取得
    const evalCp = displayEvalHistory[currentPly]?.evalCp ?? undefined;
    const evalMate = displayEvalHistory[currentPly]?.evalMate ?? undefined;

    // KifuMove 形式に変換（MobileKifuBar 用）
    const kifMoves: KifuMove[] | undefined =
        fullKifMoves && fullKifMoves.length > 0
            ? fullKifMoves.map((m) => ({ ply: m.ply, displayText: m.displayText }))
            : undefined;

    // 盤面反転のハンドラ
    const handleFlipBoard = () => {
        onFlipBoardChange(!flipBoard);
    };
    // 設定BottomSheetの状態
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [isAiHintOpen, setIsAiHintOpen] = useState(false);

    // 評価値グラフのオーバーレイ状態（表示フラグ + ドラッグオフセット）
    const [graphOverlay, setGraphOverlay] = useState({ isOpen: false, offset: { x: 0, y: 0 } });
    const isKifuDetailOpen = graphOverlay.isOpen;
    const graphOffset = graphOverlay.offset;
    const setIsKifuDetailOpen = (open: boolean) =>
        setGraphOverlay((prev) => ({ ...prev, isOpen: open }));

    // 手詳細BottomSheetの状態
    const [moveDetail, setMoveDetail] = useState<{
        move: FullKifMove | null;
        position: PositionState | null;
    }>({ move: null, position: null });
    const selectedMoveForDetail = moveDetail.move;
    const selectedMovePosition = moveDetail.position;

    // 手タップ時のハンドラ（検討モードで詳細表示を開く）
    const handlePlySelectWithDetail = (ply: number) => {
        // まず局面を選択
        handlePlySelect(ply);

        // 検討モードで fullKifMoves がある場合は詳細を表示
        if (isReviewMode && fullKifMoves && positionHistory) {
            const move = fullKifMoves.find((m) => m.ply === ply);
            // 対応する局面（その手が指された後の局面）
            // ply は 1 始まりの手数、positionHistory は「その手が指された後の局面」を 0 始まりで保持しているため、
            // 手数 ply に対応する局面は positionHistory[ply - 1] になる。
            const pos = positionHistory[ply - 1];
            if (move && pos) {
                setMoveDetail({ move, position: pos });
            }
        }
    };

    // 詳細シートを閉じる
    const handleMoveDetailClose = () => {
        setMoveDetail({ move: null, position: null });
    };

    const graphOverlayRef = useRef<HTMLDivElement>(null);
    const graphDragRef = useRef({
        active: false,
        startX: 0,
        startY: 0,
        originX: 0,
        originY: 0,
    });

    const handleGraphPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        graphDragRef.current = {
            active: true,
            startX: e.clientX,
            startY: e.clientY,
            originX: graphOffset.x,
            originY: graphOffset.y,
        };
    };

    const handleGraphPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
        const state = graphDragRef.current;
        if (!state.active) return;
        const overlay = graphOverlayRef.current;
        if (!overlay) return;

        const deltaX = e.clientX - state.startX;
        const deltaY = e.clientY - state.startY;
        const width = overlay.offsetWidth;
        const height = overlay.offsetHeight;
        const basePadding = 8;
        const minX = -basePadding;
        const minY = -basePadding;
        const maxX = Math.max(minX, window.innerWidth - basePadding - width);
        const maxY = Math.max(minY, window.innerHeight - basePadding - height);
        const nextX = Math.min(maxX, Math.max(minX, state.originX + deltaX));
        const nextY = Math.min(maxY, Math.max(minY, state.originY + deltaY));

        setGraphOverlay((prev) => ({ ...prev, offset: { x: nextX, y: nextY } }));
    };

    const handleGraphPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!graphDragRef.current.active) return;
        graphDragRef.current.active = false;
        e.currentTarget.releasePointerCapture(e.pointerId);
    };

    // 持ち駒情報を事前計算
    const topHand = getHandInfo("top");
    const bottomHand = getHandInfo("bottom");

    // 編集モード判定を事前計算（MobileBoardSectionに渡す）
    const isEditModeActive = isEditMode && !isMatchRunning;
    const hideEmptyHandPieces = gameMode === "playing" || gameMode === "paused";
    // FAB表示条件: 検討モードで棋譜がある場合と編集モードではインライン表示するため非表示
    const shouldShowFloatingSettings = !(isReviewMode && totalPly > 0) && !isEditModeActive;

    return (
        <div className="fixed inset-0 flex flex-col gap-1 w-full h-dvh overflow-hidden px-2 bg-background">
            {/* === ヘッダー: クロック + 手数 + 反転ボタンを1行に統合 === */}
            <header className="flex-shrink-0 pt-1">
                <ClockDisplay
                    clocks={clocks}
                    timeSettings={timeSettings}
                    isRunning={isMatchRunning}
                    centerContent={
                        <>
                            <span className="text-xs text-muted-foreground tabular-nums">
                                {moves.length === 0 ? "開始" : `${moves.length}手`}
                            </span>
                            <button
                                type="button"
                                onClick={handleFlipBoard}
                                className="flex items-center justify-center w-6 h-6 rounded hover:bg-muted text-sm"
                                title="盤面を反転"
                            >
                                🔄
                            </button>
                        </>
                    }
                />
            </header>

            {/* === 盤面セクション: 固定サイズ、縮小しない === */}
            <main className="flex-shrink-0 relative">
                <MobileBoardSection
                    grid={grid}
                    position={position}
                    flipBoard={flipBoard}
                    lastMove={lastMove}
                    selection={selection}
                    promotionSelection={promotionSelection}
                    displaySettings={displaySettings}
                    isEditModeActive={isEditModeActive}
                    isMatchRunning={isMatchRunning}
                    hideEmptyHandPieces={hideEmptyHandPieces}
                    editFromSquare={editFromSquare}
                    candidateNote={candidateNote}
                    onSquareSelect={handleSquareSelect}
                    onPromotionChoice={handlePromotionChoice}
                    onHandSelect={handleHandSelect}
                    onPiecePointerDown={isEditMode ? handlePiecePointerDown : undefined}
                    onPieceTogglePromote={isEditMode ? handlePieceTogglePromote : undefined}
                    onHandPiecePointerDown={isEditMode ? handleHandPiecePointerDown : undefined}
                    onIncrementHand={handleIncrementHand}
                    onDecrementHand={handleDecrementHand}
                    topHand={topHand}
                    bottomHand={bottomHand}
                    boardSectionRef={boardSectionRef}
                    isDraggingPiece={isDraggingPiece}
                    passRightsSettings={passRightsSettings}
                    passRights={position.passRights}
                    turn={position.turn}
                />
                {isReviewMode && isKifuDetailOpen && (
                    <div className="absolute left-2 right-2 top-2 z-30">
                        <div
                            ref={graphOverlayRef}
                            className="rounded-xl border border-border/60 shadow-sm px-3 py-2 touch-none"
                            style={{
                                backgroundColor: `hsl(var(--background, 0 0% 100%) / ${GLASS_SURFACE_OPACITY})`,
                                backdropFilter: `blur(${GLASS_SURFACE_BLUR_PX}px)`,
                                transform: `translate(${graphOffset.x}px, ${graphOffset.y}px)`,
                            }}
                            onPointerDown={handleGraphPointerDown}
                            onPointerMove={handleGraphPointerMove}
                            onPointerUp={handleGraphPointerUp}
                            onPointerCancel={handleGraphPointerUp}
                            role="dialog"
                            aria-label="評価値グラフ"
                        >
                            <div className="flex items-start justify-end mb-2">
                                <button
                                    type="button"
                                    onClick={() => setIsKifuDetailOpen(false)}
                                    onPointerDown={(e) => e.stopPropagation()}
                                    className="px-2 py-1 rounded text-sm text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
                                    aria-label="評価値グラフを閉じる"
                                >
                                    ✕
                                </button>
                            </div>
                            <EvalGraph
                                evalHistory={displayEvalHistory}
                                currentPly={currentPly}
                                compact
                                height={80}
                            />
                        </div>
                    </div>
                )}
            </main>

            {/* === コントロール: 残りの高さを使う、必要に応じて縮小 === */}
            <footer className="flex-1 flex flex-col min-h-0 pb-[env(safe-area-inset-bottom)]">
                {gameMode === "playing" ? (
                    /* 対局モード: 1行棋譜 + パス権 + 停止・投了・待ったボタン */
                    <div className="flex flex-col gap-1 flex-shrink-0">
                        {kifMoves && kifMoves.length > 0 && (
                            <MobileKifuBar moves={kifMoves} currentPly={currentPly} />
                        )}
                        {/* メッセージ表示（高さを常に確保してレイアウトシフトを防ぐ） */}
                        <div
                            className={`text-sm text-center px-2 min-h-[1.25rem] ${
                                message
                                    ? message.type === "error"
                                        ? "text-destructive"
                                        : message.type === "warning"
                                          ? "text-yellow-600 dark:text-yellow-500"
                                          : "text-green-600 dark:text-green-500"
                                    : ""
                            }`}
                        >
                            {message?.text}
                        </div>
                        <div className="flex justify-center gap-2 py-1">
                            <PlayingModeControls
                                onStop={pauseAutoPlay}
                                onResign={handleResign}
                                onUndo={handleUndo}
                                canUndo={canUndo}
                            />
                            {/* パスボタン（パス機能有効時のみ） */}
                            {shouldRenderPassButton && position.passRights && (
                                <PassButton
                                    canPass={canMakePassMove}
                                    disabledReason={passButtonDisabledReason}
                                    onPass={handlePassMove}
                                    remainingPassRights={position.passRights[position.turn]}
                                    showConfirmDialog={shouldShowPassConfirm}
                                    compact
                                />
                            )}
                            <button
                                type="button"
                                onClick={() => setIsAiHintOpen(true)}
                                className="rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted active:scale-95 transition-all"
                            >
                                🤖 ヒント
                            </button>
                        </div>
                    </div>
                ) : gameMode === "paused" ? (
                    /* 一時停止モード: 1行棋譜 + 対局再開・局面編集・投了ボタン */
                    <div className="flex flex-col gap-1 flex-shrink-0">
                        {kifMoves && kifMoves.length > 0 && (
                            <MobileKifuBar
                                moves={kifMoves}
                                currentPly={currentPly}
                                onPlySelect={
                                    fullKifMoves && positionHistory
                                        ? handlePlySelectWithDetail
                                        : handlePlySelect
                                }
                            />
                        )}
                        <div className="flex justify-center gap-2 py-1">
                            <PausedModeControls
                                onResume={resumeAutoPlay}
                                onEnterEditMode={enterEditModeFromPaused}
                                onResign={handleResign}
                            />
                            <button
                                type="button"
                                onClick={() => setIsAiHintOpen(true)}
                                className="rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted active:scale-95 transition-all"
                            >
                                🤖 ヒント
                            </button>
                        </div>
                    </div>
                ) : isReviewMode && totalPly === 0 ? (
                    /* 対局準備モード: 開始ボタンのみ（棋譜がまだない状態） */
                    <div className="flex justify-center gap-2 py-2 flex-shrink-0">
                        <button
                            type="button"
                            onClick={resumeAutoPlay}
                            className="px-8 py-3 bg-primary text-primary-foreground rounded-lg font-medium shadow-md active:scale-95 transition-transform"
                        >
                            対局を開始
                        </button>
                    </div>
                ) : isReviewMode ? (
                    /* 検討モード: 評価値 + ナビゲーション + 詳細ボタン（コンパクト） */
                    <div className="flex flex-col gap-1 flex-shrink-0">
                        {kifMoves && kifMoves.length > 0 && (
                            <MobileKifuBar
                                moves={kifMoves}
                                currentPly={currentPly}
                                onPlySelect={
                                    fullKifMoves && positionHistory
                                        ? handlePlySelectWithDetail
                                        : handlePlySelect
                                }
                            />
                        )}
                        {/* 現在の評価値（コンパクト表示） */}
                        <div className="flex items-center justify-center gap-2 text-sm">
                            <span className="text-muted-foreground">評価:</span>
                            <span className="font-mono tabular-nums">
                                {formatMobileCompactEval(evalCp, evalMate)}
                            </span>
                            {/* 詳細ボタン */}
                            <button
                                type="button"
                                onClick={() => setIsKifuDetailOpen(!isKifuDetailOpen)}
                                aria-pressed={isKifuDetailOpen}
                                className={`px-2 py-0.5 text-xs rounded active:scale-95 transition-all ${
                                    isKifuDetailOpen
                                        ? "bg-primary text-primary-foreground"
                                        : "bg-muted hover:bg-muted/80"
                                }`}
                            >
                                📊 グラフ
                            </button>
                            <button
                                type="button"
                                onClick={() => setIsAiHintOpen(true)}
                                className="px-2 py-0.5 text-xs rounded bg-muted hover:bg-muted/80 active:scale-95 transition-all"
                            >
                                🤖 ヒント
                            </button>
                        </div>

                        {/* ナビゲーションボタン */}
                        <MobileNavigation
                            currentPly={currentPly}
                            totalPly={totalPly}
                            onBack={goBack}
                            onForward={goForward}
                            onToStart={goToStart}
                            onToEnd={goToEnd}
                            onSettingsClick={() => setIsSettingsOpen(true)}
                            onNnueManagerClick={onOpenNnueManager}
                        />
                    </div>
                ) : (
                    /* 編集モード: 対局開始 + 平手に戻す + 設定ボタン */
                    <div className="flex flex-col gap-1.5 flex-shrink-0">
                        <div className="flex flex-col gap-0.5 text-center text-muted-foreground">
                            <div className="text-sm">盤面をタップ / 長押し・ドラッグで編集</div>
                            <div className="text-[10px] opacity-80">
                                ダブルタップ: 成切替 / 盤外へ: 削除 /
                                手駒を長押し・ドラッグで盤に追加
                            </div>
                        </div>
                        <div className="flex items-center justify-center gap-2 py-2">
                            <button
                                type="button"
                                onClick={resumeAutoPlay}
                                className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium shadow-md active:scale-95 transition-all"
                            >
                                対局を開始
                            </button>
                            <button
                                type="button"
                                onClick={handleResetToStartpos}
                                className="px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-muted active:scale-95 transition-all"
                            >
                                平手に戻す
                            </button>
                            {/* 設定・NNUE管理ボタン */}
                            <MobileSettingsActions
                                variant="navigation"
                                onSettingsClick={() => setIsSettingsOpen(true)}
                                onNnueManagerClick={onOpenNnueManager}
                            />
                        </div>
                    </div>
                )}
            </footer>

            {/* FAB: 設定ボタン（右下固定）
                検討モードで棋譜がある場合と編集モードでは、インラインで表示するため非表示 */}
            {shouldShowFloatingSettings && (
                <div className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] right-4 flex items-center gap-2 z-40">
                    <MobileSettingsActions
                        variant="fab"
                        onSettingsClick={() => setIsSettingsOpen(true)}
                        onNnueManagerClick={onOpenNnueManager}
                    />
                </div>
            )}

            {/* 設定BottomSheet */}
            <BottomSheet
                open={isSettingsOpen}
                onOpenChange={setIsSettingsOpen}
                title="設定"
                height="full"
            >
                <MobileSettingsSheet
                    sides={sides}
                    onSidesChange={onSidesChange}
                    analysisEngineId={analysisEngineId}
                    onAnalysisEngineIdChange={onAnalysisEngineIdChange}
                    timeSettings={timeSettings}
                    onTimeSettingsChange={onTimeSettingsChange}
                    internalEngineId={internalEngineId}
                    engineOptions={engineOptions}
                    nnueList={nnueList}
                    presets={presets}
                    senteNnueSelection={senteNnueSelection}
                    onSenteNnueSelectionChange={onSenteNnueSelectionChange}
                    goteNnueSelection={goteNnueSelection}
                    onGoteNnueSelectionChange={onGoteNnueSelectionChange}
                    settingsLocked={settingsLocked}
                    isDevMode={isDevMode}
                    engineThreads={engineThreads}
                    onEngineThreadsChange={onEngineThreadsChange}
                    onOpenEngineManager={onOpenEngineManager}
                    passRightsSettings={passRightsSettings}
                    onPassRightsSettingsChange={onPassRightsSettingsChange}
                    isMatchRunning={isMatchRunning}
                    onStartMatch={() => {
                        resumeAutoPlay();
                        setIsSettingsOpen(false);
                    }}
                    onStopMatch={pauseAutoPlay}
                    onResetToStartpos={() => {
                        handleResetToStartpos();
                        setIsSettingsOpen(false);
                    }}
                    displaySettings={displaySettings}
                    onDisplaySettingsChange={onDisplaySettingsChange}
                    onOpenAbout={onOpenAbout}
                    onImportSfen={onImportSfen}
                    onImportKif={onImportKif}
                    positionReady={positionReady}
                />
            </BottomSheet>

            <BottomSheet
                open={isAiHintOpen}
                onOpenChange={setIsAiHintOpen}
                title="AI ヒント"
                height="auto"
            >
                <CurrentPositionAiHintPanel title="AI ヒント" />
            </BottomSheet>

            {/* 手詳細BottomSheet（検討モード用） */}
            <MoveDetailBottomSheet
                open={selectedMoveForDetail !== null}
                onOpenChange={(open) => {
                    if (!open) handleMoveDetailClose();
                }}
                move={selectedMoveForDetail}
                position={selectedMovePosition}
                onAddBranch={handleAddPvAsBranch}
                onPreview={handlePreviewPv}
                isOnMainLine={isOnMainLine}
            />
        </div>
    );
}
