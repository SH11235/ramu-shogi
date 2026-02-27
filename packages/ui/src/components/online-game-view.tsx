import {
    applyMoveWithState,
    deriveLastMove,
    getPositionService,
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
import { useEffect, useReducer, useRef, useState } from "react";
import { ShogiBoard } from "./shogi-board";
import { BottomSheet } from "./shogi-match/components/BottomSheet";
import { HandPiecesDisplay } from "./shogi-match/components/HandPiecesDisplay";
import { KifuNavigationToolbar } from "./shogi-match/components/KifuNavigationToolbar";
import { type HandInfo, MobileBoardSection } from "./shogi-match/components/MobileBoardSection";
import { useIsMobile } from "./shogi-match/hooks/useMediaQuery";
import type { PromotionSelection } from "./shogi-match/types";
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
}

// ─── 型定義 ───────────────────────────────────────────────────────────────────

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
    kifu: string;
    offlineSeats: Set<string>;
    passRights: PassRightsState | null;
    myAnalysisRemaining: number | null;
    analysisLog: Array<{ seat: "b" | "w"; ply: number }>;
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
    | { type: "game_end"; result: GameResult; kifu: string }
    | { type: "player_offline"; seat: string }
    | { type: "player_online"; seat: string }
    | {
          type: "analysis_used";
          isMySeat: boolean;
          seat: "b" | "w";
          analysisRemaining: number;
          ply: number;
      }
    | {
          type: "resync";
          position: PositionState;
          turn: "b" | "w";
          clock: ClockState;
          passRights: PassRightsState | null;
      };

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
        kifu: "",
        offlineSeats: new Set(),
        passRights: snapshot.passRights,
        myAnalysisRemaining:
            myAiSettings?.mode === "limited" ? (myAiSettings.limitCount ?? 0) : null,
        analysisLog: [],
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
                turn: action.turn === "b" ? "w" : "b",
                clockState: action.clock,
                passRights: action.passRights,
            };
        }
        case "result":
            return { ...state, gameResult: action.result };
        case "game_end":
            return { ...state, gameResult: action.result, kifu: action.kifu };
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
    | { type: "set_ai_sheet_open"; open: boolean };

const INITIAL_UI_STATE: UIState = {
    selectedSquare: null,
    selectedHand: null,
    legalMoves: [],
    promoteDialog: null,
    navIndex: null,
    aiSheetOpen: false,
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
        kifu,
        offlineSeats,
        passRights,
        myAnalysisRemaining,
        analysisLog,
    } = gameState;

    // ─── UI インタラクション状態（useReducer） ───────────────────────────────
    const [uiState, dispatchUI] = useReducer(uiReducer, INITIAL_UI_STATE);
    const { selectedSquare, selectedHand, legalMoves, promoteDialog, navIndex, aiSheetOpen } =
        uiState;

    // analysis prop から分解（undefined 時のデフォルト値）
    const isAnalyzing = analysis?.isAnalyzing ?? false;
    const topMoves = analysis?.topMoves ?? [];

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
                    dispatch({ type: "game_end", result: e.result, kifu: e.kifu });
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
        void (async () => {
            if (isMyTurn && !gameResult && !isRewound) {
                try {
                    const moves = await getPositionService().getLegalMoves(
                        startSfenRef.current,
                        movesRef.current,
                        passRightsOption,
                    );
                    dispatchUI({ type: "set_legal_moves", moves });
                } catch {
                    dispatchUI({ type: "set_legal_moves", moves: [] });
                }
            } else {
                dispatchUI({ type: "set_legal_moves", moves: [] });
            }
        })();
    }, [isMyTurn, gameResult, isRewound, passRights]);

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

    // ─── AI 解析トリガー ─────────────────────────────────────────────────────

    const handleAnalyze = async () => {
        if (!position || !aiSupport || seat === "s") return;
        // 制限モードは use_analysis を先送信してからエンジン解析
        if (myAiSettings?.mode === "limited") {
            const ply = movesRef.current.length;
            client.consumeAnalysis({ eventId: latestEventIdRef.current, ply });
            // analysis_used 受信後に自動で残り回数が更新される
        }
        if (analysis) {
            await getPositionService()
                .boardToSfen(position)
                .then((sfen) => analysis.startAnalysis(sfen, movesRef.current))
                .catch(console.error);
        }
    };

    // 無制限モード: 自分の手番になったら自動解析
    const positionSfenRef = useRef<string>("");
    useEffect(() => {
        if (!aiSupport || !position || gameResult || !analysis) return;
        if (myAiSettings?.mode !== "unlimited") return;
        // 自分の手番（または観戦者）のとき自動解析
        const isMyAnalysisTurn =
            seat === "s" || (seat === "b" && turn === "b") || (seat === "w" && turn === "w");
        if (!isMyAnalysisTurn) {
            void analysis.cancelAnalysis();
            return;
        }
        getPositionService()
            .boardToSfen(position)
            .then((sfen) => {
                if (sfen === positionSfenRef.current) return;
                positionSfenRef.current = sfen;
                return analysis.startAnalysis(sfen, movesRef.current);
            })
            .catch(console.error);
    }, [aiSupport, myAiSettings, position, turn, seat, gameResult, analysis]);

    // ─── KIF ダウンロード ─────────────────────────────────────────────────────

    function handleDownloadKifu(): void {
        if (!kifu) return;
        const blob = new Blob([kifu], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `game-${roomId}.kif`;
        a.click();
        URL.revokeObjectURL(url);
    }

    // ─── レンダリング ─────────────────────────────────────────────────────────

    const flipBoard = seat === "w";
    const isMobile = useIsMobile();

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
    const boardDisplaySettings = {
        highlightLastMove: true,
        squareNotation: "none" as const,
        showBoardLabels: true,
    };
    const onSquareSelectForMobile =
        !isRewound && isMyTurn && !isSpectator ? handleBoardSelect : () => {};
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

    // PC サイドバーとモバイル BottomSheet で共通利用するコンテンツ
    const aiPanelContent = aiSupport ? (
        <OnlineAiPanel
            aiSupport={aiSupport}
            seat={seat}
            myAnalysisRemaining={myAnalysisRemaining}
            isAnalyzing={isAnalyzing}
            topMoves={topMoves}
            canAnalyze={!gameResult && !isSpectator}
            onAnalyze={() => void handleAnalyze()}
        />
    ) : null;

    return (
        <div className="flex flex-col md:flex-row gap-4 p-4 max-w-[900px] mx-auto">
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
                {/* 後手情報（上） */}
                <PlayerHeader
                    name={playerNames.w}
                    seat="w"
                    isMyTurn={turn === "w"}
                    remainMs={clockDisplay.w}
                    isOffline={offlineSeats.has("w")}
                    isFlipped={flipBoard}
                    passRightsCount={passRights != null ? passRights.w : undefined}
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
                            displaySettings={boardDisplaySettings}
                            isEditModeActive={false}
                            isMatchRunning={!gameResult}
                            hideEmptyHandPieces={true}
                            editFromSquare={null}
                            candidateNote={null}
                            onSquareSelect={onSquareSelectForMobile}
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
                ) : (
                    // === PC: ShogiBoard + HandPiecesDisplay 構造 ===
                    <>
                        {/* 後手持ち駒（上） */}
                        {displayPosition && (
                            <div className={`flex justify-${flipBoard ? "start" : "end"}`}>
                                <HandPiecesDisplay
                                    owner="gote"
                                    hand={displayPosition.hands.gote}
                                    selectedPiece={myPlayer === "gote" ? selectedHand : null}
                                    isActive={!isRewound && isMyTurn && myPlayer === "gote"}
                                    onHandSelect={handleHandSelect}
                                    hideEmptyPieces
                                    isMatchRunning
                                    size="medium"
                                    flipBoard={flipBoard}
                                />
                            </div>
                        )}

                        {/* 将棋盤 */}
                        {displayPosition ? (
                            <ShogiBoard
                                grid={grid}
                                selectedSquare={selectedSquare}
                                lastMove={lastMove}
                                promotionSquare={promoteDialog?.to ?? null}
                                onSelect={
                                    !isRewound && isMyTurn && !isSpectator
                                        ? handleBoardSelect
                                        : undefined
                                }
                                onPromotionChoice={(promote) => {
                                    if (!promoteDialog) return;
                                    void sendMove(
                                        promote ? `${promoteDialog.usi}+` : promoteDialog.usi,
                                        promoteDialog.to,
                                    );
                                    dispatchUI({ type: "set_promote_dialog", dialog: null });
                                }}
                                flipBoard={flipBoard}
                                showBoardLabels
                                squareNotation="none"
                            />
                        ) : (
                            <div className="flex h-64 items-center justify-center rounded-lg border border-border bg-card">
                                <p className="text-muted-foreground">局面を読み込み中...</p>
                            </div>
                        )}

                        {/* 先手持ち駒（下） */}
                        {displayPosition && (
                            <div className={`flex justify-${flipBoard ? "end" : "start"}`}>
                                <HandPiecesDisplay
                                    owner="sente"
                                    hand={displayPosition.hands.sente}
                                    selectedPiece={myPlayer === "sente" ? selectedHand : null}
                                    isActive={!isRewound && isMyTurn && myPlayer === "sente"}
                                    onHandSelect={handleHandSelect}
                                    hideEmptyPieces
                                    isMatchRunning
                                    size="medium"
                                    flipBoard={flipBoard}
                                />
                            </div>
                        )}
                    </>
                )}

                {/* 先手情報（下） */}
                <PlayerHeader
                    name={playerNames.b}
                    seat="b"
                    isMyTurn={turn === "b"}
                    remainMs={clockDisplay.b}
                    isOffline={offlineSeats.has("b")}
                    isFlipped={flipBoard}
                    passRightsCount={passRights != null ? passRights.b : undefined}
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
                    />
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
                    {!isSpectator && !gameResult && (
                        <button
                            type="button"
                            onClick={handleResign}
                            className="rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                            投了
                        </button>
                    )}
                    {aiSupport && (
                        <button
                            type="button"
                            onClick={() => dispatchUI({ type: "set_ai_sheet_open", open: true })}
                            className="md:hidden rounded-md bg-secondary px-3 py-2 text-sm font-medium text-secondary-foreground hover:bg-secondary/80"
                            aria-label="AI解析"
                        >
                            🤖
                        </button>
                    )}
                </div>

                {/* 観戦者数 */}
                {snapshot.spectators > 0 && (
                    <p className="text-xs text-muted-foreground">
                        観戦者: {snapshot.spectators} 人
                    </p>
                )}
            </div>

            {/* サイドバー: AI 解析（PC のみ表示） */}
            <div className="hidden md:flex w-64 flex-col gap-3">{aiPanelContent}</div>

            {/* 対局結果ダイアログ */}
            {gameResult && (
                <GameEndDialog
                    result={gameResult}
                    kifu={kifu}
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

            {/* AI 解析（モバイル） */}
            {aiSupport && (
                <BottomSheet
                    open={aiSheetOpen}
                    onOpenChange={(open) => dispatchUI({ type: "set_ai_sheet_open", open })}
                    title="AI 解析"
                    height="auto"
                >
                    {aiPanelContent}
                </BottomSheet>
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
                                }}
                                className="w-full rounded-lg bg-secondary py-2 text-sm font-semibold text-secondary-foreground hover:bg-secondary/80"
                            >
                                棋譜をコピー
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
    aiSupport: AiSupportSettings;
    seat: Seat;
    myAnalysisRemaining: number | null;
    isAnalyzing: boolean;
    topMoves: AnalysisMoveResult[];
    canAnalyze: boolean;
    onAnalyze: () => void;
}

function OnlineAiPanel({
    aiSupport,
    seat,
    myAnalysisRemaining,
    isAnalyzing,
    topMoves,
    canAnalyze,
    onAnalyze,
}: OnlineAiPanelProps): ReactElement {
    const mySeatKey = seat === "b" ? "b" : seat === "w" ? "w" : null;
    const myMode = mySeatKey ? aiSupport[mySeatKey].mode : null;
    const isLimited = myMode === "limited";
    const hasNoRemaining = isLimited && myAnalysisRemaining !== null && myAnalysisRemaining <= 0;

    // 形勢バー（0〜100%、50% = 互角、cp +2000 ≈ 100%）
    const evalCp = topMoves[0]?.cp ?? null;
    const evalPercent =
        evalCp !== null ? Math.min(100, Math.max(0, 50 + (evalCp / 2000) * 50)) : 50;
    const canClickAnalyze = canAnalyze && !isAnalyzing && !hasNoRemaining && seat !== "s";

    return (
        <div className="flex flex-col rounded-lg border border-border bg-card overflow-hidden">
            <div className="px-3 py-2 border-b border-border flex items-center justify-between">
                <span className="text-sm font-semibold text-foreground">AI 解析</span>
                {isLimited && (
                    <span className="text-xs text-muted-foreground">
                        残り {myAnalysisRemaining ?? 0} 回
                    </span>
                )}
            </div>

            <div className="px-3 py-2 flex flex-col gap-2">
                {/* 形勢バー */}
                {topMoves.length > 0 && (
                    <div className="flex flex-col gap-1">
                        <div className="relative h-3 w-full rounded-full overflow-hidden bg-wafuu-ai">
                            <div
                                className="absolute inset-y-0 left-0 bg-wafuu-shu transition-all duration-300"
                                style={{ width: `${evalPercent}%` }}
                            />
                        </div>
                        <div className="flex justify-between text-xs text-muted-foreground">
                            <span className="text-wafuu-shu">
                                ▲ {evalCp !== null && evalCp > 0 ? `+${evalCp}` : ""}
                            </span>
                            <span className="text-wafuu-ai">
                                △ {evalCp !== null && evalCp < 0 ? `+${Math.abs(evalCp)}` : ""}
                            </span>
                        </div>
                    </div>
                )}

                {/* 候補手（上位 3 手） */}
                {topMoves.length > 0 && (
                    <div className="flex flex-col gap-0.5">
                        {topMoves.slice(0, 3).map((mv, i) => (
                            <div key={mv.usi} className="flex items-center gap-2 text-xs">
                                <span className="text-muted-foreground w-4">{i + 1}.</span>
                                <span className="font-mono text-foreground">{mv.usi}</span>
                                <span className="text-muted-foreground ml-auto">
                                    {mv.cp > 0 ? "+" : ""}
                                    {mv.cp}
                                </span>
                            </div>
                        ))}
                    </div>
                )}

                {isAnalyzing && topMoves.length === 0 && (
                    <p className="text-xs text-muted-foreground">解析中...</p>
                )}

                {/* 制限モードのみ手動ボタン表示 */}
                {isLimited && seat !== "s" && (
                    <button
                        type="button"
                        onClick={onAnalyze}
                        disabled={!canClickAnalyze}
                        className="w-full rounded-md bg-primary py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
                    >
                        {hasNoRemaining ? "上限到達" : isAnalyzing ? "解析中..." : "解析する"}
                    </button>
                )}
            </div>
        </div>
    );
}
