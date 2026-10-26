import type {
    BoardState,
    GameResult,
    KifuTree,
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
    detectParallelism,
    getAllSquares,
    getPositionService,
    isStudyUsiMove,
    resolveWorkerCount,
} from "@shogi/app-core";
import type { ReactElement } from "react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { isCpuLosing } from "../hooks/moveSoundScene";
import type { NnueAccountStore } from "./nnue-library/types";
import { MatchNnueDownloadDialog } from "./shogi-match/components/MatchNnueDownloadDialog";
import { SearchInfoPanel } from "./shogi-match/components/SearchInfoPanel";
import {
    DEFAULT_BYOYOMI_MS,
    DEFAULT_MAX_LOGS,
    MATCH_LAYOUT_CLASSES,
    TOOLTIP_DELAY_DURATION_MS,
} from "./shogi-match/constants";
import { applyDropResult } from "./shogi-match/dnd/dropLogic";
import type { DropResult } from "./shogi-match/dnd/types";
import { usePieceDnd } from "./shogi-match/dnd/usePieceDnd";
import {
    useInitialAnalysisEntries,
    useMatchSnapshotReports,
} from "./shogi-match/hooks/useAnalysisSnapshot";
import { useBatchAnalysis } from "./shogi-match/hooks/useBatchAnalysis";
import { useBoardState } from "./shogi-match/hooks/useBoardState";
import { useDialogs } from "./shogi-match/hooks/useDialogs";
import { useEditModeActions } from "./shogi-match/hooks/useEditModeActions";
import { useEngineManager } from "./shogi-match/hooks/useEngineManager";
import { useEnginePool } from "./shogi-match/hooks/useEnginePool";
import { useGameControls } from "./shogi-match/hooks/useGameControls";
import { useImportedKifuPlayers } from "./shogi-match/hooks/useImportedKifuPlayers";
import {
    type InitialReviewInput,
    useInitialReviewSync,
} from "./shogi-match/hooks/useInitialReviewSync";
import { useKifuImportExport } from "./shogi-match/hooks/useKifuImportExport";
import { useKifuKeyboardNavigation } from "./shogi-match/hooks/useKifuKeyboardNavigation";
import { useKifuNavigation } from "./shogi-match/hooks/useKifuNavigation";
import { useLegalMovePrefetch } from "./shogi-match/hooks/useLegalMovePrefetch";
import { useLiveSearchInfo } from "./shogi-match/hooks/useLiveSearchInfo";
import { useMatchClock } from "./shogi-match/hooks/useMatchClock";
import { useMatchNnueDownload } from "./shogi-match/hooks/useMatchNnueDownload";
import { useMatchPreferences } from "./shogi-match/hooks/useMatchPreferences";
import { useMatchSounds } from "./shogi-match/hooks/useMatchSounds";
import { useIsMobile } from "./shogi-match/hooks/useMediaQuery";
import { useMoveExecution } from "./shogi-match/hooks/useMoveExecution";
import { useMoveShadow } from "./shogi-match/hooks/useMoveShadow";
import { useNnueManager } from "./shogi-match/hooks/useNnueManager";
import { usePassRights } from "./shogi-match/hooks/usePassRights";
import { usePlayHintNnueSelection } from "./shogi-match/hooks/usePlayHintNnueSelection";
import { usePlayHintSearch } from "./shogi-match/hooks/usePlayHintSearch";
import { usePlayScreen } from "./shogi-match/hooks/usePlayScreen";
import { useUIState } from "./shogi-match/hooks/useUIState";
import { ShogiMatchLayout } from "./shogi-match/layouts/ShogiMatchLayout";
import { type PlayPhase, ShogiMatchProvider } from "./shogi-match/ShogiMatchContext";
import type {
    AnalysisSnapshotDraft,
    AnalysisSnapshotEntryDraft,
    EngineOption,
    GameMode,
    PassRightsSettings,
    SideSetting,
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
import { buildLegalCacheKey, LegalMoveCache } from "./shogi-match/utils/legalMoveCache";
import {
    canEditPosition,
    resolveMoveDetail,
    shouldFlipBoardForSides,
} from "./shogi-match/utils/matchView";
import { boardToGrid } from "./shogi-match/utils/positionUtils";
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
    /** Web 用: ログインしたアカウントに保存した AI */
    nnueAccount?: NnueAccountStore;
    /** デフォルトの NNUE プリセットキー（未指定時は DEFAULT_PRESET_KEY） */
    defaultNnuePresetKey?: string;
    /** AIアイコンのURL（GitHub Pages等でbase pathが必要な場合に指定） */
    aiIconUrl?: string;
    /** CPU 戦の「犬」の音源を置いた URL（末尾 /）。未指定なら犬は選べず通常の駒音だけ */
    dogSoundBaseUrl?: string;
    /** 対局中でも解析を許可する（オンライン対戦の AI サポート用） */
    allowAnalysisDuringMatch?: boolean;
    /** 棋譜パネルに表示する AI 解析使用マーカー */
    analysisMarkers?: Array<{ seat: "b" | "w"; ply: number }>;
    /**
     * マウント時に読み込む棋譜（指定時は検討室モードで開始）。
     * `moveData` は `moves` と同じ index で対応する各手の評価値・消費時間
     * (先手視点)。ライブ観戦の評価値グラフ / 棋譜評価値カラム用。省略可 (後方互換)。
     */
    initialReview?: InitialReviewInput;
    /** 現在局面のスナップショットを通知 */
    onPositionSnapshot?: (snapshot: { sfen: string; moves: string[]; label?: string }) => void;
    /** 現在の解析結果スナップショットを通知 */
    onAnalysisSnapshotChange?: (snapshot: AnalysisSnapshotDraft | null) => void;
    /** 初期表示時に適用する分析結果 */
    initialAnalysisEntries?: AnalysisSnapshotEntryDraft[] | null;
    /** 棋譜検討モード: 対局設定サイドバーを非表示にする */
    reviewMode?: boolean;
    /**
     * ライブ観戦モード。表示設定を対局用とは別 localStorage 名前空間で扱い、
     * 棋譜評価値カラム (`showKifuEval`) を既定 ON にする。対局モードのチート防止
     * 既定 (OFF) や、ユーザーが対局用に設定した表示設定を汚さない。観戦側で
     * 明示的にトグルした値は観戦用名前空間に永続化され尊重される。
     */
    spectateMode?: boolean;
    /**
     * 棋譜を見るだけの画面（棋譜ビューア・ライブ観戦・公開棋譜）。対局開始・対局再開・棋譜読込・
     * 局面編集・平手に戻すを出さない（PC・スマホとも）。盤は操作できず（駒を動かして変化を作れない）、
     * 解析もできない。できるのは、棋譜の再生、評価値グラフ、読み筋の再生、棋譜にある分岐の閲覧。
     * 調べたいときは研究ノートで開く。対局したいときは、ページ側が `onPositionSnapshot` で受けた
     * 局面を対局ページへ引き継ぐ。
     */
    viewerMode?: boolean;
    /**
     * 画面の種類。`"play"` は対局専用の画面（AI と指す）で、対局の設定 → 対局 → 終局の流れだけを
     * 出す。棋譜の読み込み・駒を動かす検討・棋譜の解析は出さず（研究ノートで行う）、対局中の解析は
     * いまの局面のヒントだけにする。省略時は、対局と検討を兼ねた画面。
     */
    screen?: "play";
    /** 対局画面（`screen="play"`）で、進み具合（設定・対局中・終局後など）が変わったときに呼ぶ。 */
    onPlayPhaseChange?: (phase: PlayPhase) => void;
    /** 対局画面（`screen="play"`）の設定の欄の下に出す、ほかのページへの案内（研究ノートなど）。 */
    playSetupFooter?: React.ReactNode;
    /**
     * PC の盤のすぐ上（対局時計の位置）に、対局時計の代わりに出すコンテンツ
     * （棋譜ビューアの対局者名など）。スマホのレイアウトには出ない。
     */
    boardTopContent?: React.ReactNode;
    /**
     * スマホの盤の上の 1 行（手数・反転・サウンドの行）の左側に出すコンテンツ
     * （棋譜ビューアの対局者名など）。PC のレイアウトには出ない。
     */
    mobileHeaderContent?: React.ReactNode;
    /**
     * スマホの検討の画面で、評価値の行（「グラフ・読み筋」の隣）に足す操作（棋譜ビューアの
     * 「研究ノートで開く」など）。最初の画面に収まる位置なので、その画面の主な操作を置く。
     */
    mobileReviewActions?: React.ReactNode;
    /**
     * 評価値グラフを常に出す（PC。折りたたみの操作を出さない）。棋譜ビューアのように、
     * 対局中ではなくグラフを隠す理由の無い画面で指定する。指定しない画面は、対局中だけ
     * 既定で閉じ、それ以外（対局前・検討・観戦）は既定で開く（どちらも利用者が開閉できる）。
     */
    evalGraphPinned?: boolean;
    /** 棋譜検討モード時に左サイドバー位置に表示するコンテンツ */
    reviewLeftContent?: React.ReactNode;
    /** 棋譜検討モード時に 3 カラムの上部へ全幅で表示するコンテンツ（観戦スコアボード等） */
    reviewTopContent?: React.ReactNode;
    /** 外部エンジン管理パネルを開くコールバック（Desktop用） */
    onOpenEngineManager?: () => void;
    /** 起動中外部エンジン設定パネルを開くコールバック（Desktop用） */
    onOpenEngineSettings?: (info: {
        side: "sente" | "gote" | "analysis";
        engineId: string;
        sessionId: string | null;
    }) => void;
    /**
     * 読み込んだ棋譜を研究ノートにするコールバック。指定すると、棋譜読込の欄の下に
     * 「この棋譜を研究ノートにする」を出す（指し手があり、変則ルールでない棋譜のときだけ）。
     */
    onOpenAsStudy?: (
        tree: KifuTree,
        info: {
            /** 読み込んだ棋譜に書かれていた対局者名（いま開いている棋譜がその棋譜のままのとき）。 */
            players?: { sente?: string; gote?: string };
        },
    ) => void;
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
    nnueAccount,
    defaultNnuePresetKey,
    aiIconUrl,
    dogSoundBaseUrl,
    allowAnalysisDuringMatch,
    analysisMarkers = EMPTY_ANALYSIS_MARKERS,
    initialReview,
    onPositionSnapshot,
    onAnalysisSnapshotChange,
    initialAnalysisEntries = null,
    reviewMode,
    spectateMode,
    viewerMode = false,
    screen,
    playSetupFooter,
    onPlayPhaseChange,
    boardTopContent,
    mobileHeaderContent,
    mobileReviewActions,
    evalGraphPinned = false,
    reviewLeftContent,
    reviewTopContent,
    onOpenEngineManager,
    onOpenEngineSettings,
    onOpenAsStudy,
}: ShogiMatchProps): ReactElement {
    // デフォルトの NNUE 選択（props のプリセットキーを使用、未指定時は DEFAULT_PRESET_KEY）
    const defaultNnueSelection = createDefaultNnueSelection(
        defaultNnuePresetKey ?? DEFAULT_PRESET_KEY,
    );
    const emptyBoard: BoardState = Object.fromEntries(
        getAllSquares().map((sq) => [sq, null]),
    ) as BoardState;
    const {
        sides,
        setSides,
        timeSettings,
        setTimeSettings,
        hintMultiPv,
        setHintMultiPv,
        displaySettings,
        setDisplaySettings,
        analysisSettings,
        setAnalysisSettings,
        analysisEngineId,
        setAnalysisEngineId,
        passRightsSettings,
        setPassRightsSettings,
        engineThreads,
        setEngineThreads,
        engineSearchLimits,
        setEngineSearchLimits,
    } = useMatchPreferences({
        screen,
        spectateMode,
        defaultSides,
        initialMainTimeMs,
        initialByoyomiMs,
        engineOptions,
    });

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
    const [isMatchRunning, setIsMatchRunning] = useState(false);
    const [isEditMode, setIsEditMode] = useState(true);
    const isPlayScreen = screen === "play";
    // 対局画面では、利用者が「局面を変えて指す」を開いている間だけ盤を編集できる。
    const [positionEditOpen, setPositionEditOpen] = useState(false);
    const editAllowed =
        canEditPosition({ isEditMode, viewerMode }) && (!isPlayScreen || positionEditOpen);
    const [isPaused, setIsPaused] = useState(false);
    // 対局画面の進み具合。終局の結果があれば、一時停止より優先する（一時停止中に投了したときも
    // 結果の画面へ移る）。
    const playPhase: PlayPhase = isMatchRunning
        ? "playing"
        : gameResult
          ? "finished"
          : isPaused
            ? "paused"
            : positionEditOpen
              ? "editing"
              : "setup";
    // この対局で指し始めた手数（引き継いだ棋譜の途中から始めた対局では 0 でない）。待ったで戻せる範囲に使う。
    const [playStartPly, setPlayStartPly] = useState(0);
    const {
        liveSearchInfo,
        clearLiveSearchDisplay,
        recordSearchComplete,
        getPendingSearchStats,
        deletePendingSearchStats,
        pushLiveInfo,
    } = useLiveSearchInfo({ isMatchRunning });
    // モバイル判定
    const isMobile = useIsMobile();
    // 検討モード: 編集モードでも対局中でも一時停止中でもない状態
    // 自由に棋譜を閲覧し、分岐を作成できる
    const isReviewMode = !isEditMode && !isMatchRunning && !isPaused;
    const isCpuGame = sides.sente.role === "engine" || sides.gote.role === "engine";
    const { playSound, playMoveSound, playMatchEndSound } = useMatchSounds({
        displaySettings,
        isCpuGame,
        dogSoundBaseUrl,
    });
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
        isImportDialogOpen,
        setIsImportDialogOpen,
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

    const effectiveAnalysisNnueSelection = usePlayHintNnueSelection({
        isPlayScreen,
        sides,
        engineOptions,
        senteNnueSelection,
        goteNnueSelection,
        analysisNnueSelection,
        resolveNnue,
        nnueCount: nnueList.length,
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
    useMatchSnapshotReports({
        startSfen,
        moves,
        kifMoves,
        analysisSettings,
        onPositionSnapshot,
        onAnalysisSnapshotChange,
    });

    // 読み筋のウィンドウ（PC）に出す手。開いている間は、見ている手に追従する。
    const selectedMoveDetail = resolveMoveDetail({
        isOpen: selectedMoveDetailPly !== null,
        currentPly: navigation.state.currentPly,
        kifMoves,
        positionHistory,
    });

    // 後手が人間の場合は盤面を反転して手前側に表示
    useEffect(() => {
        setFlipBoard(
            shouldFlipBoardForSides({
                reviewMode: reviewMode === true,
                senteRole: sides.sente.role,
                goteRole: sides.gote.role,
            }),
        );
    }, [reviewMode, setFlipBoard, sides.gote.role, sides.sente.role]);

    // 持ち駒表示用のヘルパー関数（メモ化してMobileBoardSectionの再レンダリングを防ぐ）
    const getHandInfo = (pos: "top" | "bottom") => {
        const owner: Player =
            pos === "top" ? (flipBoard ? "sente" : "gote") : flipBoard ? "gote" : "sente";
        // 検討モードでは手番の持ち駒を選択可能（対局設定に関係なく）。ビューアでは選ばせない。
        const isActiveInReview = isReviewMode && !viewerMode && position.turn === owner;
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

    const stopAllEnginesRef = useRef<() => Promise<void>>(async () => {});
    const prepareEnginesRef = useRef<() => Promise<boolean>>(async () => true);

    const {
        clocks,
        clocksRef,
        resetClocks,
        updateClocksForNextTurn,
        stopTicking,
        startTicking,
        endIfFlaggedBeforeMove,
        getRemainingTimeMs,
    } = useMatchClock({
        isPlayScreen,
        sides,
        timeSettings,
        engineSearchLimits,
        totalMoves: moves.length,
        isMatchRunning,
        isPaused,
        matchEndedRef,
        endMatchRef,
        setMessage,
    });

    // パス権管理フック
    const passRights = usePassRights({
        passRightsSettings,
        positionRef,
        setPosition,
        isMatchRunning,
        moves,
        startSfen,
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

    // 対局終了処理（エンジン管理フックから呼ばれる）
    const endMatch = async (result: GameResult) => {
        if (matchEndedRef.current) return;
        matchEndedRef.current = true;
        setGameResult(result);
        setShowResultDialog(true);
        playMatchEndSound();
        setIsMatchRunning(false);
        setIsPaused(false);
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
        const senteIsHuman = sides.sente.role === "human";
        const goteIsHuman = sides.gote.role === "human";
        // 対局画面で人が片方だけなら、投了するのはその人（相手の AI の手番中に押しても、自分の負けにする）。
        const currentTurn: Player =
            isPlayScreen && senteIsHuman !== goteIsHuman
                ? senteIsHuman
                    ? "sente"
                    : "gote"
                : positionRef.current.turn;
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
                const legal = await legalCache.getOrResolve(
                    buildLegalCacheKey(startSfen, moves, passRightsOption),
                    resolver,
                );
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
        // 対局画面では、この対局で指した手だけを戻す（引き継いだ棋譜の手は戻さない）。戻せる手が
        // 無ければ、時計やエンジンを止める前に何もせず戻る。
        if (isPlayScreen && moveCount - playStartPly <= 0) return;

        moveProcessingRef.current = true;

        try {
            // まず時計を停止（待った処理中に時間が進むのを防ぐ）
            stopTicking();

            // エンジンの思考を停止（旧局面のbestmoveが適用されるのを防ぐ）
            await stopAllEnginesRef.current();

            // 2手戻す（自分の前の手まで戻る）
            // ただし、1手しかない場合は1手だけ戻す
            // 対局画面の人 対 人では、直前の 1 手だけ戻す（交互に指しているので、2 手戻すと相手の手まで消える）。
            const bothHumans = sides.sente.role === "human" && sides.gote.role === "human";
            const wantedUndoCount = isPlayScreen && bothHumans ? 1 : moveCount >= 2 ? 2 : 1;
            // 対局画面では、この対局で指した手だけを戻す（引き継いだ棋譜の手は戻さない）。
            const undoCount = isPlayScreen
                ? Math.min(wantedUndoCount, moveCount - playStartPly)
                : wantedUndoCount;

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

            // 取り消す手は、直前の手（手番でない側）から交互にさかのぼる。その手で得た加算を返させる。
            const undone = { sente: 0, gote: 0 };
            for (let i = 0; i < undoCount; i++) {
                const mover = (i % 2 === 0) === (turnBeforeUndo === "sente") ? "gote" : "sente";
                undone[mover] += 1;
            }

            for (let i = 0; i < undoCount; i++) {
                navigation.goBack();
            }
            // 対局画面では、取り消した手を棋譜から消す（終局後の棋譜や研究ノートに残さない）。
            if (isPlayScreen) navigation.truncate();

            // 停止で破棄したエンジンを時計再開前に初期化し直す
            // （初期化時間が秒読みから差し引かれるのを防ぐ）
            if (!(await prepareEnginesRef.current())) {
                // 一時停止扱いにして再開操作からやり直せるようにする。
                // 秒読みは undo 後の手番用にリセットするが、isMatchRunning=false の
                // 間は時計の interval が動かないため実時間は消費されない
                setIsMatchRunning(false);
                setIsPaused(true);
                updateClocksForNextTurn(turnAfterUndo, { undone });
                setMessage({ text: "エンジンの初期化に失敗しました。", type: "error" });
                return;
            }

            // 待った後の思考時間計測を新しく開始
            turnStartTimeRef.current = Date.now();
            // 秒読みをリセット（計算した手番で時計を更新・開始）
            updateClocksForNextTurn(turnAfterUndo, { undone });
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
        engineStatus,
        stopAllEngines,
        prepareEngines,
        isEngineTurn,
        logEngineError,
        isAnalyzing,
        analyzePosition,
        cancelAnalysis,
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
        onSearchComplete: recordSearchComplete,
        onLiveInfo: (side, event) => {
            // 対局停止後や fatal エラー後に flush された info が残留表示を再セットしないようにする
            if (!isMatchRunning || engineStatus[side] === "error") return;
            pushLiveInfo(side, event);
        },
        maxLogs,
        senteNnueSelection,
        goteNnueSelection,
        analysisNnueSelection: effectiveAnalysisNnueSelection,
        resolveNnue,
        allowAnalysisDuringMatch,
        engineThreads,
        engineSearchLimits,
        analysisEngineId,
    });
    stopAllEnginesRef.current = stopAllEngines;
    prepareEnginesRef.current = prepareEngines;

    // fatal なエンジンエラーは対局停止 (isMatchRunning=false) に遷移しないため、
    // error 状態を直接監視してライブ探索表示を消す
    useEffect(() => {
        if (engineStatus.sente !== "error" && engineStatus.gote !== "error") return;
        clearLiveSearchDisplay();
    }, [engineStatus.sente, engineStatus.gote, clearLiveSearchDisplay]);
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
        // 外部の USI エンジンは、変則ルールのパスを解釈できない。
        supportsPassRights: analysisEngineOption?.kind !== "external",
        materialFallback: analysisEngineOption?.kind !== "external",
        // エンジンが同時に動かせる数に収める（Desktop の内蔵エンジンは 1 つだけ）。
        workerCount: Math.min(
            resolveWorkerCount(analysisSettings.parallelWorkers),
            analysisEngineOption?.maxParallel ?? Number.POSITIVE_INFINITY,
        ),
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
        analysisNnueSelection: effectiveAnalysisNnueSelection,
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

    // 対局画面のヒント。解析のスレッド数は、対局の先後のうち多いほう（解析エンジンと同じ決め方）。
    const resolveThreads = (count: number) =>
        count > 0 ? count : detectParallelism().recommendedWorkers;
    const playHint = usePlayHintSearch({
        enabled: isPlayScreen,
        engineOption:
            engineOptions.find((option) => option.id === analysisEngineId) ?? engineOptions[0],
        threads: Math.max(resolveThreads(engineThreads.sente), resolveThreads(engineThreads.gote)),
        multiPv: hintMultiPv,
        nnueSelection: effectiveAnalysisNnueSelection,
        resolveNnue,
        startSfen,
        moves: moves.slice(0, navigation.state.currentPly),
        currentPly: navigation.state.currentPly,
        passRightsSettings,
        matchActive: isMatchRunning && !isPaused,
        recordEvalByPly,
        clearEvalByPly,
        fallback: { analyze: handleAnalyzeHintPly, cancel: cancelAnalysis, isAnalyzing },
    });

    // エンジンの手・パスの適用後の共通処理（盤や持ち駒からの人の手は useMoveExecution が適用する）
    const applyMoveAndUpdateState = (
        move: string,
        nextPosition: PositionState,
        lastMoveInfo: LastMove | undefined,
        source?: "human" | "engine",
    ) => {
        if (endIfFlaggedBeforeMove(positionRef.current.turn)) return;
        // サウンドフィードバック（positionRef はまだ指す前の局面）。
        // 探索結果は bestmove を返した時点の手数（= この手を足す前の moves.length）で onSearchComplete が記録し、
        // 下の navigation.addMove で棋譜に移すまで残っている。値はエンジン自身から見た評価値。
        playMoveSound(
            move,
            positionRef.current,
            nextPosition,
            source === "engine" ? "opponent" : "self",
            source === "engine" && isCpuLosing(getPendingSearchStats(moves.length)),
        );
        // 消費時間を計算
        const elapsedMs = Date.now() - turnStartTimeRef.current;
        // 棋譜ナビゲーションに手を追加（局面更新はonPositionChangeで自動実行）
        const ply = moves.length;
        const searchStats = source === "engine" ? getPendingSearchStats(ply) : undefined;
        navigation.addMove(move, nextPosition, { elapsedMs, searchStats });
        if (source === "engine") deletePendingSearchStats(ply);
        setLastMove(lastMoveInfo);
        setSelection(null);
        setMessage(null);
        clearLegalCache();
        // ターン開始時刻をリセット
        turnStartTimeRef.current = Date.now();
        updateClocksForNextTurn(nextPosition.turn, { moved: true });
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
        // 対局画面では、終局後だけ棋譜を送れる（設定中・一時停止中に局面を動かさせない）。
        disabled: isMatchRunning || (isPlayScreen && playPhase !== "finished"),
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
                const movesKey = buildLegalCacheKey(startSfen, moves, passRightsOption);
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

    const matchNnueDownload = useMatchNnueDownload({
        manifestUrl,
        resolveNnue,
        setMessage,
        // 対局画面では、ダウンロードを断っても知らせを出さない（自分でやめただけで、エラーではない）。
        silentOnDecline: isPlayScreen,
    });

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
        engineOptions,
        senteNnueSelection,
        goteNnueSelection,
        matchEndedRef,
        turnStartTimeRef,
        stopTicking,
        startTicking,
        resetClocks,
        stopAllEngines,
        prepareEngines,
        ensureMatchNnue: matchNnueDownload.ensureMatchNnue,
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
    // 持っていない駒（0 枚）を薄く出すのは、局面編集で駒台から駒を足すときだけ。それ以外では
    // 情報が無く、小さい盤では枚数の印が駒に重なって見づらいだけなので出さない。
    const hideEmptyHandPieces = gameMode !== "editing";

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
        isEditMode: editAllowed,
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
        if (!editAllowed) return;

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
        disabled: !editAllowed,
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
        if (!editAllowed) return;
        const sq = square as Square;
        setPiecePromotion(sq, !piece.promoted);
    };

    // 指し手実行管理フック
    const {
        handleSquareSelect,
        handlePromotionChoice,
        handleHandSelect,
        applyUsiMove,
        getLegalSet,
    } = useMoveExecution({
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
        endIfFlaggedBeforeMove,
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
        // 人の手は applyMoveAndUpdateState を通らないので、駒音はここで鳴らす。
        onHumanMoveApplied: (move, before, after) => playMoveSound(move, before, after, "self"),
    });

    // 選んでいる駒の影（マウスを乗せた行き先に出す）。局面編集中は選択の意味が違うので出さない
    const moveShadow = useMoveShadow({
        enabled: !isEditMode,
        selection,
        grid,
        turn: position.turn,
        positionKey: `${startSfen}|${moves.join(" ")}`,
        getLegalSet,
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

    // 棋譜読込で読んだ棋譜の対局者名を覚えておく（研究ノートにするときの表題に使う）。
    // 別の棋譜（KIF を含む）を読んだら忘れ、同じ棋譜のままかは開始局面と本譜の手順で見分ける。
    const { importSfenFromPanel, importKifFromPanel, playersFor } = useImportedKifuPlayers({
        importSfen,
        importKif,
    });

    // initialReview を取り込む。live 観戦では moves が逐次伸びた場合だけ importSfen で
    // 末尾まで再構築し、コメントだけが遅れて届いた場合は既存ノードへ差分適用する。
    useInitialReviewSync({
        positionReady,
        initialReview,
        navigation,
        importSfen,
    });

    useInitialAnalysisEntries({
        positionReady,
        initialAnalysisEntries,
        clearEvalByPly,
        recordEvalByPly,
    });

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
    const handlePreviewPv = (
        ply: number,
        pv: string[],
        evalCp?: number,
        evalMate?: number,
        startPosition?: PositionState,
    ) => {
        // PVはply手目を指した後の局面から計算されている
        // positionHistory[ply-1] = ply手目を指した後の局面（0 手目の局面は持たないので、呼び出し側が渡す）
        const startPos = startPosition ?? positionHistory[ply - 1];
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
    const isDraggingPiece = editAllowed && dndController.state.isDragging;
    // 棋譜を見るだけの画面（ビューア）は、盤を操作させない。局面の編集も、駒を動かして変化を
    // 作ることもできない（調べたいときは、研究ノートで開く）。
    // 対局画面も、設定中（局面編集を開いていないとき）と終局後は盤を操作させない
    // （駒を動かして調べるのは研究ノート）。
    const boardLockedInViewer =
        viewerMode || (isPlayScreen && (playPhase === "setup" || playPhase === "finished"));
    const internalEngineId = engineOptions[0]?.id ?? "wasm";

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
        engineSearchLimits,
        setEngineSearchLimits,
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
        moveShadow,
        promotionSelection,
        lastMove,
        moves,
        editFromSquare,
        flipBoard,
        displaySettings,
        setDisplaySettings,
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
        nnueAccount,
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
        handlePlySelect,
        handleCopyKif,
        handleMoveDetailSelect,
    };

    // Props グループ化: 盤面操作ハンドラー
    const boardHandlers: BoardHandlersProps = {
        hideEmptyHandPieces,
        getHandInfo,
        handleSquareSelect: boardLockedInViewer ? async () => {} : handleSquareSelect,
        handlePromotionChoice,
        handleHandSelect: boardLockedInViewer ? () => {} : handleHandSelect,
        applyUsiMove: boardLockedInViewer ? async () => false : applyUsiMove,
        handleHandPiecePointerDown,
        handlePiecePointerDown,
        handlePieceTogglePromote,
        handleIncrementHand: boardLockedInViewer ? () => {} : handleIncrementHand,
        handleDecrementHand: boardLockedInViewer ? () => {} : handleDecrementHand,
        handleResetToStartpos,
        pauseAutoPlay,
        resumeAutoPlay,
        handleStartReview,
        handleEnterEditMode,
        enterEditModeFromPaused,
        handleResign,
        handleUndo,
        setIsImportDialogOpen,
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
        isImportDialogOpen,
        importSfen: importSfenFromPanel,
        importKif: importKifFromPanel,
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
        reviewTopContent,
    };

    // 対局中に出す AI の読み。対局が止まった後や、その AI がエラーになった後は出さない。
    const visibleLiveSearch =
        isMatchRunning && liveSearchInfo && engineStatus[liveSearchInfo.side] !== "error"
            ? liveSearchInfo
            : null;

    // Props グループ化: Mobile専用
    const mobileSpecificProps: MobileSpecificProps = {
        searchInfo:
            !isPlayScreen && displaySettings.showSearchInfo && visibleLiveSearch ? (
                <SearchInfoPanel
                    side={visibleLiveSearch.side}
                    info={visibleLiveSearch.event}
                    isMobile
                />
            ) : null,
        isReviewMode,
        onOpenAbout: () => setIsAboutOpen(true),
        onImportSfen: importSfenFromPanel,
        onImportKif: importKifFromPanel,
    };

    // 研究ノートにできるのは、どの手も研究ノートに入れられる書式の棋譜（パスも入れられる）。指し手が無くても
    // （編集した局面だけでも）、その局面から検討を始めるノートにできる。ただし局面の編集中は、
    // 棋譜のツリーが編集前の局面のままなので、指し手の無い状態では出さない（確定してから）。
    const canOpenAsStudy =
        onOpenAsStudy !== undefined &&
        !isMatchRunning &&
        (!isEditMode || navigation.tree.nodes.size > 1) &&
        [...navigation.tree.nodes.values()].every(
            (node) => node.usiMove === null || isStudyUsiMove(node.usiMove),
        );
    const kifuImportExtra = canOpenAsStudy ? (
        <div className="flex flex-col gap-1 border-t border-border pt-3">
            <button
                type="button"
                className="w-full rounded-md border border-wafuu-border bg-wafuu-washi py-2 text-sm font-medium text-wafuu-sumi transition-colors hover:bg-wafuu-washi-warm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => {
                    onOpenAsStudy?.(navigation.tree, {
                        players: playersFor(startSfen, navigation.getMainLineMoves()),
                    });
                }}
            >
                {navigation.tree.nodes.size > 1
                    ? "この棋譜を研究ノートにする"
                    : "この局面を研究ノートにする"}
            </button>
            <p className="text-xs text-muted-foreground">
                {navigation.tree.nodes.size > 1
                    ? `いま開いている棋譜（${navigation.state.totalPly} 手）`
                    : "いまの局面"}
                を研究ノートにして、解析結果・変化・コメントを自動で保存します。
            </p>
        </div>
    ) : null;

    // 対局画面（screen="play"）の進行と操作
    const playConfig = usePlayScreen({
        isPlayScreen,
        playPhase,
        onPlayPhaseChange,
        playSetupFooter,
        liveSearch: visibleLiveSearch,
        message,
        setMessage,
        setSelection,
        setPromotionSelection,
        position,
        positionRef,
        positionReady,
        startSfen,
        moves,
        navigation,
        isMatchRunning,
        isPaused,
        setIsPaused,
        isEditMode,
        editAllowed,
        setPositionEditOpen,
        playStartPly,
        setPlayStartPly,
        gameResult,
        setGameResult,
        showResultDialog,
        setShowResultDialog,
        matchEndedRef,
        sides,
        engineOptions,
        senteNnueSelection,
        goteNnueSelection,
        presetConfigs,
        nnueList,
        playHint,
        hintMultiPv,
        setHintMultiPv,
        stopAllEngines,
        resumeAutoPlay,
        handleResetToStartpos,
        handleEnterEditMode,
        handleStartReview,
        applyEditedPosition,
        importSfen,
        onOpenAsStudy,
    });

    return (
        <ShogiMatchProvider
            config={{
                play: playConfig,
                kifuImportExtra,
                viewerMode,
                boardTopContent,
                mobileHeaderContent,
                mobileReviewActions,
                evalGraphPinned,
                aiIconUrl,
                soundVoiceSelectable: isCpuGame && Boolean(dogSoundBaseUrl),
                previewSound: (voice) =>
                    playSound("move_opponent", {
                        voice,
                        scene: "move",
                        fallbackWhileLoading: true,
                    }),
                presetIconUrls: Object.fromEntries(
                    presetConfigs.flatMap((preset) =>
                        preset.iconUrl ? [[preset.presetKey, preset.iconUrl]] : [],
                    ),
                ),
                aiPresetKeys: {
                    sente: engineOptions.some(
                        (engine) =>
                            engine.id === sides.sente.engineId && engine.kind === "external",
                    )
                        ? null
                        : senteNnueSelection.presetKey,
                    gote: engineOptions.some(
                        (engine) => engine.id === sides.gote.engineId && engine.kind === "external",
                    )
                        ? null
                        : goteNnueSelection.presetKey,
                },
            }}
        >
            <TooltipProvider delayDuration={TOOLTIP_DELAY_DURATION_MS}>
                <MatchNnueDownloadDialog state={matchNnueDownload} />
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
                {!isMobile &&
                    !isPlayScreen &&
                    displaySettings.showSearchInfo &&
                    visibleLiveSearch && (
                        <SearchInfoPanel
                            side={visibleLiveSearch.side}
                            info={visibleLiveSearch.event}
                            isMobile={isMobile}
                        />
                    )}
            </TooltipProvider>
        </ShogiMatchProvider>
    );
}
