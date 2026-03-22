import type {
    BoardState,
    GameResult,
    LastMove,
    NnueSelection,
    PieceType,
    Player,
    PositionState,
    Square,
} from "@shogi/app-core";
import {
    applyMoveWithState,
    createDefaultNnueSelection,
    createEmptyHands,
    DEFAULT_PRESET_KEY,
    getAllSquares,
    getPositionService,
    resolveWorkerCount,
} from "@shogi/app-core";
import type { ReactElement } from "react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useShogiSound } from "../hooks/useShogiSound";
import type { RemoteNnueManager } from "./nnue/types";
import {
    DEFAULT_BYOYOMI_MS,
    DEFAULT_MAX_LOGS,
    MATCH_LAYOUT_CLASSES,
    TOOLTIP_DELAY_DURATION_MS,
} from "./shogi-match/constants";
import { applyDropResult } from "./shogi-match/dnd/dropLogic";
import type { DropResult } from "./shogi-match/dnd/types";
import { usePieceDnd } from "./shogi-match/dnd/usePieceDnd";
import { useBatchAnalysis } from "./shogi-match/hooks/useBatchAnalysis";
import { useBoardState } from "./shogi-match/hooks/useBoardState";
import { useClockManager } from "./shogi-match/hooks/useClockManager";
import { useDialogs } from "./shogi-match/hooks/useDialogs";
import { useEditModeActions } from "./shogi-match/hooks/useEditModeActions";
import { useEngineManager } from "./shogi-match/hooks/useEngineManager";
import { useEnginePool } from "./shogi-match/hooks/useEnginePool";
import { useGameControls } from "./shogi-match/hooks/useGameControls";
import { useKifuImportExport } from "./shogi-match/hooks/useKifuImportExport";
import { useKifuKeyboardNavigation } from "./shogi-match/hooks/useKifuKeyboardNavigation";
import { useKifuNavigation } from "./shogi-match/hooks/useKifuNavigation";
import { useLegalMovePrefetch } from "./shogi-match/hooks/useLegalMovePrefetch";
import { useLocalStorage } from "./shogi-match/hooks/useLocalStorage";
import { useIsMobile } from "./shogi-match/hooks/useMediaQuery";
import { useMoveExecution } from "./shogi-match/hooks/useMoveExecution";
import { useNnueManager } from "./shogi-match/hooks/useNnueManager";
import { useNormalizedSettings } from "./shogi-match/hooks/useNormalizedSettings";
import { usePassRights } from "./shogi-match/hooks/usePassRights";
import { useUIState } from "./shogi-match/hooks/useUIState";
import { ShogiMatchLayout } from "./shogi-match/layouts/ShogiMatchLayout";
import { ShogiMatchProvider } from "./shogi-match/ShogiMatchContext";
import type {
    AnalysisSettings,
    AnalysisSnapshotDraft,
    AnalysisSnapshotEntryDraft,
    DisplaySettings,
    EngineOption,
    EngineThreadSettings,
    GameMode,
    PassRightsSettings,
    SideSetting,
} from "./shogi-match/types";
import {
    DEFAULT_ANALYSIS_SETTINGS,
    DEFAULT_DISPLAY_SETTINGS,
    DEFAULT_PASS_RIGHTS_SETTINGS,
} from "./shogi-match/types";
import type {
    AnalysisProps,
    BoardHandlersProps,
    BoardStateProps,
    DialogStateProps,
    MatchSettingsProps,
    MobileSpecificProps,
    NavigationProps,
    PCSpecificProps,
} from "./shogi-match/types/layoutProps";
import type { KifMove } from "./shogi-match/utils/kifFormat";
import { LegalMoveCache } from "./shogi-match/utils/legalMoveCache";
import {
    isSamePassRightsSettings,
    normalizePassRightsSettings,
} from "./shogi-match/utils/passRightsSettings";
import { boardToGrid } from "./shogi-match/utils/positionUtils";
import { isSameTimeSettings, normalizeTimeSettings } from "./shogi-match/utils/timeSettings";
import { TooltipProvider } from "./tooltip";

const EMPTY_ANALYSIS_MARKERS: Array<{ seat: "b" | "w"; ply: number }> = [];

interface ShogiMatchProps {
    engineOptions: EngineOption[];
    defaultSides?: { sente: SideSetting; gote: SideSetting };
    initialMainTimeMs?: number;
    initialByoyomiMs?: number;
    maxLogs?: number;
    fetchLegalMoves?: (
        sfen: string,
        moves: string[],
        options?: { passRights?: { sente: number; gote: number } },
    ) => Promise<string[]>;
    /** 開発者モード（エンジンログパネルなどを表示） */
    isDevMode?: boolean;
    /** NNUE プリセット manifest.json の URL（必須） */
    manifestUrl: string;
    /** Desktop 用: NNUE ファイル選択ダイアログを開いてパスを取得するコールバック */
    onRequestNnueFilePath?: () => Promise<string | null>;
    /** Web 用: remote private NNUE の取り込み導線 */
    remoteNnueManager?: RemoteNnueManager;
    /** デフォルトの NNUE プリセットキー（未指定時は DEFAULT_PRESET_KEY） */
    defaultNnuePresetKey?: string;
    /** AIアイコンのURL（GitHub Pages等でbase pathが必要な場合に指定） */
    aiIconUrl?: string;
    /** 対局中でも解析を許可する（オンライン対戦の AI サポート用） */
    allowAnalysisDuringMatch?: boolean;
    /** 棋譜パネルに表示する AI 解析使用マーカー */
    analysisMarkers?: Array<{ seat: "b" | "w"; ply: number }>;
    /** マウント時に読み込む棋譜（指定時は検討室モードで開始） */
    initialReview?: { sfen: string; moves: string[] };
    /** 現在局面のスナップショットを通知 */
    onPositionSnapshot?: (snapshot: { sfen: string; moves: string[]; label?: string }) => void;
    /** 現在の解析結果スナップショットを通知 */
    onAnalysisSnapshotChange?: (snapshot: AnalysisSnapshotDraft | null) => void;
    /** 初期表示時に適用する分析結果 */
    initialAnalysisEntries?: AnalysisSnapshotEntryDraft[] | null;
    /** 棋譜検討モード: 対局設定サイドバーを非表示にする */
    reviewMode?: boolean;
    /** 棋譜検討モード時に左サイドバー位置に表示するコンテンツ */
    reviewLeftContent?: React.ReactNode;
    /** 外部エンジン管理パネルを開くコールバック（Desktop用） */
    onOpenEngineManager?: () => void;
    /** 起動中外部エンジン設定パネルを開くコールバック（Desktop用） */
    onOpenEngineSettings?: (info: {
        side: "sente" | "gote" | "analysis";
        engineId: string;
        sessionId: string | null;
    }) => void;
}

export function ShogiMatch({
    engineOptions,
    defaultSides = {
        sente: { role: "engine", engineId: engineOptions[0]?.id },
        gote: { role: "engine", engineId: engineOptions[0]?.id },
    },
    initialMainTimeMs = 0,
    initialByoyomiMs = DEFAULT_BYOYOMI_MS,
    maxLogs = DEFAULT_MAX_LOGS,
    fetchLegalMoves,
    isDevMode = false,
    manifestUrl,
    onRequestNnueFilePath,
    remoteNnueManager,
    defaultNnuePresetKey,
    aiIconUrl,
    allowAnalysisDuringMatch,
    analysisMarkers = EMPTY_ANALYSIS_MARKERS,
    initialReview,
    onPositionSnapshot,
    onAnalysisSnapshotChange,
    initialAnalysisEntries = null,
    reviewMode,
    reviewLeftContent,
    onOpenEngineManager,
    onOpenEngineSettings,
}: ShogiMatchProps): ReactElement {
    // デフォルトの NNUE 選択（props のプリセットキーを使用、未指定時は DEFAULT_PRESET_KEY）
    const defaultNnueSelection = createDefaultNnueSelection(
        defaultNnuePresetKey ?? DEFAULT_PRESET_KEY,
    );
    const emptyBoard: BoardState = Object.fromEntries(
        getAllSquares().map((sq) => [sq, null]),
    ) as BoardState;
    const [sides, setSides] = useLocalStorage<{ sente: SideSetting; gote: SideSetting }>(
        "shogi-match-sides",
        defaultSides,
    );

    // 盤面状態管理（統合フック）
    const {
        position,
        setPosition,
        positionReady,
        setPositionReady,
        setInitialBoard,
        setBasePosition,
        lastMove,
        setLastMove,
        selection,
        setSelection,
        promotionSelection,
        setPromotionSelection,
        message,
        setMessage,
        gameResult,
        setGameResult,
        showResultDialog,
        setShowResultDialog,
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
        startSfen,
        setStartSfen,
        initializeBoard,
    } = useBoardState({
        initialPosition: {
            board: emptyBoard,
            hands: createEmptyHands(),
            turn: "sente",
            ply: 1,
        },
    });
    const initializeBoardEvent = useEffectEvent(initializeBoard);
    const defaultTimeSettings = {
        sente: {
            mainMs: initialMainTimeMs,
            byoyomiMs: initialByoyomiMs,
            enabled: defaultSides.sente.role !== "human",
        },
        gote: {
            mainMs: initialMainTimeMs,
            byoyomiMs: initialByoyomiMs,
            enabled: defaultSides.gote.role !== "human",
        },
    };
    const [timeSettings, setTimeSettings] = useNormalizedSettings(
        "shogi-match-time-settings",
        defaultTimeSettings,
        normalizeTimeSettings,
        isSameTimeSettings,
    );
    const [isMatchRunning, setIsMatchRunning] = useState(false);
    const [isEditMode, setIsEditMode] = useState(true);
    const [isPaused, setIsPaused] = useState(false);
    // モバイル判定
    const isMobile = useIsMobile();
    // 検討モード: 編集モードでも対局中でも一時停止中でもない状態
    // 自由に棋譜を閲覧し、分岐を作成できる
    const isReviewMode = !isEditMode && !isMatchRunning && !isPaused;
    const [storedDisplaySettings, setDisplaySettings] = useLocalStorage<DisplaySettings>(
        "shogi-display-settings",
        DEFAULT_DISPLAY_SETTINGS,
    );
    // 既存の localStorage データに新フィールド（enableSound 等）がない場合のマージ
    const displaySettings = { ...DEFAULT_DISPLAY_SETTINGS, ...storedDisplaySettings };
    const { playSound } = useShogiSound();
    // 解析設定（古いlocalStorageデータとの互換性のためデフォルト値とマージ）
    const [storedAnalysisSettings, setAnalysisSettings] = useLocalStorage<AnalysisSettings>(
        "shogi-analysis-settings",
        DEFAULT_ANALYSIS_SETTINGS,
    );
    const analysisSettings = { ...DEFAULT_ANALYSIS_SETTINGS, ...storedAnalysisSettings };
    const [analysisEngineId, setAnalysisEngineId] = useLocalStorage<string>(
        "shogi-analysis-engine",
        engineOptions[0]?.id ?? "wasm",
    );
    // パス権設定
    const [passRightsSettings, setPassRightsSettings] = useNormalizedSettings(
        "shogi-pass-rights-settings",
        DEFAULT_PASS_RIGHTS_SETTINGS,
        normalizePassRightsSettings,
        isSamePassRightsSettings,
    );
    const [storedEngineThreads, setStoredEngineThreads] = useLocalStorage<
        EngineThreadSettings | number
    >("shogi-match-engine-threads", { sente: 0, gote: 0 });
    const engineThreads = (() => {
        if (typeof storedEngineThreads === "number") {
            const normalized = Math.max(0, Math.trunc(storedEngineThreads));
            return { sente: normalized, gote: normalized };
        }
        if (!storedEngineThreads || typeof storedEngineThreads !== "object") {
            return { sente: 0, gote: 0 };
        }
        const normalize = (value: number | undefined) =>
            typeof value === "number" && Number.isFinite(value)
                ? Math.max(0, Math.trunc(value))
                : 0;
        return {
            sente: normalize(storedEngineThreads.sente),
            gote: normalize(storedEngineThreads.gote),
        };
    })();
    const setEngineThreads = (next: EngineThreadSettings) => {
        setStoredEngineThreads({
            sente: Math.max(0, Math.trunc(next.sente)),
            gote: Math.max(0, Math.trunc(next.gote)),
        });
    };
    // UI状態管理（統合フック）
    const {
        flipBoard,
        setFlipBoard,
        kifuViewMode,
        setKifuViewMode,
        pvPreview,
        setPvPreview,
        selectedMoveDetailPly,
        setSelectedMoveDetailPly,
        selectedBranchNodeId,
        setSelectedBranchNodeId,
        lastAddedBranchInfo,
        setLastAddedBranchInfo,
        batchAnalysis,
        setBatchAnalysis,
    } = useUIState();

    // ダイアログ状態管理
    const {
        isSettingsModalOpen,
        setIsSettingsModalOpen,
        isNnueManagerOpen,
        nnueManagerOpenReason,
        openNnueManager,
        closeNnueManager,
        clearNnueManagerOpenReason,
        isDisplaySettingsOpen,
        setIsDisplaySettingsOpen,
        isAboutOpen,
        setIsAboutOpen,
        isPassRightsSettingsOpen,
        setIsPassRightsSettingsOpen,
    } = useDialogs();

    // エンジン再起動用のref（useNnueManagerで使用）
    const restartEngineForNnueRef = useRef<
        ((side: Player, selection?: NnueSelection) => Promise<void>) | null
    >(null);

    // NNUE管理（統合フック）
    const {
        senteNnueSelection,
        handleSenteNnueSelectionChange,
        goteNnueSelection,
        handleGoteNnueSelectionChange,
        analysisNnueSelection,
        setAnalysisNnueSelection,
        analysisNnueId,
        nnueList,
        isNnueListLoading,
        presets,
        presetConfigs,
        resolveNnue,
    } = useNnueManager({
        defaultNnueSelection,
        manifestUrl,
        restartEngineForNnue: (side, selection) =>
            restartEngineForNnueRef.current?.(side, selection) ?? Promise.resolve(),
    });

    // 分析用 NNUE 変更時に一括解析をリセット（プール破棄に伴う UI 同期）
    const prevAnalysisNnueSelectionRef = useRef(analysisNnueSelection);
    useEffect(() => {
        const prev = prevAnalysisNnueSelectionRef.current;
        if (
            prev.presetKey !== analysisNnueSelection.presetKey ||
            prev.nnueId !== analysisNnueSelection.nnueId
        ) {
            prevAnalysisNnueSelectionRef.current = analysisNnueSelection;
            // 一括解析中なら UI をリセット
            setBatchAnalysis(null);
        }
    }, [analysisNnueSelection, setBatchAnalysis]);

    // positionRef を先に定義（コールバックで使用するため）
    const positionRef = useRef<PositionState>(position);
    // 編集操作のバージョンカウンター（非同期SFEN計算の競合状態を防止）
    const editVersionRef = useRef(0);

    // ナビゲーションからの局面変更コールバック
    const handleNavigationPositionChange = (
        newPosition: PositionState,
        lastMoveInfo?: { from?: string; to: string },
    ) => {
        setPosition(newPosition);
        positionRef.current = newPosition;
        // ナビゲーションからのlastMove情報を反映
        if (lastMoveInfo) {
            setLastMove({
                from: (lastMoveInfo.from ?? null) as Square | null,
                to: lastMoveInfo.to as Square,
                promotes: false, // ナビゲーションでは成り情報を追跡しない
            });
        } else {
            setLastMove(undefined);
        }
    };

    // 棋譜ナビゲーション管理フック
    const navigation = useKifuNavigation({
        initialPosition: position,
        initialSfen: startSfen,
        onPositionChange: handleNavigationPositionChange,
    });

    // navigation.resetの参照をrefで保持（初期化useEffectで使用）
    // navigation オブジェクト全体は useKifuNavigation 内で再生成されるため、
    // reset メソッドのみを保持して不要な再実行を防ぐ
    const navigationResetRef = useRef(navigation.reset);
    navigationResetRef.current = navigation.reset;

    // 互換性用のmoves配列
    const moves = navigation.getMovesArray();
    const movesKey = moves.join(" ");

    const lastSnapshotRef = useRef<{ sfen: string; movesKey: string } | null>(null);

    useEffect(() => {
        const prev = lastSnapshotRef.current;
        if (prev && prev.sfen === startSfen && prev.movesKey === movesKey) {
            return;
        }
        lastSnapshotRef.current = { sfen: startSfen, movesKey };
        onPositionSnapshot?.({
            sfen: startSfen,
            moves,
            label: "現在局面",
        });
    }, [moves, movesKey, onPositionSnapshot, startSfen]);

    // 棋譜＋評価値データ
    const {
        kifMoves,
        evalHistory,
        mainLineEvalHistory,
        boardHistory,
        positionHistory,
        branchMarkers,
        recordEvalByPly,
        recordEvalByNodeId,
        clearEvalByPly,
        clearEvalByNodeId,
        addPvAsBranch,
    } = navigation;

    // 評価値グラフ用: ビューモードに応じて本譜 or 分岐の評価履歴を選択
    // "main" モード時は本譜の評価値を表示
    // "branches" や "selectedBranch" モード時は現在の経路（分岐含む）の評価値を表示
    const displayEvalHistory = kifuViewMode === "main" ? mainLineEvalHistory : evalHistory;
    const analysisSnapshotDraft = (() => {
        const entries = kifMoves
            .filter(
                (move) =>
                    move.evalCp !== undefined ||
                    move.evalMate !== undefined ||
                    move.depth !== undefined ||
                    move.pv !== undefined ||
                    move.multiPvEvals !== undefined,
            )
            .map((move) => ({
                ply: move.ply,
                evalCp: move.evalCp ?? null,
                evalMate: move.evalMate ?? null,
                depth: move.depth ?? null,
                pv: move.pv ?? null,
                multiPv: move.multiPvEvals ?? null,
            }));

        if (entries.length === 0) {
            return null;
        }

        return {
            startSfen,
            lineMoves: kifMoves.map((move) => move.usiMove),
            analysisSettings,
            entries,
        } satisfies AnalysisSnapshotDraft;
    })();
    const lastAnalysisSnapshotSignatureRef = useRef<string | null>(null);

    useEffect(() => {
        const signature = analysisSnapshotDraft ? JSON.stringify(analysisSnapshotDraft) : null;
        if (lastAnalysisSnapshotSignatureRef.current === signature) {
            return;
        }
        lastAnalysisSnapshotSignatureRef.current = signature;
        onAnalysisSnapshotChange?.(analysisSnapshotDraft);
    }, [analysisSnapshotDraft, onAnalysisSnapshotChange]);

    // 選択中の手の詳細を最新のkifMovesから取得
    const selectedMoveDetail = (() => {
        if (!selectedMoveDetailPly) return null;
        const move = kifMoves.find((m) => m.ply === selectedMoveDetailPly.ply);
        if (!move) return null;
        return { move, position: selectedMoveDetailPly.position };
    })();

    // 後手が人間の場合は盤面を反転して手前側に表示
    useEffect(() => {
        const goteIsHuman = sides.gote.role === "human";
        const senteIsHuman = sides.sente.role === "human";
        // 後手のみ人間、または両方人間で後手優先の場合は反転
        // （後手が人間かつ先手がエンジンの場合に反転）
        setFlipBoard(goteIsHuman && !senteIsHuman);
    }, [setFlipBoard, sides.gote.role, sides.sente.role]);

    // 持ち駒表示用のヘルパー関数（メモ化してMobileBoardSectionの再レンダリングを防ぐ）
    const getHandInfo = (pos: "top" | "bottom") => {
        const owner: Player =
            pos === "top" ? (flipBoard ? "sente" : "gote") : flipBoard ? "gote" : "sente";
        // 検討モードでは手番の持ち駒を選択可能（対局設定に関係なく）
        const isActiveInReview = isReviewMode && position.turn === owner;
        const isActiveInMatch =
            !isEditMode &&
            !isReviewMode &&
            position.turn === owner &&
            sides[owner].role === "human";
        return {
            owner,
            hand: owner === "sente" ? position.hands.sente : position.hands.gote,
            isActive: isActiveInReview || isActiveInMatch,
            isAI: !reviewMode && sides[owner].role === "engine",
        };
    };

    const legalCacheRef = useRef<LegalMoveCache | null>(null);
    if (!legalCacheRef.current) legalCacheRef.current = new LegalMoveCache();
    const legalCache = legalCacheRef.current;

    const matchEndedRef = useRef(false);
    const boardSectionRef = useRef<HTMLDivElement>(null);
    const settingsLocked = isMatchRunning;
    // 現在のターン開始時刻（消費時間計算用）
    const turnStartTimeRef = useRef<number>(Date.now());

    // endMatch のための ref（循環依存を回避）
    const endMatchRef = useRef<((result: GameResult) => Promise<void>) | null>(null);

    const handleClockError = (text: string) => {
        setMessage({ text, type: "error" });
    };

    const stopAllEnginesRef = useRef<() => Promise<void>>(async () => {});

    // 時計管理フックを使用
    const { clocks, clocksRef, resetClocks, updateClocksForNextTurn, stopTicking, startTicking } =
        useClockManager({
            timeSettings,
            isMatchRunning,
            onTimeExpired: async (side) => {
                const winner: Player = side === "sente" ? "gote" : "sente";
                const result: GameResult = {
                    winner,
                    reason: { kind: "time_expired", loser: side },
                    totalMoves: moves.length,
                };
                await endMatchRef.current?.(result);
            },
            matchEndedRef,
            onClockError: handleClockError,
        });

    const getRemainingTimeMs = (side: Player) => {
        const clock = clocksRef.current;
        const state = clock[side];
        if (!state) return 0;
        const isTicking = clock.ticking === side;
        const elapsed = isTicking ? Date.now() - clock.lastUpdatedAt : 0;
        const mainLeft = Math.max(0, state.mainMs - elapsed);
        const overMain = Math.max(0, elapsed - state.mainMs);
        const byoyomiLeft =
            state.mainMs === 0 && isTicking
                ? Math.max(0, state.byoyomiMs - elapsed)
                : Math.max(0, state.byoyomiMs - overMain);
        return mainLeft + byoyomiLeft;
    };

    // パス権管理フック
    const passRights = usePassRights({
        passRightsSettings,
        positionRef,
        setPosition,
        isMatchRunning,
        moves,
        legalCache,
        currentTurnRole: sides[position.turn]?.role ?? "human",
        getRemainingTimeMs,
    });

    const clearLegalCache = () => {
        legalCache.clear();
        passRights.setCanPassLegal(false);
    };
    // パス権設定変更時にキャッシュもクリアするラッパー
    // （合法手にpassが含まれるかどうかが変わるため）
    const handlePassRightsSettingsChange = (newSettings: PassRightsSettings) => {
        setPassRightsSettings(newSettings);
        clearLegalCache();
    };

    // 対局前に timeSettings が変更されたら clocks を同期
    // （resetClocks は timeSettings に依存しているため、resetClocks の変更で検知可能）
    useEffect(() => {
        if (!isMatchRunning) {
            resetClocks(false);
        }
    }, [isMatchRunning, resetClocks]);

    // 対局終了処理（エンジン管理フックから呼ばれる）
    const endMatch = async (result: GameResult) => {
        if (matchEndedRef.current) return;
        matchEndedRef.current = true;
        setGameResult(result);
        setShowResultDialog(true);
        setIsMatchRunning(false);
        stopTicking();
        try {
            await stopAllEnginesRef.current();
        } catch (error) {
            console.error("エンジン停止に失敗しました:", error);
            setMessage({
                text: `対局終了処理でエンジン停止に失敗しました: ${String(error ?? "unknown")}`,
                type: "error",
            });
        }
    };

    // endMatchRef を更新
    endMatchRef.current = endMatch;

    // 投了処理
    const handleResign = async () => {
        const currentTurn = positionRef.current.turn;
        const result: GameResult = {
            winner: currentTurn === "sente" ? "gote" : "sente",
            reason: { kind: "resignation", loser: currentTurn },
            totalMoves: moves.length,
        };
        await endMatch(result);
    };

    // 詰み検出: 人間の手番で合法手がない場合に自動終局
    // エンジンの手番は engine-controller が "bestmove none" を検知して処理するためスキップ
    useEffect(() => {
        if (!isMatchRunning || !positionReady || matchEndedRef.current) return;
        if (sides[position.turn].role === "engine") return;

        let cancelled = false;
        const passRightsOption = passRights.getPassRightsOption();
        void (async () => {
            try {
                const resolver = fetchLegalMoves
                    ? () => fetchLegalMoves(startSfen, moves, passRightsOption)
                    : () => getPositionService().getLegalMoves(startSfen, moves, passRightsOption);
                const legal = await legalCache.getOrResolve(moves.join(" "), resolver);
                if (cancelled || matchEndedRef.current) return;
                if (legal.size === 0) {
                    const loser: Player = position.turn;
                    const winner: Player = loser === "sente" ? "gote" : "sente";
                    await endMatchRef.current?.({
                        winner,
                        reason: { kind: "checkmate", loser },
                        totalMoves: moves.length,
                    });
                }
            } catch {
                // 合法手取得失敗時は無視
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [
        isMatchRunning,
        positionReady,
        moves,
        startSfen,
        position.turn,
        fetchLegalMoves,
        sides,
        passRights,
        legalCache,
    ]);

    // 手の処理中フラグ（待った・パス等の連打・競合防止用）
    const moveProcessingRef = useRef(false);

    // 待った処理（2手戻す：相手の手と自分の前の手を戻す）
    const handleUndo = async () => {
        // 処理中なら無視（連打・競合防止）
        if (moveProcessingRef.current) return;

        const moveCount = moves.length;
        if (moveCount === 0) return;

        moveProcessingRef.current = true;

        try {
            // まず時計を停止（待った処理中に時間が進むのを防ぐ）
            stopTicking();

            // エンジンの思考を停止（旧局面のbestmoveが適用されるのを防ぐ）
            await stopAllEnginesRef.current();

            // 2手戻す（自分の前の手まで戻る）
            // ただし、1手しかない場合は1手だけ戻す
            const undoCount = moveCount >= 2 ? 2 : 1;

            // 待った後の手番を明示的に計算
            // React のバッチ処理により navigation.goBack() 後の positionRef.current は
            // 即座に更新されないため、手番を事前に計算する
            const turnBeforeUndo = positionRef.current.turn;
            const turnAfterUndo =
                undoCount % 2 === 1
                    ? turnBeforeUndo === "sente"
                        ? "gote"
                        : "sente"
                    : turnBeforeUndo;

            for (let i = 0; i < undoCount; i++) {
                navigation.goBack();
            }

            // 待った後の思考時間計測を新しく開始
            turnStartTimeRef.current = Date.now();
            // 秒読みをリセット（計算した手番で時計を更新・開始）
            updateClocksForNextTurn(turnAfterUndo);
        } finally {
            moveProcessingRef.current = false;
        }
    };

    const handleMoveFromEngineRef = useRef<(move: string) => void>(() => {});

    // 評価値更新コールバックのref（useBatchAnalysisで設定）
    const handleEvalUpdateRef = useRef<
        (ply: number, event: import("@shogi/engine-client").EngineInfoEvent) => void
    >(() => {});

    // エンジン管理フックを使用（明示API経由で制御）
    const {
        eventLogs,
        errorLogs,
        stopAllEngines,
        isEngineTurn,
        logEngineError,
        isAnalyzing,
        analyzePosition,
        engineErrorDetails,
        retryEngine,
        isRetrying,
        isEngineRestarting,
        disposeEngine,
        restartEngineForNnue,
        getClientForSide,
        getAnalysisClient,
    } = useEngineManager({
        sides,
        engineOptions,
        clocksRef,
        startSfen,
        moves,
        positionTurn: position.turn,
        isMatchRunning,
        positionReady,
        passRightsSettings,
        onMoveFromEngine: (move) => handleMoveFromEngineRef.current(move),
        onMatchEnd: endMatch,
        onEvalUpdate: (ply, event) => handleEvalUpdateRef.current(ply, event),
        maxLogs,
        senteNnueSelection,
        goteNnueSelection,
        analysisNnueSelection,
        resolveNnue,
        allowAnalysisDuringMatch,
        engineThreads,
        analysisEngineId,
    });
    stopAllEnginesRef.current = stopAllEngines;
    restartEngineForNnueRef.current = restartEngineForNnue;

    // role変更時にエンジンを破棄するラッパー
    const handleSidesChange = (newSides: { sente: SideSetting; gote: SideSetting }) => {
        // role が engine から human に変わった場合はエンジンを破棄
        for (const side of ["sente", "gote"] as const) {
            if (sides[side].role === "engine" && newSides[side].role !== "engine") {
                void disposeEngine(side);
            }
        }
        setSides(newSides);
    };

    // 並列一括解析用のエンジンプール
    const analysisEngineOption =
        engineOptions.find((option) => option.id === analysisEngineId) ?? engineOptions[0];
    const enginePool = useEnginePool({
        createClient:
            analysisEngineOption?.createClient ??
            (() => {
                throw new Error("No engine available");
            }),
        clientKey: analysisEngineOption?.id,
        workerCount: resolveWorkerCount(analysisSettings.parallelWorkers),
        onProgress: (progress) => {
            setBatchAnalysis({
                isRunning: true,
                currentIndex: progress.completed,
                totalCount: progress.total,
                targetPlies: [], // 進捗表示用には不要
                inProgress: progress.inProgress,
            });
        },
        onResult: (ply, event, nodeId) => {
            // nodeIdがある場合は分岐解析の結果
            if (nodeId) {
                recordEvalByNodeId(nodeId, event);
            } else {
                recordEvalByPly(ply, event);
            }
        },
        onComplete: () => {
            setBatchAnalysis(null);
        },
        onError: (ply, error) => {
            console.error(`解析エラー (ply=${ply}):`, error);
        },
        nnueId: analysisNnueId,
    });

    // 一括解析管理フック
    const {
        analyzingState,
        handleEvalUpdate,
        handleAnalyzePly,
        handleAnalyzeHintPly,
        handleAnalyzeNode,
        handleStartBatchAnalysis,
        handleStartTreeBatchAnalysis,
        handleAnalyzeBranch,
        handleCancelBatchAnalysis,
    } = useBatchAnalysis({
        kifMoves,
        startSfen,
        analysisSettings,
        enginePool,
        resolveNnue,
        analysisNnueSelection,
        recordEvalByPly,
        recordEvalByNodeId,
        clearEvalByPly,
        clearEvalByNodeId,
        analyzePosition,
        isAnalyzing,
        kifuTree: navigation.tree,
        openNnueManager,
        setMessage,
        batchAnalysis,
        setBatchAnalysis,
    });

    // handleEvalUpdate を ref に設定（useEngineManager で使用）
    handleEvalUpdateRef.current = handleEvalUpdate;

    // 手の適用後の共通処理（エンジンの手・パス手・人間の手で共通）
    const applyMoveAndUpdateState = (
        move: string,
        nextPosition: PositionState,
        lastMoveInfo: LastMove | undefined,
        source?: "human" | "engine",
    ) => {
        // サウンドフィードバック
        if (displaySettings.enableSound) {
            if (move === "pass") {
                playSound("pass");
            } else if (source === "engine") {
                playSound("move_opponent");
            } else {
                playSound("move_self");
            }
        }
        // 消費時間を計算
        const elapsedMs = Date.now() - turnStartTimeRef.current;
        // 棋譜ナビゲーションに手を追加（局面更新はonPositionChangeで自動実行）
        navigation.addMove(move, nextPosition, { elapsedMs });
        setLastMove(lastMoveInfo);
        setSelection(null);
        setMessage(null);
        clearLegalCache();
        // ターン開始時刻をリセット
        turnStartTimeRef.current = Date.now();
        updateClocksForNextTurn(nextPosition.turn);
    };

    // キーボード・ホイールナビゲーション用のgoForward（分岐対応）
    const handleKeyboardForward = () => {
        navigation.goForward(selectedBranchNodeId ?? undefined);
    };

    // キーボード・ホイールナビゲーション（対局中は無効）
    // selectedBranchNodeIdがある場合は、分岐に沿って進む
    useKifuKeyboardNavigation({
        onForward: handleKeyboardForward,
        onBack: navigation.goBack,
        onToStart: navigation.goToStart,
        onToEnd: navigation.goToEnd,
        disabled: isMatchRunning,
        containerRef: boardSectionRef,
        enableWheelNavigation: displaySettings.enableWheelNavigation,
    });

    // エンジンからの手を受け取って適用するコールバック
    const handleMoveFromEngine = (move: string) => {
        // 待った・パス処理中は無視（旧局面への適用防止）
        if (moveProcessingRef.current) return;
        if (matchEndedRef.current) return;
        // 手番チェック: エンジンの手番でない場合は無視
        // （待った→パス→待った等の連続操作で古いbestmoveが届く競合状態を防止）
        if (sides[positionRef.current.turn].role !== "engine") {
            console.warn(
                `Ignoring engine move "${move}": current turn is ${positionRef.current.turn} (human)`,
            );
            return;
        }
        const result = applyMoveWithState(positionRef.current, move, {
            validateTurn: false,
        });
        if (!result.ok) {
            logEngineError(
                `engine move rejected (${move || "empty"}): ${result.error ?? "unknown"}`,
            );
            return;
        }
        applyMoveAndUpdateState(move, result.next, result.lastMove, "engine");
    };
    handleMoveFromEngineRef.current = handleMoveFromEngine;

    // パス手を処理するコールバック
    // 人間・エンジン両方のパス手で使用される
    const handlePassMove = async () => {
        // 処理中なら無視（待ったとの競合防止）
        if (moveProcessingRef.current) return;
        if (matchEndedRef.current) return;
        if (!passRightsSettings?.enabled) return;
        const rights = positionRef.current.passRights ?? passRights.ensurePassRightsInitialized();
        const hasRightsNow = rights ? rights[positionRef.current.turn] > 0 : false;
        if (!hasRightsNow) {
            setMessage({ text: "パス権がありません", type: "error" });
            return;
        }

        moveProcessingRef.current = true;

        try {
            // 合法手をチェック（王手中はパスが合法手に含まれない）
            // エンジン側の can_pass() は王手中のパスを禁止しており、
            // パスが合法でない場合にloadPositionするとパニックするため、事前にチェック
            try {
                const passRightsOption = passRights.getPassRightsOption();
                const resolver = fetchLegalMoves
                    ? () => fetchLegalMoves(startSfen, moves, passRightsOption)
                    : () => getPositionService().getLegalMoves(startSfen, moves, passRightsOption);
                const movesKey = moves.join(" ");
                let legal = await legalCache.getOrResolve(movesKey, resolver);
                if (!legal || !legal.has("pass")) {
                    // パス権ありでも合法手に含まれない場合はキャッシュをクリアして再取得（パス権オプション漏れ対策）
                    clearLegalCache();
                    legal = await legalCache.getOrResolve(movesKey, resolver);
                    if (!legal || !legal.has("pass")) {
                        setMessage({ text: "王手されているためパスできません", type: "error" });
                        return;
                    }
                }
            } catch (error) {
                setMessage({ text: `合法手の取得に失敗しました: ${String(error)}`, type: "error" });
                return;
            }

            // "pass" を applyMoveWithState で適用
            // validateTurn: false の理由:
            // - 人間のパスはUI側で手番チェック済み（sides[position.turn].role === "human"）
            // - エンジンのパスも受け付けるため、ここでは手番検証をスキップ
            const result = applyMoveWithState(positionRef.current, "pass", {
                validateTurn: false,
            });

            if (!result.ok) {
                setMessage({ text: `パスに失敗しました: ${result.error}`, type: "error" });
                return;
            }

            applyMoveAndUpdateState("pass", result.next, result.lastMove);
        } finally {
            moveProcessingRef.current = false;
        }
    };

    useEffect(() => {
        let cancelled = false;
        const service = getPositionService();

        const init = async () => {
            try {
                const pos = await service.getInitialBoard();
                if (cancelled) return;
                positionRef.current = pos;
                let sfen = "startpos";
                try {
                    sfen = await service.boardToSfen(pos);
                } catch (error) {
                    if (!cancelled) {
                        setMessage({
                            text: `局面のSFEN変換に失敗しました: ${String(error)}`,
                            type: "error",
                        });
                    }
                }
                if (!cancelled) {
                    // 局面・initialBoard・basePosition・startSfen・positionReady を一括設定
                    initializeBoardEvent(pos, sfen);
                    navigationResetRef.current(pos, sfen);
                }
            } catch (error) {
                if (!cancelled) {
                    setMessage({
                        text: `初期局面の取得に失敗しました: ${String(error)}`,
                        type: "error",
                    });
                }
            }
        };

        void init();
        return () => {
            cancelled = true;
        };
    }, [setMessage]);

    const grid = (() => {
        const g = boardToGrid(position.board);
        return flipBoard ? [...g].reverse().map((row) => [...row].reverse()) : g;
    })();

    const refreshStartSfen = async (pos: PositionState): Promise<string> => {
        try {
            const sfen = await getPositionService().boardToSfen(pos);
            setStartSfen(sfen);
            return sfen;
        } catch (error) {
            setMessage({
                text: `局面のSFEN変換に失敗しました: ${String(error)}`,
                type: "error",
            });
            throw error;
        }
    };

    // 対局制御フック
    const {
        pauseAutoPlay,
        enterEditModeFromPaused,
        resumeAutoPlay,
        handleStartReview,
        handleEnterEditMode,
        handleResetToStartpos,
    } = useGameControls({
        position,
        positionRef,
        navigation,
        isMatchRunning,
        isPaused,
        isEditMode,
        positionReady,
        startSfen,
        passRightsSettings,
        sides,
        senteNnueSelection,
        goteNnueSelection,
        matchEndedRef,
        turnStartTimeRef,
        stopTicking,
        startTicking,
        resetClocks,
        stopAllEngines,
        resolveNnue,
        clearLegalCache,
        refreshStartSfen,
        setIsMatchRunning,
        setIsPaused,
        setIsEditMode,
        setPosition,
        setBasePosition,
        setInitialBoard,
        setStartSfen,
        setPositionReady,
        setLastMove,
        setSelection,
        setMessage,
        setLastAddedBranchInfo,
        setGameResult,
        setShowResultDialog,
        openNnueManager,
        setEditFromSquare,
        setEditTool,
        setEditPromoted,
        setEditOwner,
        setEditPieceType,
    });

    /** 現在のゲームモードを計算 */
    const gameMode: GameMode = isEditMode
        ? "editing"
        : isMatchRunning
          ? "playing"
          : isPaused
            ? "paused"
            : "reviewing";
    const hideEmptyHandPieces = gameMode === "playing" || gameMode === "paused";

    // パス可否判定のため、キャッシュ未作成時は合法手をプリフェッチ
    useLegalMovePrefetch({
        isMatchRunning,
        positionReady,
        positionTurn: position.turn,
        sides,
        moves,
        legalCache,
        passRights,
        startSfen,
        fetchLegalMoves,
    });

    // 編集モードアクション管理フック
    const {
        applyEditedPosition,
        setPiecePromotion,
        placePieceAt,
        handleIncrementHand,
        handleDecrementHand,
    } = useEditModeActions({
        position,
        positionRef,
        editVersionRef,
        navigation,
        isEditMode,
        isMatchRunning,
        matchEndedRef,
        clearLegalCache,
        stopTicking,
        refreshStartSfen,
        setPosition,
        setInitialBoard,
        setLastMove,
        setSelection,
        setMessage,
        setLastAddedBranchInfo,
        setEditFromSquare,
        setIsMatchRunning,
    });

    // DnD ドロップハンドラ
    const handleDndDrop = (result: DropResult) => {
        if (!isEditMode) return;

        const applied = applyDropResult(result, positionRef.current);
        if (!applied.ok) {
            setMessage({ text: applied.error ?? "ドロップに失敗しました", type: "error" });
            return;
        }

        applyEditedPosition(applied.next);
    };

    // DnD コントローラー
    const dndController = usePieceDnd({
        onDrop: handleDndDrop,
        disabled: !isEditMode,
    });

    // DnD ドラッグ開始ハンドラ（盤上の駒）
    // 注: isEditMode チェックは usePieceDnd の disabled オプションと
    //     JSX での条件付き props 渡しで行うため、ここでは不要
    const handlePiecePointerDown = (
        square: string,
        piece: { owner: "sente" | "gote"; type: string; promoted?: boolean },
        e: React.PointerEvent,
    ) => {
        const origin = { type: "board" as const, square: square as Square };
        const payload = {
            owner: piece.owner as Player,
            pieceType: piece.type as PieceType,
            isPromoted: piece.promoted ?? false,
        };

        dndController.startDrag(origin, payload, e);
    };

    // DnD ドラッグ開始ハンドラ（持ち駒）
    const handleHandPiecePointerDown = (
        owner: Player,
        pieceType: PieceType,
        e: React.PointerEvent,
    ) => {
        // 持ち駒が0個の場合はストック扱い（編集モード時、無限供給）
        const count = position?.hands[owner][pieceType] ?? 0;
        const origin =
            count > 0
                ? { type: "hand" as const, owner, pieceType }
                : { type: "stock" as const, owner, pieceType };
        const payload = {
            owner,
            pieceType,
            isPromoted: false,
        };

        dndController.startDrag(origin, payload, e);
    };

    const handlePieceTogglePromote = (
        square: string,
        piece: { owner: "sente" | "gote"; type: string; promoted?: boolean },
        _event: React.MouseEvent<HTMLButtonElement>,
    ) => {
        if (!isEditMode) return;
        const sq = square as Square;
        setPiecePromotion(sq, !piece.promoted);
    };

    // 指し手実行管理フック
    const { handleSquareSelect, handlePromotionChoice, handleHandSelect, applyUsiMove } =
        useMoveExecution({
            position,
            navigation,
            isEditMode,
            isReviewMode,
            isPaused,
            positionReady,
            fetchLegalMoves,
            startSfen,
            moves,
            legalCache,
            clearLegalCache,
            setCanPassLegal: passRights.setCanPassLegal,
            getPassRightsOption: passRights.getPassRightsOption,
            updateClocksForNextTurn,
            turnStartTimeRef,
            isEngineTurn,
            selection,
            setSelection,
            promotionSelection,
            setPromotionSelection,
            setLastMove,
            setMessage,
            setLastAddedBranchInfo,
            editFromSquare,
            setEditFromSquare,
            editTool,
            editPieceType,
            editOwner,
            editPromoted,
            placePieceAt,
            moveProcessingRef,
        });

    // 棋譜インポート・エクスポート管理フック
    const { handleCopyKif, importSfen, importKif } = useKifuImportExport({
        navigation,
        passRightsSettings,
        clearLegalCache,
        resetClocks,
        kifMoves,
        boardHistory,
        sides,
        startSfen,
        setLastMove,
        setSelection,
        setMessage,
        setPositionReady,
        setBasePosition,
        setStartSfen,
        setInitialBoard,
        setLastAddedBranchInfo,
        setIsEditMode,
        setIsMatchRunning,
    });

    // マウント時に initialReview が指定されていれば棋譜を読み込む（一度だけ実行）
    const initialReviewHandledRef = useRef(false);
    const initialAnalysisAppliedRef = useRef<string | null>(null);
    useEffect(() => {
        if (!positionReady) {
            return;
        }
        if (initialReview && !initialReviewHandledRef.current) {
            initialReviewHandledRef.current = true;
            void importSfen(initialReview.sfen, initialReview.moves);
        }
    }, [importSfen, initialReview, positionReady]);

    useEffect(() => {
        if (!positionReady || !initialAnalysisEntries || initialAnalysisEntries.length === 0) {
            return;
        }

        const signature = JSON.stringify(initialAnalysisEntries);
        if (initialAnalysisAppliedRef.current === signature) {
            return;
        }

        for (const entry of initialAnalysisEntries) {
            clearEvalByPly(entry.ply);
            recordEvalByPly(entry.ply, {
                type: "info",
                scoreCp: entry.evalCp ?? undefined,
                scoreMate: entry.evalMate ?? undefined,
                depth: entry.depth ?? undefined,
                pv: entry.pv ?? undefined,
                multipv: 1,
            });
        }

        initialAnalysisAppliedRef.current = signature;
    }, [clearEvalByPly, initialAnalysisEntries, positionReady, recordEvalByPly]);

    // 棋譜の手数選択コールバック（巻き戻し・リプレイ用）
    const handlePlySelect = (ply: number) => {
        // 対局中は自動進行を一時停止し、編集モードに戻す
        if (isMatchRunning) {
            setIsMatchRunning(false);
            setIsEditMode(true);
            stopTicking();
            void stopAllEngines();
        }
        // 指定手数に移動（lastMoveはonPositionChangeで自動設定される）
        navigation.goToPly(ply);
    };

    // PVを分岐として追加するコールバック（シグナル付き）
    const handleAddPvAsBranch = (ply: number, pv: string[]) => {
        // 分岐が実際に追加された場合、ply+firstMoveを記録
        addPvAsBranch(ply, pv, (info) => {
            setLastAddedBranchInfo(info);
        });
    };

    // PVプレビューを開くコールバック
    const handlePreviewPv = (ply: number, pv: string[], evalCp?: number, evalMate?: number) => {
        // PVはply手目を指した後の局面から計算されている
        // positionHistory[ply-1] = ply手目を指した後の局面
        const startPos = positionHistory[ply - 1];
        if (!startPos) return;

        setPvPreview({
            ply,
            pv,
            startPosition: startPos,
            evalCp,
            evalMate,
        });
    };

    // 手の詳細を選択するコールバック（右パネル表示用）
    const handleMoveDetailSelect = (move: KifMove | null, pos: PositionState | null) => {
        if (move && pos) {
            setSelectedMoveDetailPly({ ply: move.ply, position: pos });
        } else {
            setSelectedMoveDetailPly(null);
        }
    };

    const candidateNote = positionReady ? null : "局面を読み込み中です。";
    const isDraggingPiece = isEditMode && dndController.state.isDragging;
    const internalEngineId = engineOptions[0]?.id ?? "wasm";

    useEffect(() => {
        if (engineOptions.some((option) => option.id === analysisEngineId)) {
            return;
        }
        setAnalysisEngineId(engineOptions[0]?.id ?? "wasm");
    }, [analysisEngineId, engineOptions, setAnalysisEngineId]);

    // Props グループ化: 対局設定
    const matchSettings: MatchSettingsProps = {
        sides,
        handleSidesChange,
        analysisEngineId,
        setAnalysisEngineId,
        timeSettings,
        setTimeSettings,
        passRightsSettings,
        handlePassRightsSettingsChange,
        settingsLocked,
        isDevMode,
        engineThreads,
        setEngineThreads,
        senteNnueSelection,
        handleSenteNnueSelectionChange,
        goteNnueSelection,
        handleGoteNnueSelectionChange,
        nnueList,
        presets,
        internalEngineId,
        engineOptions,
        onOpenEngineManager,
        onOpenEngineSettings: onOpenEngineSettings
            ? (side: "sente" | "gote" | "analysis") => {
                  let engineId: string | undefined;
                  let client = null;
                  if (side === "analysis") {
                      engineId = analysisEngineId;
                      client = getAnalysisClient();
                  } else {
                      const setting = sides[side];
                      engineId = setting.role === "engine" ? setting.engineId : undefined;
                      client = getClientForSide(side);
                  }
                  if (!engineId) return;
                  const sessionId = client?.getSessionId?.() ?? null;
                  onOpenEngineSettings({ side, engineId, sessionId });
              }
            : undefined,
        setIsDisplaySettingsOpen,
        setIsPassRightsSettingsOpen,
    };

    // Props グループ化: 盤面状態
    const boardState: BoardStateProps = {
        position,
        clocks,
        grid,
        gameMode,
        message,
        selection,
        promotionSelection,
        lastMove,
        moves,
        editFromSquare,
        flipBoard,
        displaySettings,
        onFlipBoardChange: setFlipBoard,
    };

    // Props グループ化: ダイアログ状態
    const dialogState: DialogStateProps = {
        gameResult,
        showResultDialog,
        setShowResultDialog,
        pvPreview,
        setPvPreview,
        isNnueManagerOpen,
        openNnueManager,
        closeNnueManager,
        nnueManagerOpenReason,
        clearNnueManagerOpenReason,
        manifestUrl,
        onRequestNnueFilePath,
        remoteNnueManager,
        selectedMoveDetail,
        setSelectedMoveDetailPly,
        isAboutOpen,
        setIsAboutOpen,
    };

    // Props グループ化: 解析機能
    const analysisProps: AnalysisProps = {
        analysisSettings,
        setAnalysisSettings,
        analysisNnueSelection,
        setAnalysisNnueSelection,
        isNnueListLoading,
        presetConfigs,
        isAnalyzing,
        analyzingState,
        batchAnalysis,
        handleAnalyzePly,
        handleAnalyzeHintPly,
        handleStartBatchAnalysis,
        handleCancelBatchAnalysis,
        handleAnalyzeNode,
        handleAnalyzeBranch,
        handleStartTreeBatchAnalysis,
    };

    // Props グループ化: ナビゲーション・棋譜
    const navigationProps: NavigationProps = {
        navigationState: {
            currentPly: navigation.state.currentPly,
            totalPly: navigation.state.totalPly,
            isRewound: navigation.state.isRewound,
            canGoForward: navigation.state.canGoForward,
            hasBranches: navigation.state.hasBranches,
            currentBranchIndex: navigation.state.currentBranchIndex,
            branchCount: navigation.state.branchCount,
            isOnMainLine: navigation.state.isOnMainLine,
        },
        navigationHandlers: {
            goBack: navigation.goBack,
            goForward: handleKeyboardForward,
            goToStart: navigation.goToStart,
            goToEnd: navigation.goToEnd,
            switchBranch: navigation.switchBranch,
            promoteCurrentLine: navigation.promoteCurrentLine,
            goToNodeById: navigation.goToNodeById,
            switchBranchAtNode: navigation.switchBranchAtNode,
        },
        kifMoves,
        evalHistory,
        displayEvalHistory,
        positionHistory,
        kifuTree: navigation.tree,
        selectedBranchNodeId,
        setSelectedBranchNodeId,
        branchMarkers,
        analysisMarkers,
        lastAddedBranchInfo,
        setLastAddedBranchInfo,
        handleAddPvAsBranch,
        handlePreviewPv,
        kifuViewMode,
        setKifuViewMode,
        setDisplaySettings,
        handlePlySelect,
        handleCopyKif,
        handleMoveDetailSelect,
    };

    // Props グループ化: 盤面操作ハンドラー
    const boardHandlers: BoardHandlersProps = {
        hideEmptyHandPieces,
        getHandInfo,
        handleSquareSelect,
        handlePromotionChoice,
        handleHandSelect,
        applyUsiMove,
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
        setIsSettingsModalOpen,
        shouldRenderPassButton: passRights.shouldRenderPassButton,
        canMakePassMove: passRights.canMakePassMove,
        passButtonDisabledReason: passRights.passButtonDisabledReason,
        handlePassMove,
        shouldShowPassConfirm: passRights.shouldShowPassConfirm,
        isDraggingPiece,
        boardSectionRef,
    };

    // Props グループ化: PC専用
    const pcSpecificProps: PCSpecificProps = {
        matchLayoutClasses: MATCH_LAYOUT_CLASSES,
        candidateNote,
        isSettingsModalOpen,
        importSfen,
        importKif,
        positionReady,
        isDevMode,
        eventLogs,
        errorLogs,
        engineErrorDetails,
        retryEngine,
        isRetrying,
        isDisplaySettingsOpen,
        onDisplaySettingsOpenChange: setIsDisplaySettingsOpen,
        isPassRightsSettingsOpen,
        onPassRightsSettingsOpenChange: setIsPassRightsSettingsOpen,
        reviewMode,
        reviewLeftContent,
    };

    // Props グループ化: Mobile専用
    const mobileSpecificProps: MobileSpecificProps = {
        isReviewMode,
        onOpenAbout: () => setIsAboutOpen(true),
        onImportSfen: importSfen,
        onImportKif: importKif,
        onDisplaySettingsChange: setDisplaySettings,
    };

    return (
        <ShogiMatchProvider config={{ aiIconUrl }}>
            <TooltipProvider delayDuration={TOOLTIP_DELAY_DURATION_MS}>
                <ShogiMatchLayout
                    // グループ化されたprops
                    matchSettings={matchSettings}
                    boardState={boardState}
                    dialogState={dialogState}
                    analysisProps={analysisProps}
                    navigationProps={navigationProps}
                    boardHandlers={boardHandlers}
                    pcSpecificProps={pcSpecificProps}
                    mobileSpecificProps={mobileSpecificProps}
                    // 個別props
                    isMobile={isMobile}
                    dndController={dndController}
                    isEditMode={isEditMode}
                    isEngineRestarting={isEngineRestarting}
                    isMatchRunning={isMatchRunning}
                    isPaused={isPaused}
                />
            </TooltipProvider>
        </ShogiMatchProvider>
    );
}
