import {
    applyMoveWithState,
    type BoardState,
    boardToMatrix,
    cloneBoard,
    createDefaultNnueSelection,
    createEmptyHands,
    DEFAULT_PRESET_KEY,
    type GameResult,
    getAllSquares,
    getPositionService,
    type LastMove,
    type NnueSelection,
    type PieceType,
    type Player,
    type PositionState,
    resolveWorkerCount,
    type Square,
} from "@shogi/app-core";
import type { ReactElement } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLazyNnueLoader } from "../hooks/useLazyNnueLoader";
import { useNnueStorage } from "../hooks/useNnueStorage";
import { usePresetManager } from "../hooks/usePresetManager";
import { AboutDialog } from "./AboutDialog";
import { EngineRestartingOverlay } from "./nnue/EngineRestartingOverlay";
import { NnueManagerDialog } from "./nnue/NnueManagerDialog";
import type { ShogiBoardCell } from "./shogi-board";
import { GameResultDialog } from "./shogi-match/components/GameResultDialog";
import type { KifuViewMode } from "./shogi-match/components/KifuPanel";
import { MoveDetailWindow } from "./shogi-match/components/MoveDetailWindow";
import type { PassDisabledReason } from "./shogi-match/components/PassButton";
import { PvPreviewDialog } from "./shogi-match/components/PvPreviewDialog";
import {
    AnalysisProvider,
    MatchSettingsProvider,
    MatchStateProvider,
    NavigationProvider,
} from "./shogi-match/contexts";
import { applyDropResult, DragGhost, type DropResult, usePieceDnd } from "./shogi-match/dnd";
import { useBatchAnalysis } from "./shogi-match/hooks/useBatchAnalysis";
import { type ClockSettings, useClockManager } from "./shogi-match/hooks/useClockManager";
import { useEditModeActions } from "./shogi-match/hooks/useEditModeActions";
import { useEngineManager } from "./shogi-match/hooks/useEngineManager";
import { useEnginePool } from "./shogi-match/hooks/useEnginePool";
import { useKifuImportExport } from "./shogi-match/hooks/useKifuImportExport";
import { useKifuKeyboardNavigation } from "./shogi-match/hooks/useKifuKeyboardNavigation";
import { useKifuNavigation } from "./shogi-match/hooks/useKifuNavigation";
import { useLocalStorage } from "./shogi-match/hooks/useLocalStorage";
import { useIsMobile } from "./shogi-match/hooks/useMediaQuery";
import { useMoveExecution } from "./shogi-match/hooks/useMoveExecution";
import { MobileLayout } from "./shogi-match/layouts/MobileLayout";
import { PCLayout } from "./shogi-match/layouts/PCLayout";
import { ShogiMatchProvider } from "./shogi-match/ShogiMatchContext";
import {
    type AnalysisSettings,
    DEFAULT_ANALYSIS_SETTINGS,
    DEFAULT_DISPLAY_SETTINGS,
    DEFAULT_PASS_RIGHTS_SETTINGS,
    type DisplaySettings,
    type EngineOption,
    type GameMode,
    type Message,
    type PassRightsSettings,
    type PromotionSelection,
    type SideSetting,
} from "./shogi-match/types";
import { cloneHandsState } from "./shogi-match/utils/boardUtils";
import type { KifMove } from "./shogi-match/utils/kifFormat";
import { LegalMoveCache } from "./shogi-match/utils/legalMoveCache";
import {
    buildPassRightsOptionForLegalMoves,
    isSamePassRightsSettings,
    normalizePassRightsSettings,
} from "./shogi-match/utils/passRightsSettings";
import { isSameTimeSettings, normalizeTimeSettings } from "./shogi-match/utils/timeSettings";
import { TooltipProvider } from "./tooltip";

type Selection = { kind: "square"; square: string } | { kind: "hand"; piece: PieceType };

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
    /** NNUE プリセット manifest.json の URL（指定時のみプリセット機能が有効） */
    manifestUrl?: string;
    /** Desktop 用: NNUE ファイル選択ダイアログを開いてパスを取得するコールバック */
    onRequestNnueFilePath?: () => Promise<string | null>;
    /** デフォルトの NNUE プリセットキー（未指定時は DEFAULT_PRESET_KEY） */
    defaultNnuePresetKey?: string;
    /** AIアイコンのURL（GitHub Pages等でbase pathが必要な場合に指定） */
    aiIconUrl?: string;
}

// デフォルト値の定数
const DEFAULT_BYOYOMI_MS = 5_000; // デフォルト秒読み時間（5秒）
const DEFAULT_MAX_LOGS = 80; // ログ履歴の最大保持件数
const TOOLTIP_DELAY_DURATION_MS = 120; // ツールチップ表示遅延

// レイアウト用Tailwindクラス（CSS変数はクラスで設定）
const matchLayoutClasses =
    "flex flex-col gap-2 items-center py-2 [--kifu-panel-max-h:min(60vh,calc(100dvh-320px))] [--kifu-panel-branch-max-h:calc(var(--kifu-panel-max-h)-40px)] [--shogi-cell-size:44px]";

const clonePositionState = (pos: PositionState): PositionState => ({
    board: cloneBoard(pos.board),
    hands: cloneHandsState(pos.hands),
    turn: pos.turn,
    ply: pos.ply,
    passRights: pos.passRights
        ? { sente: pos.passRights.sente, gote: pos.passRights.gote }
        : undefined,
});

function boardToGrid(board: BoardState): ShogiBoardCell[][] {
    const matrix = boardToMatrix(board);
    return matrix.map((row) =>
        row.map((cell) => ({
            id: cell.square,
            piece: cell.piece
                ? {
                      owner: cell.piece.owner,
                      type: cell.piece.type,
                      promoted: cell.piece.promoted,
                  }
                : null,
        })),
    );
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
    defaultNnuePresetKey,
    aiIconUrl,
}: ShogiMatchProps): ReactElement {
    // デフォルトの NNUE 選択（props のプリセットキーを使用、未指定時は DEFAULT_PRESET_KEY）
    const defaultNnueSelection = useMemo(
        () => createDefaultNnueSelection(defaultNnuePresetKey ?? DEFAULT_PRESET_KEY),
        [defaultNnuePresetKey],
    );
    const emptyBoard = useMemo<BoardState>(
        () => Object.fromEntries(getAllSquares().map((sq) => [sq, null])) as BoardState,
        [],
    );
    const [sides, setSides] = useLocalStorage<{ sente: SideSetting; gote: SideSetting }>(
        "shogi-match-sides",
        defaultSides,
    );
    const [position, setPosition] = useState<PositionState>({
        board: emptyBoard,
        hands: createEmptyHands(),
        turn: "sente",
        ply: 1,
    });
    const [, setInitialBoard] = useState<BoardState | null>(null);
    const [positionReady, setPositionReady] = useState(false);
    const [lastMove, setLastMove] = useState<LastMove | undefined>(undefined);
    const [selection, setSelection] = useState<Selection | null>(null);
    const [promotionSelection, setPromotionSelection] = useState<PromotionSelection | null>(null);
    const [message, setMessage] = useState<Message | null>(null);
    const [gameResult, setGameResult] = useState<GameResult | null>(null);
    const [showResultDialog, setShowResultDialog] = useState(false);
    const [flipBoard, setFlipBoard] = useState(false);
    const defaultTimeSettings = useMemo(
        () => ({
            sente: { mainMs: initialMainTimeMs, byoyomiMs: initialByoyomiMs },
            gote: { mainMs: initialMainTimeMs, byoyomiMs: initialByoyomiMs },
        }),
        [initialMainTimeMs, initialByoyomiMs],
    );
    const [timeSettings, setTimeSettings] = useLocalStorage<ClockSettings>(
        "shogi-match-time-settings",
        defaultTimeSettings,
    );
    useEffect(() => {
        const normalized = normalizeTimeSettings(timeSettings, defaultTimeSettings);
        if (!isSameTimeSettings(normalized, timeSettings)) {
            setTimeSettings(normalized);
        }
    }, [defaultTimeSettings, setTimeSettings, timeSettings]);
    const [isMatchRunning, setIsMatchRunning] = useState(false);
    const [isEditMode, setIsEditMode] = useState(true);
    const [isPaused, setIsPaused] = useState(false);
    // モバイル判定
    const isMobile = useIsMobile();
    // 検討モード: 編集モードでも対局中でも一時停止中でもない状態
    // 自由に棋譜を閲覧し、分岐を作成できる
    const isReviewMode = !isEditMode && !isMatchRunning && !isPaused;
    const [editOwner, setEditOwner] = useState<Player>("sente");
    const [editPieceType, setEditPieceType] = useState<PieceType | null>(null);
    const [editPromoted, setEditPromoted] = useState(false);
    const [editFromSquare, setEditFromSquare] = useState<Square | null>(null);
    const [editTool, setEditTool] = useState<"place" | "erase">("place");
    const [startSfen, setStartSfen] = useState<string>("startpos");
    // TODO: 将来的に局面編集機能の強化で使用予定
    const [_basePosition, setBasePosition] = useState<PositionState | null>(null);
    const [displaySettings, setDisplaySettings] = useLocalStorage<DisplaySettings>(
        "shogi-display-settings",
        DEFAULT_DISPLAY_SETTINGS,
    );
    // 解析設定（古いlocalStorageデータとの互換性のためデフォルト値とマージ）
    const [storedAnalysisSettings, setAnalysisSettings] = useLocalStorage<AnalysisSettings>(
        "shogi-analysis-settings",
        DEFAULT_ANALYSIS_SETTINGS,
    );
    const analysisSettings = useMemo(() => {
        return { ...DEFAULT_ANALYSIS_SETTINGS, ...storedAnalysisSettings };
    }, [storedAnalysisSettings]);
    // パス権設定
    const [storedPassRightsSettings, setPassRightsSettings] = useLocalStorage<PassRightsSettings>(
        "shogi-pass-rights-settings",
        DEFAULT_PASS_RIGHTS_SETTINGS,
    );
    const passRightsSettings = useMemo(
        () => normalizePassRightsSettings(storedPassRightsSettings, DEFAULT_PASS_RIGHTS_SETTINGS),
        [storedPassRightsSettings],
    );
    useEffect(() => {
        if (!isSamePassRightsSettings(passRightsSettings, storedPassRightsSettings)) {
            setPassRightsSettings(passRightsSettings);
        }
    }, [passRightsSettings, setPassRightsSettings, storedPassRightsSettings]);
    // PVプレビュー用のstate
    const [pvPreview, setPvPreview] = useState<{
        open: boolean;
        ply: number;
        pv: string[];
        startPosition: PositionState;
        evalCp?: number;
        evalMate?: number;
    } | null>(null);
    // 一括解析の状態（useEnginePoolとuseBatchAnalysisで共有）
    const [batchAnalysis, setBatchAnalysis] = useState<{
        isRunning: boolean;
        currentIndex: number;
        totalCount: number;
        targetPlies: number[];
        inProgress?: number[]; // 並列解析中の手番号
    } | null>(null);
    // 最後に追加された分岐の情報（KifuPanelが直接その分岐ビューに遷移するため）
    // nodeIdではなくply+firstMoveを使用（StrictModeでnodeIdが不整合になる問題を回避）
    const [lastAddedBranchInfo, setLastAddedBranchInfo] = useState<{
        ply: number;
        firstMove: string;
    } | null>(null);
    // 選択中の分岐ノードID（キーボードナビゲーション用）
    const [selectedBranchNodeId, setSelectedBranchNodeId] = useState<string | null>(null);
    // 棋譜パネルの表示モード（評価値グラフ切り替え用）
    const [kifuViewMode, setKifuViewMode] = useState<KifuViewMode>("main");
    // 選択中の手の詳細（右パネル表示用）- plyで管理し、最新のmoveは都度取得
    const [selectedMoveDetailPly, setSelectedMoveDetailPly] = useState<{
        ply: number;
        position: PositionState;
    } | null>(null);
    // 設定モーダルの表示状態
    const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);

    // NNUE 管理ダイアログの状態
    const [isNnueManagerOpen, setIsNnueManagerOpen] = useState(false);
    // NNUE 管理ダイアログを開いた理由（未ダウンロードエラー時など）
    const [nnueManagerOpenReason, setNnueManagerOpenReason] = useState<string | null>(null);

    // 表示設定ダイアログの状態
    const [isDisplaySettingsOpen, setIsDisplaySettingsOpen] = useState(false);

    // About（ライセンス）ダイアログの状態
    const [isAboutOpen, setIsAboutOpen] = useState(false);

    // パス権設定ダイアログの状態
    const [isPassRightsSettingsOpen, setIsPassRightsSettingsOpen] = useState(false);

    // 対局用 NNUE 選択
    const [senteNnueSelection, setSenteNnueSelection] = useLocalStorage<NnueSelection>(
        "shogi:senteNnueSelection",
        defaultNnueSelection,
    );
    const [goteNnueSelection, setGoteNnueSelection] = useLocalStorage<NnueSelection>(
        "shogi:goteNnueSelection",
        defaultNnueSelection,
    );
    // 分析用 NNUE 選択
    const [analysisNnueSelection, setAnalysisNnueSelection] = useLocalStorage<NnueSelection>(
        "shogi:analysisNnueSelection",
        defaultNnueSelection,
    );

    // 旧キーからのマイグレーション
    useEffect(() => {
        if (typeof window === "undefined") return;

        // 旧 senteNnueId からの移行
        const oldSenteKey = "shogi:senteNnueId";
        const oldSenteStored = localStorage.getItem(oldSenteKey);
        if (oldSenteStored !== null) {
            try {
                const parsed = JSON.parse(oldSenteStored) as string | null;
                if (parsed) {
                    const newSelection = { presetKey: null, nnueId: parsed };
                    setSenteNnueSelection(newSelection);
                    void restartEngineForNnueRef.current?.("sente", newSelection);
                }
            } catch (error) {
                console.warn(`Failed to parse localStorage key "${oldSenteKey}":`, error);
            } finally {
                localStorage.removeItem(oldSenteKey);
            }
        }

        // 旧 goteNnueId からの移行
        const oldGoteKey = "shogi:goteNnueId";
        const oldGoteStored = localStorage.getItem(oldGoteKey);
        if (oldGoteStored !== null) {
            try {
                const parsed = JSON.parse(oldGoteStored) as string | null;
                if (parsed) {
                    const newSelection = { presetKey: null, nnueId: parsed };
                    setGoteNnueSelection(newSelection);
                    void restartEngineForNnueRef.current?.("gote", newSelection);
                }
            } catch (error) {
                console.warn(`Failed to parse localStorage key "${oldGoteKey}":`, error);
            } finally {
                localStorage.removeItem(oldGoteKey);
            }
        }

        // 旧 analysisNnueId からの移行
        const oldAnalysisKey = "shogi:analysisNnueId";
        const oldAnalysisStored = localStorage.getItem(oldAnalysisKey);
        if (oldAnalysisStored !== null) {
            try {
                const parsed = JSON.parse(oldAnalysisStored) as string | null;
                if (parsed) {
                    setAnalysisNnueSelection({ presetKey: null, nnueId: parsed });
                }
            } catch (error) {
                console.warn(`Failed to parse localStorage key "${oldAnalysisKey}":`, error);
            } finally {
                localStorage.removeItem(oldAnalysisKey);
            }
        }

        // さらに古い matchNnueId からの移行
        const legacyKey = "shogi:matchNnueId";
        const legacyStored = localStorage.getItem(legacyKey);
        if (legacyStored !== null) {
            try {
                const parsed = JSON.parse(legacyStored) as string | null;
                if (parsed) {
                    setSenteNnueSelection({ presetKey: null, nnueId: parsed });
                    setGoteNnueSelection({ presetKey: null, nnueId: parsed });
                }
            } catch (error) {
                console.warn(`Failed to parse localStorage key "${legacyKey}":`, error);
            } finally {
                localStorage.removeItem(legacyKey);
            }
        }
    }, [setSenteNnueSelection, setGoteNnueSelection, setAnalysisNnueSelection]);

    // NNUE ストレージから一覧を取得
    const {
        nnueList,
        isLoading: isNnueListLoading,
        refreshList: refreshNnueList,
    } = useNnueStorage();

    // プリセット一覧を取得
    const { presets, isLoading: isPresetsLoading } = usePresetManager({
        manifestUrl,
        autoFetch: true,
        onDownloadComplete: () => {
            // ダウンロード完了時にストレージを更新
            void refreshNnueList();
        },
    });

    // presetKey から displayName を取得する関数
    const getPresetDisplayName = useCallback(
        (presetKey: string): string | undefined => {
            const preset = presets.find((p) => p.config.presetKey === presetKey);
            return preset?.config.displayName;
        },
        [presets],
    );

    // NNUE 解決フック（未ダウンロードのプリセットはエラーをスロー）
    const { resolveNnue } = useLazyNnueLoader({ getPresetDisplayName });

    // 選択された NNUE（カスタムの場合）が削除された場合はデフォルトにリセット
    // プリセット選択の場合は削除チェック不要（未ダウンロードでも選択可能）
    // isLoading 中はリストが空でも待機（初期ロード完了後に判定）
    useEffect(() => {
        if (!isNnueListLoading) {
            // カスタム NNUE（presetKey が null）で nnueId が設定されている場合のみチェック
            if (
                senteNnueSelection.presetKey === null &&
                senteNnueSelection.nnueId &&
                !nnueList.some((n) => n.id === senteNnueSelection.nnueId)
            ) {
                setSenteNnueSelection(defaultNnueSelection);
                void restartEngineForNnueRef.current?.("sente", defaultNnueSelection);
            }
            if (
                goteNnueSelection.presetKey === null &&
                goteNnueSelection.nnueId &&
                !nnueList.some((n) => n.id === goteNnueSelection.nnueId)
            ) {
                setGoteNnueSelection(defaultNnueSelection);
                void restartEngineForNnueRef.current?.("gote", defaultNnueSelection);
            }
            if (
                analysisNnueSelection.presetKey === null &&
                analysisNnueSelection.nnueId &&
                !nnueList.some((n) => n.id === analysisNnueSelection.nnueId)
            ) {
                setAnalysisNnueSelection(defaultNnueSelection);
            }
        }
    }, [
        senteNnueSelection,
        goteNnueSelection,
        analysisNnueSelection,
        nnueList,
        isNnueListLoading,
        setSenteNnueSelection,
        setGoteNnueSelection,
        setAnalysisNnueSelection,
        defaultNnueSelection,
    ]);

    // manifestUrl 未指定でプリセット選択中の場合のフォールバック
    // ただし、nnueList に該当プリセットがダウンロード済みで存在する場合はリセットしない
    useEffect(() => {
        // manifestUrl が指定されている場合は処理不要
        if (manifestUrl) return;
        // nnueList 読み込み中は待機
        if (isNnueListLoading) return;

        const shouldReset = (presetKey: string | null): boolean => {
            if (!presetKey) return false;
            // nnueList に該当プリセットがダウンロード済みで存在するかチェック
            const existsInList = nnueList.some(
                (n) => n.source === "preset" && n.presetKey === presetKey,
            );
            // 存在しない場合のみリセット対象
            return !existsInList;
        };

        if (shouldReset(analysisNnueSelection.presetKey)) {
            setAnalysisNnueSelection({ presetKey: null, nnueId: null });
        }
        if (shouldReset(senteNnueSelection.presetKey)) {
            const newSelection = { presetKey: null, nnueId: null };
            setSenteNnueSelection(newSelection);
            void restartEngineForNnueRef.current?.("sente", newSelection);
        }
        if (shouldReset(goteNnueSelection.presetKey)) {
            const newSelection = { presetKey: null, nnueId: null };
            setGoteNnueSelection(newSelection);
            void restartEngineForNnueRef.current?.("gote", newSelection);
        }
    }, [
        manifestUrl,
        isNnueListLoading,
        nnueList,
        analysisNnueSelection.presetKey,
        senteNnueSelection.presetKey,
        goteNnueSelection.presetKey,
        setAnalysisNnueSelection,
        setSenteNnueSelection,
        setGoteNnueSelection,
    ]);

    // 選択中の presetKey がマニフェストに存在しない場合のバリデーション
    // - presets が存在すれば先頭のプリセットにフォールバック
    // - presets が空なら駒得にフォールバック
    // ※ manifestUrl 未指定時は別の useEffect で nnueList ベースの処理を行うためスキップ
    useEffect(() => {
        // manifestUrl 未指定の場合は別の useEffect で処理するためスキップ
        if (!manifestUrl) return;
        // プリセット読み込み中は待機
        if (isPresetsLoading) return;

        const validateAndFix = (
            selection: NnueSelection,
            setSelection: (s: NnueSelection) => void,
        ): NnueSelection | null => {
            // presetKey が設定されていない場合はバリデーション不要
            if (!selection.presetKey) return null;

            // presets が空の場合は駒得にフォールバック
            if (presets.length === 0) {
                const newSelection = { presetKey: null, nnueId: null };
                setSelection(newSelection);
                return newSelection;
            }

            // presetKey が presets に存在するかチェック
            const exists = presets.some((p) => p.config.presetKey === selection.presetKey);
            if (!exists) {
                // 先頭のプリセットにフォールバック
                const newSelection = { presetKey: presets[0].config.presetKey, nnueId: null };
                setSelection(newSelection);
                return newSelection;
            }
            return null;
        };

        const newSenteSelection = validateAndFix(senteNnueSelection, setSenteNnueSelection);
        const newGoteSelection = validateAndFix(goteNnueSelection, setGoteNnueSelection);
        validateAndFix(analysisNnueSelection, setAnalysisNnueSelection);

        // 選択が変更された場合、対局用エンジンを再起動
        if (newSenteSelection) {
            restartEngineForNnueRef.current?.("sente", newSenteSelection);
        }
        if (newGoteSelection) {
            restartEngineForNnueRef.current?.("gote", newGoteSelection);
        }
    }, [
        manifestUrl,
        isPresetsLoading,
        presets,
        senteNnueSelection,
        goteNnueSelection,
        analysisNnueSelection,
        setSenteNnueSelection,
        setGoteNnueSelection,
        setAnalysisNnueSelection,
    ]);

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
    }, [analysisNnueSelection]);

    // 分析用 NNUE ID の導出（子コンポーネント用）
    // preset 選択時は nnueList からダウンロード済みの NNUE を探す
    const analysisNnueId = useMemo(() => {
        if (analysisNnueSelection.nnueId) {
            return analysisNnueSelection.nnueId;
        }
        if (analysisNnueSelection.presetKey) {
            const presetNnue = nnueList.find(
                (n) => n.source === "preset" && n.presetKey === analysisNnueSelection.presetKey,
            );
            return presetNnue?.id ?? null;
        }
        return null;
    }, [analysisNnueSelection, nnueList]);

    // プリセット設定のみを抽出（UIコンポーネント用）
    const presetConfigs = useMemo(() => presets.map((p) => p.config), [presets]);

    // positionRef を先に定義（コールバックで使用するため）
    const positionRef = useRef<PositionState>(position);
    // 編集操作のバージョンカウンター（非同期SFEN計算の競合状態を防止）
    const editVersionRef = useRef(0);

    // ナビゲーションからの局面変更コールバック（メモ化して安定した参照を維持）
    const handleNavigationPositionChange = useCallback(
        (newPosition: PositionState, lastMoveInfo?: { from?: string; to: string }) => {
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
        },
        [],
    );

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
    const displayEvalHistory = useMemo(() => {
        // "main" モード時は本譜の評価値を表示
        // "branches" や "selectedBranch" モード時は現在の経路（分岐含む）の評価値を表示
        return kifuViewMode === "main" ? mainLineEvalHistory : evalHistory;
    }, [kifuViewMode, mainLineEvalHistory, evalHistory]);

    // 選択中の手の詳細を最新のkifMovesから取得
    const selectedMoveDetail = useMemo(() => {
        if (!selectedMoveDetailPly) return null;
        const move = kifMoves.find((m) => m.ply === selectedMoveDetailPly.ply);
        if (!move) return null;
        return { move, position: selectedMoveDetailPly.position };
    }, [selectedMoveDetailPly, kifMoves]);

    // 後手が人間の場合は盤面を反転して手前側に表示
    useEffect(() => {
        const goteIsHuman = sides.gote.role === "human";
        const senteIsHuman = sides.sente.role === "human";
        // 後手のみ人間、または両方人間で後手優先の場合は反転
        // （後手が人間かつ先手がエンジンの場合に反転）
        setFlipBoard(goteIsHuman && !senteIsHuman);
    }, [sides.sente.role, sides.gote.role]);

    // 持ち駒表示用のヘルパー関数（メモ化してMobileBoardSectionの再レンダリングを防ぐ）
    const getHandInfo = useCallback(
        (pos: "top" | "bottom") => {
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
                isAI: sides[owner].role === "engine",
            };
        },
        [flipBoard, isReviewMode, isEditMode, position.turn, position.hands, sides],
    );

    const legalCache = useMemo(() => new LegalMoveCache(), []);
    const [canPassLegal, setCanPassLegal] = useState(false);
    const clearLegalCache = useCallback(() => {
        legalCache.clear();
        setCanPassLegal(false);
    }, [legalCache]);
    const ensurePassRightsInitialized = useCallback(() => {
        if (!passRightsSettings?.enabled) return null;
        if (positionRef.current.passRights) return positionRef.current.passRights;
        const rights = {
            sente: passRightsSettings.senteInitialCount,
            gote: passRightsSettings.goteInitialCount,
        };
        const updated = { ...positionRef.current, passRights: rights };
        setPosition(updated);
        positionRef.current = updated;
        return rights;
    }, [passRightsSettings]);
    // 合法手取得用のパス権オプションを返す
    // build_position（Rust側）はパス権を設定してからmovesを適用するため、
    // 現在のパス権ではなく初期パス権を渡す必要がある（二重消費を防ぐため）
    const getPassRightsOption = useCallback(() => {
        return buildPassRightsOptionForLegalMoves(passRightsSettings, moves);
    }, [passRightsSettings, moves]);
    // ナビゲーションで局面が変わったらキャッシュをクリア
    useEffect(() => {
        clearLegalCache();
    }, [clearLegalCache]);
    // パス権設定変更時にキャッシュもクリアするラッパー
    // （合法手にpassが含まれるかどうかが変わるため）
    const handlePassRightsSettingsChange = useCallback(
        (newSettings: PassRightsSettings) => {
            setPassRightsSettings(newSettings);
            clearLegalCache();
        },
        [setPassRightsSettings, clearLegalCache],
    );

    const hasPassRights = position.passRights && position.passRights[position.turn] > 0;
    // パス合法可否が計算済みか
    const passLegalKnown = legalCache.isCached(moves.length);
    // パス可能かどうかの判定（合法手キャッシュに"pass"が含まれるかでのみ判定）
    // 判定前は楽観的に true とし、実際の適用時に再チェックする
    const canMakePassMove =
        isMatchRunning &&
        sides[position.turn].role === "human" &&
        !!hasPassRights &&
        (passLegalKnown ? canPassLegal : true);
    // ボタン表示可否（対局中でパス機能が有効な場合に表示）
    // パス権が0でも表示（レイアウトシフト防止）。非活性理由はdisabledReasonで管理。
    const shouldRenderPassButton =
        isMatchRunning &&
        passRightsSettings?.enabled &&
        (passRightsSettings.senteInitialCount > 0 || passRightsSettings.goteInitialCount > 0) &&
        !!position.passRights;

    // パス権が有効なら不足時に初期化しておく（編集開始局面などでpassRightsが未設定な場合に備える）
    useEffect(() => {
        if (!passRightsSettings?.enabled) return;
        ensurePassRightsInitialized();
    }, [ensurePassRightsInitialized, passRightsSettings?.enabled]);
    const passButtonDisabledReason: PassDisabledReason | undefined = (() => {
        if (!isMatchRunning) return "match-not-running";
        if (sides[position.turn].role !== "human") return "not-your-turn";
        if (!hasPassRights) return "no-rights";
        if (passLegalKnown && !canPassLegal) return "in-check";
        return undefined;
    })();

    const matchEndedRef = useRef(false);
    const boardSectionRef = useRef<HTMLDivElement>(null);
    const settingsLocked = isMatchRunning;
    // 現在のターン開始時刻（消費時間計算用）
    const turnStartTimeRef = useRef<number>(Date.now());

    // endMatch のための ref（循環依存を回避）
    const endMatchRef = useRef<((result: GameResult) => Promise<void>) | null>(null);

    const handleClockError = useCallback((text: string) => {
        setMessage({ text, type: "error" });
    }, []);

    const stopAllEnginesRef = useRef<() => Promise<void>>(async () => {});
    // NNUE再起動用のref（useEffectからアクセスするため）
    const restartEngineForNnueRef = useRef<
        ((side: Player, selection?: NnueSelection) => Promise<void>) | null
    >(null);

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

    const getRemainingTimeMs = useCallback(
        (side: Player) => {
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
        },
        [clocksRef],
    );
    const shouldShowPassConfirm =
        passButtonDisabledReason === undefined &&
        getRemainingTimeMs(position.turn) <
            (passRightsSettings?.confirmDialogThresholdMs ?? Infinity);

    // 対局前に timeSettings が変更されたら clocks を同期
    // （resetClocks は timeSettings に依存しているため、resetClocks の変更で検知可能）
    useEffect(() => {
        if (!isMatchRunning) {
            resetClocks(false);
        }
    }, [isMatchRunning, resetClocks]);

    // 対局終了処理（エンジン管理フックから呼ばれる）
    const endMatch = useCallback(
        async (result: GameResult) => {
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
        },
        [stopTicking],
    );

    // endMatchRef を更新
    endMatchRef.current = endMatch;

    // 投了処理
    const handleResign = useCallback(async () => {
        const currentTurn = positionRef.current.turn;
        const result: GameResult = {
            winner: currentTurn === "sente" ? "gote" : "sente",
            reason: { kind: "resignation", loser: currentTurn },
            totalMoves: moves.length,
        };
        await endMatch(result);
    }, [endMatch, moves.length]);

    // 手の処理中フラグ（待った・パス等の連打・競合防止用）
    const moveProcessingRef = useRef(false);

    // 待った処理（2手戻す：相手の手と自分の前の手を戻す）
    const handleUndo = useCallback(async () => {
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
    }, [navigation, stopTicking, updateClocksForNextTurn, moves.length]);

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
    });
    stopAllEnginesRef.current = stopAllEngines;
    restartEngineForNnueRef.current = restartEngineForNnue;

    // role変更時にエンジンを破棄するラッパー
    const handleSidesChange = useCallback(
        (newSides: { sente: SideSetting; gote: SideSetting }) => {
            // role が engine から human に変わった場合はエンジンを破棄
            for (const side of ["sente", "gote"] as const) {
                if (sides[side].role === "engine" && newSides[side].role !== "engine") {
                    void disposeEngine(side);
                }
            }
            setSides(newSides);
        },
        [disposeEngine, setSides, sides],
    );

    // NNUE選択変更時にエンジンを再起動するラッパー
    const handleSenteNnueSelectionChange = useCallback(
        (newSelection: NnueSelection) => {
            setSenteNnueSelection(newSelection);
            // 新しいselectionを明示的に渡す（state更新前に参照されるのを防ぐ）
            void restartEngineForNnue("sente", newSelection);
        },
        [restartEngineForNnue, setSenteNnueSelection],
    );

    const handleGoteNnueSelectionChange = useCallback(
        (newSelection: NnueSelection) => {
            setGoteNnueSelection(newSelection);
            // 新しいselectionを明示的に渡す（state更新前に参照されるのを防ぐ）
            void restartEngineForNnue("gote", newSelection);
        },
        [restartEngineForNnue, setGoteNnueSelection],
    );

    // 並列一括解析用のエンジンプール
    const engineOpt = engineOptions[0]; // デフォルトのエンジンオプションを使用
    const enginePool = useEnginePool({
        createClient:
            engineOpt?.createClient ??
            (() => {
                throw new Error("No engine available");
            }),
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
        openNnueManager: (reason) => {
            setNnueManagerOpenReason(reason);
            setIsNnueManagerOpen(true);
        },
        setMessage,
        batchAnalysis,
        setBatchAnalysis,
    });

    // handleEvalUpdate を ref に設定（useEngineManager で使用）
    handleEvalUpdateRef.current = handleEvalUpdate;

    // キーボード・ホイールナビゲーション用のgoForward（分岐対応）
    const handleKeyboardForward = useCallback(() => {
        navigation.goForward(selectedBranchNodeId ?? undefined);
    }, [navigation, selectedBranchNodeId]);

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
    const handleMoveFromEngine = useCallback(
        (move: string) => {
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
            // 消費時間を計算
            const elapsedMs = Date.now() - turnStartTimeRef.current;
            // 棋譜ナビゲーションに手を追加（局面更新はonPositionChangeで自動実行）
            navigation.addMove(move, result.next, { elapsedMs });
            setLastMove(result.lastMove);
            setSelection(null);
            setMessage(null);
            clearLegalCache();
            // ターン開始時刻をリセット
            turnStartTimeRef.current = Date.now();
            updateClocksForNextTurn(result.next.turn);
        },
        [clearLegalCache, logEngineError, navigation, sides, updateClocksForNextTurn],
    );
    handleMoveFromEngineRef.current = handleMoveFromEngine;

    // パス手を処理するコールバック
    // 人間・エンジン両方のパス手で使用される
    const handlePassMove = useCallback(async () => {
        // 処理中なら無視（待ったとの競合防止）
        if (moveProcessingRef.current) return;
        if (matchEndedRef.current) return;
        if (!passRightsSettings?.enabled) return;
        const rights = positionRef.current.passRights ?? ensurePassRightsInitialized();
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
                const passRightsOption = getPassRightsOption();
                const resolver = fetchLegalMoves
                    ? () => fetchLegalMoves(startSfen, moves, passRightsOption)
                    : () => getPositionService().getLegalMoves(startSfen, moves, passRightsOption);
                const ply = moves.length;
                let legal = await legalCache.getOrResolve(ply, resolver);
                if (!legal || !legal.has("pass")) {
                    // パス権ありでも合法手に含まれない場合はキャッシュをクリアして再取得（パス権オプション漏れ対策）
                    clearLegalCache();
                    legal = await legalCache.getOrResolve(ply, resolver);
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

            // 消費時間を計算
            const elapsedMs = Date.now() - turnStartTimeRef.current;
            // 棋譜ナビゲーションに手を追加（局面更新はonPositionChangeで自動実行）
            navigation.addMove("pass", result.next, { elapsedMs });
            setLastMove(result.lastMove);
            setSelection(null);
            setMessage(null);
            clearLegalCache();

            // ターン開始時刻をリセット
            turnStartTimeRef.current = Date.now();
            updateClocksForNextTurn(result.next.turn);
        } finally {
            moveProcessingRef.current = false;
        }
    }, [
        fetchLegalMoves,
        clearLegalCache,
        getPassRightsOption,
        legalCache,
        ensurePassRightsInitialized,
        navigation,
        passRightsSettings,
        startSfen,
        updateClocksForNextTurn,
        moves,
    ]);

    useEffect(() => {
        let cancelled = false;
        const service = getPositionService();

        const init = async () => {
            try {
                const pos = await service.getInitialBoard();
                if (cancelled) return;
                setPosition(pos);
                positionRef.current = pos;
                setInitialBoard(cloneBoard(pos.board));
                setBasePosition(clonePositionState(pos));
                let sfen = "startpos";
                try {
                    sfen = await service.boardToSfen(pos);
                    if (!cancelled) {
                        setStartSfen(sfen);
                    }
                } catch (error) {
                    if (!cancelled) {
                        setMessage({
                            text: `局面のSFEN変換に失敗しました: ${String(error)}`,
                            type: "error",
                        });
                    }
                }
                // 棋譜ナビゲーションを正しい初期局面でリセット
                if (!cancelled) {
                    navigationResetRef.current(pos, sfen);
                    setPositionReady(true);
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
    }, []);

    const grid = useMemo(() => {
        const g = boardToGrid(position.board);
        return flipBoard ? [...g].reverse().map((row) => [...row].reverse()) : g;
    }, [position.board, flipBoard]);

    const refreshStartSfen = useCallback(async (pos: PositionState): Promise<string> => {
        try {
            const sfen = await getPositionService().boardToSfen(pos);
            setStartSfen(sfen);
            return sfen;
        } catch (error) {
            setMessage({ text: `局面のSFEN変換に失敗しました: ${String(error)}`, type: "error" });
            throw error;
        }
    }, []);

    const pauseAutoPlay = async () => {
        setIsMatchRunning(false);
        setIsPaused(true); // 一時停止モードに（棋譜を保持）
        stopTicking();
        await stopAllEngines();
    };

    /** 一時停止中から編集モードに移行 */
    const enterEditModeFromPaused = () => {
        setIsPaused(false);
        setIsEditMode(true);
    };

    const resumeAutoPlay = async () => {
        matchEndedRef.current = false;
        if (!positionReady) return;

        // 一時停止からの再開：棋譜を保持したまま再開
        if (isPaused) {
            setIsPaused(false);
            setIsMatchRunning(true);
            turnStartTimeRef.current = Date.now();
            startTicking(position.turn);
            return;
        }

        // 編集モードからの再開：棋譜をリセットして新しい対局を開始
        if (isEditMode) {
            await finalizeEditedPosition();
            // 対局開始時に編集モードを終了
            setIsEditMode(false);
        }

        // パス権が有効な場合、対局開始時に初期化
        // ナビゲーションのルートノードにもパス権を反映するため、navigation.resetを呼び直す
        if (passRightsSettings?.enabled && !positionRef.current.passRights) {
            const updatedPosition = {
                ...positionRef.current,
                passRights: {
                    sente: passRightsSettings.senteInitialCount,
                    gote: passRightsSettings.goteInitialCount,
                },
            };
            setPosition(updatedPosition);
            positionRef.current = updatedPosition;
            // ナビゲーションのルートノードをパス権付きの局面で更新
            // （待った時にパス権が復元されるようにするため）
            navigation.reset(updatedPosition, startSfen);
        }

        // 対局開始前に NNUE の存在確認を行う（未ダウンロードの場合はエラー）
        try {
            const nnuePreparations: Promise<unknown>[] = [];
            if (sides.sente.role === "engine" && senteNnueSelection) {
                nnuePreparations.push(resolveNnue(senteNnueSelection));
            }
            if (sides.gote.role === "engine" && goteNnueSelection) {
                nnuePreparations.push(resolveNnue(goteNnueSelection));
            }
            if (nnuePreparations.length > 0) {
                await Promise.all(nnuePreparations);
            }
        } catch (e) {
            // NNUE未ダウンロードエラー → 評価関数ファイル管理を開いて理由を表示
            const errorMessage = e instanceof Error ? e.message : "評価関数の準備に失敗しました";
            setNnueManagerOpenReason(`対局を開始できません: ${errorMessage}`);
            setIsNnueManagerOpen(true);
            return;
        }

        // エンジン管理は useEngineManager フックが自動的に処理する
        setIsMatchRunning(true);
        // ターン開始時刻をリセット
        turnStartTimeRef.current = Date.now();
        startTicking(position.turn);
    };

    /** 検討モードを開始 */
    const handleStartReview = async () => {
        if (!positionReady) return;
        if (isEditMode) {
            await finalizeEditedPosition();
            setIsEditMode(false);
        }
        // isMatchRunningはfalseのままでisReviewModeになる
    };

    /** 現在のゲームモードを計算 */
    const gameMode: GameMode = isEditMode
        ? "editing"
        : isMatchRunning
          ? "playing"
          : isPaused
            ? "paused"
            : "reviewing";
    const hideEmptyHandPieces = gameMode === "playing" || gameMode === "paused";

    const finalizeEditedPosition = async () => {
        if (isMatchRunning) return;
        const current = positionRef.current;
        setBasePosition(clonePositionState(current));
        setInitialBoard(cloneBoard(current.board));
        // SFENを取得して棋譜ツリーをリセット（編集した持ち駒情報を反映）
        try {
            const newSfen = await refreshStartSfen(current);
            navigation.reset(current, newSfen);
            clearLegalCache();
            setIsEditMode(false);
        } catch {
            setMessage({ text: "局面の確定に失敗しました。", type: "error" });
        }
    };

    /** 検討モードから編集モードに戻る */
    const handleEnterEditMode = useCallback(async () => {
        if (isMatchRunning) return;
        const current = positionRef.current;
        // 現在局面を編集開始局面として設定
        setBasePosition(clonePositionState(current));
        setInitialBoard(cloneBoard(current.board));
        // 先にSFENを取得してから棋譜ナビゲーションをリセット
        try {
            const newSfen = await refreshStartSfen(current);
            navigation.reset(current, newSfen);
            setLastMove(undefined);
            setSelection(null);
            setMessage(null);
            setLastAddedBranchInfo(null);
            clearLegalCache();
            // 編集モードに移行
            setIsEditMode(true);
        } catch {
            setMessage({ text: "編集モードへの移行に失敗しました。", type: "error" });
        }
    }, [clearLegalCache, isMatchRunning, navigation, refreshStartSfen]);

    /** 平手初期局面にリセット */
    const handleResetToStartpos = useCallback(async () => {
        matchEndedRef.current = false;
        setGameResult(null);
        setShowResultDialog(false);
        await stopAllEngines();

        const service = getPositionService();
        try {
            const pos = await service.getInitialBoard();
            const next = clonePositionState(pos);
            setPosition(next);
            positionRef.current = next;
            setInitialBoard(cloneBoard(next.board));
            setBasePosition(clonePositionState(next));
            setStartSfen("startpos");
            setPositionReady(true);

            navigation.reset(next, "startpos");
            setLastMove(undefined);
            setSelection(null);
            setMessage(null);
            setLastAddedBranchInfo(null); // 分岐状態をクリア
            resetClocks(false);

            setIsMatchRunning(false);
            setIsEditMode(true);
            setEditFromSquare(null);
            setEditTool("place");
            setEditPromoted(false);
            setEditOwner("sente");
            setEditPieceType(null);
            clearLegalCache();
            turnStartTimeRef.current = Date.now();
        } catch (error) {
            setMessage({ text: `平手初期化に失敗しました: ${String(error)}`, type: "error" });
        }
    }, [clearLegalCache, navigation, resetClocks, stopAllEngines]);

    // パス可否判定のため、キャッシュ未作成時は合法手をプリフェッチ
    useEffect(() => {
        if (!isMatchRunning || !positionReady) return;
        if (sides[position.turn].role !== "human") return;
        const ply = moves.length;
        if (legalCache.isCached(ply)) return;

        const passRightsOption = getPassRightsOption();
        const resolver = async () => {
            if (fetchLegalMoves) {
                return fetchLegalMoves(startSfen, moves, passRightsOption);
            }
            return getPositionService().getLegalMoves(startSfen, moves, passRightsOption);
        };

        // エラーはパスボタンクリック時の再解決に委ねる
        void legalCache
            .getOrResolve(ply, resolver)
            .then((result) => {
                if (moves.length === ply) {
                    setCanPassLegal(result.has("pass"));
                }
            })
            .catch(() => undefined);
    }, [
        fetchLegalMoves,
        isMatchRunning,
        legalCache,
        getPassRightsOption,
        position.turn,
        positionReady,
        sides,
        startSfen,
        moves,
    ]);

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
    const handleDndDrop = useCallback(
        (result: DropResult) => {
            if (!isEditMode) return;

            const applied = applyDropResult(result, positionRef.current);
            if (!applied.ok) {
                setMessage({ text: applied.error ?? "ドロップに失敗しました", type: "error" });
                return;
            }

            applyEditedPosition(applied.next);
        },
        [isEditMode, applyEditedPosition],
    );

    // DnD コントローラー
    const dndController = usePieceDnd({
        onDrop: handleDndDrop,
        disabled: !isEditMode,
    });

    // DnD ドラッグ開始ハンドラ（盤上の駒）
    // 注: isEditMode チェックは usePieceDnd の disabled オプションと
    //     JSX での条件付き props 渡しで行うため、ここでは不要
    const handlePiecePointerDown = useCallback(
        (
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
        },
        [dndController],
    );

    // DnD ドラッグ開始ハンドラ（持ち駒）
    const handleHandPiecePointerDown = useCallback(
        (owner: Player, pieceType: PieceType, e: React.PointerEvent) => {
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
        },
        [dndController, position],
    );

    const handlePieceTogglePromote = useCallback(
        (
            square: string,
            piece: { owner: "sente" | "gote"; type: string; promoted?: boolean },
            _event: React.MouseEvent<HTMLButtonElement>,
        ) => {
            if (!isEditMode) return;
            const sq = square as Square;
            setPiecePromotion(sq, !piece.promoted);
        },
        [isEditMode, setPiecePromotion],
    );

    // 指し手実行管理フック
    const { handleSquareSelect, handlePromotionChoice, handleHandSelect } = useMoveExecution({
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
        setCanPassLegal,
        getPassRightsOption,
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

    // 棋譜の手数選択コールバック（巻き戻し・リプレイ用）
    const handlePlySelect = useCallback(
        (ply: number) => {
            // 対局中は自動進行を一時停止し、編集モードに戻す
            if (isMatchRunning) {
                setIsMatchRunning(false);
                setIsEditMode(true);
                stopTicking();
                void stopAllEngines();
            }
            // 指定手数に移動（lastMoveはonPositionChangeで自動設定される）
            navigation.goToPly(ply);
        },
        [isMatchRunning, navigation, stopTicking, stopAllEngines],
    );

    // PVを分岐として追加するコールバック（シグナル付き）
    const handleAddPvAsBranch = useCallback(
        (ply: number, pv: string[]) => {
            // 分岐が実際に追加された場合、ply+firstMoveを記録
            addPvAsBranch(ply, pv, (info) => {
                setLastAddedBranchInfo(info);
            });
        },
        [addPvAsBranch],
    );

    // PVプレビューを開くコールバック
    const handlePreviewPv = useCallback(
        (ply: number, pv: string[], evalCp?: number, evalMate?: number) => {
            // PVはply手目を指した後の局面から計算されている
            // positionHistory[ply-1] = ply手目を指した後の局面
            const startPos = positionHistory[ply - 1];
            if (!startPos) return;

            setPvPreview({
                open: true,
                ply,
                pv,
                startPosition: startPos,
                evalCp,
                evalMate,
            });
        },
        [positionHistory],
    );

    // 手の詳細を選択するコールバック（右パネル表示用）
    const handleMoveDetailSelect = useCallback(
        (move: KifMove | null, pos: PositionState | null) => {
            if (move && pos) {
                setSelectedMoveDetailPly({ ply: move.ply, position: pos });
            } else {
                setSelectedMoveDetailPly(null);
            }
        },
        [],
    );

    const candidateNote = positionReady ? null : "局面を読み込み中です。";
    const isDraggingPiece = isEditMode && dndController.state.isDragging;

    const internalEngineId = engineOptions[0]?.id ?? "wasm";

    return (
        <ShogiMatchProvider config={{ aiIconUrl }}>
            <TooltipProvider delayDuration={TOOLTIP_DELAY_DURATION_MS}>
                {/* DnD ゴースト */}
                <DragGhost
                    ref={dndController.ghostRef as React.RefObject<HTMLDivElement>}
                    dndState={dndController.state}
                    ownerOrientation={flipBoard ? "gote" : "sente"}
                />

                <EngineRestartingOverlay visible={isEngineRestarting} />

                {/* 勝敗表示ダイアログ */}
                <GameResultDialog
                    result={gameResult}
                    open={showResultDialog}
                    onClose={() => setShowResultDialog(false)}
                />

                {/* PVプレビューダイアログ */}
                {pvPreview && (
                    <PvPreviewDialog
                        open={pvPreview.open}
                        onClose={() => setPvPreview(null)}
                        pv={pvPreview.pv}
                        startPosition={pvPreview.startPosition}
                        ply={pvPreview.ply}
                        evalCp={pvPreview.evalCp}
                        evalMate={pvPreview.evalMate}
                        squareNotation={displaySettings.squareNotation}
                        showBoardLabels={displaySettings.showBoardLabels}
                    />
                )}

                {/* NNUE ファイル管理ダイアログ */}
                <NnueManagerDialog
                    open={isNnueManagerOpen}
                    onOpenChange={(open) => {
                        setIsNnueManagerOpen(open);
                        // ダイアログを閉じたら理由もクリア
                        if (!open) {
                            setNnueManagerOpenReason(null);
                        }
                    }}
                    manifestUrl={manifestUrl}
                    onRequestFilePath={onRequestNnueFilePath}
                    openReason={nnueManagerOpenReason ?? undefined}
                    onClearOpenReason={() => setNnueManagerOpenReason(null)}
                    isMatchActive={isMatchRunning || isPaused}
                />

                {/* 手の詳細ウィンドウ（ドラッグ移動可能） */}
                {selectedMoveDetail && (
                    <MoveDetailWindow
                        move={selectedMoveDetail.move}
                        position={selectedMoveDetail.position}
                        onAddBranch={handleAddPvAsBranch}
                        onPreview={handlePreviewPv}
                        onAnalyze={handleAnalyzePly}
                        isAnalyzing={isAnalyzing}
                        analyzingPly={
                            analyzingState.type !== "none" && analyzingState.type !== "error"
                                ? analyzingState.ply
                                : undefined
                        }
                        analysisError={
                            analyzingState.type === "error"
                                ? {
                                      ply: analyzingState.ply,
                                      message: analyzingState.message,
                                  }
                                : undefined
                        }
                        analysisNnueSelection={analysisNnueSelection}
                        onAnalysisNnueSelectionChange={setAnalysisNnueSelection}
                        nnueList={nnueList}
                        isNnueListLoading={isNnueListLoading}
                        presets={presetConfigs}
                        kifuTree={navigation.tree}
                        onClose={() => setSelectedMoveDetailPly(null)}
                        isOnMainLine={navigation.state.isOnMainLine}
                    />
                )}

                {/* モバイル時はMobileLayout、PC時は3列レイアウト */}
                {isMobile ? (
                    <MatchSettingsProvider
                        sides={sides}
                        onSidesChange={handleSidesChange}
                        timeSettings={timeSettings}
                        onTimeSettingsChange={setTimeSettings}
                        passRightsSettings={passRightsSettings}
                        onPassRightsSettingsChange={handlePassRightsSettingsChange}
                        settingsLocked={settingsLocked}
                        senteNnueSelection={senteNnueSelection}
                        onSenteNnueSelectionChange={handleSenteNnueSelectionChange}
                        goteNnueSelection={goteNnueSelection}
                        onGoteNnueSelectionChange={handleGoteNnueSelectionChange}
                        nnueList={nnueList}
                        presets={presets}
                        internalEngineId={internalEngineId}
                        onOpenNnueManager={() => setIsNnueManagerOpen(true)}
                        onOpenDisplaySettings={() => setIsDisplaySettingsOpen(true)}
                        onOpenPassRightsSettings={() => setIsPassRightsSettingsOpen(true)}
                    >
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
                            onFlipBoardChange={setFlipBoard}
                            displaySettings={displaySettings}
                            passRightsSettings={passRightsSettings}
                            sides={sides}
                            moves={moves}
                            editFromSquare={editFromSquare}
                            hideEmptyHandPieces={gameMode === "playing" || gameMode === "paused"}
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
                            onOpenSettings={() => setIsSettingsModalOpen(true)}
                            shouldRenderPassButton={shouldRenderPassButton}
                            canMakePassMove={canMakePassMove}
                            passButtonDisabledReason={passButtonDisabledReason}
                            handlePassMove={handlePassMove}
                            shouldShowPassConfirm={shouldShowPassConfirm}
                            isDraggingPiece={isDraggingPiece}
                            boardSectionRef={boardSectionRef}
                        >
                            <NavigationProvider
                                navigationState={{
                                    currentPly: navigation.state.currentPly,
                                    totalPly: navigation.state.totalPly,
                                    isRewound: navigation.state.isRewound,
                                    canGoForward: navigation.state.canGoForward,
                                    hasBranches: navigation.state.hasBranches,
                                    currentBranchIndex: navigation.state.currentBranchIndex,
                                    branchCount: navigation.state.branchCount,
                                    isOnMainLine: navigation.state.isOnMainLine,
                                }}
                                navigationHandlers={{
                                    goBack: navigation.goBack,
                                    goForward: handleKeyboardForward,
                                    goToStart: navigation.goToStart,
                                    goToEnd: navigation.goToEnd,
                                    switchBranch: navigation.switchBranch,
                                    promoteCurrentLine: navigation.promoteCurrentLine,
                                    goToNodeById: navigation.goToNodeById,
                                    switchBranchAtNode: navigation.switchBranchAtNode,
                                }}
                                kifMoves={kifMoves}
                                evalHistory={evalHistory}
                                displayEvalHistory={displayEvalHistory}
                                positionHistory={positionHistory}
                                kifuTree={navigation.tree}
                                selectedBranchNodeId={selectedBranchNodeId}
                                onSelectedBranchChange={setSelectedBranchNodeId}
                                branchMarkers={branchMarkers}
                                lastAddedBranchInfo={lastAddedBranchInfo}
                                onLastAddedBranchHandled={() => setLastAddedBranchInfo(null)}
                                handleAddPvAsBranch={handleAddPvAsBranch}
                                handlePreviewPv={handlePreviewPv}
                                kifuViewMode={kifuViewMode}
                                onViewModeChange={setKifuViewMode}
                                displaySettings={displaySettings}
                                onDisplaySettingsChange={setDisplaySettings}
                                handlePlySelect={handlePlySelect}
                                handleCopyKif={handleCopyKif}
                                handleMoveDetailSelect={handleMoveDetailSelect}
                                isMatchRunning={isMatchRunning}
                            >
                                <MobileLayout
                                    candidateNote={candidateNote}
                                    isReviewMode={isReviewMode}
                                    onOpenAbout={() => setIsAboutOpen(true)}
                                    onImportSfen={importSfen}
                                    onImportKif={importKif}
                                    positionReady={positionReady}
                                    onDisplaySettingsChange={setDisplaySettings}
                                />
                            </NavigationProvider>
                        </MatchStateProvider>
                    </MatchSettingsProvider>
                ) : (
                    <MatchSettingsProvider
                        sides={sides}
                        onSidesChange={handleSidesChange}
                        timeSettings={timeSettings}
                        onTimeSettingsChange={setTimeSettings}
                        passRightsSettings={passRightsSettings}
                        onPassRightsSettingsChange={handlePassRightsSettingsChange}
                        settingsLocked={settingsLocked}
                        senteNnueSelection={senteNnueSelection}
                        onSenteNnueSelectionChange={handleSenteNnueSelectionChange}
                        goteNnueSelection={goteNnueSelection}
                        onGoteNnueSelectionChange={handleGoteNnueSelectionChange}
                        nnueList={nnueList}
                        presets={presets}
                        internalEngineId={internalEngineId}
                        onOpenNnueManager={() => setIsNnueManagerOpen(true)}
                        onOpenDisplaySettings={() => setIsDisplaySettingsOpen(true)}
                        onOpenPassRightsSettings={() => setIsPassRightsSettingsOpen(true)}
                    >
                        <AnalysisProvider
                            analysisSettings={analysisSettings}
                            onAnalysisSettingsChange={setAnalysisSettings}
                            analysisNnueSelection={analysisNnueSelection}
                            onAnalysisNnueSelectionChange={setAnalysisNnueSelection}
                            nnueList={nnueList}
                            isNnueListLoading={isNnueListLoading}
                            presetConfigs={presetConfigs}
                            isAnalyzing={isAnalyzing}
                            analyzingState={analyzingState}
                            batchAnalysis={batchAnalysis}
                            handleAnalyzePly={handleAnalyzePly}
                            handleStartBatchAnalysis={handleStartBatchAnalysis}
                            handleCancelBatchAnalysis={handleCancelBatchAnalysis}
                            handleAnalyzeNode={handleAnalyzeNode}
                            handleAnalyzeBranch={handleAnalyzeBranch}
                            handleStartTreeBatchAnalysis={handleStartTreeBatchAnalysis}
                        >
                            <PCLayout
                                matchLayoutClasses={matchLayoutClasses}
                                // MatchStateProvider 用
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
                                onFlipBoardChange={setFlipBoard}
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
                                onOpenSettings={() => setIsSettingsModalOpen(true)}
                                shouldRenderPassButton={shouldRenderPassButton}
                                canMakePassMove={canMakePassMove}
                                passButtonDisabledReason={passButtonDisabledReason}
                                handlePassMove={handlePassMove}
                                shouldShowPassConfirm={shouldShowPassConfirm}
                                isDraggingPiece={isDraggingPiece}
                                boardSectionRef={boardSectionRef}
                                // PCBoardSection 用
                                candidateNote={candidateNote}
                                // NavigationProvider 用
                                navigationState={{
                                    currentPly: navigation.state.currentPly,
                                    totalPly: navigation.state.totalPly,
                                    isRewound: navigation.state.isRewound,
                                    canGoForward: navigation.state.canGoForward,
                                    hasBranches: navigation.state.hasBranches,
                                    currentBranchIndex: navigation.state.currentBranchIndex,
                                    branchCount: navigation.state.branchCount,
                                    isOnMainLine: navigation.state.isOnMainLine,
                                }}
                                navigationHandlers={{
                                    goBack: navigation.goBack,
                                    goForward: navigation.goForward,
                                    goToStart: navigation.goToStart,
                                    goToEnd: navigation.goToEnd,
                                    switchBranch: navigation.switchBranch,
                                    promoteCurrentLine: navigation.promoteCurrentLine,
                                    goToNodeById: navigation.goToNodeById,
                                    switchBranchAtNode: navigation.switchBranchAtNode,
                                }}
                                kifMoves={kifMoves}
                                evalHistory={evalHistory}
                                displayEvalHistory={displayEvalHistory}
                                positionHistory={positionHistory}
                                kifuTree={navigation.tree}
                                selectedBranchNodeId={selectedBranchNodeId}
                                onSelectedBranchChange={setSelectedBranchNodeId}
                                branchMarkers={branchMarkers}
                                lastAddedBranchInfo={lastAddedBranchInfo}
                                onLastAddedBranchHandled={() => setLastAddedBranchInfo(null)}
                                handleAddPvAsBranch={handleAddPvAsBranch}
                                handlePreviewPv={handlePreviewPv}
                                kifuViewMode={kifuViewMode}
                                onViewModeChange={setKifuViewMode}
                                onDisplaySettingsChange={setDisplaySettings}
                                handlePlySelect={handlePlySelect}
                                handleCopyKif={handleCopyKif}
                                handleMoveDetailSelect={handleMoveDetailSelect}
                                // SettingsModal 用
                                isSettingsModalOpen={isSettingsModalOpen}
                                onSettingsModalOpenChange={setIsSettingsModalOpen}
                                importSfen={importSfen}
                                importKif={importKif}
                                positionReady={positionReady}
                                isDevMode={isDevMode}
                                eventLogs={eventLogs}
                                errorLogs={errorLogs}
                                engineErrorDetails={engineErrorDetails}
                                retryEngine={retryEngine}
                                isRetrying={isRetrying}
                                // 表示設定ダイアログ
                                isDisplaySettingsOpen={isDisplaySettingsOpen}
                                onDisplaySettingsOpenChange={setIsDisplaySettingsOpen}
                                setDisplaySettings={setDisplaySettings}
                                // パス権設定ダイアログ
                                isPassRightsSettingsOpen={isPassRightsSettingsOpen}
                                onPassRightsSettingsOpenChange={setIsPassRightsSettingsOpen}
                                handlePassRightsSettingsChange={handlePassRightsSettingsChange}
                                settingsLocked={settingsLocked}
                            />
                        </AnalysisProvider>
                    </MatchSettingsProvider>
                )}

                {/* 画面右下固定のAboutリンク（PC版のみ） */}
                {!isMobile && (
                    <button
                        type="button"
                        onClick={() => setIsAboutOpen(true)}
                        className="fixed bottom-2 right-2 z-40 px-2 py-1 text-xs text-muted-foreground/60 hover:text-muted-foreground hover:underline transition-colors"
                        aria-label="このアプリについて"
                        title="このアプリについて"
                    >
                        About
                    </button>
                )}

                <AboutDialog open={isAboutOpen} onOpenChange={setIsAboutOpen} />
            </TooltipProvider>
        </ShogiMatchProvider>
    );
}
