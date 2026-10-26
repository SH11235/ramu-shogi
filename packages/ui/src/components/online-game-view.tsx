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
    AiSupportSettings,
    ErrorCode,
    RoomClient,
    Seat,
    SnapshotPayload,
} from "@shogi/match-client";
import type { ReactElement } from "react";
import { useEffect, useEffectEvent, useReducer, useRef, useState } from "react";
import { useScreenWakeLock } from "../hooks/useScreenWakeLock";
import { useShogiSound } from "../hooks/useShogiSound";
import { NnueLibraryDialog } from "./nnue-library/NnueLibraryDialog";
import type { NnueAccountStore } from "./nnue-library/types";
import { exportGameKif } from "./online-game-state";
import { AnalysisSummaryBar } from "./online-game-view/AnalysisSummaryBar";
import { ConnectionNotices } from "./online-game-view/ConnectionNotices";
import { GameEndDialog } from "./online-game-view/GameEndDialog";
import { GameResultStrip } from "./online-game-view/GameResultStrip";
import { formatGameEndReason, formatGameResultTitle } from "./online-game-view/gameResultText";
import { OnlineAiPanel } from "./online-game-view/OnlineAiPanel";
import { OnlineKifuList } from "./online-game-view/OnlineKifuList";
import type { OnlineAnalysis } from "./online-game-view/onlineAnalysis";
import { INITIAL_UI_STATE, uiReducer } from "./online-game-view/onlineGameUiState";
import { PlayerHeader } from "./online-game-view/PlayerHeader";
import { ResignButton } from "./online-game-view/ResignButton";
import { TakebackApprovalDialog, TakebackPendingBanner } from "./online-game-view/TakebackPrompts";
import { useOnlineAiAnalysis } from "./online-game-view/useOnlineAiAnalysis";
import { useOnlineClock } from "./online-game-view/useOnlineClock";
import { useOnlineGameRoom } from "./online-game-view/useOnlineGameRoom";
import { BottomSheet } from "./shogi-match/components/BottomSheet";
import { KifuNavigationToolbar } from "./shogi-match/components/KifuNavigationToolbar";
import { type HandInfo, MobileBoardSection } from "./shogi-match/components/MobileBoardSection";
import { PCBoardContent } from "./shogi-match/components/PCBoardContent";
import { PvPreviewDialog } from "./shogi-match/components/PvPreviewDialog";
import { TabHeader } from "./shogi-match/components/TabHeader";
import { useIsMobile } from "./shogi-match/hooks/useMediaQuery";
import type { PromotionSelection } from "./shogi-match/types";
import { computeMoveShadow } from "./shogi-match/utils/moveShadow";
import { boardToGrid } from "./shogi-match/utils/positionUtils";
import { determinePromotion } from "./shogi-match/utils/promotionLogic";

const BOARD_DISPLAY_SETTINGS = {
    highlightLastMove: true,
    squareNotation: "none" as const,
    showBoardLabels: true,
};

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
    "サーバーではこの局面を詰みと判定しませんでした。指せる手が表示されないときは、投了で対局を終えてください。";

// ─── メインコンポーネント ──────────────────────────────────────────────────────

interface OnlineGameViewProps {
    client: RoomClient;
    snapshot: SnapshotPayload;
    seat: Seat;
    roomId: string;
    analysis?: OnlineAnalysis;
    manifestUrl?: string;
    nnueAccount?: NnueAccountStore;
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
    nnueAccount,
    onStartReview,
    onExit,
    requestFullSnapshot,
}: OnlineGameViewProps): ReactElement {
    // ─── AI サポート設定 ─────────────────────────────────────────────────────
    const aiSupport = snapshot.settings.aiSupport as AiSupportSettings | null;
    const myAiSettings = seat !== "s" && aiSupport ? aiSupport[seat === "b" ? "b" : "w"] : null;

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
    const { playSound } = useShogiSound();

    // ─── ルームの購読と対局の状態 ────────────────────────────────────────────
    const {
        gameState,
        connection,
        loadFailed,
        startSfenRef,
        movesRef,
        gameRecordIdRef,
        appliedEventIdRef,
        connectionEpochRef,
        positionVersionRef,
    } = useOnlineGameRoom({
        client,
        snapshot,
        seat,
        roomId,
        myAiSettings,
        requestFullSnapshot,
        onPositionReset: () => dispatchUI({ type: "resync_received" }),
        onMoveApplied: (usi, nextTurn) => {
            dispatchUI({ type: "move_received" });
            // 自分の席が着手後の手番 = 相手が指した
            const isOpponentMove = seat !== "s" && nextTurn === seat;
            if (usi === "pass") {
                playSound("pass");
            } else if (isOpponentMove || seat === "s") {
                playSound("move_opponent");
            } else {
                playSound("move_self");
            }
        },
        onCommandRejected: (code, appliedMovesKey) => {
            const text = rejectedCommandNotice(code, seat);
            if (text) {
                setCommandNotice({ text });
            }
            if (code === "CHECKMATE_NOT_CONFIRMED") {
                // 申告の判定と同じ指し手列で記録する。案内は描画中の usiMovesKey と比べるが、
                // どちらも適用し終えた指し手列から作るので一致する
                checkmateRejectedMovesRef.current = appliedMovesKey;
                setCheckmateRejectedMoves(usiMovesKey);
            }
        },
    });
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

    // 右パネルのアクティブタブ
    const [rightTab, setRightTab] = useState<"kifu" | "ai">(aiSupport || analysis ? "ai" : "kifu");

    // analysis prop から分解（undefined 時のデフォルト値）
    const isAnalyzing = analysis?.isAnalyzing ?? false;
    const topMoves = analysis?.topMoves ?? [];

    // 自分の手番か
    const myPlayer: Player | null = seat === "b" ? "sente" : seat === "w" ? "gote" : null;
    const isMyTurn =
        myPlayer !== null &&
        ((turn === "b" && myPlayer === "sente") || (turn === "w" && myPlayer === "gote"));
    const isSpectator = seat === "s";
    // つながっていない間に送った操作は RoomClient が捨てる。再接続した直後も、サーバーの
    // 局面を反映し終えるまでは古い局面を見て選んだ操作になるので受け付けない
    const canSend = connection.state === "connected";
    // 対局中（観戦中も）は、相手の手を待つ間に画面が消えてロックされないようにする。つながり直せない
    // （再読み込みやトップへ戻る案内を出している）間は、消灯を止めない。
    useScreenWakeLock(
        !gameResult && (connection.state === "connected" || connection.state === "reconnecting"),
    );
    const canPlay = isMyTurn && canSend;

    const totalPly = Math.max(0, positionHistory.length - 1);
    // 自分の手番になったら巻き戻しを解除してライブ追従（effect 不要、レンダー時に派生）
    const effectiveNavIndex = isMyTurn ? null : navIndex;
    const isRewound = effectiveNavIndex !== null;
    const currentPly = isRewound ? effectiveNavIndex : totalPly;
    // 表示用局面: 巻き戻し中は履歴局面、それ以外はライブ局面
    const displayPosition = isRewound ? (positionHistory[effectiveNavIndex] ?? null) : position;

    const usiMovesKey = usiMoveLog.map((entry) => entry.usi).join(" ");
    const showsCheckmateRejected = !gameResult && checkmateRejectedMoves === usiMovesKey;

    // ─── 合法手の取得 ────────────────────────────────────────────────────────

    // 指し手列は取りに行く時点で反映し終えたものを読む
    const fetchLegalMoves = useEffectEvent(
        (options: { passRights?: { sente: number; gote: number } }): Promise<string[]> =>
            getPositionService().getLegalMoves(startSfenRef.current, movesRef.current, options),
    );
    const declareCheckmateIfNoMoves = useEffectEvent((moves: string[]): void => {
        // 合法手が0 = 自分が詰まされている → サーバーに通知
        const movesKey = movesRef.current.join(" ");
        if (moves.length === 0 && checkmateRejectedMovesRef.current !== movesKey) {
            client.checkmate({ eventId: appliedEventIdRef.current });
        }
    });

    useEffect(() => {
        // 巻き戻し中は合法手を表示しない
        // passRightsOption は try/catch の外で計算する（React Compiler の制約）
        // エンジンは渡したパス権を開始時の回数として棋譜を再生し、その中のパスで減らすので、
        // 残り回数ではなく部屋の初期値を渡す。残り回数を渡すと使ったパスを二重に引く
        const initialPassRights = passRights
            ? snapshot.settings.passRights?.initialCount
            : undefined;
        const passRightsOption =
            initialPassRights !== undefined
                ? { passRights: { sente: initialPassRights, gote: initialPassRights } }
                : {};
        let cancelled = false;
        void (async () => {
            // position に依存させる: 手番が変わらないまま局面だけ変わる再同期でも、
            // 反映し終えた局面の合法手を取り直す
            if (position && canPlay && !gameResult && !isRewound) {
                try {
                    const moves = await fetchLegalMoves(passRightsOption);
                    if (cancelled) return;
                    dispatchUI({ type: "set_legal_moves", moves });
                    declareCheckmateIfNoMoves(moves);
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
    }, [canPlay, gameResult, isRewound, passRights, position, snapshot.settings.passRights]);

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

    // ─── AI 解析 ─────────────────────────────────────────────────────────────

    const {
        analysisNeedsServer,
        requestAnalysis,
        analyzedPosition,
        pvPreviewMove,
        setPvPreviewMove,
        nnueSelection,
        setNnueSelection,
    } = useOnlineAiAnalysis({
        analysis,
        client,
        seat,
        myAiSettings,
        canSend,
        position,
        turn,
        startSfenRef,
        movesRef,
        appliedEventIdRef,
    });
    const [nnueManagerOpen, setNnueManagerOpen] = useState(false);
    const isMobile = useIsMobile();

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
                onAnalyze={requestAnalysis}
                analysisBoard={analyzedPosition?.position.board ?? null}
                analysisTurn={analyzedPosition?.turn ?? "b"}
                nnueSelection={nnueSelection}
                onNnueSelectionChange={setNnueSelection}
                onOpenNnueManager={() => setNnueManagerOpen(true)}
                onApplyMove={
                    canPlay && !gameResult && !isSpectator
                        ? (usiMove) => Promise.resolve(handleApplyAiMove(usiMove))
                        : undefined
                }
                onPreviewPv={analyzedPosition ? setPvPreviewMove : undefined}
            />
        ) : null;

    const kifuPanelContent = (
        <OnlineKifuList
            usiMoveLog={usiMoveLog}
            positionHistory={positionHistory}
            currentPly={currentPly}
            disabled={!gameResult && !isSpectator}
            onSelectPly={(index) => dispatchUI({ type: "set_nav_index", index })}
        />
    );

    return (
        <div className="flex flex-col md:flex-row gap-4 p-4 max-w-[1100px] mx-auto">
            {/* 左サイドバー: 対局後検討・NNUE設定など（PC のみ表示） */}
            <div className="hidden md:flex w-64 flex-col gap-3" />

            <ConnectionNotices
                offlineSeats={offlineSeats}
                connection={connection}
                isGameOver={gameResult !== null}
                onExit={onExit}
            />

            {/* メインコンテンツ */}
            <div className={`flex flex-col gap-3 ${isMobile ? "items-center" : "flex-1"}`}>
                {/* 奥側プレイヤー情報（上）: 後手視点では先手が奥 */}
                <PlayerHeader
                    name={flipBoard ? playerNames.b : playerNames.w}
                    seat={flipBoard ? "b" : "w"}
                    isMyTurn={flipBoard ? turn === "b" : turn === "w"}
                    remainMs={flipBoard ? clockDisplay.b : clockDisplay.w}
                    isOffline={flipBoard ? offlineSeats.has("b") : offlineSeats.has("w")}
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

                {pendingTakeback && pendingTakeback.seat === seat && !isSpectator && (
                    <TakebackPendingBanner canCancel={canSend} onCancel={handleTakebackCancel} />
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
                        <ResignButton
                            disabled={!canSend}
                            isMyTurn={isMyTurn}
                            canResign={canPlay && position !== null}
                            onResign={handleResign}
                        />
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

                {/* 投了を案内するので、出し入れで投了ボタンの位置がずれないよう操作ボタンの下に置く */}
                {showsCheckmateRejected && (
                    <p role="alert" className="text-sm text-destructive">
                        {CHECKMATE_REJECTED_NOTICE}
                    </p>
                )}

                {(aiSupport || analysis) && topMoves.length > 0 && (
                    <AnalysisSummaryBar
                        evalCp={topMoves[0]?.cp ?? null}
                        onOpen={() => dispatchUI({ type: "set_ai_sheet_open", open: true })}
                    />
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
                    className="mb-2"
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

            <TakebackApprovalDialog
                open={showTakebackApproval}
                onRespond={handleTakebackResponse}
            />

            {/* 対局結果ダイアログ */}
            {gameResult && (
                <GameEndDialog
                    open={!endDialogClosed}
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
            {pvPreviewMove && analyzedPosition && (
                <PvPreviewDialog
                    onClose={() => setPvPreviewMove(null)}
                    pv={pvPreviewMove.pv ?? []}
                    startPosition={analyzedPosition.position}
                    ply={analyzedPosition.ply}
                    evalCp={pvPreviewMove.evalCp}
                    squareNotation={BOARD_DISPLAY_SETTINGS.squareNotation}
                    showBoardLabels={BOARD_DISPLAY_SETTINGS.showBoardLabels}
                    flipBoard={flipBoard}
                />
            )}

            {/* AI（評価関数）の一覧。対局中に部屋を離れると接続が切れるので、その場で開く */}
            {manifestUrl && (
                <NnueLibraryDialog
                    open={nnueManagerOpen}
                    onOpenChange={setNnueManagerOpen}
                    manifestUrl={manifestUrl}
                    account={nnueAccount}
                    isMatchActive={!gameResult}
                />
            )}
        </div>
    );
}
