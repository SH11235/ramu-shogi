import type {
    LastMove,
    NnueMeta,
    NnueSelection,
    PieceType,
    Player,
    PositionState,
    PresetWithStatus,
    Square,
} from "@shogi/app-core";
import type { ReactElement, RefObject } from "react";
import { useCallback, useMemo, useRef, useState } from "react";
import type { ShogiBoardCell } from "../../shogi-board";
import {
    BottomSheet,
    GLASS_SURFACE_BLUR_PX,
    GLASS_SURFACE_OPACITY,
} from "../components/BottomSheet";
import { ClockDisplay } from "../components/ClockDisplay";
import { EvalGraph } from "../components/EvalGraph";
import { PausedModeControls, PlayingModeControls } from "../components/GameModeControls";
import { MobileBoardSection } from "../components/MobileBoardSection";
import { type KifuMove, MobileKifuBar } from "../components/MobileKifuBar";
import { MobileNavigation } from "../components/MobileNavigation";
import { MobileSettingsActions } from "../components/MobileSettingsActions";
import { MobileSettingsSheet } from "../components/MobileSettingsSheet";
import { MoveDetailBottomSheet } from "../components/MoveDetailBottomSheet";
import { PassButton, type PassDisabledReason } from "../components/PassButton";
import type { ClockSettings, TickState } from "../hooks/useClockManager";
import type {
    DisplaySettings,
    GameMode,
    Message,
    PassRightsSettings,
    PromotionSelection,
    SideSetting,
} from "../types";
import type { EvalHistory, KifMove as FullKifMove } from "../utils/kifFormat";
import type { KifMoveData } from "../utils/kifParser";

type Selection = { kind: "square"; square: string } | { kind: "hand"; piece: PieceType };

interface MobileLayoutProps {
    // 盤面関連
    grid: ShogiBoardCell[][];
    position: PositionState;
    flipBoard: boolean;
    lastMove?: LastMove;
    selection: Selection | null;
    promotionSelection: PromotionSelection | null;
    isEditMode: boolean;
    isMatchRunning: boolean;
    gameMode: GameMode;
    editFromSquare: Square | null;
    moves: string[];
    candidateNote: string | null;

    // 表示設定
    displaySettings: Pick<
        DisplaySettings,
        "highlightLastMove" | "squareNotation" | "showBoardLabels"
    >;

    // イベントハンドラ
    onSquareSelect: (square: string, shiftKey?: boolean) => void;
    onPromotionChoice: (promote: boolean) => void;
    onFlipBoard: () => void;
    onHandSelect: (piece: PieceType) => void;

    // 編集モード用
    onPiecePointerDown?: (
        square: string,
        piece: { owner: "sente" | "gote"; type: string; promoted?: boolean },
        e: React.PointerEvent,
    ) => void;
    onPieceTogglePromote?: (
        square: string,
        piece: { owner: "sente" | "gote"; type: string; promoted?: boolean },
        event: React.MouseEvent<HTMLButtonElement>,
    ) => void;
    onHandPiecePointerDown?: (owner: Player, pieceType: PieceType, e: React.PointerEvent) => void;
    onIncrementHand?: (owner: Player, piece: PieceType) => void;
    onDecrementHand?: (owner: Player, piece: PieceType) => void;

    // 検討モード関連
    isReviewMode: boolean;

    // 棋譜関連
    kifMoves?: KifuMove[];
    currentPly?: number;
    totalPly?: number;
    onPlySelect?: (ply: number) => void;

    // ナビゲーション
    onBack?: () => void;
    onForward?: () => void;
    onToStart?: () => void;
    onToEnd?: () => void;

    // 評価値
    evalHistory: EvalHistory[];
    evalCp?: number;
    evalMate?: number;

    // 対局コントロール
    onStop?: () => void;
    onStart?: () => void;
    onResetToStartpos?: () => void;
    onResign?: () => void;
    onUndo?: () => void;
    canUndo?: boolean;
    onEnterEditMode?: () => void;

    // 対局設定（モバイル用BottomSheet）
    sides: { sente: SideSetting; gote: SideSetting };
    onSidesChange: (sides: { sente: SideSetting; gote: SideSetting }) => void;
    timeSettings: ClockSettings;
    onTimeSettingsChange: (settings: ClockSettings) => void;
    internalEngineId: string;
    nnueList: NnueMeta[];
    presets: PresetWithStatus[];
    senteNnueSelection: NnueSelection;
    onSenteNnueSelectionChange: (selection: NnueSelection) => void;
    goteNnueSelection: NnueSelection;
    onGoteNnueSelectionChange: (selection: NnueSelection) => void;
    settingsLocked: boolean;
    /** 評価関数ファイル管理を開く */
    onOpenNnueManager?: () => void;

    // パス権設定（オプション）
    passRightsSettings?: PassRightsSettings;
    onPassRightsSettingsChange?: (settings: PassRightsSettings) => void;
    /** パス手を指すハンドラ */
    onPassMove?: () => void;
    /** パスが可能かどうか */
    canPassMove?: boolean;
    /** パス不可理由（ツールチップ用） */
    passMoveDisabledReason?: PassDisabledReason;
    /** パス時に確認ダイアログを出すか */
    passMoveConfirmDialog?: boolean;

    // クロック表示
    clocks: TickState;

    // 表示設定（フル版、BottomSheet用）
    displaySettingsFull: DisplaySettings;
    onDisplaySettingsChange: (settings: DisplaySettings) => void;

    // メッセージ
    message?: Message | null;

    // 持ち駒情報取得
    getHandInfo: (pos: "top" | "bottom") => {
        owner: Player;
        hand: PositionState["hands"]["sente"] | PositionState["hands"]["gote"];
        isActive: boolean;
        isAI: boolean;
    };

    // Ref
    boardSectionRef: RefObject<HTMLDivElement | null>;

    // DnD関連
    isDraggingPiece: boolean;

    // MultiPV詳細表示用（検討モード）
    /** 完全なKifMove配列（multiPvEvalsを含む） */
    fullKifMoves?: FullKifMove[];
    /** 局面履歴（各手が指された後の局面） */
    positionHistory?: PositionState[];
    /** PVを分岐として追加するコールバック */
    onAddPvAsBranch?: (ply: number, pv: string[]) => void;
    /** PVを盤面で確認するコールバック */
    onPreviewPv?: (ply: number, pv: string[], evalCp?: number, evalMate?: number) => void;
    /** 現在位置がメインライン上にあるか */
    isOnMainLine?: boolean;

    /** Aboutダイアログを開く */
    onOpenAbout?: () => void;

    // 棋譜インポート
    /** SFENインポート時のコールバック */
    onImportSfen?: (sfen: string, moves: string[]) => Promise<void>;
    /** KIFインポート時のコールバック */
    onImportKif?: (moves: string[], moveData: KifMoveData[], startSfen?: string) => Promise<void>;
    /** 局面が準備完了しているか */
    positionReady?: boolean;
}

/**
 * スマホ用レイアウト
 * 「盤面優先 + Flexbox」方式
 * - 盤面は画面幅から計算した固定サイズ
 * - コントロール部分は残りの高さを使い、必要に応じて縮小
 */
export function MobileLayout({
    grid,
    position,
    flipBoard,
    lastMove,
    selection,
    promotionSelection,
    isEditMode,
    isMatchRunning,
    gameMode,
    editFromSquare,
    moves,
    candidateNote,
    displaySettings,
    onSquareSelect,
    onPromotionChoice,
    onFlipBoard,
    onHandSelect,
    onPiecePointerDown,
    onPieceTogglePromote,
    onHandPiecePointerDown,
    onIncrementHand,
    onDecrementHand,
    isReviewMode,
    kifMoves,
    currentPly = 0,
    totalPly = 0,
    onPlySelect,
    onBack,
    onForward,
    onToStart,
    onToEnd,
    evalHistory,
    evalCp,
    evalMate,
    onStop,
    onStart,
    onResetToStartpos,
    onResign,
    onUndo,
    canUndo,
    onEnterEditMode,
    sides,
    onSidesChange,
    timeSettings,
    onTimeSettingsChange,
    internalEngineId,
    nnueList,
    presets,
    senteNnueSelection,
    onSenteNnueSelectionChange,
    goteNnueSelection,
    onGoteNnueSelectionChange,
    settingsLocked,
    onOpenNnueManager,
    passRightsSettings,
    onPassRightsSettingsChange,
    onPassMove,
    canPassMove,
    passMoveDisabledReason,
    passMoveConfirmDialog,
    clocks,
    displaySettingsFull,
    onDisplaySettingsChange,
    message,
    getHandInfo,
    boardSectionRef,
    isDraggingPiece,
    // MultiPV詳細表示用
    fullKifMoves,
    positionHistory,
    onAddPvAsBranch,
    onPreviewPv,
    isOnMainLine = true,
    onOpenAbout,
    onImportSfen,
    onImportKif,
    positionReady = true,
}: MobileLayoutProps): ReactElement {
    // 設定BottomSheetの状態
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);

    // 評価値グラフの表示状態（盤面上オーバーレイ）
    const [isKifuDetailOpen, setIsKifuDetailOpen] = useState(false);

    // 手詳細BottomSheetの状態
    const [selectedMoveForDetail, setSelectedMoveForDetail] = useState<FullKifMove | null>(null);
    const [selectedMovePosition, setSelectedMovePosition] = useState<PositionState | null>(null);

    // 手タップ時のハンドラ（検討モードで詳細表示を開く）
    const handlePlySelectWithDetail = useCallback(
        (ply: number) => {
            // まず局面を選択
            onPlySelect?.(ply);

            // 検討モードで fullKifMoves がある場合は詳細を表示
            if (isReviewMode && fullKifMoves && positionHistory) {
                const move = fullKifMoves.find((m) => m.ply === ply);
                // 対応する局面（その手が指された後の局面）
                // ply は 1 始まりの手数、positionHistory は「その手が指された後の局面」を 0 始まりで保持しているため、
                // 手数 ply に対応する局面は positionHistory[ply - 1] になる。
                const pos = positionHistory[ply - 1];
                if (move && pos) {
                    setSelectedMoveForDetail(move);
                    setSelectedMovePosition(pos);
                }
            }
        },
        [onPlySelect, isReviewMode, fullKifMoves, positionHistory],
    );

    // 詳細シートを閉じる
    const handleMoveDetailClose = useCallback(() => {
        setSelectedMoveForDetail(null);
        setSelectedMovePosition(null);
    }, []);

    const graphOverlayRef = useRef<HTMLDivElement>(null);
    const graphDragRef = useRef({
        active: false,
        startX: 0,
        startY: 0,
        originX: 0,
        originY: 0,
    });
    const [graphOffset, setGraphOffset] = useState({ x: 0, y: 0 });

    const handleGraphPointerDown = useCallback(
        (e: React.PointerEvent<HTMLDivElement>) => {
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
        },
        [graphOffset.x, graphOffset.y],
    );

    const handleGraphPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
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

        setGraphOffset({ x: nextX, y: nextY });
    }, []);

    const handleGraphPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        if (!graphDragRef.current.active) return;
        graphDragRef.current.active = false;
        e.currentTarget.releasePointerCapture(e.pointerId);
    }, []);

    // 持ち駒情報を事前計算（useMemoで安定させてReact.memoを有効にする）
    const topHand = useMemo(() => getHandInfo("top"), [getHandInfo]);
    const bottomHand = useMemo(() => getHandInfo("bottom"), [getHandInfo]);

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
                    isRunning={isMatchRunning}
                    centerContent={
                        <>
                            <span className="text-xs text-muted-foreground tabular-nums">
                                {moves.length === 0 ? "開始" : `${moves.length}手`}
                            </span>
                            <button
                                type="button"
                                onClick={onFlipBoard}
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
                    onSquareSelect={onSquareSelect}
                    onPromotionChoice={onPromotionChoice}
                    onHandSelect={onHandSelect}
                    onPiecePointerDown={onPiecePointerDown}
                    onPieceTogglePromote={onPieceTogglePromote}
                    onHandPiecePointerDown={onHandPiecePointerDown}
                    onIncrementHand={onIncrementHand}
                    onDecrementHand={onDecrementHand}
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
                                evalHistory={evalHistory}
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
                        {onStop && (
                            <div className="flex justify-center gap-2 py-1">
                                <PlayingModeControls
                                    onStop={onStop}
                                    onResign={onResign}
                                    onUndo={onUndo}
                                    canUndo={canUndo}
                                />
                                {/* パスボタン（パス機能有効時のみ） */}
                                {passRightsSettings?.enabled &&
                                    (passRightsSettings.senteInitialCount > 0 ||
                                        passRightsSettings.goteInitialCount > 0) &&
                                    position.passRights &&
                                    onPassMove && (
                                        <PassButton
                                            canPass={canPassMove ?? false}
                                            disabledReason={passMoveDisabledReason}
                                            onPass={onPassMove}
                                            remainingPassRights={position.passRights[position.turn]}
                                            showConfirmDialog={passMoveConfirmDialog}
                                            compact
                                        />
                                    )}
                            </div>
                        )}
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
                                        : onPlySelect
                                }
                            />
                        )}
                        {onStart && (
                            <div className="flex justify-center gap-2 py-1">
                                <PausedModeControls
                                    onResume={onStart}
                                    onEnterEditMode={onEnterEditMode}
                                    onResign={onResign}
                                />
                            </div>
                        )}
                    </div>
                ) : isReviewMode && totalPly === 0 ? (
                    /* 対局準備モード: 開始ボタンのみ（棋譜がまだない状態） */
                    <div className="flex justify-center gap-2 py-2 flex-shrink-0">
                        {onStart && (
                            <button
                                type="button"
                                onClick={onStart}
                                className="px-8 py-3 bg-primary text-primary-foreground rounded-lg font-medium shadow-md active:scale-95 transition-transform"
                            >
                                対局を開始
                            </button>
                        )}
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
                                        : onPlySelect
                                }
                            />
                        )}
                        {/* 現在の評価値（コンパクト表示） */}
                        <div className="flex items-center justify-center gap-2 text-sm">
                            <span className="text-muted-foreground">評価:</span>
                            <span className="font-mono tabular-nums">
                                {evalMate !== undefined
                                    ? evalMate > 0
                                        ? `詰み${evalMate}手`
                                        : `詰まされ${Math.abs(evalMate)}手`
                                    : evalCp !== undefined
                                      ? `${evalCp > 0 ? "+" : ""}${(evalCp / 100).toFixed(1)}`
                                      : "-"}
                            </span>
                            {/* 詳細ボタン */}
                            <button
                                type="button"
                                onClick={() => setIsKifuDetailOpen((prev) => !prev)}
                                aria-pressed={isKifuDetailOpen}
                                className={`px-2 py-0.5 text-xs rounded active:scale-95 transition-all ${
                                    isKifuDetailOpen
                                        ? "bg-primary text-primary-foreground"
                                        : "bg-muted hover:bg-muted/80"
                                }`}
                            >
                                📊 グラフ
                            </button>
                        </div>

                        {/* ナビゲーションボタン */}
                        {onBack && onForward && onToStart && onToEnd && (
                            <MobileNavigation
                                currentPly={currentPly}
                                totalPly={totalPly}
                                onBack={onBack}
                                onForward={onForward}
                                onToStart={onToStart}
                                onToEnd={onToEnd}
                                onSettingsClick={() => setIsSettingsOpen(true)}
                                onNnueManagerClick={onOpenNnueManager}
                            />
                        )}
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
                            {onStart && (
                                <button
                                    type="button"
                                    onClick={onStart}
                                    className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium shadow-md active:scale-95 transition-all"
                                >
                                    対局を開始
                                </button>
                            )}
                            {onResetToStartpos && (
                                <button
                                    type="button"
                                    onClick={onResetToStartpos}
                                    className="px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-muted active:scale-95 transition-all"
                                >
                                    平手に戻す
                                </button>
                            )}
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
                    timeSettings={timeSettings}
                    onTimeSettingsChange={onTimeSettingsChange}
                    internalEngineId={internalEngineId}
                    nnueList={nnueList}
                    presets={presets}
                    senteNnueSelection={senteNnueSelection}
                    onSenteNnueSelectionChange={onSenteNnueSelectionChange}
                    goteNnueSelection={goteNnueSelection}
                    onGoteNnueSelectionChange={onGoteNnueSelectionChange}
                    settingsLocked={settingsLocked}
                    passRightsSettings={passRightsSettings}
                    onPassRightsSettingsChange={onPassRightsSettingsChange}
                    isMatchRunning={isMatchRunning}
                    onStartMatch={
                        onStart
                            ? () => {
                                  onStart();
                                  setIsSettingsOpen(false);
                              }
                            : undefined
                    }
                    onStopMatch={onStop}
                    onResetToStartpos={
                        onResetToStartpos
                            ? () => {
                                  onResetToStartpos();
                                  setIsSettingsOpen(false);
                              }
                            : undefined
                    }
                    displaySettings={displaySettingsFull}
                    onDisplaySettingsChange={onDisplaySettingsChange}
                    onOpenAbout={onOpenAbout}
                    onImportSfen={onImportSfen}
                    onImportKif={onImportKif}
                    positionReady={positionReady}
                />
            </BottomSheet>

            {/* 手詳細BottomSheet（検討モード用） */}
            <MoveDetailBottomSheet
                open={selectedMoveForDetail !== null}
                onOpenChange={(open) => {
                    if (!open) handleMoveDetailClose();
                }}
                move={selectedMoveForDetail}
                position={selectedMovePosition}
                onAddBranch={onAddPvAsBranch}
                onPreview={onPreviewPv}
                isOnMainLine={isOnMainLine}
            />
        </div>
    );
}
