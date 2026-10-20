import type { LayerStacksConfig } from "@shogi/app-core";
import {
    applyMoveWithState,
    type BoardState,
    deriveLastMove,
    getPositionService,
    type NnueSelection,
    NONE_NNUE_SELECTION,
    type PieceType,
    type Player,
    type PositionState,
    type Square,
} from "@shogi/app-core";
import type {
    AiSupportSettings,
    ClockState,
    ErrorCode,
    GameResult,
    RoomClient,
    RoomClientStatus,
    RoomEvent,
    Seat,
    SnapshotPayload,
} from "@shogi/match-client";
import {
    getStoredResumeToken,
    isResumeTokenRejected,
    removeStoredResumeToken,
    removeStoredSeat,
} from "@shogi/match-client";
import type { ReactElement } from "react";
import { useEffect, useEffectEvent, useReducer, useRef, useState } from "react";
import { useLazyNnueLoader } from "../hooks/useLazyNnueLoader";
import { useScreenWakeLock } from "../hooks/useScreenWakeLock";
import { useShogiSound } from "../hooks/useShogiSound";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "./alert-dialog";
import { ConnectionLostNotice } from "./connection-lost-notice";
import { NnueManagerDialog } from "./nnue/NnueManagerDialog";
import type { RemoteNnueManager } from "./nnue/types";
import {
    createSerialQueue,
    exportGameKif,
    gameReducer,
    makeInitialGameState,
    resolveStartSfen,
    restorePosition,
    type SerialQueue,
    snapshotAnalysisRemaining,
} from "./online-game-state";
import { type AiHintMove, AiHintPanel } from "./shogi-match/components/AiHintPanel";
import { BottomSheet } from "./shogi-match/components/BottomSheet";
import { KifuNavigationToolbar } from "./shogi-match/components/KifuNavigationToolbar";
import { type HandInfo, MobileBoardSection } from "./shogi-match/components/MobileBoardSection";
import { PCBoardContent } from "./shogi-match/components/PCBoardContent";
import { PvPreviewDialog } from "./shogi-match/components/PvPreviewDialog";
import { TabHeader } from "./shogi-match/components/TabHeader";
import { useIsMobile } from "./shogi-match/hooks/useMediaQuery";
import type { PromotionSelection } from "./shogi-match/types";
import { formatMoveSimple } from "./shogi-match/utils/kifFormat";
import { computeMoveShadow } from "./shogi-match/utils/moveShadow";
import { boardToGrid } from "./shogi-match/utils/positionUtils";
import { determinePromotion } from "./shogi-match/utils/promotionLogic";

// ─── AI 解析インターフェース（export） ─────────────────────────────────────────

export interface AnalysisMoveResult {
    usi: string;
    cp: number;
    pv: string[];
}

export interface OnlineAnalysis {
    isAnalyzing: boolean;
    topMoves: AnalysisMoveResult[];
    startAnalysis: (sfen: string, moves: string[]) => Promise<void>;
    cancelAnalysis: () => Promise<void>;
    loadNnue?: (nnueId: string | null, layerStacks?: LayerStacksConfig) => Promise<void>;
}

// ─── 型定義 ───────────────────────────────────────────────────────────────────

const BOARD_DISPLAY_SETTINGS = {
    highlightLastMove: true,
    squareNotation: "none" as const,
    showBoardLabels: true,
};

// 時間フォーマット
function formatMs(ms: number): string {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

// サーバーに拒否された操作のうち、利用者がやり直せるものだけ案内する
function rejectedCommandNotice(code: ErrorCode, seat: Seat): string | null {
    if (code === "DESYNC") {
        return "局面が更新されました。もう一度操作してください。";
    }
    // 対局者の席でこのエラーになるのは、同じ席を後から開いた別の接続が操作している場合か、
    // この接続が席に結び付いていない場合。画面からはどちらか区別できないので断定しない
    if (code === "SPECTATOR_FORBIDDEN" && seat !== "s") {
        return "この画面からは操作できません。別のタブやウィンドウで対局中の場合は、そちらで続けてください。";
    }
    return null;
}

const CHECKMATE_REJECTED_NOTICE =
    "サーバーではこの局面を詰みと判定しませんでした。最新の局面を確認しています。指せる手が表示されないときは、投了で対局を終えてください。";

/** 局面も手番も終局も変えないイベント。指し手を送る準備の途中に届いても、その指し手は有効 */
const POSITION_KEEPING_EVENTS: ReadonlySet<RoomEvent["kind"]> = new Set([
    "player_offline",
    "player_online",
    "analysis_used",
    "settings_updated",
    "takeback_requested",
    "takeback_rejected",
    "takeback_cancelled",
]);

/** 再接続後、席へ戻った結果の snapshot を待つ上限。過ぎたら要求を送り直す */
const RESYNC_TIMEOUT_MS = 15_000;
/** snapshot の要求を送り直す回数の上限。尽きたら再読み込みを案内する */
const RESYNC_MAX_RETRIES = 2;

/**
 * 同期を待つ間にこれらが返ったら、送り直しても同じ席へは戻れない。ROOM_FINISHED は、切断中に
 * 終局した部屋へ参加し直そうとした観戦者（と、トークンを持たない対局者）に返る
 */
const SEAT_LOST_CODES: ReadonlySet<ErrorCode> = new Set([
    "INVALID_TOKEN",
    "ROOM_NOT_FOUND",
    "ROOM_EXPIRED",
    "ROOM_FULL",
    "ROOM_FINISHED",
]);

/**
 * 対局中の接続。reconnecting は WebSocket を開き直している間と、開いた後に席へ戻って
 * サーバーの snapshot を反映し終えるまで。lost は再接続か再同期を諦め、再読み込みを案内する状態。
 * rejected はサーバーが席への復帰を拒んだ状態で、finished は拒んだ理由が終局だったとき
 */
type GameConnection =
    | { state: "connected" }
    | { state: "reconnecting" }
    | { state: "lost"; canResume: boolean }
    | { state: "rejected"; finished: boolean };

/**
 * 届いた順に反映するサーバーからのメッセージ。initial は画面を開いたときの snapshot。
 * resync は、再接続後の同期を待っている間に届いた snapshot に付く、その再接続の番号
 */
type Incoming =
    | { t: "snapshot"; payload: SnapshotPayload; initial: boolean; resync?: number }
    | { t: "event"; payload: RoomEvent };

// ─── UI インタラクション状態管理 ───────────────────────────────────────────────

interface UIState {
    selectedSquare: string | null;
    selectedHand: PieceType | null;
    legalMoves: string[];
    promoteDialog: { from: string; to: string; usi: string } | null;
    navIndex: number | null;
    aiSheetOpen: boolean;
    kifuSheetOpen: boolean;
    endDialogClosed: boolean;
}

type UIAction =
    | { type: "move_received" } // selectedSquare, selectedHand, legalMoves を一括リセット
    | { type: "resync_received" } // 選択・成り選択・合法手・navIndex を一括リセット
    | { type: "clear_selection" } // selectedSquare, selectedHand を一括リセット
    | { type: "select_square"; squareId: string | null }
    | { type: "select_hand"; pieceType: PieceType | null }
    | { type: "set_legal_moves"; moves: string[] }
    | { type: "set_promote_dialog"; dialog: { from: string; to: string; usi: string } | null }
    | { type: "set_nav_index"; index: number | null }
    | { type: "set_ai_sheet_open"; open: boolean }
    | { type: "set_kifu_sheet_open"; open: boolean }
    | { type: "set_end_dialog_closed"; closed: boolean };

const INITIAL_UI_STATE: UIState = {
    selectedSquare: null,
    selectedHand: null,
    legalMoves: [],
    promoteDialog: null,
    navIndex: null,
    aiSheetOpen: false,
    kifuSheetOpen: false,
    endDialogClosed: false,
};

function uiReducer(state: UIState, action: UIAction): UIState {
    switch (action.type) {
        case "move_received":
            return { ...state, selectedSquare: null, selectedHand: null, legalMoves: [] };
        case "resync_received":
            return {
                ...state,
                selectedSquare: null,
                selectedHand: null,
                legalMoves: [],
                promoteDialog: null,
                navIndex: null,
            };
        case "clear_selection":
            return { ...state, selectedSquare: null, selectedHand: null };
        case "select_square":
            return { ...state, selectedSquare: action.squareId };
        case "select_hand":
            return { ...state, selectedHand: action.pieceType };
        case "set_legal_moves":
            return { ...state, legalMoves: action.moves };
        case "set_promote_dialog":
            return { ...state, promoteDialog: action.dialog };
        case "set_nav_index":
            return { ...state, navIndex: action.index };
        case "set_ai_sheet_open":
            return { ...state, aiSheetOpen: action.open };
        case "set_kifu_sheet_open":
            return { ...state, kifuSheetOpen: action.open };
        case "set_end_dialog_closed":
            return { ...state, endDialogClosed: action.closed };
    }
}

// ─── クロックフック ────────────────────────────────────────────────────────────

function useOnlineClock(clockState: ClockState | null): { b: number; w: number } {
    const [displayMs, setDisplayMs] = useState<{ b: number; w: number }>({ b: 0, w: 0 });

    useEffect(() => {
        if (!clockState) return;
        const update = (): void => {
            const elapsed = Date.now() - clockState.lastTickTs;
            setDisplayMs({
                b:
                    clockState.running === "b"
                        ? Math.max(0, clockState.b.remainMs - elapsed)
                        : clockState.b.remainMs,
                w:
                    clockState.running === "w"
                        ? Math.max(0, clockState.w.remainMs - elapsed)
                        : clockState.w.remainMs,
            });
        };
        update();
        const id = setInterval(update, 500);
        return () => clearInterval(id);
    }, [clockState]);

    return displayMs;
}

// ─── メインコンポーネント ──────────────────────────────────────────────────────

interface OnlineGameViewProps {
    client: RoomClient;
    snapshot: SnapshotPayload;
    seat: Seat;
    roomId: string;
    analysis?: OnlineAnalysis;
    manifestUrl?: string;
    remoteNnueManager?: RemoteNnueManager;
    onStartReview?: (data: {
        sfen: string;
        moves: string[];
        analysisMarkers: Array<{ seat: "b" | "w"; ply: number }>;
        gameRecordId: string | null;
    }) => void;
    onExit?: () => void;
    /** 参加した席のまま、サーバーが必ず snapshot を返す要求を送る。送る手段が無ければ false */
    requestFullSnapshot?: () => boolean;
}

export function OnlineGameView({
    client,
    snapshot,
    seat,
    roomId,
    analysis,
    manifestUrl,
    remoteNnueManager,
    onStartReview,
    onExit,
    requestFullSnapshot,
}: OnlineGameViewProps): ReactElement {
    // ─── AI サポート設定（makeInitialGameState の引数として使用するため先に定義） ──
    const aiSupport = snapshot.settings.aiSupport as AiSupportSettings | null;
    const myAiSettings = seat !== "s" && aiSupport ? aiSupport[seat === "b" ? "b" : "w"] : null;

    // ─── ゲーム状態（useReducer） ─────────────────────────────────────────────
    const [gameState, dispatch] = useReducer(gameReducer, undefined, () =>
        makeInitialGameState(snapshot, myAiSettings, seat),
    );
    const {
        position,
        positionHistory,
        turn,
        clockState,
        gameResult,
        offlineSeats,
        passRights,
        myAnalysisRemaining,
        analysisLog,
        usiMoveLog,
        pendingTakeback,
    } = gameState;

    // ─── UI インタラクション状態（useReducer） ───────────────────────────────
    const [uiState, dispatchUI] = useReducer(uiReducer, INITIAL_UI_STATE);
    const {
        selectedSquare,
        selectedHand,
        legalMoves,
        promoteDialog,
        navIndex,
        aiSheetOpen,
        kifuSheetOpen,
        endDialogClosed,
    } = uiState;

    // 右パネルのアクティブタブ
    const [rightTab, setRightTab] = useState<"kifu" | "ai">(aiSupport || analysis ? "ai" : "kifu");

    // analysis prop から分解（undefined 時のデフォルト値）
    const isAnalyzing = analysis?.isAnalyzing ?? false;
    const topMoves = analysis?.topMoves ?? [];
    // ミニサマリバー用評価値（先手視点 cp）
    const summaryEvalCp = topMoves[0]?.cp ?? null;
    const summaryEvalPercent =
        summaryEvalCp !== null ? Math.min(100, Math.max(0, 50 + (summaryEvalCp / 2000) * 50)) : 50;

    // 現在の start SFEN と moves
    const startSfenRef = useRef(resolveStartSfen(snapshot.settings.startSfen));
    const movesRef = useRef<string[]>([...snapshot.moves]);
    const gameRecordIdRef = useRef<string | null>(snapshot.gameRecordId ?? null);
    // 画面に反映し終えた最新のイベント。操作の送信にはこの番号を使う: 受信しただけで
    // まだ反映していないイベントの番号を送ると、古い局面を見て選んだ操作がサーバーを通ってしまう
    const appliedEventIdRef = useRef(snapshot.eventId);

    // 自分の手番か
    const myPlayer: Player | null = seat === "b" ? "sente" : seat === "w" ? "gote" : null;
    const isMyTurn =
        myPlayer !== null &&
        ((turn === "b" && myPlayer === "sente") || (turn === "w" && myPlayer === "gote"));
    const isSpectator = seat === "s";
    const [connection, setConnection] = useState<GameConnection>({ state: "connected" });
    // つながっていない間に送った操作は RoomClient が捨てる。再接続した直後も、サーバーの
    // 局面を反映し終えるまでは古い局面を見て選んだ操作になるので受け付けない
    const canSend = connection.state === "connected";
    // 対局中（観戦中も）は、相手の手を待つ間に画面が消えてロックされないようにする。つながり直せない
    // （再読み込みやトップへ戻る案内を出している）間は、消灯を止めない。
    useScreenWakeLock(
        !gameResult && (connection.state === "connected" || connection.state === "reconnecting"),
    );
    // 切断・再接続のたびに進む。非同期処理の前後で比べ、その間に接続が替わったかを知る
    const connectionEpochRef = useRef(0);
    // 再接続後、席へ戻った結果の snapshot を待っている間だけ、その再接続の番号を持つ
    const resyncRef = useRef<number | null>(null);
    const resyncRetriesRef = useRef(0);
    const resyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // 局面を変えるイベントや snapshot を反映するたびに進む
    const positionVersionRef = useRef(0);
    // 復帰を拒まれた後に開き直しても、同じトークンでは席へ戻れない
    const rejectedRef = useRef(false);
    const canPlay = isMyTurn && canSend;

    const totalPly = Math.max(0, positionHistory.length - 1);
    // 自分の手番になったら巻き戻しを解除してライブ追従（effect 不要、レンダー時に派生）
    const effectiveNavIndex = isMyTurn ? null : navIndex;
    const isRewound = effectiveNavIndex !== null;
    const currentPly = isRewound ? effectiveNavIndex : totalPly;
    // 表示用局面: 巻き戻し中は履歴局面、それ以外はライブ局面
    const displayPosition = isRewound ? (positionHistory[effectiveNavIndex] ?? null) : position;

    // ─── サーバーに拒否された操作の案内 ──────────────────────────────────────

    // 同じ案内が続いたときも表示時間を数え直せるよう、文言を毎回新しいオブジェクトで持つ
    const [commandNotice, setCommandNotice] = useState<{ text: string } | null>(null);
    useEffect(() => {
        if (!commandNotice) return;
        const timerId = setTimeout(() => setCommandNotice(null), 5000);
        return () => clearTimeout(timerId);
    }, [commandNotice]);

    // 詰みの申告を拒まれた局面の指し手。指せる手も無いまま止まらないよう、局面が変わるか
    // 終局するまで案内を出し続ける
    const [checkmateRejectedMoves, setCheckmateRejectedMoves] = useState<string | null>(null);
    // 詰みの申告を拒まれた局面の指し手。サーバーと食い違ったまま申告と拒否を繰り返さないよう、
    // その局面では申告し直さない。届かなかった申告は再接続後に送り直せるよう、送っただけでは記録しない
    const checkmateRejectedMovesRef = useRef<string | null>(null);
    const usiMovesKey = usiMoveLog.map((entry) => entry.usi).join(" ");
    const showsCheckmateRejected = !gameResult && checkmateRejectedMoves === usiMovesKey;

    const showRejection = useEffectEvent((code: ErrorCode): void => {
        const text = rejectedCommandNotice(code, seat);
        if (text) {
            setCommandNotice({ text });
        }
        if (code === "CHECKMATE_NOT_CONFIRMED") {
            checkmateRejectedMovesRef.current = usiMovesKey;
            setCheckmateRejectedMoves(usiMovesKey);
        }
        // 見ている局面が古いと指し直しても通らないので、取りこぼしたイベントを取り直す。
        // 詰みの申告が拒まれるのも、手元の局面がサーバーと食い違っているとき
        if (code === "DESYNC" || code === "CHECKMATE_NOT_CONFIRMED") {
            client.sync({ sinceEventId: appliedEventIdRef.current });
        }
    });

    // ─── 接続状態 ────────────────────────────────────────────────────────────

    const stopResync = useEffectEvent((): void => {
        resyncRef.current = null;
        if (resyncTimerRef.current !== null) {
            clearTimeout(resyncTimerRef.current);
            resyncTimerRef.current = null;
        }
    });

    const showConnectionLost = (): void => {
        setConnection({
            state: "lost",
            canResume: seat !== "s" && getStoredResumeToken(roomId) !== null,
        });
    };

    // snapshot を求め直せたら true。待ちが終わっていれば何もせず、回数を使い切ったら諦める
    const requestResyncSnapshot = useEffectEvent((resync: number): boolean => {
        if (resyncRef.current !== resync) return false;
        if (resyncRetriesRef.current >= RESYNC_MAX_RETRIES || !requestFullSnapshot?.()) {
            stopResync();
            showConnectionLost();
            return false;
        }
        resyncRetriesRef.current += 1;
        return true;
    });

    const waitForResync = (resync: number): void => {
        if (resyncTimerRef.current !== null) clearTimeout(resyncTimerRef.current);
        resyncTimerRef.current = setTimeout(() => {
            if (requestResyncSnapshot(resync)) waitForResync(resync);
        }, RESYNC_TIMEOUT_MS);
    };

    const retryResync = useEffectEvent((resync: number): void => {
        if (requestResyncSnapshot(resync)) waitForResync(resync);
    });

    const rejectResync = useEffectEvent((code: ErrorCode): void => {
        stopResync();
        // useRoomConnection は対局開始で購読をやめていて、この応答を見ない。二度と使えない
        // トークンをここで捨てないと、再読み込みのたびに同じ resume が拒まれる
        if (isResumeTokenRejected(code)) {
            removeStoredResumeToken(roomId);
            removeStoredSeat(roomId);
        }
        rejectedRef.current = true;
        setConnection({ state: "rejected", finished: code === "ROOM_FINISHED" });
    });

    const applyStatus = useEffectEvent((status: RoomClientStatus): void => {
        connectionEpochRef.current += 1;
        stopResync();
        if (rejectedRef.current) return;
        if (status === "reconnecting") {
            setConnection({ state: "reconnecting" });
        } else if (status === "disconnected") {
            showConnectionLost();
        } else if (status === "connected") {
            // WebSocket が開いても、席へ戻れたかは分からない。対局者は RoomClient が必ず snapshot の
            // 返る resume を送り、観戦者は useRoomConnection が開き直した接続で参加し直すので、
            // どちらも応答の snapshot を反映し終えたら戻す
            const resync = connectionEpochRef.current;
            resyncRef.current = resync;
            resyncRetriesRef.current = 0;
            waitForResync(resync);
        }
    });

    const { playSound } = useShogiSound();
    const playSoundEvent = useEffectEvent(playSound);

    // ─── サーバーからのメッセージの反映 ──────────────────────────────────────

    // 局面の解析は非同期なので、メッセージごとに別々に進めると、後から届いたものが先に
    // 反映されたり、古い snapshot が新しい指し手を巻き戻したりする。画面を開いたときの
    // snapshot も含めて 1 本の列に並べ、届いた順に 1 件ずつ反映し終えてから次へ進む
    const incomingRef = useRef<SerialQueue<Incoming> | null>(null);
    const initialSnapshotRef = useRef(snapshot);
    const isListeningRef = useRef(false);
    const [loadFailed, setLoadFailed] = useState(false);

    const applyIncoming = useEffectEvent((incoming: Incoming): void | Promise<void> => {
        if (incoming.t === "snapshot") {
            const { payload, initial } = incoming;
            // 画面を開いたときの snapshot を復元できないと盤面を出せないので、1 度だけやり直す
            const restoring = initial
                ? restorePosition(payload).catch(() => restorePosition(payload))
                : restorePosition(payload);
            return restoring.then(
                (restored) => {
                    if (!isListeningRef.current) return;
                    setLoadFailed(false);
                    appliedEventIdRef.current = payload.eventId;
                    startSfenRef.current = resolveStartSfen(payload.settings.startSfen);
                    movesRef.current = [...payload.moves];
                    // 終局イベントは購読開始より前に配信済みのことがあるので、snapshot からも復元する
                    if (payload.result) {
                        dispatch({ type: "result", result: payload.result });
                    }
                    if (payload.gameRecordId) {
                        gameRecordIdRef.current = payload.gameRecordId;
                    }
                    if (initial) {
                        dispatch({ type: "init", ...restored });
                        return;
                    }
                    positionVersionRef.current += 1;
                    if (incoming.resync !== undefined && incoming.resync === resyncRef.current) {
                        stopResync();
                        setConnection({ state: "connected" });
                    }
                    dispatch({
                        type: "resync",
                        ...restored,
                        turn: payload.turn,
                        clock: payload.clock,
                        passRights: payload.passRights,
                        pendingTakeback: payload.pendingTakeback,
                        myAnalysisRemaining: snapshotAnalysisRemaining(payload, seat),
                        analysisLog: payload.analysisLog,
                    });
                    dispatchUI({ type: "resync_received" }); // 再接続後は最新局面に戻す
                },
                (err) => {
                    console.error("[OnlineGameView] Failed to parse SFEN from snapshot:", err);
                    if (!isListeningRef.current) return;
                    if (initial) {
                        setLoadFailed(true);
                        // 局面が無いままでは指せず、snapshot が届くまで待つしかないので取り寄せる。
                        // 届いた snapshot も読めなければ、再接続後の同期と同じく回数を区切って諦める。
                        // 再接続後の同期が既に待っていれば、その snapshot で作り直せるので引き継ぐ
                        const resync = connectionEpochRef.current;
                        if (resyncRef.current === resync) return;
                        resyncRef.current = resync;
                        resyncRetriesRef.current = 0;
                        if (requestFullSnapshot?.()) {
                            waitForResync(resync);
                        } else {
                            stopResync();
                        }
                        return;
                    }
                    // sync の応答は差分イベントだけのことがあるので、同期待ちなら snapshot を求め直す
                    if (incoming.resync !== undefined && incoming.resync === resyncRef.current) {
                        retryResync(incoming.resync);
                        return;
                    }
                    // サーバーに再同期リクエストを送信して最新状態を取得する
                    client.sync({ sinceEventId: appliedEventIdRef.current });
                },
            );
        }

        const e = incoming.payload;
        // 終局済みルームへ再接続すると、snapshot に反映済みのイベントが後から届く。
        // 二重に適用しないよう、終局の通知以外は読み飛ばす
        const alreadyApplied = e.eventId <= appliedEventIdRef.current;
        // サーバーは指し手以外のイベントでもイベント番号を増やすので、すべてのイベントで更新する
        const markApplied = (): void => {
            appliedEventIdRef.current = Math.max(appliedEventIdRef.current, e.eventId);
            if (!POSITION_KEEPING_EVENTS.has(e.kind)) {
                positionVersionRef.current += 1;
            }
        };

        if (e.kind === "game_end") {
            if (e.gameRecordId) {
                gameRecordIdRef.current = e.gameRecordId;
            }
            dispatch({ type: "result", result: e.result });
        } else if (
            e.kind === "resign" ||
            e.kind === "timeout" ||
            e.kind === "checkmate" ||
            e.kind === "sennichite" ||
            e.kind === "illegal_move" ||
            e.kind === "disconnect_loss"
        ) {
            dispatch({ type: "result", result: e.result });
        } else if (alreadyApplied) {
            return;
        } else if (e.kind === "takeback_accepted") {
            return getPositionService()
                .parseSfen(e.sfen)
                .then((pos) => {
                    if (!isListeningRef.current) return;
                    movesRef.current = movesRef.current.slice(0, -1);
                    dispatch({
                        type: "takeback_accepted",
                        position: pos,
                        turn: e.turn,
                        clock: e.clock,
                        passRights: e.passRights,
                    });
                    dispatchUI({ type: "resync_received" });
                    markApplied();
                });
        } else if (e.kind === "move") {
            dispatch({
                type: "move",
                usi: e.usi,
                turn: e.turn,
                clock: e.clock,
                passRights: e.passRights,
                elapsedMs: e.elapsedMs,
            });
            movesRef.current = [...movesRef.current, e.usi];
            dispatchUI({ type: "move_received" });

            // ─── 着手通知 ────────────────────────────────────────
            // e.turn は着手後の次の手番。自分の席が次手番 = 相手が指した
            const isOpponentMove = seat !== "s" && e.turn === seat;
            if (e.usi === "pass") {
                playSoundEvent("pass");
            } else if (isOpponentMove || seat === "s") {
                playSoundEvent("move_opponent");
            } else {
                playSoundEvent("move_self");
            }
        } else if (e.kind === "player_offline") {
            dispatch({ type: "player_offline", seat: e.seat });
        } else if (e.kind === "player_online") {
            dispatch({ type: "player_online", seat: e.seat });
        } else if (e.kind === "analysis_used" && (e.seat === "b" || e.seat === "w")) {
            dispatch({
                type: "analysis_used",
                isMySeat: e.seat === seat,
                seat: e.seat,
                analysisRemaining: e.analysisRemaining,
                ply: movesRef.current.length,
            });
        } else if (e.kind === "takeback_requested" && (e.seat === "b" || e.seat === "w")) {
            dispatch({ type: "takeback_requested", seat: e.seat, ply: e.ply });
        } else if (e.kind === "takeback_rejected") {
            dispatch({ type: "takeback_rejected" });
        } else if (e.kind === "takeback_cancelled") {
            dispatch({ type: "takeback_cancelled" });
        }
        markApplied();
    });

    useEffect(() => {
        isListeningRef.current = true;
        if (!incomingRef.current) {
            incomingRef.current = createSerialQueue<Incoming>(
                (incoming) => applyIncoming(incoming),
                () => isListeningRef.current,
            );
            incomingRef.current.push({
                t: "snapshot",
                payload: initialSnapshotRef.current,
                initial: true,
            });
        } else {
            incomingRef.current.resume();
        }
        const incoming = incomingRef.current;
        const unsub = client.subscribe((msg) => {
            if (msg.t === "event") {
                incoming.push(msg);
            } else if (msg.t === "snapshot") {
                incoming.push({
                    t: "snapshot",
                    payload: msg.payload,
                    initial: false,
                    resync: resyncRef.current ?? undefined,
                });
            } else if (msg.t === "error") {
                if (resyncRef.current !== null && SEAT_LOST_CODES.has(msg.payload.code)) {
                    rejectResync(msg.payload.code);
                    return;
                }
                showRejection(msg.payload.code);
            }
        });
        const initialStatus = client.getStatus();
        if (initialStatus === "reconnecting" || initialStatus === "disconnected") {
            applyStatus(initialStatus);
        }
        const unsubStatus = client.subscribeStatus(applyStatus);
        return () => {
            unsub();
            unsubStatus();
            stopResync();
            // 解析の途中で画面を離れたら、その結果も残りのメッセージも反映しない
            isListeningRef.current = false;
        };
    }, [client]);

    // ─── 合法手の取得 ────────────────────────────────────────────────────────

    useEffect(() => {
        // 巻き戻し中は合法手を表示しない
        // passRightsOption は try/catch の外で計算する（React Compiler の制約）
        const passRightsOption = passRights
            ? { passRights: { sente: passRights.b, gote: passRights.w } }
            : {};
        let cancelled = false;
        void (async () => {
            // position に依存させる: 手番が変わらないまま局面だけ変わる再同期でも、
            // 反映し終えた局面の合法手を取り直す
            if (position && canPlay && !gameResult && !isRewound) {
                try {
                    const moves = await getPositionService().getLegalMoves(
                        startSfenRef.current,
                        movesRef.current,
                        passRightsOption,
                    );
                    if (cancelled) return;
                    dispatchUI({ type: "set_legal_moves", moves });
                    // 合法手が0 = 自分が詰まされている → サーバーに通知
                    const movesKey = movesRef.current.join(" ");
                    if (moves.length === 0 && checkmateRejectedMovesRef.current !== movesKey) {
                        client.checkmate({ eventId: appliedEventIdRef.current });
                    }
                } catch {
                    if (!cancelled) {
                        dispatchUI({ type: "set_legal_moves", moves: [] });
                    }
                }
            } else {
                dispatchUI({ type: "set_legal_moves", moves: [] });
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [canPlay, gameResult, isRewound, passRights, client, position]);

    // ─── 棋譜ナビゲーションハンドラ ───────────────────────────────────────────

    const handleNavBack = () => {
        const cur = navIndex !== null ? navIndex : positionHistory.length - 1;
        dispatchUI({ type: "set_nav_index", index: Math.max(0, cur - 1) });
    };

    const handleNavForward = () => {
        if (navIndex === null) return;
        const next = navIndex + 1;
        // 最新局面に追いついたらライブ追従モードに戻す
        dispatchUI({
            type: "set_nav_index",
            index: next >= positionHistory.length - 1 ? null : next,
        });
    };

    const handleNavStart = () => dispatchUI({ type: "set_nav_index", index: 0 });
    const handleNavEnd = () => dispatchUI({ type: "set_nav_index", index: null });

    // ─── 指し手送信 ──────────────────────────────────────────────────────────

    const sendMove = async (usi: string, _toSquare?: string): Promise<void> => {
        if (!position || !canSend) return;
        const positionVersion = positionVersionRef.current;
        const epoch = connectionEpochRef.current;
        // パス手は局面変化なし（手番のみ交代）。PositionState に passRights がないため
        // applyMoveWithState は使わず、手番を反転した局面の SFEN を生成する
        const nextPos =
            usi === "pass"
                ? {
                      ...position,
                      turn: (position.turn === "sente" ? "gote" : "sente") as "sente" | "gote",
                  }
                : applyMoveWithState(position, usi).next;
        const nextSfen = await getPositionService().boardToSfen(nextPos);
        // 変換を待つ間に切断や局面の更新があると、古い局面の SFEN を送ることになる
        if (connectionEpochRef.current !== epoch) {
            setCommandNotice({ text: "指し手を送れませんでした。もう一度操作してください。" });
            return;
        }
        if (positionVersionRef.current !== positionVersion) {
            setCommandNotice({ text: "局面が更新されました。もう一度操作してください。" });
            return;
        }
        // 局面が変わっていなければ、その間に進んだイベント番号で送っても同じ局面を指す
        client.move({ eventId: appliedEventIdRef.current, usi, sfen: nextSfen });
    };

    // ─── 盤面クリック処理 ────────────────────────────────────────────────────

    function handleBoardSelect(squareId: string): void {
        if (!canPlay || gameResult || !position) return;

        // 持ち駒を選択中の場合 → ドロップ
        if (selectedHand !== null) {
            // 合法手は小文字 USI 形式（例: "P*7f"）。squareId は小文字
            const usi = `${selectedHand}*${squareId}`;
            if (legalMoves.includes(usi)) {
                void sendMove(usi, squareId);
            }
            dispatchUI({ type: "clear_selection" });
            return;
        }

        // 盤上の駒を選択中の場合 → 移動
        if (selectedSquare) {
            if (selectedSquare === squareId) {
                dispatchUI({ type: "select_square", squareId: null });
                return;
            }
            // 合法手は小文字 USI 形式（例: "7g7f", "7g7f+"）
            // selectedSquare / squareId はマス ID（小文字）なのでそのまま使用
            const from = selectedSquare;
            const to = squareId;
            const usiBase = `${from}${to}`;
            const usiPromote = `${usiBase}+`;

            const canMove = legalMoves.some((m) => m === usiBase || m === usiPromote);
            if (!canMove) {
                // 別の自分の駒を選択
                const piece = position.board[squareId as keyof typeof position.board];
                if (
                    piece &&
                    ((piece.owner === "sente" && myPlayer === "sente") ||
                        (piece.owner === "gote" && myPlayer === "gote"))
                ) {
                    dispatchUI({ type: "select_square", squareId });
                } else {
                    dispatchUI({ type: "select_square", squareId: null });
                }
                return;
            }

            const promotion = determinePromotion(new Set(legalMoves), from, to);

            if (promotion === "forced") {
                void sendMove(usiPromote, squareId);
            } else if (promotion === "optional") {
                dispatchUI({
                    type: "set_promote_dialog",
                    dialog: { from: selectedSquare, to: squareId, usi: usiBase },
                });
            } else {
                void sendMove(usiBase, squareId);
            }
            dispatchUI({ type: "select_square", squareId: null });
            return;
        }

        // 新たに駒を選択
        const piece = position?.board[squareId as keyof typeof position.board];
        if (
            piece &&
            ((piece.owner === "sente" && myPlayer === "sente") ||
                (piece.owner === "gote" && myPlayer === "gote"))
        ) {
            dispatchUI({ type: "select_square", squareId });
        }
    }

    function handleHandSelect(pieceType: PieceType): void {
        if (!canPlay || gameResult || isRewound) return;
        dispatchUI({
            type: "select_hand",
            pieceType: selectedHand === pieceType ? null : pieceType,
        });
        dispatchUI({ type: "select_square", squareId: null });
    }

    // ─── 投了 ────────────────────────────────────────────────────────────────

    function handleResign(): void {
        if (!canPlay || !position) return;
        client.resign({ eventId: appliedEventIdRef.current });
    }

    // 投了は取り消せないので、確かめてから送る（スマホでは隣の「棋譜」「待った」と押し間違えやすい）。
    const [isResignConfirmOpen, setIsResignConfirmOpen] = useState(false);

    // ─── 待った ───────────────────────────────────────────────────────────────

    function handleTakebackRequest(): void {
        client.takebackRequest({ eventId: appliedEventIdRef.current });
    }

    function handleTakebackResponse(accept: boolean): void {
        client.takebackResponse({ eventId: appliedEventIdRef.current, accept });
    }

    function handleTakebackCancel(): void {
        client.takebackCancel({ eventId: appliedEventIdRef.current });
    }

    // ─── AI 解析トリガー ─────────────────────────────────────────────────────

    // 解析を開始した局面の board/turn を保存（formatMoveSimple に渡すため）
    const [analysisBoard, setAnalysisBoard] = useState<BoardState | null>(null);
    const [analysisTurn, setAnalysisTurn] = useState<"b" | "w">("b");
    // PVプレビュー用に局面と手数も保存
    const [analysisPosition, setAnalysisPosition] = useState<PositionState | null>(null);
    const [analysisPly, setAnalysisPly] = useState<number>(0);
    // PVプレビューダイアログ
    const [pvPreviewMove, setPvPreviewMove] = useState<AiHintMove | null>(null);

    // 制限モードは use_analysis を先送信してからエンジン解析（観戦者はスキップ）
    const analysisNeedsServer = myAiSettings?.mode === "limited" && seat !== "s";

    const handleAnalyze = async () => {
        if (!position || (analysisNeedsServer && !canSend)) return;
        if (analysisNeedsServer) {
            const ply = movesRef.current.length;
            client.consumeAnalysis({ eventId: appliedEventIdRef.current, ply });
            // analysis_used 受信後に自動で残り回数が更新される
        }
        if (analysis) {
            setAnalysisBoard(position.board);
            setAnalysisTurn(turn);
            setAnalysisPosition(position);
            setAnalysisPly(movesRef.current.length);
            void analysis.startAnalysis(startSfenRef.current, movesRef.current);
        }
    };

    // ─── NNUE 管理 ───────────────────────────────────────────────────────────

    const [nnueSelection, setNnueSelection] = useState<NnueSelection>(NONE_NNUE_SELECTION);
    const [nnueManagerOpen, setNnueManagerOpen] = useState(false);
    const { resolveNnue } = useLazyNnueLoader();
    const isMobile = useIsMobile();

    const loadNnueEvent = useEffectEvent((sel: NnueSelection) => {
        if (!analysis?.loadNnue) return;
        resolveNnue(sel)
            .then((resolved) =>
                analysis.loadNnue?.(resolved?.nnueId ?? null, resolved?.layerStacks),
            )
            .catch(console.error);
    });
    useEffect(() => {
        loadNnueEvent(nnueSelection);
    }, [nnueSelection]);

    // ─── AI 手の盤面適用 ──────────────────────────────────────────────────────

    function handleApplyAiMove(usiMove: string): void {
        if (!position || !canPlay || gameResult) return;
        void sendMove(usiMove);
    }

    // ─── 制限モード: 自分の手番になったらAIシートを自動で開く ────────────────────

    const prevIsMyTurnRef = useRef(false);
    useEffect(() => {
        if (!isMobile) return;
        if (!aiSupport || isSpectator || !myAiSettings || gameResult) return;
        if (myAiSettings.mode !== "limited") return;
        if (isMyTurn && !prevIsMyTurnRef.current && (myAnalysisRemaining ?? 1) > 0) {
            dispatchUI({ type: "set_ai_sheet_open", open: true });
        }
        prevIsMyTurnRef.current = isMyTurn;
    }, [isMyTurn, aiSupport, isMobile, isSpectator, myAiSettings, myAnalysisRemaining, gameResult]);

    useEffect(() => {
        if (isMobile) return;
        if (!aiSheetOpen) return;
        dispatchUI({ type: "set_ai_sheet_open", open: false });
    }, [aiSheetOpen, isMobile]);

    // ─── KIF ダウンロード ─────────────────────────────────────────────────────

    function handleDownloadKifu(): void {
        if (!generatedKif) return;
        const blob = new Blob([generatedKif], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `game-${roomId}.kif`;
        a.click();
        URL.revokeObjectURL(url);
    }

    // ─── レンダリング ─────────────────────────────────────────────────────────

    const flipBoard = seat === "w";
    // 表示用盤面（巻き戻し中は履歴局面を使用、後手視点は反転）
    const grid = (() => {
        if (!displayPosition) return [];
        const g = boardToGrid(displayPosition.board);
        return flipBoard ? [...g].reverse().map((row) => [...row].reverse()) : g;
    })();
    const clockDisplay = useOnlineClock(clockState);

    // 最後の指し手（ハイライト用）
    const lastMoveUsi = isRewound
        ? usiMoveLog[(effectiveNavIndex ?? 0) - 1]?.usi
        : usiMoveLog.at(-1)?.usi;
    const lastMove = deriveLastMove(lastMoveUsi);

    // モバイル用 ref（MobileBoardSection の必須 props のため）
    const boardSectionRef = useRef<HTMLDivElement | null>(null);

    // 成り選択状態（MobileBoardSection へ渡す用）
    const promotionSelection: PromotionSelection | null = (() => {
        if (!promoteDialog || !displayPosition || !canSend) return null;
        const piece =
            displayPosition.board[promoteDialog.from as keyof typeof displayPosition.board];
        if (!piece) return null;
        return {
            from: promoteDialog.from as Square,
            to: promoteDialog.to as Square,
            piece,
        };
    })();

    // 上下の持ち駒情報（MobileBoardSection へ渡す用）
    const topOwner: Player = flipBoard ? "sente" : "gote";
    const bottomOwner: Player = flipBoard ? "gote" : "sente";
    const topHand: HandInfo = {
        owner: topOwner,
        hand: displayPosition?.hands[topOwner] ?? ({} as PositionState["hands"]["sente"]),
        isActive: !isRewound && canPlay && myPlayer === topOwner,
        isAI: false,
    };
    const bottomHand: HandInfo = {
        owner: bottomOwner,
        hand: displayPosition?.hands[bottomOwner] ?? ({} as PositionState["hands"]["sente"]),
        isActive: !isRewound && canPlay && myPlayer === bottomOwner,
        isAI: false,
    };
    const onSquareSelect = !isRewound && canPlay && !isSpectator ? handleBoardSelect : () => {};
    const onPromotionChoiceForMobile = (promote: boolean) => {
        if (!promoteDialog) return;
        void sendMove(promote ? `${promoteDialog.usi}+` : promoteDialog.usi, promoteDialog.to);
        dispatchUI({ type: "set_promote_dialog", dialog: null });
    };

    // 選んでいる駒の影（マウスを乗せた行き先に出す）。合法手は自分の手番のあいだ既に持っている
    const selection = selectedSquare
        ? ({ kind: "square", square: selectedSquare } as const)
        : selectedHand
          ? ({ kind: "hand", piece: selectedHand } as const)
          : null;
    const moveShadow =
        displayPosition && !isRewound && canPlay && !isSpectator
            ? computeMoveShadow({
                  selection,
                  grid,
                  turn: displayPosition.turn,
                  legalMoves,
              })
            : null;

    const playerNames = {
        b: snapshot.players.b?.name ?? "先手",
        w: snapshot.players.w?.name ?? "後手",
    };

    // KIF テキスト（対局終了後のダウンロード・コピー用）
    const generatedKif = exportGameKif(gameState, snapshot.settings.startSfen, playerNames);

    // 画面全体を覆うので、つながっていない間に出すと再読み込みの案内を押せなくなる
    const showTakebackApproval =
        pendingTakeback !== null &&
        pendingTakeback.seat !== seat &&
        !isSpectator &&
        !gameResult &&
        canSend;

    // PC サイドバーとモバイル BottomSheet で共通利用するコンテンツ
    const canAnalyzeNow =
        !gameResult && (isMyTurn || isSpectator) && (canSend || !analysisNeedsServer);
    const analyzeHintText =
        !gameResult && !isMyTurn && !isSpectator
            ? "相手の手番中は解析できません。自分の手番になってから使用してください。"
            : !gameResult && !canSend && analysisNeedsServer
              ? "接続が戻るまで解析できません。"
              : "「解析する」を押すと現在の局面をAIが分析します";
    const aiPanelContent =
        aiSupport || analysis ? (
            <OnlineAiPanel
                aiSupport={aiSupport ?? undefined}
                seat={seat}
                myAnalysisRemaining={myAnalysisRemaining}
                isAnalyzing={isAnalyzing}
                topMoves={topMoves}
                canAnalyze={canAnalyzeNow}
                analyzeHint={analyzeHintText}
                onAnalyze={() => void handleAnalyze()}
                analysisBoard={analysisBoard}
                analysisTurn={analysisTurn}
                nnueSelection={nnueSelection}
                onNnueSelectionChange={setNnueSelection}
                onOpenNnueManager={() => setNnueManagerOpen(true)}
                onApplyMove={
                    canPlay && !gameResult && !isSpectator
                        ? (usiMove) => Promise.resolve(handleApplyAiMove(usiMove))
                        : undefined
                }
                onPreviewPv={analysisPosition ? setPvPreviewMove : undefined}
            />
        ) : null;

    // PC サイドバー・モバイル BottomSheet 共通: 棋譜リスト
    const kifuPanelContent = (
        <div className="flex flex-col gap-1 overflow-y-auto max-h-[50dvh] md:max-h-[calc(100dvh-160px)]">
            {usiMoveLog.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                    まだ指し手がありません
                </p>
            ) : (
                usiMoveLog
                    .map((entry, i) => ({
                        ply: i + 1,
                        usi: entry.usi,
                        pos: positionHistory[i],
                    }))
                    .map((item) => {
                        const moveText = item.pos
                            ? formatMoveSimple(item.usi, item.pos.turn, item.pos.board)
                            : item.usi;
                        const isCurrentPly = currentPly === item.ply;
                        return (
                            <button
                                key={item.ply}
                                type="button"
                                disabled={!gameResult && !isSpectator}
                                onClick={() =>
                                    dispatchUI({
                                        type: "set_nav_index",
                                        index:
                                            item.ply >= positionHistory.length - 1
                                                ? null
                                                : item.ply,
                                    })
                                }
                                className={`flex gap-2 text-xs px-2 py-1 rounded text-left transition-colors ${
                                    isCurrentPly
                                        ? "bg-wafuu-kincha/20 text-wafuu-kincha font-medium"
                                        : "hover:bg-muted disabled:cursor-default"
                                }`}
                            >
                                <span className="text-muted-foreground w-6 shrink-0 tabular-nums">
                                    {item.ply}.
                                </span>
                                <span>{moveText}</span>
                            </button>
                        );
                    })
            )}
        </div>
    );

    return (
        <div className="flex flex-col md:flex-row gap-4 p-4 max-w-[1100px] mx-auto">
            {/* 左サイドバー: 対局後検討・NNUE設定など（PC のみ表示） */}
            <div className="hidden md:flex w-64 flex-col gap-3" />

            {/* 接続の通知: 盤面の上に重ね、出し入れで盤面が動かないようにする */}
            <div className="pointer-events-none fixed top-4 left-1/2 -translate-x-1/2 z-50 flex w-[min(90vw,420px)] flex-col items-center gap-2">
                {offlineSeats.size > 0 && (
                    <div className="rounded-lg bg-destructive px-4 py-2 text-sm text-destructive-foreground shadow-lg">
                        {Array.from(offlineSeats).map((s) => (
                            <span key={s}>{s === "b" ? "先手" : "後手"}が切断しました</span>
                        ))}
                    </div>
                )}
                {!gameResult && connection.state === "reconnecting" && (
                    <output className="rounded-lg border border-border bg-card px-4 py-2 text-sm text-muted-foreground shadow-lg">
                        再接続中...
                    </output>
                )}
                {!gameResult && connection.state === "lost" && (
                    <ConnectionLostNotice
                        reason={connection.canResume ? "seat" : "reload"}
                        className="pointer-events-auto w-full shadow-lg"
                    />
                )}
                {!gameResult &&
                    connection.state === "rejected" &&
                    (connection.finished && onExit ? (
                        <ConnectionLostNotice
                            reason="finished"
                            onExit={onExit}
                            className="pointer-events-auto w-full shadow-lg"
                        />
                    ) : (
                        // 戻り先を渡されていなければ、終局していても再読み込みで画面を出し直してもらう
                        <ConnectionLostNotice
                            reason={connection.finished ? "reload" : "session"}
                            className="pointer-events-auto w-full shadow-lg"
                        />
                    ))}
            </div>

            {/* メインコンテンツ */}
            <div className={`flex flex-col gap-3 ${isMobile ? "items-center" : "flex-1"}`}>
                {/* 奥側プレイヤー情報（上）: 後手視点では先手が奥 */}
                <PlayerHeader
                    name={flipBoard ? playerNames.b : playerNames.w}
                    seat={flipBoard ? "b" : "w"}
                    isMyTurn={flipBoard ? turn === "b" : turn === "w"}
                    remainMs={flipBoard ? clockDisplay.b : clockDisplay.w}
                    isOffline={flipBoard ? offlineSeats.has("b") : offlineSeats.has("w")}
                    isFlipped={flipBoard}
                    passRightsCount={
                        passRights != null ? (flipBoard ? passRights.b : passRights.w) : undefined
                    }
                />

                {isMobile ? (
                    // === モバイル: MobileBoardSection が持ち駒を含めて表示 ===
                    displayPosition ? (
                        <MobileBoardSection
                            grid={grid}
                            position={displayPosition}
                            flipBoard={flipBoard}
                            lastMove={lastMove}
                            selection={selection}
                            moveShadow={moveShadow}
                            promotionSelection={promotionSelection}
                            displaySettings={BOARD_DISPLAY_SETTINGS}
                            isEditModeActive={false}
                            isMatchRunning={!gameResult}
                            hideEmptyHandPieces={true}
                            editFromSquare={null}
                            candidateNote={null}
                            onSquareSelect={onSquareSelect}
                            onPromotionChoice={onPromotionChoiceForMobile}
                            onHandSelect={handleHandSelect}
                            topHand={topHand}
                            bottomHand={bottomHand}
                            boardSectionRef={boardSectionRef}
                            isDraggingPiece={false}
                        />
                    ) : (
                        <div className="flex h-64 items-center justify-center">
                            <p className="text-muted-foreground">局面を読み込み中...</p>
                        </div>
                    )
                ) : // === PC: PCBoardContent（オフラインと共通） ===
                displayPosition ? (
                    // w-fit + items-center でオフライン PCBoardSection と同じ構造にする
                    // （持ち駒の w-full が盤面幅に揃い、gap-2 でオフラインと間隔を統一）
                    <div className="w-fit flex flex-col gap-2 items-center self-center">
                        <PCBoardContent
                            grid={grid}
                            flipBoard={flipBoard}
                            lastMove={lastMove}
                            selection={selection}
                            moveShadow={moveShadow}
                            promotionSelection={promotionSelection}
                            displaySettings={BOARD_DISPLAY_SETTINGS}
                            isEditModeActive={false}
                            isMatchRunning={!gameResult}
                            hideEmptyHandPieces={true}
                            editFromSquare={null}
                            candidateNote={null}
                            onSquareSelect={onSquareSelect}
                            onPromotionChoice={onPromotionChoiceForMobile}
                            onHandSelect={handleHandSelect}
                            topHand={topHand}
                            bottomHand={bottomHand}
                            passRights={
                                passRights ? { sente: passRights.b, gote: passRights.w } : undefined
                            }
                        />
                    </div>
                ) : (
                    <div className="flex h-64 items-center justify-center rounded-lg border border-border bg-card">
                        <p className="text-muted-foreground">局面を読み込み中...</p>
                    </div>
                )}

                {/* 手前側プレイヤー情報（下）: 後手視点では後手が手前 */}
                <PlayerHeader
                    name={flipBoard ? playerNames.w : playerNames.b}
                    seat={flipBoard ? "w" : "b"}
                    isMyTurn={flipBoard ? turn === "w" : turn === "b"}
                    remainMs={flipBoard ? clockDisplay.w : clockDisplay.b}
                    isOffline={flipBoard ? offlineSeats.has("w") : offlineSeats.has("b")}
                    isFlipped={flipBoard}
                    passRightsCount={
                        passRights != null ? (flipBoard ? passRights.w : passRights.b) : undefined
                    }
                />

                {gameResult && (
                    <GameResultStrip
                        shown={endDialogClosed}
                        text={`${formatGameResultTitle(gameResult, playerNames)}（${formatGameEndReason(gameResult)}）`}
                        onReopen={() =>
                            dispatchUI({ type: "set_end_dialog_closed", closed: false })
                        }
                    />
                )}

                {/* 棋譜ナビゲーション */}
                {positionHistory.length > 0 && (
                    <KifuNavigationToolbar
                        currentPly={currentPly}
                        totalPly={totalPly}
                        onBack={handleNavBack}
                        onForward={handleNavForward}
                        onToStart={handleNavStart}
                        onToEnd={handleNavEnd}
                        isRewound={isRewound}
                        disabled={!gameResult && !isSpectator}
                    />
                )}

                {/* 待った: 申請中バナー（申請者向け） */}
                {pendingTakeback && pendingTakeback.seat === seat && !isSpectator && (
                    <div className="flex items-center justify-between rounded-lg border border-wafuu-kincha/40 bg-wafuu-kincha/10 px-3 py-2 text-sm">
                        <span className="text-wafuu-kincha">
                            待った申請中... 相手の応答を待っています
                        </span>
                        <button
                            type="button"
                            onClick={handleTakebackCancel}
                            disabled={!canSend}
                            className="ml-3 text-xs text-muted-foreground underline hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            取り消す
                        </button>
                    </div>
                )}

                {showsCheckmateRejected && (
                    <p role="alert" className="text-sm text-destructive">
                        {CHECKMATE_REJECTED_NOTICE}
                    </p>
                )}
                {(loadFailed || commandNotice) && (
                    <p role="alert" className="text-sm text-destructive">
                        {loadFailed
                            ? "局面を読み込めませんでした。ページを再読み込みしてください。"
                            : commandNotice?.text}
                    </p>
                )}

                {/* 操作ボタン */}
                <div className="flex gap-2">
                    {passRights !== null && !isSpectator && !gameResult && (
                        <button
                            type="button"
                            onClick={() => void sendMove("pass")}
                            disabled={!canSend || !legalMoves.includes("pass")}
                            className="rounded-md bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground hover:bg-secondary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            パス
                        </button>
                    )}
                    {!isSpectator &&
                        !gameResult &&
                        snapshot.settings.takeback &&
                        !isMyTurn &&
                        usiMoveLog.length > 0 &&
                        !pendingTakeback && (
                            <button
                                type="button"
                                onClick={handleTakebackRequest}
                                disabled={!canSend}
                                className="rounded-md border border-wafuu-kincha/40 bg-wafuu-kincha/10 px-4 py-2 text-sm font-medium text-wafuu-kincha hover:bg-wafuu-kincha/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                待った
                            </button>
                        )}
                    {!isSpectator && !gameResult && (
                        <AlertDialog
                            // 終局したらボタンごと消えるので、確かめている途中でも閉じる（相手の投了・時間切れ）。
                            open={isResignConfirmOpen}
                            onOpenChange={setIsResignConfirmOpen}
                        >
                            <AlertDialogTrigger asChild>
                                <button
                                    type="button"
                                    disabled={!canSend}
                                    className="rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    投了
                                </button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                    <AlertDialogTitle>投了しますか？</AlertDialogTitle>
                                    <AlertDialogDescription>
                                        {/* 切れている間（自分の手番でも押せない）は、上の接続の案内に任せる。 */}
                                        {isMyTurn
                                            ? "対局を終了します。取り消せません。"
                                            : "相手の手番の間は投了できません。自分の手番になってから投了してください。"}
                                    </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel>キャンセル</AlertDialogCancel>
                                    <AlertDialogAction
                                        onClick={handleResign}
                                        disabled={!canPlay || !position}
                                    >
                                        投了する
                                    </AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                    )}
                    <button
                        type="button"
                        onClick={() => dispatchUI({ type: "set_kifu_sheet_open", open: true })}
                        className="md:hidden rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
                        aria-label="棋譜"
                    >
                        棋譜
                    </button>
                    {(aiSupport || analysis) && (
                        <button
                            type="button"
                            onClick={() => dispatchUI({ type: "set_ai_sheet_open", open: true })}
                            className="md:hidden rounded-md border border-wafuu-ai/40 bg-wafuu-ai/10 px-3 py-2 text-sm font-medium text-wafuu-ai hover:bg-wafuu-ai/20"
                            aria-label="AI解析"
                        >
                            🤖 AI解析
                        </button>
                    )}
                </div>

                {/* AI解析ミニサマリバー（モバイルのみ・シート閉じているとき） */}
                {(aiSupport || analysis) && topMoves.length > 0 && (
                    <button
                        type="button"
                        onClick={() => dispatchUI({ type: "set_ai_sheet_open", open: true })}
                        className="md:hidden flex items-center gap-2 rounded-md border border-border bg-card/80 px-3 py-1.5 text-xs w-full"
                    >
                        <span className="text-muted-foreground shrink-0">🤖</span>
                        <div className="flex-1 h-1.5 rounded-full bg-wafuu-ai overflow-hidden">
                            <div
                                className="h-full bg-wafuu-shu transition-all duration-300"
                                style={{ width: `${summaryEvalPercent}%` }}
                            />
                        </div>
                        <span
                            className={`font-mono tabular-nums shrink-0 ${summaryEvalCp !== null && summaryEvalCp < 0 ? "text-wafuu-ai" : "text-wafuu-shu"}`}
                        >
                            {summaryEvalCp !== null
                                ? summaryEvalCp > 0
                                    ? `+${summaryEvalCp}`
                                    : String(summaryEvalCp)
                                : "---"}
                        </span>
                        <span className="text-muted-foreground shrink-0">詳細 ›</span>
                    </button>
                )}

                {/* 観戦者数 */}
                {snapshot.spectators > 0 && (
                    <p className="text-xs text-muted-foreground">
                        観戦者: {snapshot.spectators} 人
                    </p>
                )}
            </div>

            {/* サイドバー: 棋譜 / AI 解析 タブ（PC のみ表示） */}
            <div className="hidden md:flex w-64 flex-col">
                <TabHeader
                    tabs={[
                        { id: "kifu" as const, label: "棋譜" },
                        ...(aiSupport || analysis ? [{ id: "ai" as const, label: "AI解析" }] : []),
                    ]}
                    activeTab={rightTab}
                    onChange={setRightTab}
                />

                {/* 棋譜タブ */}
                {rightTab === "kifu" && kifuPanelContent}

                {/* AI解析タブ */}
                {rightTab === "ai" && aiPanelContent}
            </div>

            {/* 待った: 承認ダイアログ（相手向け） */}
            {showTakebackApproval && (
                <div className="fixed inset-0 z-40 flex items-end justify-center pb-8 md:items-center md:pb-0">
                    <div className="rounded-xl border border-border bg-card p-5 shadow-xl w-[300px]">
                        <p className="mb-1 text-center font-semibold text-foreground">
                            待ったの申請
                        </p>
                        <p className="mb-4 text-center text-sm text-muted-foreground">
                            相手が直前の手を取り消したいと申請しています
                        </p>
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={() => handleTakebackResponse(true)}
                                className="flex-1 rounded-lg bg-primary py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
                            >
                                承認する
                            </button>
                            <button
                                type="button"
                                onClick={() => handleTakebackResponse(false)}
                                className="flex-1 rounded-lg bg-secondary py-2 text-sm font-semibold text-secondary-foreground hover:bg-secondary/80"
                            >
                                拒否する
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* 対局結果ダイアログ */}
            {gameResult && !endDialogClosed && (
                <GameEndDialog
                    result={gameResult}
                    kifu={generatedKif}
                    playerNames={playerNames}
                    onDownloadKifu={handleDownloadKifu}
                    analysisLog={analysisLog}
                    onStartReview={
                        onStartReview
                            ? () =>
                                  onStartReview({
                                      sfen: startSfenRef.current,
                                      moves: movesRef.current,
                                      analysisMarkers: analysisLog,
                                      gameRecordId: gameRecordIdRef.current,
                                  })
                            : undefined
                    }
                    onExit={onExit}
                    onDismiss={() => dispatchUI({ type: "set_end_dialog_closed", closed: true })}
                />
            )}

            {/* 棋譜（モバイル） */}
            {isMobile && (
                <BottomSheet
                    open={kifuSheetOpen}
                    onOpenChange={(open) => dispatchUI({ type: "set_kifu_sheet_open", open })}
                    title="棋譜"
                    height="half"
                >
                    {kifuPanelContent}
                </BottomSheet>
            )}

            {/* AI 解析（モバイル） */}
            {isMobile && (aiSupport || analysis) && (
                <BottomSheet
                    open={aiSheetOpen}
                    onOpenChange={(open) => dispatchUI({ type: "set_ai_sheet_open", open })}
                    title="AI 解析"
                    height="auto"
                >
                    {aiPanelContent}
                </BottomSheet>
            )}

            {/* PVプレビューダイアログ */}
            {pvPreviewMove && analysisPosition && (
                <PvPreviewDialog
                    onClose={() => setPvPreviewMove(null)}
                    pv={pvPreviewMove.pv ?? []}
                    startPosition={analysisPosition}
                    ply={analysisPly}
                    evalCp={pvPreviewMove.evalCp}
                    squareNotation={BOARD_DISPLAY_SETTINGS.squareNotation}
                    showBoardLabels={BOARD_DISPLAY_SETTINGS.showBoardLabels}
                />
            )}

            {/* NNUE ファイル管理ダイアログ */}
            {manifestUrl && (
                <NnueManagerDialog
                    open={nnueManagerOpen}
                    onOpenChange={setNnueManagerOpen}
                    manifestUrl={manifestUrl}
                    remoteNnueManager={remoteNnueManager}
                    isMatchActive={!gameResult}
                />
            )}
        </div>
    );
}

// ─── サブコンポーネント ────────────────────────────────────────────────────────

interface PlayerHeaderProps {
    name: string;
    seat: "b" | "w";
    isMyTurn: boolean;
    remainMs: number;
    isOffline: boolean;
    isFlipped: boolean;
    /** undefined = パス権機能が無効、数値 = 残りパス権数 */
    passRightsCount?: number;
}

function PlayerHeader({
    name,
    seat,
    isMyTurn,
    remainMs,
    isOffline,
    passRightsCount,
}: PlayerHeaderProps): ReactElement {
    return (
        // スマホでは親が中央寄せなので、幅を指定しないと中身の幅に縮み、名前と残り時間がくっつく。
        <div
            className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 ${isMyTurn ? "border-primary bg-primary/5" : "border-border bg-card"}`}
        >
            <div className="flex min-w-0 flex-wrap items-center gap-x-2">
                <span
                    className={`min-w-0 truncate text-sm font-semibold ${seat === "b" ? "text-wafuu-shu" : "text-wafuu-ai"}`}
                >
                    {seat === "b" ? "▲" : "△"} {name}
                </span>
                {isOffline && <span className="text-xs text-destructive">● 切断中</span>}
                {passRightsCount !== undefined && (
                    <span
                        className={`text-xs ${passRightsCount > 0 ? "text-muted-foreground" : "text-muted-foreground/50"}`}
                    >
                        パス権: {passRightsCount}
                    </span>
                )}
            </div>
            <span
                className={`shrink-0 font-mono text-base tabular-nums md:text-sm ${isMyTurn ? "text-primary font-bold" : "text-muted-foreground"}`}
            >
                {formatMs(remainMs)}
            </span>
        </div>
    );
}

const GAME_END_REASONS: Record<string, string> = {
    resign: "投了",
    checkmate: "詰み",
    timeout: "時間切れ",
    sennichite: "千日手",
    oute_sennichite: "連続王手の千日手",
    illegal_move: "反則",
    disconnect: "切断不戦敗",
};

function formatGameResultTitle(result: GameResult, playerNames: { b: string; w: string }): string {
    const winnerName =
        result.winner === "b" ? playerNames.b : result.winner === "w" ? playerNames.w : null;
    return winnerName ? `${winnerName} の勝ち` : "引き分け";
}

function formatGameEndReason(result: GameResult): string {
    return GAME_END_REASONS[result.reason] ?? result.reason;
}

interface GameEndDialogProps {
    result: GameResult;
    kifu: string;
    playerNames: { b: string; w: string };
    onDownloadKifu: () => void;
    analysisLog: Array<{ seat: "b" | "w"; ply: number }>;
    onStartReview?: () => void;
    onExit?: () => void;
    onDismiss: () => void;
}

// ダイアログを閉じた瞬間に下の棋譜ナビがずれないよう、終局したら高さを確保しておき、
// 閉じたときだけ見せる。押したボタンはダイアログごと消えるので、開き直すボタンへ
// フォーカスを移す。スクロールさせると見ようとした盤が画面の外へ押し出される
function GameResultStrip({
    shown,
    text,
    onReopen,
}: {
    shown: boolean;
    text: string;
    onReopen: () => void;
}): ReactElement {
    const buttonRef = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        if (shown) buttonRef.current?.focus({ preventScroll: true });
    }, [shown]);
    return (
        <div
            aria-hidden={!shown}
            className={`flex w-full max-w-md items-center justify-between gap-3 self-center rounded-lg border border-border bg-card px-3 py-2 ${shown ? "" : "invisible"}`}
        >
            <p className="text-sm font-semibold text-foreground">{text}</p>
            <button
                ref={buttonRef}
                type="button"
                onClick={onReopen}
                className="shrink-0 rounded-md bg-secondary px-3 py-1.5 text-xs font-semibold text-secondary-foreground hover:bg-secondary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
                結果を表示
            </button>
        </div>
    );
}

function GameEndDialog({
    result,
    kifu,
    playerNames,
    onDownloadKifu,
    analysisLog,
    onStartReview,
    onExit,
    onDismiss,
}: GameEndDialogProps): ReactElement {
    const [kifuCopied, setKifuCopied] = useState(false);
    useEffect(() => {
        if (!kifuCopied) return;
        const timerId = setTimeout(() => setKifuCopied(false), 2000);
        return () => clearTimeout(timerId);
    }, [kifuCopied]);

    // 背景の盤を操作できないモーダルなので、開いたらフォーカスをダイアログの中へ移す
    const dialogRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        dialogRef.current?.focus();
    }, []);

    const bAnalysisCount = analysisLog.filter((e) => e.seat === "b").length;
    const wAnalysisCount = analysisLog.filter((e) => e.seat === "w").length;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="game-end-dialog-title"
                tabIndex={-1}
                onKeyDown={(e) => {
                    if (e.key === "Escape") onDismiss();
                }}
                className="max-h-full min-w-[280px] max-w-sm overflow-y-auto rounded-xl border border-border bg-card p-6 shadow-xl focus-visible:outline-none"
            >
                <h2
                    id="game-end-dialog-title"
                    className="mb-3 text-center text-xl font-bold text-foreground"
                >
                    {formatGameResultTitle(result, playerNames)}
                </h2>
                <p className="mb-5 text-center text-sm text-muted-foreground">
                    {formatGameEndReason(result)}
                </p>

                {/* 解析ログ開示 */}
                {analysisLog.length > 0 && (
                    <div className="mb-4 rounded-md border border-border bg-muted/30 p-3">
                        <p className="mb-2 text-xs font-semibold text-foreground">
                            AI 解析使用回数
                        </p>
                        <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                            <div className="flex justify-between">
                                <span className="text-wafuu-shu">▲ {playerNames.b}</span>
                                <span>{bAnalysisCount} 回</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-wafuu-ai">△ {playerNames.w}</span>
                                <span>{wAnalysisCount} 回</span>
                            </div>
                        </div>
                    </div>
                )}

                <div className="flex flex-col gap-2">
                    {onStartReview && (
                        <button
                            type="button"
                            onClick={onStartReview}
                            className="w-full rounded-lg bg-primary py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
                        >
                            棋譜を検討する
                        </button>
                    )}
                    {kifu && (
                        <>
                            <button
                                type="button"
                                onClick={async () => {
                                    await navigator.clipboard.writeText(kifu);
                                    setKifuCopied(true);
                                }}
                                className="w-full rounded-lg bg-secondary py-2 text-sm font-semibold text-secondary-foreground hover:bg-secondary/80"
                            >
                                {kifuCopied ? "コピーしました！" : "棋譜をコピー"}
                            </button>
                            <button
                                type="button"
                                onClick={onDownloadKifu}
                                className="w-full rounded-lg bg-secondary py-2 text-sm font-semibold text-secondary-foreground hover:bg-secondary/80"
                            >
                                棋譜をダウンロード
                            </button>
                        </>
                    )}
                    {onExit && (
                        <button
                            type="button"
                            onClick={onExit}
                            className="w-full rounded-lg bg-secondary py-2 text-sm font-semibold text-secondary-foreground hover:bg-secondary/80"
                        >
                            トップへ戻る
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={onDismiss}
                        className="w-full rounded-lg border border-border bg-card py-2 text-sm font-semibold text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                        盤面を見る
                    </button>
                </div>
            </div>
        </div>
    );
}

// ─── OnlineAiPanel ───────────────────────────────────────────────────────────

interface OnlineAiPanelProps {
    aiSupport?: AiSupportSettings;
    seat: Seat;
    myAnalysisRemaining: number | null;
    isAnalyzing: boolean;
    topMoves: AnalysisMoveResult[];
    canAnalyze: boolean;
    analyzeHint: string;
    onAnalyze: () => void;
    analysisBoard: BoardState | null;
    analysisTurn: "b" | "w";
    nnueSelection: NnueSelection;
    onNnueSelectionChange: (sel: NnueSelection) => void;
    onOpenNnueManager: () => void;
    onApplyMove?: (usiMove: string) => Promise<unknown>;
    onPreviewPv?: (move: AiHintMove) => void;
}

function OnlineAiPanel({
    aiSupport,
    seat,
    myAnalysisRemaining,
    isAnalyzing,
    topMoves,
    canAnalyze,
    analyzeHint,
    onAnalyze,
    analysisBoard,
    analysisTurn,
    nnueSelection,
    onNnueSelectionChange,
    onOpenNnueManager,
    onApplyMove,
    onPreviewPv,
}: OnlineAiPanelProps): ReactElement {
    const mySeatKey = seat === "b" ? "b" : seat === "w" ? "w" : null;
    const myMode = mySeatKey && aiSupport ? aiSupport[mySeatKey].mode : null;
    const isLimited = myMode === "limited";
    const hasNoRemaining = isLimited && myAnalysisRemaining !== null && myAnalysisRemaining <= 0;

    const evalCp = topMoves[0]?.cp ?? null;
    const evalPercent =
        evalCp !== null ? Math.min(100, Math.max(0, 50 + (evalCp / 2000) * 50)) : 50;
    const canClickAnalyze = canAnalyze && !isAnalyzing && !hasNoRemaining;
    const moves: AiHintMove[] = topMoves.slice(0, 3).map((mv) => ({
        usi: mv.usi,
        displayText: analysisBoard
            ? formatMoveSimple(mv.usi, analysisTurn === "b" ? "sente" : "gote", analysisBoard)
            : mv.usi,
        scoreText: `${mv.cp > 0 ? "+" : ""}${mv.cp}`,
        scoreTone: mv.cp > 0 ? "sente" : mv.cp < 0 ? "gote" : "neutral",
        pv: mv.pv,
        evalCp: mv.cp,
    }));

    return (
        <AiHintPanel
            title="AI 解析"
            remainingLabel={isLimited ? `残り ${myAnalysisRemaining ?? 0} 回` : null}
            isAnalyzing={isAnalyzing}
            moves={moves}
            canAnalyze={canClickAnalyze}
            analyzeHint={analyzeHint}
            summary={{
                percent: evalPercent,
                senteLabel: evalCp !== null && evalCp > 0 ? `▲ +${evalCp}` : "▲",
                goteLabel: evalCp !== null && evalCp < 0 ? `△ +${Math.abs(evalCp)}` : "△",
            }}
            nnueSelection={nnueSelection}
            onNnueSelectionChange={onNnueSelectionChange}
            onOpenNnueManager={onOpenNnueManager}
            onAnalyze={onAnalyze}
            onApplyMove={onApplyMove}
            onPreviewPv={onPreviewPv}
        />
    );
}
