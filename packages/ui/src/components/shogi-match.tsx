import type {
    BoardState,
    GameResult,
    KifuTree,
    LastMove,
    MoveSearchStats,
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
    isKingInCheck,
    isStudyUsiMove,
    NONE_NNUE_SELECTION,
    resolveWorkerCount,
} from "@shogi/app-core";
import type { EngineInfoEvent } from "@shogi/engine-client";
import type { ReactElement } from "react";
// biome-ignore lint/style/noRestrictedImports: ShogiMatch は React Compiler がコンパイルを見送る（memo が入らない）ので、effect の依存に渡す値の同一性を useMemo で保つ
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { isCpuLosing, moveSoundScene } from "../hooks/moveSoundScene";
import { useScreenWakeLock } from "../hooks/useScreenWakeLock";
import { normalizeSoundVoice, type SoundVoice, useShogiSound } from "../hooks/useShogiSound";
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
import { useBatchAnalysis } from "./shogi-match/hooks/useBatchAnalysis";
import { useBoardState } from "./shogi-match/hooks/useBoardState";
import { type ClockSettings, useClockManager } from "./shogi-match/hooks/useClockManager";
import { useDialogs } from "./shogi-match/hooks/useDialogs";
import { useEditModeActions } from "./shogi-match/hooks/useEditModeActions";
import { useEngineManager } from "./shogi-match/hooks/useEngineManager";
import { useEnginePool } from "./shogi-match/hooks/useEnginePool";
import { useGameControls } from "./shogi-match/hooks/useGameControls";
import { useImportedKifuPlayers } from "./shogi-match/hooks/useImportedKifuPlayers";
import { type ReviewMoveEval, useKifuImportExport } from "./shogi-match/hooks/useKifuImportExport";
import { useKifuKeyboardNavigation } from "./shogi-match/hooks/useKifuKeyboardNavigation";
import {
    type RecordedEvalInfoEvent,
    useKifuNavigation,
} from "./shogi-match/hooks/useKifuNavigation";
import { useLegalMovePrefetch } from "./shogi-match/hooks/useLegalMovePrefetch";
import { useLocalStorage } from "./shogi-match/hooks/useLocalStorage";
import { useMatchNnueDownload } from "./shogi-match/hooks/useMatchNnueDownload";
import { useIsMobile } from "./shogi-match/hooks/useMediaQuery";
import { ILLEGAL_MOVE_MESSAGE, useMoveExecution } from "./shogi-match/hooks/useMoveExecution";
import { useMoveShadow } from "./shogi-match/hooks/useMoveShadow";
import { useNnueManager } from "./shogi-match/hooks/useNnueManager";
import { useNormalizedSettings } from "./shogi-match/hooks/useNormalizedSettings";
import { usePassRights } from "./shogi-match/hooks/usePassRights";
import { useUIState } from "./shogi-match/hooks/useUIState";
import { ShogiMatchLayout } from "./shogi-match/layouts/ShogiMatchLayout";
import {
    AI_MATCH_TIME_CHOICES,
    AI_TIME_CHOICES,
    MY_TIME_CHOICES,
    matchesChoice,
} from "./shogi-match/play/usePlaySetup";
import {
    type PlayPhase,
    type PlayScreenConfig,
    ShogiMatchProvider,
} from "./shogi-match/ShogiMatchContext";
import type {
    AnalysisSettings,
    AnalysisSnapshotDraft,
    AnalysisSnapshotEntryDraft,
    DisplaySettings,
    EngineOption,
    EngineSearchLimits,
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
import { buildLegalCacheKey, LegalMoveCache } from "./shogi-match/utils/legalMoveCache";
import {
    isSamePassRightsSettings,
    normalizePassRightsSettings,
} from "./shogi-match/utils/passRightsSettings";
import { boardToGrid } from "./shogi-match/utils/positionUtils";
import {
    clockSettingsForLimits,
    DEFAULT_ENGINE_SEARCH_LIMITS,
    normalizeEngineSearchLimits,
} from "./shogi-match/utils/searchLimits";
import { isSameTimeSettings, normalizeTimeSettings } from "./shogi-match/utils/timeSettings";
import { TooltipProvider } from "./tooltip";

const EMPTY_ANALYSIS_MARKERS: Array<{ seat: "b" | "w"; ply: number }> = [];

/** 平手の開始局面の盤・手番・持ち駒（SFEN）。 */
const HIRATE_BOARD_SFEN = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1";

/** 開始局面が平手か（`startpos` と、同じ局面の SFEN の両方を平手とみなす）。 */
const isHirateSfen = (sfen: string): boolean =>
    sfen === "startpos" || sfen.includes(HIRATE_BOARD_SFEN);

const MATCH_SIDES_KEY = "shogi-match-sides";
const PLAY_SIDES_KEY = "shogi-play-sides";

type MatchSides = { sente: SideSetting; gote: SideSetting };

/**
 * 対局画面を初めて開いたとき（先後をまだ PLAY_SIDES_KEY に保存していない）の先後。
 * 共有のキーの先後は、ほかの画面の既定値（観戦の人 対 人）や、AI 同士の保存値のこともあるので、
 * 引き継ぐのは「人 対 AI」のときだけ。引き継がないときは `alignTime` を立て、時間設定を
 * 対局画面の選択肢にそろえる。
 */
const readFirstPlaySides = (
    defaults: MatchSides,
): { sides: MatchSides; alignTime: boolean } | null => {
    if (typeof window === "undefined") return null;
    try {
        if (localStorage.getItem(PLAY_SIDES_KEY) !== null) return null;
        const raw = localStorage.getItem(MATCH_SIDES_KEY);
        const legacy = raw === null ? null : (JSON.parse(raw) as Partial<MatchSides> | null);
        const roles = [legacy?.sente?.role, legacy?.gote?.role];
        if (legacy?.sente && legacy.gote && roles.includes("human") && roles.includes("engine")) {
            return { sides: { sente: legacy.sente, gote: legacy.gote }, alignTime: false };
        }
    } catch {
        // 読めない保存値は、引き継がずに既定値で始める。
    }
    return { sides: defaults, alignTime: true };
};

/**
 * 人の側は MY_TIME_CHOICES、AI の側は AI の選択肢のどれにも当たらない時計を既定値にする
 * （AI 同士の 1 手 10 秒が自分の持ち時間に残る、観戦の「時間なし」が AI の考慮時間に残る、を防ぐ）。
 */
const alignTimeToPlayChoices = (
    settings: ClockSettings,
    sides: MatchSides,
    defaultClockFor: (role: SideSetting["role"]) => ClockSettings[Player],
): ClockSettings => {
    const align = (side: Player) => {
        const role = sides[side].role;
        const choices =
            role === "human" ? MY_TIME_CHOICES : [...AI_TIME_CHOICES, ...AI_MATCH_TIME_CHOICES];
        return choices.some((choice) => matchesChoice(settings[side], choice))
            ? settings[side]
            : defaultClockFor(role);
    };
    return { sente: align("sente"), gote: align("gote") };
};

const DISPLAY_SETTINGS_KEY = "shogi-display-settings";
/** ライブ観戦用の表示設定 localStorage キー (対局用と分離してチート防止既定を汚さない)。 */
const SPECTATE_DISPLAY_SETTINGS_KEY = "rshogi-live-display-settings";
/** ライブ観戦の既定表示設定。棋譜評価値カラムを既定 ON にする。 */
const SPECTATE_DISPLAY_SETTINGS: DisplaySettings = {
    ...DEFAULT_DISPLAY_SETTINGS,
    showKifuEval: true,
};

const reviewMoveDataKeyCache = new WeakMap<(ReviewMoveEval | undefined)[], string>();

/**
 * JSON.stringify 用 replacer。素の stringify は ±Infinity をどちらも null に潰して符号を失うため、
 * signature/cache key では手数なし詰み (evalMate=±Infinity) を符号付き文字列として残す。
 */
const infinitySafeReplacer = (_key: string, value: unknown): unknown =>
    typeof value === "number" && !Number.isNaN(value) && !Number.isFinite(value)
        ? value > 0
            ? "Infinity"
            : "-Infinity"
        : value;

export const stringifyReviewMoveData = (
    moveData: (ReviewMoveEval | undefined)[] | undefined,
): string => {
    if (!moveData) return "";
    const cached = reviewMoveDataKeyCache.get(moveData);
    if (cached !== undefined) return cached;

    const key = JSON.stringify(moveData, infinitySafeReplacer);
    reviewMoveDataKeyCache.set(moveData, key);
    return key;
};

interface LoadedReviewSignature {
    sfen: string;
    movesKey: string;
    moveDataKey: string;
}

interface InitialReviewInput {
    sfen: string;
    moves: string[];
    moveData?: (ReviewMoveEval | undefined)[];
    /**
     * 最初に取り込んだときに開く局面。`"start"` は開始局面、省略時は最終手（観戦は最新手を追う）。
     * 取り込んだ後の更新（手が伸びた・評価値が届いた）には効かない。
     */
    openAt?: "start";
}

type InitialReviewSyncMode = "skip" | "import" | "diff";

interface ReviewMoveDataDiffResult {
    changed: number;
    applied: number;
    skipped: number;
}

export const getInitialReviewSyncMode = (
    loaded: LoadedReviewSignature | null,
    next: LoadedReviewSignature,
): InitialReviewSyncMode => {
    if (!loaded) return "import";
    if (loaded.sfen !== next.sfen || loaded.movesKey !== next.movesKey) return "import";
    if (loaded.moveDataKey !== next.moveDataKey) return "diff";
    return "skip";
};

// ライブ探索表示のクリアは複数の effect / callback から呼ばれる。コンポーネント内
// 関数だと毎レンダー再生成され hook 依存に使えない (biome) ため、ref と setState を
// 引数に取るモジュール関数にする
const clearLiveSearchDisplay = (
    trailingRef: { current: unknown },
    timerRef: { current: ReturnType<typeof setTimeout> | null },
    setLiveSearchInfo: (value: null) => void,
): void => {
    trailingRef.current = null;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    setLiveSearchInfo(null);
};

const isSameReviewMoveEval = (
    a: ReviewMoveEval | undefined,
    b: ReviewMoveEval | undefined,
): boolean =>
    a?.elapsedMs === b?.elapsedMs && a?.evalCp === b?.evalCp && a?.evalMate === b?.evalMate;

export const applyReviewMoveDataDiff = (
    navigation: Pick<ReturnType<typeof useKifuNavigation>, "updateMoveEvalAtPly">,
    moves: string[],
    previousMoveData: (ReviewMoveEval | undefined)[] | undefined,
    nextMoveData: (ReviewMoveEval | undefined)[] | undefined,
): ReviewMoveDataDiffResult => {
    const result: ReviewMoveDataDiffResult = { changed: 0, applied: 0, skipped: 0 };
    for (let index = 0; index < moves.length; index++) {
        const data = nextMoveData?.[index];
        if (isSameReviewMoveEval(previousMoveData?.[index], data)) continue;

        result.changed++;
        // 評価値のクリアは diff 経路では非対応。moves 変化時の import 経路で
        // 棋譜ツリーを再構築し、その際に古い評価値もリセットされる。
        if (!data) continue;
        const updateResult = navigation.updateMoveEvalAtPly(
            index + 1,
            {
                elapsedMs: data.elapsedMs,
                scoreCp: data.evalCp,
                scoreMate: data.evalMate,
                pv: data.pv,
            },
            {
                usiMove: moves[index],
            },
        );
        if (updateResult === "missing") {
            result.skipped++;
        } else {
            result.applied++;
        }
    }
    return result;
};

export const analysisSnapshotEntryToRecordedEvalInfoEvent = (
    entry: AnalysisSnapshotEntryDraft,
): RecordedEvalInfoEvent => ({
    type: "info",
    scoreCp: entry.evalCp ?? undefined,
    scoreMate: entry.evalMate ?? undefined,
    depth: entry.depth ?? undefined,
    pv: entry.pv ?? undefined,
    multipv: 1,
    normalized: true,
});

/** 保存済み snapshot の multiPv 候補 1 件を再適用用イベントへ変換する (multipv 番号を保持)。 */
export const analysisSnapshotMultiPvToRecordedEvalInfoEvent = (
    multiPv: NonNullable<AnalysisSnapshotEntryDraft["multiPv"]>[number],
): RecordedEvalInfoEvent => ({
    type: "info",
    scoreCp: multiPv.evalCp ?? undefined,
    scoreMate: multiPv.evalMate ?? undefined,
    depth: multiPv.depth ?? undefined,
    pv: multiPv.pv ?? undefined,
    multipv: multiPv.multipv,
    normalized: true,
});

/**
 * 保存済み snapshot の 1 entry を棋譜ツリーへ再適用する。ply の評価を一旦クリアし、
 * 主評価 (multipv:1) と各 multiPv 候補を multipv スロットごとに記録する。
 * multiPv に multipv:1 が含まれても、主評価との二重記録は setNodeMultiPvEval の
 * 深さ比較で吸収されるため無害 (multiPv が空/なしの経路のため主評価記録は残す)。
 */
export const applyAnalysisSnapshotEntryEvals = (
    entry: AnalysisSnapshotEntryDraft,
    handlers: {
        clearEvalByPly: (ply: number) => void;
        recordEvalByPly: (ply: number, event: RecordedEvalInfoEvent) => void;
    },
): void => {
    handlers.clearEvalByPly(entry.ply);
    handlers.recordEvalByPly(entry.ply, analysisSnapshotEntryToRecordedEvalInfoEvent(entry));
    for (const multiPv of entry.multiPv ?? []) {
        handlers.recordEvalByPly(
            entry.ply,
            analysisSnapshotMultiPvToRecordedEvalInfoEvent(multiPv),
        );
    }
};

export function useInitialReviewSync({
    positionReady,
    initialReview,
    navigation,
    importSfen,
}: {
    positionReady: boolean;
    initialReview: InitialReviewInput | undefined;
    navigation: ReturnType<typeof useKifuNavigation>;
    importSfen: (
        sfen: string,
        moves: string[],
        options?: {
            gotoPly?: number;
            isStale?: () => boolean;
            moveData?: (ReviewMoveEval | undefined)[];
        },
    ) => Promise<void>;
}): void {
    const loadedReviewRef = useRef<LoadedReviewSignature | null>(null);
    const loadedReviewMoveDataRef = useRef<(ReviewMoveEval | undefined)[] | undefined>(undefined);
    const importSfenRef = useRef(importSfen);
    importSfenRef.current = importSfen;
    const navigationRef = useRef(navigation);
    navigationRef.current = navigation;
    const reviewSfen = initialReview?.sfen;
    const reviewMoves = initialReview?.moves;
    const reviewMoveData = initialReview?.moveData;
    const reviewMoveDataKey = stringifyReviewMoveData(reviewMoveData);
    const getLatestReview = useEffectEvent(() => initialReview);
    const applyLatestReviewMoveDataDiff = useEffectEvent((moves: string[]) => {
        const nextMoveData = getLatestReview()?.moveData;
        const result = applyReviewMoveDataDiff(
            navigationRef.current,
            moves,
            loadedReviewMoveDataRef.current,
            nextMoveData,
        );
        if (result.skipped === 0) {
            loadedReviewMoveDataRef.current = nextMoveData;
        }
        return result;
    });

    useEffect(() => {
        if (!positionReady || reviewSfen === undefined || reviewMoves === undefined) {
            return;
        }
        const movesKey = reviewMoves.join(" ");
        const loaded = loadedReviewRef.current;
        const nextSignature = {
            sfen: reviewSfen,
            movesKey,
            moveDataKey: reviewMoveDataKey,
        };
        const syncMode = getInitialReviewSyncMode(loaded, nextSignature);
        if (syncMode === "skip") {
            return;
        }
        if (syncMode === "diff") {
            const result = applyLatestReviewMoveDataDiff(reviewMoves);
            if (result.skipped === 0) {
                loadedReviewRef.current = nextSignature;
            }
            return;
        }

        // 再構築前のカーソルを捕捉する。末尾追従中 (currentPly === totalPly) なら
        // 最新手まで進め、途中検討中ならその ply を維持する。
        const navState = navigationRef.current.state;
        const wasFollowingTip = navState.currentPly === navState.totalPly;
        const restorePly = navState.currentPly;
        // 最初の取り込みだけ、開始局面から開く指定に従う。
        const openAtStart = loaded === null && getLatestReview()?.openAt === "start";

        // await 前に確定して StrictMode の二重実行を冪等化する。連続着手で先行 import が
        // 後着 import に追い越されたら、isStale で古い import の state 適用を中止する。
        loadedReviewRef.current = nextSignature;
        const importMoveData = getLatestReview()?.moveData;
        loadedReviewMoveDataRef.current = importMoveData;
        void importSfenRef
            .current(reviewSfen, reviewMoves, {
                gotoPly: openAtStart ? 0 : wasFollowingTip ? undefined : restorePly,
                moveData: importMoveData,
                isStale: () =>
                    loadedReviewRef.current?.sfen !== reviewSfen ||
                    loadedReviewRef.current?.movesKey !== movesKey ||
                    loadedReviewRef.current?.moveDataKey !== reviewMoveDataKey,
            })
            .then(() => {
                // importSfen の resolve 時点では React の commit が未完了のことがあるため、
                // macrotask (setTimeout 0) に後退させ、commit 後の navigationRef
                // (updateMoveEvalAtPly の missing 判定が参照するツリー) に対して
                // import 中に届いたコメント評価値の diff を再適用する。
                // (.then() 時点では既に非同期コンテキストのため flushSync による
                // 同期 commit の強制は使えない)
                setTimeout(() => {
                    if (
                        loadedReviewRef.current?.sfen !== reviewSfen ||
                        loadedReviewRef.current?.movesKey !== movesKey
                    ) {
                        return;
                    }
                    const latestReview = getLatestReview();
                    if (
                        latestReview?.sfen !== reviewSfen ||
                        latestReview.moves.join(" ") !== movesKey
                    ) {
                        return;
                    }
                    const latestMoveData = latestReview.moveData;
                    const result = applyReviewMoveDataDiff(
                        navigationRef.current,
                        reviewMoves,
                        loadedReviewMoveDataRef.current,
                        latestMoveData,
                    );
                    // skipped > 0 (ply 未登録等) の場合は ref を確定せず、
                    // 次の reviewMoveData 変化時に同じ差分の再適用を試みる (リトライ)。
                    // 差分適用は冪等なので重複適用の害はない。
                    if (result.skipped === 0) {
                        loadedReviewMoveDataRef.current = latestMoveData;
                        loadedReviewRef.current = {
                            sfen: reviewSfen,
                            movesKey,
                            moveDataKey: stringifyReviewMoveData(latestMoveData),
                        };
                    }
                }, 0);
            })
            .catch((err) => {
                // SFEN 解析失敗などで取り込みが reject したら loaded マークを巻き戻し、
                // 同一内容の再取り込み (再 snapshot 等) を可能にする。より新しい取り込みが
                // 先行していれば (参照不一致) リセットしない。
                if (
                    loadedReviewRef.current?.sfen === reviewSfen &&
                    loadedReviewRef.current?.movesKey === movesKey &&
                    loadedReviewRef.current?.moveDataKey === reviewMoveDataKey
                ) {
                    loadedReviewRef.current = null;
                    loadedReviewMoveDataRef.current = undefined;
                }
                console.error("[rshogi] initialReview の取り込みに失敗しました", err);
            });
    }, [positionReady, reviewSfen, reviewMoves, reviewMoveDataKey]);
}

/**
 * 読み筋のウィンドウ（PC）に出す手と、その手が指された後の局面。
 *
 * ウィンドウを開いている間は、見ている手に追従する。指し手と局面は、いま見ている手順の同じ手数
 * から引く（別の変化へ移っても、手と局面が食い違わない）。開始局面（0 手目）には出す手が無い
 * ので、その間だけウィンドウを出さない（手を進めるとまた出る）。
 */
export function resolveMoveDetail({
    isOpen,
    currentPly,
    kifMoves,
    positionHistory,
}: {
    isOpen: boolean;
    currentPly: number;
    kifMoves: readonly KifMove[];
    /** 「その手が指された後の局面」を 0 始まりで持つ（手数 ply の局面は `ply - 1`）。 */
    positionHistory: readonly PositionState[];
}): { move: KifMove; position: PositionState } | null {
    if (!isOpen || currentPly < 1) return null;
    const move = kifMoves.find((m) => m.ply === currentPly);
    const position = positionHistory[currentPly - 1];
    if (!move || !position) return null;
    return { move, position };
}

/**
 * 局面編集の操作（駒のドラッグ、マスを押しての配置、持ち駒の増減、成り・不成の切り替え）を
 * 受け付けてよいか。
 *
 * 棋譜を見るだけの画面（`viewerMode`）は局面編集を出さない。ところが内部の状態は
 * `initialReview` の取り込みが済むまで「編集モード」のままで、取り込みに失敗すると以後も
 * そのまま残る。その間に盤を編集できてしまわないよう、ビューアでは常に受け付けない。
 */
export function canEditPosition({
    isEditMode,
    viewerMode,
}: {
    isEditMode: boolean;
    viewerMode: boolean;
}): boolean {
    return isEditMode && !viewerMode;
}

/**
 * 盤を反転して（後手を手前にして）出すか。対局画面で、後手だけが人間のときに反転する。
 *
 * 先後の担当は対局画面の設定としてブラウザに保存されていて、棋譜を見る画面（棋譜ビューア・
 * 観戦・公開棋譜）もそれを読む。そこで反転すると、対局と関係のない棋譜が後手視点で開いて
 * しまうので、棋譜を見る画面では常に先手を手前にする（利用者は反転ボタンで切り替えられる）。
 */
export function shouldFlipBoardForSides({
    reviewMode,
    senteRole,
    goteRole,
}: {
    reviewMode: boolean;
    senteRole: SideSetting["role"];
    goteRole: SideSetting["role"];
}): boolean {
    if (reviewMode) return false;
    return goteRole === "human" && senteRole !== "human";
}

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
    // 観戦・公開棋譜の画面も ShogiMatch を人 対 人で開き、その既定値を保存する。対局画面は別のキーに
    // 持ち、その保存で「自分 対 AI」の既定値が上書きされないようにする。
    const [firstPlaySides] = useState(() =>
        screen === "play" ? readFirstPlaySides(defaultSides) : null,
    );
    const [sides, setSides] = useLocalStorage<MatchSides>(
        screen === "play" ? PLAY_SIDES_KEY : MATCH_SIDES_KEY,
        firstPlaySides?.sides ?? defaultSides,
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
            incrementMs: 0,
            enabled: defaultSides.sente.role !== "human",
        },
        gote: {
            mainMs: initialMainTimeMs,
            byoyomiMs: initialByoyomiMs,
            incrementMs: 0,
            enabled: defaultSides.gote.role !== "human",
        },
    };
    const [timeSettings, setTimeSettings] = useNormalizedSettings(
        "shogi-match-time-settings",
        defaultTimeSettings,
        normalizeTimeSettings,
        isSameTimeSettings,
    );
    // 初めて開いた対局画面では、利用者が秒を指定するまで、時間設定をいまの先後の選択肢にそろえ続ける。
    // 1 度だけでは足りない（ログイン中は、サーバーに保存した時間設定があとから届いて書き戻される）。
    const alignTimeRef = useRef(firstPlaySides?.alignTime === true);
    // 先後は時計より先に書き込まれる（usePlaySetup）。時計を書くときは、その先後で選択肢を判定する。
    const latestSidesRef = useRef(sides);
    const alignToPlayChoices = (settings: ClockSettings, currentSides: MatchSides) =>
        alignTimeToPlayChoices(settings, currentSides, (role) => ({
            mainMs: initialMainTimeMs,
            byoyomiMs: initialByoyomiMs,
            incrementMs: 0,
            enabled: role !== "human",
        }));
    const alignTimeForFirstPlay = useEffectEvent(
        (current: ClockSettings, currentSides: MatchSides) => {
            latestSidesRef.current = currentSides;
            if (!alignTimeRef.current) return;
            const aligned = alignToPlayChoices(current, currentSides);
            if (!isSameTimeSettings(aligned, current)) {
                setTimeSettings((latest) => alignToPlayChoices(latest, currentSides), "automatic");
            }
        },
    );
    useEffect(() => {
        alignTimeForFirstPlay(timeSettings, sides);
    }, [timeSettings, sides]);
    // 先後や時間の選択肢を選んだときの書き込みは、そろえ続けても変わらない。止めるのは、その役割の
    // 選択肢に当たらない時計（詳細設定で指定した秒）を書いたときだけ。
    const changeTimeSettings: typeof setTimeSettings = (next) => {
        if (
            typeof next === "function" ||
            !isSameTimeSettings(alignToPlayChoices(next, latestSidesRef.current), next)
        ) {
            alignTimeRef.current = false;
        }
        setTimeSettings(next);
    };
    const [isMatchRunning, setIsMatchRunning] = useState(false);
    const [isEditMode, setIsEditMode] = useState(true);
    const isPlayScreen = screen === "play";
    // 対局画面では、利用者が「局面を変えて指す」を開いている間だけ盤を編集できる。
    const [positionEditOpen, setPositionEditOpen] = useState(false);
    const [hintCount, setHintCount] = useState(0);
    const [hintPly, setHintPly] = useState<number | null>(null);
    const [pendingOpenStudy, setPendingOpenStudy] = useState(false);
    const [pendingRematch, setPendingRematch] = useState(false);
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
    // 終局後・一時停止から設定の画面へ戻している最中か（戻し終えるまで、対局を始めさせない）。
    const [isPlayResetting, setIsPlayResetting] = useState(false);
    // 対局を始める準備（評価関数の確認・エンジンの初期化）をしている最中か。その間は、設定や開始局面を
    // 変えさせない（準備の途中で局面が変わると、始まった対局の手番と時計が食い違う）。
    const [isPlayStarting, setIsPlayStarting] = useState(false);
    // 対局の始めに 1 度だけ出す知らせ（振り駒の結果など）。
    const [playStartNotice, setPlayStartNotice] = useState<string | null>(null);
    // この対局の始まりの局面（開始局面と、そこまでの手順）。別のページから引き継いだ棋譜の途中から
    // 始めた対局では、手順が空でない。「もう一局」「設定を変える」で戻す先と、待ったで戻せる範囲に使う。
    const playStartRef = useRef<{ sfen: string; moves: string[] } | null>(null);
    const [playStartPly, setPlayStartPly] = useState(0);
    // 新しい対局を始めようとしている（始まったら、その時点の開始局面と手順を控える）。
    const [pendingPlayStartCapture, setPendingPlayStartCapture] = useState(false);
    const pendingSearchStatsRef = useRef(new Map<number, MoveSearchStats>());
    const [liveSearchInfo, setLiveSearchInfo] = useState<{
        side: Player;
        event: EngineInfoEvent;
    } | null>(null);
    const liveInfoTrailingRef = useRef<{ side: Player; event: EngineInfoEvent } | null>(null);
    const liveInfoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(
        () => () => {
            if (liveInfoTimerRef.current) clearTimeout(liveInfoTimerRef.current);
        },
        [],
    );
    // 終局・一時停止・エラーで対局が止まったとき「思考中」の残留表示と未消費の統計を消す
    useEffect(() => {
        if (isMatchRunning) return;
        pendingSearchStatsRef.current.clear();
        clearLiveSearchDisplay(liveInfoTrailingRef, liveInfoTimerRef, setLiveSearchInfo);
    }, [isMatchRunning]);
    // モバイル判定
    const isMobile = useIsMobile();
    // 検討モード: 編集モードでも対局中でも一時停止中でもない状態
    // 自由に棋譜を閲覧し、分岐を作成できる
    const isReviewMode = !isEditMode && !isMatchRunning && !isPaused;
    // ライブ観戦は表示設定を別名前空間で扱い、棋譜評価値カラムを既定 ON にする。
    // 対局用の設定 (チート防止で showKifuEval=OFF 既定) を汚さず、観戦側で明示
    // トグルした値は観戦用キーに永続化されて尊重される。
    const displaySettingsKey = spectateMode ? SPECTATE_DISPLAY_SETTINGS_KEY : DISPLAY_SETTINGS_KEY;
    const displaySettingsDefaults = spectateMode
        ? SPECTATE_DISPLAY_SETTINGS
        : DEFAULT_DISPLAY_SETTINGS;
    const [storedDisplaySettings, setDisplaySettings] = useLocalStorage<DisplaySettings>(
        displaySettingsKey,
        displaySettingsDefaults,
    );
    // 既存の localStorage データに新フィールド（enableSound 等）がない場合のマージ
    const displaySettings = { ...displaySettingsDefaults, ...storedDisplaySettings };
    const { playSound } = useShogiSound({ dogSoundBaseUrl });
    const isCpuGame = sides.sente.role === "engine" || sides.gote.role === "engine";
    // 人の手は合法手の確認を待ってから適用されるので、鳴らすかどうか・鳴らし方はその時点の設定で決める。
    const moveSoundRef = useRef<{ enabled: boolean; voice: SoundVoice }>({
        enabled: false,
        voice: "standard",
    });
    moveSoundRef.current = {
        enabled: displaySettings.enableSound,
        voice:
            isCpuGame && dogSoundBaseUrl
                ? normalizeSoundVoice(
                      displaySettings.cpuSoundVoice,
                      DEFAULT_DISPLAY_SETTINGS.cpuSoundVoice,
                  )
                : "standard",
    };
    const playMoveSound = (
        move: string,
        before: PositionState,
        after: PositionState,
        by: "self" | "opponent",
        cpuLosing = false,
    ) => {
        const { enabled, voice } = moveSoundRef.current;
        if (!enabled) return;
        if (move === "pass") {
            playSound("pass");
            return;
        }
        playSound(by === "opponent" ? "move_opponent" : "move_self", {
            voice,
            scene: moveSoundScene(before, move, after),
            cpuLosing,
        });
    };
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
        // 0 は自動。旧 UI で選べた 32 超の値が localStorage に残っていると
        // 現在の選択肢 (1〜32) に一致せず表示が壊れるため clamp する
        const normalize = (value: number | undefined) =>
            typeof value === "number" && Number.isFinite(value)
                ? Math.min(32, Math.max(0, Math.trunc(value)))
                : 0;
        if (typeof storedEngineThreads === "number") {
            const normalized = normalize(storedEngineThreads);
            return { sente: normalized, gote: normalized };
        }
        if (!storedEngineThreads || typeof storedEngineThreads !== "object") {
            return { sente: 0, gote: 0 };
        }
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
    const [storedEngineSearchLimits, setEngineSearchLimits] = useLocalStorage<EngineSearchLimits>(
        "shogi-match-engine-search-limits",
        DEFAULT_ENGINE_SEARCH_LIMITS,
    );
    const engineSearchLimits = useMemo(
        () => normalizeEngineSearchLimits(storedEngineSearchLimits),
        [storedEngineSearchLimits],
    );
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

    // 対局画面のヒントに使う評価関数。利用者には選ばせず、準備の済んでいるものを使う:
    // 相手の AI（内蔵エンジン）の評価関数、無ければ解析用に選んであるもの。どちらも未ダウンロードなら
    // 簡易 AI（駒得）で出す（ヒントのためだけにダウンロードを求めない）。
    const [playHintSelection, setPlayHintSelection] = useState<NnueSelection>(NONE_NNUE_SELECTION);
    const hintCandidate: NnueSelection = (() => {
        for (const side of ["gote", "sente"] as const) {
            const setting = sides[side];
            if (setting.role !== "engine") continue;
            const engine =
                engineOptions.find((option) => option.id === setting.engineId) ?? engineOptions[0];
            if (engine && engine.kind !== "external") {
                return side === "sente" ? senteNnueSelection : goteNnueSelection;
            }
        }
        return analysisNnueSelection;
    })();
    const hintCandidateKey = `${hintCandidate.presetKey ?? ""}|${hintCandidate.nnueId ?? ""}`;
    const resolveHintCandidate = useEffectEvent(async () => {
        try {
            await resolveNnue(hintCandidate);
            return hintCandidate;
        } catch {
            return NONE_NNUE_SELECTION;
        }
    });
    // biome-ignore lint/correctness/useExhaustiveDependencies: 候補が変わったとき・評価関数の一覧が変わったとき（ダウンロード完了）に確かめ直す
    useEffect(() => {
        if (!isPlayScreen) return;
        let cancelled = false;
        void resolveHintCandidate().then((selection) => {
            if (!cancelled) setPlayHintSelection(selection);
        });
        return () => {
            cancelled = true;
        };
    }, [isPlayScreen, hintCandidateKey, nnueList.length]);
    const effectiveAnalysisNnueSelection = isPlayScreen ? playHintSelection : analysisNnueSelection;

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
        // analysisSnapshotDraft は live 由来の手数なし詰み (evalMate=±Infinity) を含みうる。
        // 素の JSON.stringify は ±Infinity をどちらも null にして符号を潰すため、
        // signature 比較では符号を保持する infinitySafeReplacer を使う。
        const signature = analysisSnapshotDraft
            ? JSON.stringify(analysisSnapshotDraft, infinitySafeReplacer)
            : null;
        if (lastAnalysisSnapshotSignatureRef.current === signature) {
            return;
        }
        lastAnalysisSnapshotSignatureRef.current = signature;
        onAnalysisSnapshotChange?.(analysisSnapshotDraft);
    }, [analysisSnapshotDraft, onAnalysisSnapshotChange]);

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

    const handleClockError = (text: string) => {
        setMessage({ text, type: "error" });
    };

    const stopAllEnginesRef = useRef<() => Promise<void>>(async () => {});
    const prepareEnginesRef = useRef<() => Promise<boolean>>(async () => true);

    // 対局画面では、AI の「1 手◯秒」は考える長さの目安で、切れても負けにしない
    // （端末が重いと、AI が制限ぎりぎりまで考えて時計だけ先に 0 になることがある）。
    // 持ち時間のある決まり（秒読み・加算・切れ負け）は時計どおりに負けにする。
    const isTimeExemptAi = (side: Player): boolean =>
        isPlayScreen && sides[side].role === "engine" && timeSettings[side].mainMs === 0;
    const handleTimeExpired = async (side: Player) => {
        if (isTimeExemptAi(side)) return;
        const winner: Player = side === "sente" ? "gote" : "sente";
        const result: GameResult = {
            winner,
            reason: { kind: "time_expired", loser: side },
            totalMoves: moves.length,
        };
        await endMatchRef.current?.(result);
    };

    // 時計に渡す設定は、中身が同じ間は同じものにする（時計は設定が替わるたびに残り時間を戻す）。
    const clockTimeSettings = useMemo(
        () => clockSettingsForLimits(timeSettings, sides, engineSearchLimits),
        [timeSettings, sides, engineSearchLimits],
    );
    // 時計管理フックを使用
    const {
        clocks,
        clocksRef,
        resetClocks,
        updateClocksForNextTurn,
        hasExpiredAtMove,
        stopTicking,
        startTicking,
    } = useClockManager({
        timeSettings: clockTimeSettings,
        isMatchRunning,
        onTimeExpired: handleTimeExpired,
        matchEndedRef,
        onClockError: handleClockError,
    });

    /** 指す前に時間が切れていた手、終局後に届いた手なら、手を適用しない（true を返す）。 */
    const endIfFlaggedBeforeMove = (mover: Player): boolean => {
        // 合法手を調べている間などに終局していたら、その手は受け付けない。
        if (matchEndedRef.current) return true;
        if (isTimeExemptAi(mover) || !hasExpiredAtMove(mover)) return false;
        void handleTimeExpired(mover);
        return true;
    };

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

    // 対局前に timeSettings が変更されたら clocks を同期
    // （resetClocks は timeSettings に依存しているため、resetClocks の変更で検知可能）
    // 一時停止中は戻さない（戻すと、止めるたびに持ち時間・秒読みが元に戻ってしまう）。
    // ただし、一時停止中に時間設定そのものを変えたときは、新しい設定に合わせ直す。
    // 読む量（ノード数・深さ）を替えたときも時計の設定が替わるので、時計に渡す設定で比べる。
    const syncedTimeSettingsRef = useRef(clockTimeSettings);
    useEffect(() => {
        const settingsChanged = syncedTimeSettingsRef.current !== clockTimeSettings;
        syncedTimeSettingsRef.current = clockTimeSettings;
        if (!isMatchRunning && (!isPaused || settingsChanged)) {
            resetClocks(false);
        }
    }, [isMatchRunning, isPaused, resetClocks, clockTimeSettings]);

    // 対局終了処理（エンジン管理フックから呼ばれる）
    const endMatch = async (result: GameResult) => {
        if (matchEndedRef.current) return;
        matchEndedRef.current = true;
        setGameResult(result);
        setShowResultDialog(true);
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
        onSearchComplete: (ply, stats) => {
            pendingSearchStatsRef.current.set(ply, stats);
            clearLiveSearchDisplay(liveInfoTrailingRef, liveInfoTimerRef, setLiveSearchInfo);
        },
        onLiveInfo: (side, event) => {
            // 対局停止後や fatal エラー後に flush された info が残留表示を再セットしないようにする
            if (!isMatchRunning || engineStatus[side] === "error") return;
            liveInfoTrailingRef.current = { side, event };
            if (liveInfoTimerRef.current) return;
            liveInfoTimerRef.current = setTimeout(() => {
                if (liveInfoTrailingRef.current) setLiveSearchInfo(liveInfoTrailingRef.current);
                liveInfoTimerRef.current = null;
            }, 250);
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
        clearLiveSearchDisplay(liveInfoTrailingRef, liveInfoTimerRef, setLiveSearchInfo);
    }, [engineStatus.sente, engineStatus.gote]);
    restartEngineForNnueRef.current = restartEngineForNnue;

    // role変更時にエンジンを破棄するラッパー
    const handleSidesChange = (newSides: { sente: SideSetting; gote: SideSetting }) => {
        // role が engine から human に変わった場合はエンジンを破棄
        for (const side of ["sente", "gote"] as const) {
            if (sides[side].role === "engine" && newSides[side].role !== "engine") {
                void disposeEngine(side);
            }
        }
        latestSidesRef.current = newSides;
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
            source === "engine" && isCpuLosing(pendingSearchStatsRef.current.get(moves.length)),
        );
        // 消費時間を計算
        const elapsedMs = Date.now() - turnStartTimeRef.current;
        // 棋譜ナビゲーションに手を追加（局面更新はonPositionChangeで自動実行）
        const ply = moves.length;
        const searchStats =
            source === "engine" ? pendingSearchStatsRef.current.get(ply) : undefined;
        navigation.addMove(move, nextPosition, { elapsedMs, searchStats });
        if (source === "engine") pendingSearchStatsRef.current.delete(ply);
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

    const initialAnalysisAppliedRef = useRef<string | null>(null);

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

    useEffect(() => {
        if (!positionReady || !initialAnalysisEntries || initialAnalysisEntries.length === 0) {
            return;
        }

        // 復元済み snapshot は evalMate=±Infinity (手数なし詰み) を含みうる。素の
        // JSON.stringify は ±Infinity をどちらも null に潰し符号違いの snapshot 切替を
        // 取りこぼすため、符号を保持する infinitySafeReplacer で署名する。
        const signature = JSON.stringify(initialAnalysisEntries, infinitySafeReplacer);
        if (initialAnalysisAppliedRef.current === signature) {
            return;
        }

        for (const entry of initialAnalysisEntries) {
            applyAnalysisSnapshotEntryEvals(entry, { clearEvalByPly, recordEvalByPly });
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
    const isDraggingPiece = editAllowed && dndController.state.isDragging;
    // 棋譜を見るだけの画面（ビューア）は、盤を操作させない。局面の編集も、駒を動かして変化を
    // 作ることもできない（調べたいときは、研究ノートで開く）。
    // 対局画面も、設定中（局面編集を開いていないとき）と終局後は盤を操作させない
    // （駒を動かして調べるのは研究ノート）。
    const boardLockedInViewer =
        viewerMode || (isPlayScreen && (playPhase === "setup" || playPhase === "finished"));
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
        setTimeSettings: changeTimeSettings,
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
        setDisplaySettings,
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

    // Props グループ化: Mobile専用
    const mobileSpecificProps: MobileSpecificProps = {
        searchInfo:
            displaySettings.showSearchInfo &&
            isMatchRunning &&
            liveSearchInfo &&
            engineStatus[liveSearchInfo.side] !== "error" ? (
                <SearchInfoPanel side={liveSearchInfo.side} info={liveSearchInfo.event} isMobile />
            ) : null,
        isReviewMode,
        reviewMode,
        onOpenAbout: () => setIsAboutOpen(true),
        onImportSfen: importSfenFromPanel,
        onImportKif: importKifFromPanel,
        onDisplaySettingsChange: setDisplaySettings,
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

    // ---- 対局画面（screen="play"）の状態と操作 ----
    // AI の考慮中や持ち時間の間に画面が消えないようにする（一時停止中は止めない）。
    useScreenWakeLock(isPlayScreen && playPhase === "playing");
    const notifyPlayPhase = useEffectEvent((phase: PlayPhase) => onPlayPhaseChange?.(phase));
    // 消すのは「指せない手」の知らせだけ（進み具合の変化と同じ更新で出たエラーは残す）。
    const clearIllegalMoveMessage = useEffectEvent(() => {
        if (message?.text === ILLEGAL_MOVE_MESSAGE) setMessage(null);
    });
    // 進み具合が変わったら、前の段階の選択とメッセージを持ち越さない
    // （「合法手ではありません」や駒の選択の枠が、一時停止中・終局後まで残らないようにする）。
    // biome-ignore lint/correctness/useExhaustiveDependencies: 進み具合が変わったときだけ
    useEffect(() => {
        if (!isPlayScreen) return;
        notifyPlayPhase(playPhase);
        setSelection(null);
        setPromotionSelection(null);
        clearIllegalMoveMessage();
    }, [isPlayScreen, playPhase]);
    // 指せない手を選んだ知らせは、しばらくしたら消す（次の手を考える邪魔にしない）。
    // 選んでいた駒の枠は、すぐ外す（知らせだけが先に消えて、枠が残るのを避ける）。
    // 依存は知らせそのもの（続けてもう一度指せない手を選んだときも、枠を外して数え直す）。
    useEffect(() => {
        if (!isPlayScreen || message?.text !== ILLEGAL_MOVE_MESSAGE) return;
        setSelection(null);
        const timer = setTimeout(() => setMessage(null), 2500);
        return () => clearTimeout(timer);
    }, [isPlayScreen, message, setMessage, setSelection]);
    const isHirateStart = isHirateSfen(startSfen);
    const playerNameFor = (side: Player): string => {
        const setting = sides[side];
        if (setting.role === "human") {
            // 人 対 人では、どちらも「あなた」にならないよう、先手・後手で呼ぶ。
            const bothHumans = sides.sente.role === "human" && sides.gote.role === "human";
            return bothHumans ? (side === "sente" ? "先手" : "後手") : "あなた";
        }
        const engine = engineOptions.find((option) => option.id === setting.engineId);
        if (engine?.kind === "external") return engine.label;
        const selection = side === "sente" ? senteNnueSelection : goteNnueSelection;
        const preset = presetConfigs.find((config) => config.presetKey === selection.presetKey);
        if (preset) return preset.displayName;
        const custom = nnueList.find((nnue) => nnue.id === selection.nnueId);
        return custom?.displayName ?? "簡易AI";
    };
    const openStudyNow = useEffectEvent(() => {
        // 対局者の名前を付けるのは、指した対局だけ（局面だけのノートは「取り込んだ局面」として作る）。
        onOpenAsStudy?.(
            navigation.tree,
            navigation.tree.nodes.size > 1
                ? { players: { sente: playerNameFor("sente"), gote: playerNameFor("gote") } }
                : {},
        );
    });
    // 局面の編集中は、棋譜のツリーが編集前の局面のまま。確定（編集モードを抜ける）を待ってから開く。
    useEffect(() => {
        if (!pendingOpenStudy || isEditMode) return;
        setPendingOpenStudy(false);
        openStudyNow();
    }, [pendingOpenStudy, isEditMode]);
    const treeFitsStudy = [...navigation.tree.nodes.values()].every(
        (node) => node.usiMove === null || isStudyUsiMove(node.usiMove),
    );
    // 終局後・一時停止から、同じ開始局面の設定の画面に戻す。
    const resetForNewGame = async () => {
        if (isPlayResetting) return;
        setIsPlayResetting(true);
        try {
            await resetForNewGameUnguarded();
        } finally {
            setIsPlayResetting(false);
        }
    };
    const resetForNewGameUnguarded = async () => {
        matchEndedRef.current = false;
        setGameResult(null);
        setShowResultDialog(false);
        setHintCount(0);
        setHintPly(null);
        setIsPaused(false);
        setPositionEditOpen(false);
        setPlayStartNotice(null);
        await stopAllEngines();
        const start = playStartRef.current ?? { sfen: startSfen, moves: [] };
        if (isHirateSfen(start.sfen) && start.moves.length === 0) {
            await handleResetToStartpos();
        } else {
            // 編集した局面・引き継いだ棋譜の途中から始めた対局は、同じ始まりの局面に戻す。
            await importSfen(start.sfen, start.moves);
        }
    };
    // 「もう一局」は、設定の画面に戻ったのを待ってから始める（戻す処理が行き渡ってから）。
    const startPlayMatch = async () => {
        if (isPlayStarting) return;
        setIsPlayStarting(true);
        // 前に出ていた知らせ（前回の開始の失敗など）を、始め直すときに持ち越さない。
        setMessage(null);
        try {
            await resumeAutoPlay();
        } finally {
            setIsPlayStarting(false);
        }
    };
    const startRematch = useEffectEvent(() => {
        void startPlayMatch();
    });
    useEffect(() => {
        if (!pendingRematch || isPlayResetting) return;
        setPendingRematch(false);
        // 設定の画面へ戻せなかった（開始局面の取得に失敗した）ときは、始めない。
        if (playPhase !== "setup" || moves.length !== (playStartRef.current?.moves.length ?? 0)) {
            return;
        }
        startRematch();
    }, [pendingRematch, isPlayResetting, playPhase, moves.length]);
    // 対局が実際に始まった時点の開始局面と手順を、この対局の始まりとして控える
    // （「もう一局」で戻す先と、待ったで戻せる範囲に使う）。
    useEffect(() => {
        if (!pendingPlayStartCapture || !isMatchRunning) return;
        setPendingPlayStartCapture(false);
        playStartRef.current = { sfen: startSfen, moves: [...moves] };
        setPlayStartPly(moves.length);
    }, [pendingPlayStartCapture, isMatchRunning, startSfen, moves]);
    const playConfig: PlayScreenConfig | null = isPlayScreen
        ? {
              phase: playPhase,
              isCustomStart: !isHirateStart || (playPhase === "setup" && moves.length > 0),
              busy: isPlayResetting || pendingRematch || isPlayStarting,
              startNotice: playPhase === "playing" && moves.length < 2 ? playStartNotice : null,
              startPly: playStartPly,
              startMatch: (notice?: string) => {
                  if (isPlayResetting || isPlayStarting) return;
                  setPositionEditOpen(false);
                  if (!isPaused) {
                      // 新しい対局の始まり。始まりの局面は、実際に始まった時点で控える
                      // （開始の処理が、編集した局面の確定やパス権の初期化で開始局面・手順を
                      // 作り直すことがあるので、押した時点の値は使わない）。
                      setPendingPlayStartCapture(true);
                      setPlayStartNotice(notice ?? null);
                      setHintCount(0);
                      setHintPly(null);
                  }
                  void startPlayMatch();
              },
              openPositionEditor: () => {
                  setPositionEditOpen(true);
                  if (!isEditMode) void handleEnterEditMode();
              },
              closePositionEditor: () => setPositionEditOpen(false),
              resetToStartpos: () => {
                  if (isPlayResetting || isPlayStarting) return;
                  void (async () => {
                      setIsPlayResetting(true);
                      try {
                          await handleResetToStartpos();
                      } finally {
                          setIsPlayResetting(false);
                      }
                  })();
              },
              startSfen,
              loadStartPosition: (sfen: string) => {
                  if (isPlayResetting || isPlayStarting) return;
                  void (async () => {
                      // 読み込みが済むまで、対局を始めさせない（読み込みがあとから完了すると、
                      // 始まった対局の局面を置き換えて止めてしまう）。
                      setIsPlayResetting(true);
                      try {
                          setPositionEditOpen(false);
                          await importSfen(sfen, []);
                      } finally {
                          setIsPlayResetting(false);
                      }
                  })();
              },
              playerNames: { sente: playerNameFor("sente"), gote: playerNameFor("gote") },
              editTurn: position.turn,
              setEditTurn: (turn: Player) => {
                  if (!editAllowed || turn === positionRef.current.turn) return;
                  applyEditedPosition({ ...positionRef.current, turn });
              },
              inCheck: isMatchRunning && isKingInCheck(position),
              newGame: () => {
                  void resetForNewGame();
              },
              rematch: () => {
                  void resetForNewGame().then(() => setPendingRematch(true));
              },
              openStudy:
                  onOpenAsStudy === undefined || isMatchRunning || !treeFitsStudy
                      ? null
                      : () => {
                            if (isEditMode) {
                                // 局面の準備が済んでいなければ、確定できない（待ちだけが残るのを避ける）。
                                if (!positionReady) return;
                                setPendingOpenStudy(true);
                                void handleStartReview();
                            } else {
                                openStudyNow();
                            }
                        },
              requestHint: () => {
                  setHintCount((count) => count + 1);
                  setHintPly(navigation.state.currentPly);
                  void handleAnalyzeHintPly(navigation.state.currentPly);
              },
              hintCount,
              hintPly,
              setupFooter: playSetupFooter ?? null,
              gameResult,
          }
        : null;

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
                    displaySettings.showSearchInfo &&
                    isMatchRunning &&
                    liveSearchInfo &&
                    engineStatus[liveSearchInfo.side] !== "error" && (
                        <SearchInfoPanel
                            side={liveSearchInfo.side}
                            info={liveSearchInfo.event}
                            isMobile={isMobile}
                        />
                    )}
            </TooltipProvider>
        </ShogiMatchProvider>
    );
}
