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
    AiSupportPlayerSettings,
    AiSupportSettings,
    ClockState,
    GameResult,
    PassRightsState,
    RoomClient,
    Seat,
    SnapshotPayload,
} from "@shogi/match-client";
import type { ReactElement } from "react";
import { useEffect, useEffectEvent, useReducer, useRef, useState } from "react";
import { useLazyNnueLoader } from "../hooks/useLazyNnueLoader";
import { useShogiSound } from "../hooks/useShogiSound";
import { NnueManagerDialog } from "./nnue/NnueManagerDialog";
import type { RemoteNnueManager } from "./nnue/types";
import { type AiHintMove, AiHintPanel } from "./shogi-match/components/AiHintPanel";
import { BottomSheet } from "./shogi-match/components/BottomSheet";
import { KifuNavigationToolbar } from "./shogi-match/components/KifuNavigationToolbar";
import { type HandInfo, MobileBoardSection } from "./shogi-match/components/MobileBoardSection";
import { PCBoardContent } from "./shogi-match/components/PCBoardContent";
import { PvPreviewDialog } from "./shogi-match/components/PvPreviewDialog";
import { TabHeader } from "./shogi-match/components/TabHeader";
import { useIsMobile } from "./shogi-match/hooks/useMediaQuery";
import type { PromotionSelection } from "./shogi-match/types";
import { exportToKifString, formatMoveSimple } from "./shogi-match/utils/kifFormat";
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
    loadNnue?: (nnueId: string | null) => Promise<void>;
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

// ─── ゲーム状態管理 ───────────────────────────────────────────────────────────

interface GameState {
    position: PositionState | null;
    positionHistory: PositionState[];
    turn: "b" | "w";
    clockState: ClockState;
    gameResult: GameResult | null;
    offlineSeats: Set<string>;
    passRights: PassRightsState | null;
    myAnalysisRemaining: number | null;
    analysisLog: Array<{ seat: "b" | "w"; ply: number }>;
    usiMoveLog: Array<{ usi: string; elapsedMs: number }>;
    pendingTakeback: { seat: "b" | "w"; ply: number } | null;
}

type GameAction =
    | { type: "init"; position: PositionState }
    | {
          type: "move";
          usi: string;
          turn: "b" | "w";
          clock: ClockState;
          passRights: PassRightsState | null;
      }
    | { type: "result"; result: GameResult }
    | { type: "game_end"; result: GameResult }
    | { type: "player_offline"; seat: string }
    | { type: "player_online"; seat: string }
    | {
          type: "analysis_used";
          isMySeat: boolean;
          seat: "b" | "w";
          analysisRemaining: number | null;
          ply: number;
      }
    | {
          type: "resync";
          position: PositionState;
          turn: "b" | "w";
          clock: ClockState;
          passRights: PassRightsState | null;
      }
    | { type: "takeback_requested"; seat: "b" | "w"; ply: number }
    | {
          type: "takeback_accepted";
          position: PositionState;
          turn: "b" | "w";
          clock: ClockState;
          passRights: PassRightsState | null;
      }
    | { type: "takeback_rejected" }
    | { type: "takeback_cancelled" };

function makeInitialGameState(
    snapshot: SnapshotPayload,
    myAiSettings: AiSupportPlayerSettings | null,
): GameState {
    return {
        position: null,
        positionHistory: [],
        turn: snapshot.turn,
        clockState: snapshot.clock,
        gameResult: null,
        offlineSeats: new Set(),
        passRights: snapshot.passRights,
        myAnalysisRemaining:
            myAiSettings?.mode === "limited" ? (myAiSettings.limitCount ?? 0) : null,
        analysisLog: [],
        usiMoveLog: [],
        pendingTakeback: null,
    };
}

function gameReducer(state: GameState, action: GameAction): GameState {
    switch (action.type) {
        case "init":
            return {
                ...state,
                position: action.position,
                positionHistory: [action.position],
            };
        case "move": {
            if (!state.position) return state;
            // 消費時間: 動いた側の残り時間の差分（手番交代前の turn が動いた側）
            const movedSeat = state.turn;
            const elapsedMs = Math.max(
                0,
                state.clockState[movedSeat].remainMs - action.clock[movedSeat].remainMs,
            );
            // パス手は局面変化なし（手番のみ交代）。
            // PositionState に passRights が未設定のため applyMoveWithState は使わない
            const next =
                action.usi === "pass"
                    ? {
                          ...state.position,
                          turn:
                              state.position.turn === "sente"
                                  ? ("gote" as const)
                                  : ("sente" as const),
                      }
                    : applyMoveWithState(state.position, action.usi).next;
            return {
                ...state,
                position: next,
                positionHistory: [...state.positionHistory, next],
                turn: action.turn,
                clockState: action.clock,
                passRights: action.passRights,
                usiMoveLog: [...state.usiMoveLog, { usi: action.usi, elapsedMs }],
            };
        }
        case "result":
            return { ...state, gameResult: action.result };
        case "game_end":
            return { ...state, gameResult: action.result };
        case "player_offline":
            return {
                ...state,
                offlineSeats: new Set([...state.offlineSeats, action.seat]),
            };
        case "player_online": {
            const next = new Set(state.offlineSeats);
            next.delete(action.seat);
            return { ...state, offlineSeats: next };
        }
        case "analysis_used":
            return {
                ...state,
                myAnalysisRemaining: action.isMySeat
                    ? action.analysisRemaining
                    : state.myAnalysisRemaining,
                analysisLog: [...state.analysisLog, { seat: action.seat, ply: action.ply }],
            };
        case "resync":
            return {
                ...state,
                position: action.position,
                positionHistory: [action.position],
                turn: action.turn,
                clockState: action.clock,
                passRights: action.passRights,
            };
        case "takeback_requested":
            return { ...state, pendingTakeback: { seat: action.seat, ply: action.ply } };
        case "takeback_accepted":
            return {
                ...state,
                position: action.position,
                positionHistory: [action.position],
                turn: action.turn,
                clockState: action.clock,
                passRights: action.passRights,
                usiMoveLog: state.usiMoveLog.slice(0, -1),
                pendingTakeback: null,
            };
        case "takeback_rejected":
            return { ...state, pendingTakeback: null };
        case "takeback_cancelled":
            return { ...state, pendingTakeback: null };
    }
}

// ─── UI インタラクション状態管理 ───────────────────────────────────────────────

interface UIState {
    selectedSquare: string | null;
    selectedHand: PieceType | null;
    legalMoves: string[];
    promoteDialog: { from: string; to: string; usi: string } | null;
    navIndex: number | null;
    aiSheetOpen: boolean;
    kifuSheetOpen: boolean;
}

type UIAction =
    | { type: "move_received" } // selectedSquare, selectedHand, legalMoves を一括リセット
    | { type: "resync_received" } // navIndex をリセット
    | { type: "clear_selection" } // selectedSquare, selectedHand を一括リセット
    | { type: "select_square"; squareId: string | null }
    | { type: "select_hand"; pieceType: PieceType | null }
    | { type: "set_legal_moves"; moves: string[] }
    | { type: "set_promote_dialog"; dialog: { from: string; to: string; usi: string } | null }
    | { type: "set_nav_index"; index: number | null }
    | { type: "set_ai_sheet_open"; open: boolean }
    | { type: "set_kifu_sheet_open"; open: boolean };

const INITIAL_UI_STATE: UIState = {
    selectedSquare: null,
    selectedHand: null,
    legalMoves: [],
    promoteDialog: null,
    navIndex: null,
    aiSheetOpen: false,
    kifuSheetOpen: false,
};

function uiReducer(state: UIState, action: UIAction): UIState {
    switch (action.type) {
        case "move_received":
            return { ...state, selectedSquare: null, selectedHand: null, legalMoves: [] };
        case "resync_received":
            return { ...state, navIndex: null };
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
    }) => void;
    onExit?: () => void;
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
}: OnlineGameViewProps): ReactElement {
    // ─── AI サポート設定（makeInitialGameState の引数として使用するため先に定義） ──
    const aiSupport = snapshot.settings.aiSupport as AiSupportSettings | null;
    const myAiSettings = seat !== "s" && aiSupport ? aiSupport[seat === "b" ? "b" : "w"] : null;

    // ─── ゲーム状態（useReducer） ─────────────────────────────────────────────
    const [gameState, dispatch] = useReducer(gameReducer, undefined, () =>
        makeInitialGameState(snapshot, myAiSettings),
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
    const startSfenRef = useRef(snapshot.settings.startSfen);
    const movesRef = useRef<string[]>([...snapshot.moves]);
    // サーバーの latestEventId を追跡（move/resign/use_analysis 送信時に使用）
    // 指し手以外のイベント（chat/analysis_used/player_online 等）でも増加するため
    // snapshot.eventId + moves.length の計算式は使えない
    const latestEventIdRef = useRef(snapshot.eventId);

    // 自分の手番か
    const myPlayer: Player | null = seat === "b" ? "sente" : seat === "w" ? "gote" : null;
    const isMyTurn =
        myPlayer !== null &&
        ((turn === "b" && myPlayer === "sente") || (turn === "w" && myPlayer === "gote"));
    const isSpectator = seat === "s";

    const totalPly = Math.max(0, positionHistory.length - 1);
    // 自分の手番になったら巻き戻しを解除してライブ追従（effect 不要、レンダー時に派生）
    const effectiveNavIndex = isMyTurn ? null : navIndex;
    const isRewound = effectiveNavIndex !== null;
    const currentPly = isRewound ? effectiveNavIndex : totalPly;
    // 表示用局面: 巻き戻し中は履歴局面、それ以外はライブ局面
    const displayPosition = isRewound ? (positionHistory[effectiveNavIndex] ?? null) : position;

    // ─── 初期局面の読み込み ──────────────────────────────────────────────────

    useEffect(() => {
        let cancelled = false;
        getPositionService()
            .parseSfen(snapshot.sfen)
            .then((pos) => {
                if (!cancelled) {
                    dispatch({ type: "init", position: pos });
                }
            })
            .catch(console.error);
        return () => {
            cancelled = true;
        };
    }, [snapshot.sfen]);

    // ─── RoomClient サブスクライブ ────────────────────────────────────────────

    useEffect(() => {
        const unsub = client.subscribe((msg) => {
            if (msg.t === "event") {
                const e = msg.payload;
                // すべてのイベントで latestEventId を更新する
                // サーバーは指し手以外のイベントでも latestEventId を増加させるため
                latestEventIdRef.current = e.eventId;
                if (e.kind === "move") {
                    dispatch({
                        type: "move",
                        usi: e.usi,
                        turn: e.turn,
                        clock: e.clock,
                        passRights: e.passRights,
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
                } else if (
                    e.kind === "resign" ||
                    e.kind === "timeout" ||
                    e.kind === "checkmate" ||
                    e.kind === "sennichite" ||
                    e.kind === "illegal_move" ||
                    e.kind === "disconnect_loss"
                ) {
                    dispatch({ type: "result", result: e.result });
                } else if (e.kind === "game_end") {
                    dispatch({ type: "game_end", result: e.result });
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
                } else if (e.kind === "takeback_accepted") {
                    movesRef.current = movesRef.current.slice(0, -1);
                    getPositionService()
                        .parseSfen(e.sfen)
                        .then((pos) => {
                            dispatch({
                                type: "takeback_accepted",
                                position: pos,
                                turn: e.turn,
                                clock: e.clock,
                                passRights: e.passRights,
                            });
                            dispatchUI({ type: "resync_received" });
                        })
                        .catch(console.error);
                } else if (e.kind === "takeback_rejected") {
                    dispatch({ type: "takeback_rejected" });
                } else if (e.kind === "takeback_cancelled") {
                    dispatch({ type: "takeback_cancelled" });
                }
            } else if (msg.t === "snapshot") {
                // 再接続後のスナップショット更新
                // latestEventId と moves を最新状態に同期する
                latestEventIdRef.current = msg.payload.eventId;
                movesRef.current = [...msg.payload.moves];
                getPositionService()
                    .parseSfen(msg.payload.sfen)
                    .then((pos) => {
                        dispatch({
                            type: "resync",
                            position: pos,
                            turn: msg.payload.turn,
                            clock: msg.payload.clock,
                            passRights: msg.payload.passRights,
                        });
                        dispatchUI({ type: "resync_received" }); // 再接続後は最新局面に戻す
                    })
                    .catch((err) => {
                        console.error("[OnlineGameView] Failed to parse SFEN from snapshot:", err);
                        // サーバーに再同期リクエストを送信して最新状態を取得する
                        client.sync({ sinceEventId: latestEventIdRef.current });
                    });
            }
        });
        return unsub;
    }, [client, seat]);

    // ─── 合法手の取得 ────────────────────────────────────────────────────────

    useEffect(() => {
        // 巻き戻し中は合法手を表示しない
        // passRightsOption は try/catch の外で計算する（React Compiler の制約）
        const passRightsOption = passRights
            ? { passRights: { sente: passRights.b, gote: passRights.w } }
            : {};
        let cancelled = false;
        void (async () => {
            if (isMyTurn && !gameResult && !isRewound) {
                try {
                    const moves = await getPositionService().getLegalMoves(
                        startSfenRef.current,
                        movesRef.current,
                        passRightsOption,
                    );
                    if (cancelled) return;
                    dispatchUI({ type: "set_legal_moves", moves });
                    // 合法手が0 = 自分が詰まされている → サーバーに通知
                    if (moves.length === 0) {
                        client.checkmate({ eventId: latestEventIdRef.current });
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
    }, [isMyTurn, gameResult, isRewound, passRights, client]);

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
        if (!position) return;
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
        client.move({ eventId: latestEventIdRef.current, usi, sfen: nextSfen });
    };

    // ─── 盤面クリック処理 ────────────────────────────────────────────────────

    function handleBoardSelect(squareId: string): void {
        if (!isMyTurn || gameResult || !position) return;

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
        if (!isMyTurn || gameResult || isRewound) return;
        dispatchUI({
            type: "select_hand",
            pieceType: selectedHand === pieceType ? null : pieceType,
        });
        dispatchUI({ type: "select_square", squareId: null });
    }

    // ─── 投了 ────────────────────────────────────────────────────────────────

    function handleResign(): void {
        if (!isMyTurn || !position) return;
        client.resign({ eventId: latestEventIdRef.current });
    }

    // ─── 待った ───────────────────────────────────────────────────────────────

    function handleTakebackRequest(): void {
        client.takebackRequest({ eventId: latestEventIdRef.current });
    }

    function handleTakebackResponse(accept: boolean): void {
        client.takebackResponse({ eventId: latestEventIdRef.current, accept });
    }

    function handleTakebackCancel(): void {
        client.takebackCancel({ eventId: latestEventIdRef.current });
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

    const handleAnalyze = async () => {
        if (!position) return;
        // 制限モードは use_analysis を先送信してからエンジン解析（観戦者はスキップ）
        if (myAiSettings?.mode === "limited" && seat !== "s") {
            const ply = movesRef.current.length;
            client.consumeAnalysis({ eventId: latestEventIdRef.current, ply });
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
    const { playSound } = useShogiSound();
    const playSoundEvent = useEffectEvent(playSound);

    const loadNnueEvent = useEffectEvent((sel: NnueSelection) => {
        if (!analysis?.loadNnue) return;
        resolveNnue(sel)
            .then((resolved) => analysis.loadNnue?.(resolved?.nnueId ?? null))
            .catch(console.error);
    });
    useEffect(() => {
        loadNnueEvent(nnueSelection);
    }, [nnueSelection]);

    // ─── AI 手の盤面適用 ──────────────────────────────────────────────────────

    function handleApplyAiMove(usiMove: string): void {
        if (!position || !isMyTurn || gameResult) return;
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
        ? movesRef.current[(effectiveNavIndex ?? 0) - 1]
        : movesRef.current.at(-1);
    const lastMove = deriveLastMove(lastMoveUsi);

    // モバイル用 ref（MobileBoardSection の必須 props のため）
    const boardSectionRef = useRef<HTMLDivElement | null>(null);

    // 成り選択状態（MobileBoardSection へ渡す用）
    const promotionSelection: PromotionSelection | null = (() => {
        if (!promoteDialog || !displayPosition) return null;
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
        isActive: !isRewound && isMyTurn && myPlayer === topOwner,
        isAI: false,
    };
    const bottomHand: HandInfo = {
        owner: bottomOwner,
        hand: displayPosition?.hands[bottomOwner] ?? ({} as PositionState["hands"]["sente"]),
        isActive: !isRewound && isMyTurn && myPlayer === bottomOwner,
        isAI: false,
    };
    const onSquareSelect = !isRewound && isMyTurn && !isSpectator ? handleBoardSelect : () => {};
    const onPromotionChoiceForMobile = (promote: boolean) => {
        if (!promoteDialog) return;
        void sendMove(promote ? `${promoteDialog.usi}+` : promoteDialog.usi, promoteDialog.to);
        dispatchUI({ type: "set_promote_dialog", dialog: null });
    };

    // ハイライト: 選択中マスの合法手先
    const legalTargets = new Set<string>();
    if (selectedSquare) {
        for (const m of legalMoves) {
            const from = m.slice(0, 2).toLowerCase();
            const to = m.slice(2, 4).toLowerCase();
            if (from === selectedSquare.toLowerCase()) {
                legalTargets.add(to);
            }
        }
    }

    const playerNames = {
        b: snapshot.players.b?.name ?? "先手",
        w: snapshot.players.w?.name ?? "後手",
    };

    // KIF テキスト（対局終了後のダウンロード・コピー用）
    const generatedKif =
        usiMoveLog.length > 0
            ? exportToKifString(
                  usiMoveLog.map((entry, i) => ({
                      ply: i + 1,
                      usiMove: entry.usi,
                      elapsedMs: entry.elapsedMs,
                      kifText: "",
                      displayText: "",
                  })),
                  positionHistory.slice(0, usiMoveLog.length).map((p) => p.board),
                  { senteName: playerNames.b, goteName: playerNames.w },
              )
            : "";

    // PC サイドバーとモバイル BottomSheet で共通利用するコンテンツ
    const canAnalyzeNow = !gameResult && (isMyTurn || isSpectator);
    const analyzeHintText =
        !gameResult && !isMyTurn && !isSpectator
            ? "相手の手番中は解析できません。自分の手番になってから使用してください。"
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
                    isMyTurn && !gameResult && !isSpectator
                        ? (usiMove) => Promise.resolve(handleApplyAiMove(usiMove))
                        : undefined
                }
                onPreviewPv={analysisPosition ? (move) => setPvPreviewMove(move) : undefined}
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

            {/* 切断バナー */}
            {offlineSeats.size > 0 && (
                <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 rounded-lg bg-destructive px-4 py-2 text-sm text-destructive-foreground shadow-lg">
                    {Array.from(offlineSeats).map((s) => (
                        <span key={s}>{s === "b" ? "先手" : "後手"}が切断しました</span>
                    ))}
                </div>
            )}

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
                            selection={
                                selectedSquare
                                    ? { kind: "square", square: selectedSquare }
                                    : selectedHand
                                      ? { kind: "hand", piece: selectedHand }
                                      : null
                            }
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
                            selection={
                                selectedSquare
                                    ? { kind: "square", square: selectedSquare }
                                    : selectedHand
                                      ? { kind: "hand", piece: selectedHand }
                                      : null
                            }
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
                            className="ml-3 text-xs text-muted-foreground underline hover:text-foreground"
                        >
                            取り消す
                        </button>
                    </div>
                )}

                {/* 操作ボタン */}
                <div className="flex gap-2">
                    {passRights !== null && !isSpectator && !gameResult && (
                        <button
                            type="button"
                            onClick={() => void sendMove("pass")}
                            disabled={!legalMoves.includes("pass")}
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
                                className="rounded-md border border-wafuu-kincha/40 bg-wafuu-kincha/10 px-4 py-2 text-sm font-medium text-wafuu-kincha hover:bg-wafuu-kincha/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                                待った
                            </button>
                        )}
                    {!isSpectator && !gameResult && (
                        <button
                            type="button"
                            onClick={handleResign}
                            className="rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                            投了
                        </button>
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
            {pendingTakeback && pendingTakeback.seat !== seat && !isSpectator && !gameResult && (
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
            {gameResult && (
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
                                  })
                            : undefined
                    }
                    onExit={onExit}
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
        <div
            className={`flex items-center justify-between rounded-lg border px-3 py-2 ${isMyTurn ? "border-primary bg-primary/5" : "border-border bg-card"}`}
        >
            <div className="flex items-center gap-2">
                <span
                    className={`text-sm font-semibold ${seat === "b" ? "text-wafuu-shu" : "text-wafuu-ai"}`}
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
                className={`font-mono text-sm tabular-nums ${isMyTurn ? "text-primary font-bold" : "text-muted-foreground"}`}
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
    illegal_move: "反則",
    disconnect: "切断不戦敗",
};

interface GameEndDialogProps {
    result: GameResult;
    kifu: string;
    playerNames: { b: string; w: string };
    onDownloadKifu: () => void;
    analysisLog: Array<{ seat: "b" | "w"; ply: number }>;
    onStartReview?: () => void;
    onExit?: () => void;
}

function GameEndDialog({
    result,
    kifu,
    playerNames,
    onDownloadKifu,
    analysisLog,
    onStartReview,
    onExit,
}: GameEndDialogProps): ReactElement {
    const [kifuCopied, setKifuCopied] = useState(false);
    useEffect(() => {
        if (!kifuCopied) return;
        const timerId = setTimeout(() => setKifuCopied(false), 2000);
        return () => clearTimeout(timerId);
    }, [kifuCopied]);

    const winnerName =
        result.winner === "b" ? playerNames.b : result.winner === "w" ? playerNames.w : null;

    const bAnalysisCount = analysisLog.filter((e) => e.seat === "b").length;
    const wAnalysisCount = analysisLog.filter((e) => e.seat === "w").length;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
            <div className="rounded-xl border border-border bg-card p-6 shadow-xl min-w-[280px] max-w-sm">
                <h2 className="mb-3 text-center text-xl font-bold text-foreground">
                    {winnerName ? `${winnerName} の勝ち` : "引き分け"}
                </h2>
                <p className="mb-5 text-center text-sm text-muted-foreground">
                    {GAME_END_REASONS[result.reason] ?? result.reason}
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
