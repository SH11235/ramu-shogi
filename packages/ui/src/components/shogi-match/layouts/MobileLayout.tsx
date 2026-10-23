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

import { cn } from "@shogi/design-system";
import type { ReactElement, ReactNode } from "react";
import { useState } from "react";
import { BottomSheet } from "../components/BottomSheet";
import { ClockDisplay } from "../components/ClockDisplay";
import { CurrentPositionAiHintPanel } from "../components/CurrentPositionAiHintPanel";
import { PausedModeControls, PlayingModeControls } from "../components/GameModeControls";
import { MobileAnalysisSheet } from "../components/MobileAnalysisSheet";
import { MobileBoardSection } from "../components/MobileBoardSection";
import type { KifuMove } from "../components/MobileKifuBar";
import { MobileKifuBar } from "../components/MobileKifuBar";
import { MobileNavigation } from "../components/MobileNavigation";
import { MobileSettingsActions } from "../components/MobileSettingsActions";
import { MobileSettingsSheet } from "../components/MobileSettingsSheet";
import { PassButton } from "../components/PassButton";
import { SoundToggle } from "../components/SoundToggle";
import { useMatchSettings } from "../contexts/MatchSettingsContext";
import { useMatchState } from "../contexts/MatchStateContext";
import { useNavigation } from "../contexts/NavigationContext";
import { useShogiMatchConfig } from "../ShogiMatchContext";
import type { DisplaySettings } from "../types";
import { formatEval } from "../utils/kifFormat";
import type { ImportKifHandler, ImportSfenHandler } from "../utils/kifuImport";

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
    searchInfo?: ReactNode;
    /** 候補手の注釈（盤面表示用） */
    candidateNote: string | null;

    /** 検討モードか（対局中でも棋譜がある状態でもない）。対局準備中も true になる導出値 */
    isReviewMode: boolean;

    /** ページレベルの検討/観戦モード(外部 prop)。墨地サーフェスの判定に使う */
    reviewMode?: boolean;

    /** Aboutダイアログを開く */
    onOpenAbout?: () => void;

    /** SFENインポート時のコールバック */
    onImportSfen?: ImportSfenHandler;

    /** KIFインポート時のコールバック */
    onImportKif?: ImportKifHandler;

    /** 局面が準備完了しているか */
    positionReady?: boolean;

    /** 表示設定変更コールバック（BottomSheet用） */
    onDisplaySettingsChange: (settings: DisplaySettings) => void;
}

/**
 * スマホ用レイアウト
 * 盤面はコンテナ幅に合わせ、低い画面ではページスクロールで操作欄へ到達できる。
 */
export function MobileLayout({
    searchInfo,
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
    // 棋譜を見るだけの画面（棋譜ビューア・観戦）では、対局を始める・棋譜を読み込む・
    // 局面を編集する・平手に戻す操作を出さない。
    const { viewerMode, mobileHeaderContent, mobileReviewActions } = useShogiMatchConfig();

    // MatchStateContext から取得
    const {
        grid,
        position,
        flipBoard,
        onFlipBoardChange,
        lastMove,
        selection,
        moveShadow,
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

    // 「グラフ・読み筋」シートの状態。指し手を押しただけでは開かない（評価値の行のボタンから開く）。
    const [isAnalysisSheetOpen, setIsAnalysisSheetOpen] = useState(false);
    // いま見ている手と、その手が指された後の局面（シートの読み筋用）。
    // ply は 1 始まり、positionHistory は「その手が指された後の局面」を 0 始まりで持つ。
    const currentMove = fullKifMoves?.find((m) => m.ply === currentPly) ?? null;
    const currentMovePosition = currentPly > 0 ? (positionHistory?.[currentPly - 1] ?? null) : null;

    // 持ち駒情報を事前計算
    const topHand = getHandInfo("top");
    const bottomHand = getHandInfo("bottom");

    // 編集モード判定を事前計算（MobileBoardSectionに渡す）
    const isEditModeActive = isEditMode && !isMatchRunning;
    // 持っていない駒を出すのは、局面編集で駒台から駒を足すときだけ。
    const hideEmptyHandPieces = !isEditModeActive;
    // FAB表示条件: 検討モードで棋譜がある場合と編集モードではインライン表示するため非表示
    // （棋譜を見るだけの画面は 0 手の棋譜でも検討モードの並びで出すので、同じく非表示）
    const shouldShowFloatingSettings =
        !(isReviewMode && (totalPly > 0 || viewerMode)) && !isEditModeActive;

    // ヘッダー中央の「手数・反転・サウンド」。
    const headerControls = (
        <>
            <span className="hidden min-[360px]:inline shrink-0 whitespace-nowrap text-xs text-muted-foreground tabular-nums">
                {moves.length === 0 ? "開始" : `${moves.length}手`}
            </span>
            <button
                type="button"
                onClick={handleFlipBoard}
                className="flex items-center justify-center w-8 h-8 rounded hover:bg-muted text-sm"
                title="盤面を反転"
                aria-label="盤面を反転"
            >
                🔄
            </button>
            <SoundToggle />
        </>
    );

    return (
        <div className="relative flex flex-col gap-1 w-full min-w-0 px-2 pb-[env(safe-area-inset-bottom)] bg-background text-foreground">
            {/* === ヘッダー: クロック + 手数 + 反転ボタンを1行に統合 === */}
            <header className="flex-shrink-0 pt-1">
                {viewerMode ? (
                    // 棋譜を見るだけの画面は対局しないので、時計（∞）は出さない。
                    // 左に対局者名などを小さく出し、上に別の行を取らない（盤を最初の画面に収める）。
                    <div className="flex items-center gap-2">
                        <div className="min-w-0 flex-1">{mobileHeaderContent}</div>
                        <div className="flex shrink-0 items-center gap-1">{headerControls}</div>
                    </div>
                ) : (
                    <ClockDisplay
                        clocks={clocks}
                        timeSettings={timeSettings}
                        isRunning={isMatchRunning}
                        className="[&>div]:gap-0.5 [&>div]:px-0 [&_.font-mono]:text-xs"
                        centerContent={headerControls}
                    />
                )}
            </header>

            {/* === 盤面セクション: 固定サイズ、縮小しない === */}
            {/* 棋譜を見るだけの画面は、盤の下の行（評価値・主な操作・移動）まで最初の画面に収める。
                盤の幅は高さから逆算して絞る: マスを c px とすると盤（持ち駒の段を含む）の高さは
                およそ 10.6c + 82px、盤以外の縦の合計は約 215px なので、幅 9c + 33px の上限は
                およそ 85svh - 222px。高さはブラウザの操作の帯が出ているときの画面（svh）で測る
                （帯が縮むたびに盤の大きさが変わらないように）。 */}
            <main
                className={cn(
                    "flex-shrink-0 relative flex justify-center",
                    viewerMode &&
                        "mx-auto w-full max-w-[calc(85vh-222px)] supports-[height:1svh]:max-w-[calc(85svh-222px)]",
                )}
            >
                <MobileBoardSection
                    grid={grid}
                    position={position}
                    flipBoard={flipBoard}
                    lastMove={lastMove}
                    selection={selection}
                    moveShadow={moveShadow}
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
                    minCellSize={viewerMode ? 20 : undefined}
                />
            </main>

            {/* === 対局・検討・編集の操作 === */}
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
                                onPlySelect={handlePlySelect}
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
                ) : isReviewMode && totalPly === 0 && !viewerMode ? (
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
                                onPlySelect={handlePlySelect}
                            />
                        )}
                        {/* 現在の評価値（コンパクト表示） */}
                        {/* 評価値は左、操作は右に寄せる（評価値の桁数・詰みの表記で幅が変わっても、
                            操作のボタンが動かないように）。 */}
                        <div className="flex items-center justify-between gap-2 px-1 text-sm">
                            <div className="flex min-w-0 items-baseline gap-1.5">
                                <span className="shrink-0 text-muted-foreground">評価:</span>
                                <span className="truncate font-mono tabular-nums">
                                    {formatMobileCompactEval(evalCp, evalMate)}
                                </span>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => setIsAnalysisSheetOpen(true)}
                                    aria-haspopup="dialog"
                                    // 行の高さは変えず（盤を最初の画面に収めるため）、押せる範囲だけ上下に広げる。
                                    className="relative px-2 py-0.5 text-xs rounded bg-muted hover:bg-muted/80 active:scale-95 transition-all after:absolute after:inset-x-0 after:-inset-y-1.5"
                                >
                                    📊 グラフ・読み筋
                                </button>
                                {/* 棋譜を見るだけの画面では、解析（ヒント）は出さない。 */}
                                {!viewerMode && (
                                    <button
                                        type="button"
                                        onClick={() => setIsAiHintOpen(true)}
                                        className="px-2 py-0.5 text-xs rounded bg-muted hover:bg-muted/80 active:scale-95 transition-all"
                                    >
                                        🤖 ヒント
                                    </button>
                                )}
                                {mobileReviewActions}
                            </div>
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
                            onNnueManagerClick={viewerMode ? undefined : onOpenNnueManager}
                        />
                    </div>
                ) : viewerMode ? null : (
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
                {gameMode !== "playing" && message?.type === "error" && (
                    <p role="alert" className="text-center text-sm text-destructive">
                        {message.text}
                    </p>
                )}
            </footer>

            {displaySettings.showSearchInfo && <div className="min-h-10 w-full">{searchInfo}</div>}

            {/* 検討・編集以外の設定操作も通常フローに置き、盤や停止ボタンを覆わない。 */}
            {shouldShowFloatingSettings && (
                <div className="flex justify-end gap-2 py-4">
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
                    onStartMatch={
                        viewerMode
                            ? undefined
                            : () => {
                                  resumeAutoPlay();
                                  setIsSettingsOpen(false);
                              }
                    }
                    onStopMatch={pauseAutoPlay}
                    onResetToStartpos={
                        viewerMode
                            ? undefined
                            : () => {
                                  handleResetToStartpos();
                                  setIsSettingsOpen(false);
                              }
                    }
                    displaySettings={displaySettings}
                    onDisplaySettingsChange={onDisplaySettingsChange}
                    onOpenAbout={onOpenAbout}
                    onImportSfen={viewerMode ? undefined : onImportSfen}
                    onImportKif={viewerMode ? undefined : onImportKif}
                    positionReady={positionReady}
                    viewerMode={viewerMode}
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

            {/* グラフ・読み筋（検討モード用） */}
            <MobileAnalysisSheet
                open={isReviewMode && isAnalysisSheetOpen}
                onOpenChange={setIsAnalysisSheetOpen}
                evalHistory={displayEvalHistory}
                currentPly={currentPly}
                totalPly={totalPly}
                move={currentMove}
                position={currentMovePosition}
                onPlySelect={handlePlySelect}
                onBack={goBack}
                onForward={goForward}
                onToStart={goToStart}
                onToEnd={goToEnd}
                onAddBranch={viewerMode ? undefined : handleAddPvAsBranch}
                onPreview={handlePreviewPv}
                isOnMainLine={isOnMainLine}
            />
        </div>
    );
}
