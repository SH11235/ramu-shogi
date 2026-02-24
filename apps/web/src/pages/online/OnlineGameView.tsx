// apps/web/src/pages/online/OnlineGameView.tsx
// オンライン対局ビュー T-304, T-306, T-307, T-A007, T-A008

import {
    applyMoveWithState,
    getPositionService,
    type PieceType,
    type Player,
    type PositionState,
} from "@shogi/app-core";
import type {
    AiSupportSettings,
    ChatEvent,
    ClockState,
    GameResult,
    RoomClient,
    Seat,
    SnapshotPayload,
} from "@shogi/match-client";
import { ShogiBoard, HandPiecesDisplay, boardToGrid } from "@shogi/ui";
import { createWasmEngineClient } from "@shogi/engine-wasm";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import type { ChatMessage } from "./ChatPanel";
import { ChatPanel } from "./ChatPanel";

// ─── 型定義 ───────────────────────────────────────────────────────────────────

// 成り判定：駒の種類と目的のランクから成れるか
function canPromote(
    pieceType: PieceType,
    fromRank: string,
    toRank: string,
    player: Player,
): boolean {
    if (["K", "G"].includes(pieceType)) return false;
    const promotionRanks = player === "sente" ? ["a", "b", "c"] : ["g", "h", "i"];
    return promotionRanks.includes(fromRank) || promotionRanks.includes(toRank);
}

// 強制成り：成らないと動けない場合
function mustPromote(pieceType: PieceType, toRank: string, player: Player): boolean {
    if (pieceType === "P" || pieceType === "L") {
        return player === "sente" ? toRank === "a" : toRank === "i";
    }
    if (pieceType === "N") {
        return player === "sente" ? ["a", "b"].includes(toRank) : ["h", "i"].includes(toRank);
    }
    return false;
}

// 時間フォーマット
function formatMs(ms: number): string {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

// ─── AI 解析フック（T-A007） ───────────────────────────────────────────────────

interface AnalysisMoveResult {
    usi: string;
    cp: number;
    pv: string[];
}

function useOnlineAnalysis(searchDepth: number | null, searchTimeMs: number | null) {
    const engineRef = useRef<ReturnType<typeof createWasmEngineClient> | null>(null);
    const searchHandleRef = useRef<{ cancel(): Promise<void> } | null>(null);
    const unsubscribeRef = useRef<(() => void) | null>(null);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [topMoves, setTopMoves] = useState<AnalysisMoveResult[]>([]);
    const topMovesMapRef = useRef<Map<number, AnalysisMoveResult>>(new Map());

    useEffect(() => {
        const engine = createWasmEngineClient({ stopMode: "terminate" });
        engineRef.current = engine;
        engine
            .init({ threads: 1 })
            .then(() => engine.setOption("MultiPV", 3))
            .catch(console.error);
        return () => {
            engine.dispose().catch(console.error);
        };
    }, []);

    const startAnalysis = useCallback(
        async (sfen: string, moves: string[]) => {
            const engine = engineRef.current;
            if (!engine) return;

            // 前回の解析をキャンセル
            if (searchHandleRef.current) {
                await searchHandleRef.current.cancel().catch(() => undefined);
                searchHandleRef.current = null;
            }
            if (unsubscribeRef.current) {
                unsubscribeRef.current();
                unsubscribeRef.current = null;
            }

            topMovesMapRef.current.clear();
            setTopMoves([]);
            setIsAnalyzing(true);

            const unsub = engine.subscribe((event) => {
                if (event.type === "info") {
                    const ev = event as typeof event & {
                        multipv?: number;
                        pv?: string[];
                        scoreCp?: number;
                    };
                    const lineIdx = ev.multipv ?? 1;
                    const pv = ev.pv;
                    if (!pv || pv.length === 0) return;
                    const cp = ev.scoreCp ?? 0;
                    topMovesMapRef.current.set(lineIdx, { usi: pv[0], cp, pv });
                    const sorted = Array.from(topMovesMapRef.current.entries())
                        .sort(([a], [b]) => a - b)
                        .map(([, v]) => v);
                    setTopMoves(sorted);
                } else if (event.type === "bestmove") {
                    setIsAnalyzing(false);
                    unsub();
                    unsubscribeRef.current = null;
                }
            });
            unsubscribeRef.current = unsub;

            try {
                await engine.loadPosition(sfen, moves);
                const limits: { maxDepth?: number; movetimeMs?: number } = {};
                if (searchDepth !== null) limits.maxDepth = searchDepth;
                if (searchTimeMs !== null) limits.movetimeMs = searchTimeMs;
                const handle = await engine.search({ limits });
                searchHandleRef.current = handle;
            } catch {
                setIsAnalyzing(false);
                unsub();
                unsubscribeRef.current = null;
            }
        },
        [searchDepth, searchTimeMs],
    );

    const cancelAnalysis = useCallback(async () => {
        if (searchHandleRef.current) {
            await searchHandleRef.current.cancel().catch(() => undefined);
            searchHandleRef.current = null;
        }
        if (unsubscribeRef.current) {
            unsubscribeRef.current();
            unsubscribeRef.current = null;
        }
        setIsAnalyzing(false);
    }, []);

    return { isAnalyzing, topMoves, startAnalysis, cancelAnalysis };
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
}

export function OnlineGameView({
    client,
    snapshot,
    seat,
    roomId,
}: OnlineGameViewProps): ReactElement {
    const [position, setPosition] = useState<PositionState | null>(null);
    const [clockState, setClockState] = useState<ClockState>(snapshot.clock);
    const [turn, setTurn] = useState<"b" | "w">(snapshot.turn);
    const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
    const [selectedHand, setSelectedHand] = useState<PieceType | null>(null);
    const [legalMoves, setLegalMoves] = useState<string[]>([]);
    const [promoteDialog, setPromoteDialog] = useState<{
        from: string;
        to: string;
        usi: string;
    } | null>(null);
    const [gameResult, setGameResult] = useState<GameResult | null>(null);
    const [kifu, setKifu] = useState<string>("");
    const [offlineSeats, setOfflineSeats] = useState<Set<string>>(new Set());
    const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
        ...snapshot.recentChat.map((e, i) => ({
            id: i,
            seat: e.seat,
            name: e.name,
            text: e.text,
        })),
    ]);
    const chatIdRef = useRef(snapshot.recentChat.length);

    // ─── AI サポート状態（T-A007, T-A008） ─────────────────────────────────────
    const aiSupport = snapshot.settings.aiSupport as AiSupportSettings | null;
    const myAiSettings = seat !== "s" && aiSupport ? aiSupport[seat === "b" ? "b" : "w"] : null;
    // 残り解析回数（null = 無制限、数値 = 残り回数）
    const [myAnalysisRemaining, setMyAnalysisRemaining] = useState<number | null>(
        myAiSettings?.mode === "limited" ? (myAiSettings.limitCount ?? 0) : null,
    );
    // 解析使用ログ（T-A008）
    const [analysisLog, setAnalysisLog] = useState<Array<{ seat: "b" | "w"; ply: number }>>([]);
    const { isAnalyzing, topMoves, startAnalysis, cancelAnalysis } = useOnlineAnalysis(
        aiSupport?.searchDepth ?? null,
        aiSupport?.searchTimeMs ?? null,
    );

    // 現在の start SFEN と moves
    const startSfenRef = useRef(snapshot.settings.startSfen);
    const movesRef = useRef<string[]>([...snapshot.moves]);

    // 自分の手番か
    const myPlayer: Player | null = seat === "b" ? "sente" : seat === "w" ? "gote" : null;
    const isMyTurn =
        myPlayer !== null &&
        ((turn === "b" && myPlayer === "sente") || (turn === "w" && myPlayer === "gote"));
    const isSpectator = seat === "s";

    // ─── 初期局面の読み込み ──────────────────────────────────────────────────

    useEffect(() => {
        let cancelled = false;
        getPositionService()
            .parseSfen(snapshot.sfen)
            .then((pos) => {
                if (!cancelled) setPosition(pos);
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
                if (e.kind === "move") {
                    // 局面を更新
                    setPosition((prev) => {
                        if (!prev) return prev;
                        return applyMoveWithState(prev, e.usi).next;
                    });
                    movesRef.current = [...movesRef.current, e.usi];
                    setTurn(e.turn === "b" ? "w" : "b"); // 次の手番
                    setClockState(e.clock);
                    setSelectedSquare(null);
                    setSelectedHand(null);
                    setLegalMoves([]);
                } else if (
                    e.kind === "resign" ||
                    e.kind === "timeout" ||
                    e.kind === "checkmate" ||
                    e.kind === "sennichite" ||
                    e.kind === "illegal_move" ||
                    e.kind === "disconnect_loss"
                ) {
                    setGameResult(e.result);
                } else if (e.kind === "game_end") {
                    setGameResult(e.result);
                    setKifu(e.kifu);
                } else if (e.kind === "player_offline") {
                    setOfflineSeats((prev) => new Set([...prev, e.seat]));
                } else if (e.kind === "player_online") {
                    setOfflineSeats((prev) => {
                        const next = new Set(prev);
                        next.delete(e.seat);
                        return next;
                    });
                } else if (e.kind === "chat") {
                    const chatEv = e as ChatEvent;
                    setChatMessages((prev) => [
                        ...prev,
                        {
                            id: chatIdRef.current++,
                            seat: chatEv.seat,
                            name: chatEv.name,
                            text: chatEv.text,
                        },
                    ]);
                } else if (e.kind === "analysis_used") {
                    // 自分の残り回数を更新
                    if (e.seat === seat && e.seat !== "s") {
                        setMyAnalysisRemaining(
                            typeof e.analysisRemaining === "number" ? e.analysisRemaining : null,
                        );
                    }
                    // 解析ログに追記（T-A008）
                    if (e.seat === "b" || e.seat === "w") {
                        const ply = movesRef.current.length;
                        setAnalysisLog((prev) => [...prev, { seat: e.seat as "b" | "w", ply }]);
                    }
                }
            } else if (msg.t === "snapshot") {
                // 再接続後のスナップショット更新
                setClockState(msg.payload.clock);
                setTurn(msg.payload.turn);
                getPositionService()
                    .parseSfen(msg.payload.sfen)
                    .then(setPosition)
                    .catch(console.error);
            }
        });
        return unsub;
    }, [client]);

    // ─── 合法手の取得 ────────────────────────────────────────────────────────

    const fetchLegalMoves = useCallback(async () => {
        if (!isMyTurn) return;
        try {
            const moves = await getPositionService().getLegalMoves(
                startSfenRef.current,
                movesRef.current,
            );
            setLegalMoves(moves);
        } catch {
            setLegalMoves([]);
        }
    }, [isMyTurn]);

    useEffect(() => {
        if (isMyTurn && !gameResult) {
            void fetchLegalMoves();
        } else {
            setLegalMoves([]);
        }
    }, [isMyTurn, gameResult, fetchLegalMoves]);

    // ─── 盤面クリック処理 ────────────────────────────────────────────────────

    function handleBoardSelect(squareId: string): void {
        if (!isMyTurn || gameResult || !position) return;

        // 持ち駒を選択中の場合 → ドロップ
        if (selectedHand !== null) {
            const usi = `${selectedHand}*${squareId.toUpperCase()}`;
            // 合法手チェック
            if (legalMoves.includes(usi) || legalMoves.some((m) => m === usi)) {
                void sendMove(usi, squareId);
                setSelectedHand(null);
            } else {
                setSelectedHand(null);
            }
            setSelectedSquare(null);
            return;
        }

        // 盤上の駒を選択中の場合 → 移動
        if (selectedSquare) {
            if (selectedSquare === squareId) {
                setSelectedSquare(null);
                return;
            }
            const from = selectedSquare.toUpperCase();
            const to = squareId.toUpperCase();
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
                    setSelectedSquare(squareId);
                } else {
                    setSelectedSquare(null);
                }
                return;
            }

            const fromRank = from.slice(1).toLowerCase();
            const toRank = to.slice(1).toLowerCase();
            const piece = position.board[selectedSquare as keyof typeof position.board];
            const pieceType = piece?.type ?? null;

            const mustPro =
                pieceType && myPlayer ? mustPromote(pieceType, toRank, myPlayer) : false;
            const canPro =
                pieceType && myPlayer && !piece?.promoted
                    ? canPromote(pieceType, fromRank, toRank, myPlayer)
                    : false;

            if (mustPro) {
                void sendMove(usiPromote, squareId);
            } else if (canPro && legalMoves.includes(usiPromote)) {
                setPromoteDialog({ from: selectedSquare, to: squareId, usi: usiBase });
            } else {
                void sendMove(usiBase, squareId);
            }
            setSelectedSquare(null);
            return;
        }

        // 新たに駒を選択
        const piece = position?.board[squareId as keyof typeof position.board];
        if (
            piece &&
            ((piece.owner === "sente" && myPlayer === "sente") ||
                (piece.owner === "gote" && myPlayer === "gote"))
        ) {
            setSelectedSquare(squareId);
        }
    }

    function handleHandSelect(pieceType: PieceType): void {
        if (!isMyTurn || gameResult) return;
        setSelectedHand(selectedHand === pieceType ? null : pieceType);
        setSelectedSquare(null);
    }

    async function sendMove(usi: string, _toSquare?: string): Promise<void> {
        if (!position) return;
        // 移動後の SFEN を計算して送信
        const nextPos = applyMoveWithState(position, usi).next;
        const nextSfen = await getPositionService().boardToSfen(nextPos);
        const eventId = snapshot.eventId + movesRef.current.length;
        client.move({ eventId, usi, sfen: nextSfen });
    }

    // ─── 投了 ────────────────────────────────────────────────────────────────

    function handleResign(): void {
        if (!isMyTurn && !position) return;
        const eventId = snapshot.eventId + movesRef.current.length;
        client.resign({ eventId });
    }

    // ─── AI 解析トリガー（T-A007） ────────────────────────────────────────────

    const handleAnalyze = useCallback(async () => {
        if (!position || !aiSupport || seat === "s") return;
        // 制限モードは use_analysis を先送信してからエンジン解析
        if (myAiSettings?.mode === "limited") {
            const eventId = snapshot.eventId + movesRef.current.length;
            const ply = movesRef.current.length;
            client.useAnalysis({ eventId, ply });
            // analysis_used 受信後に自動で残り回数が更新される
        }
        // WASM 解析開始
        await getPositionService()
            .boardToSfen(position)
            .then((sfen) => startAnalysis(sfen, movesRef.current))
            .catch(console.error);
    }, [position, aiSupport, myAiSettings, seat, snapshot.eventId, client, startAnalysis]);

    // 無制限モード: 自分の手番になったら自動解析
    const positionSfenRef = useRef<string>("");
    useEffect(() => {
        if (!aiSupport || !position || gameResult) return;
        if (myAiSettings?.mode !== "unlimited") return;
        // 自分の手番（または観戦者）のとき自動解析
        const isMyAnalysisTurn =
            seat === "s" || (seat === "b" && turn === "b") || (seat === "w" && turn === "w");
        if (!isMyAnalysisTurn) {
            void cancelAnalysis();
            return;
        }
        getPositionService()
            .boardToSfen(position)
            .then((sfen) => {
                if (sfen === positionSfenRef.current) return;
                positionSfenRef.current = sfen;
                return startAnalysis(sfen, movesRef.current);
            })
            .catch(console.error);
    }, [aiSupport, myAiSettings, position, turn, seat, gameResult, startAnalysis, cancelAnalysis]);

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

    const grid = position ? boardToGrid(position.board) : [];
    const clockDisplay = useOnlineClock(clockState);

    const flipBoard = seat === "w";

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
            <div className="flex flex-col gap-3 flex-1">
                {/* 後手情報（上） */}
                <PlayerHeader
                    name={playerNames.w}
                    seat="w"
                    isMyTurn={turn === "w"}
                    remainMs={clockDisplay.w}
                    isOffline={offlineSeats.has("w")}
                    isFlipped={flipBoard}
                />

                {/* 後手持ち駒（上） */}
                {position && (
                    <div className={`flex justify-${flipBoard ? "start" : "end"}`}>
                        <HandPiecesDisplay
                            owner="gote"
                            hand={position.hands.gote}
                            selectedPiece={myPlayer === "gote" ? selectedHand : null}
                            isActive={isMyTurn && myPlayer === "gote"}
                            onHandSelect={handleHandSelect}
                            hideEmptyPieces
                            isMatchRunning
                            size="medium"
                            flipBoard={flipBoard}
                        />
                    </div>
                )}

                {/* 将棋盤 */}
                {position ? (
                    <ShogiBoard
                        grid={grid}
                        selectedSquare={selectedSquare}
                        onSelect={isMyTurn && !isSpectator ? handleBoardSelect : undefined}
                        flipBoard={flipBoard}
                        showBoardLabels
                    />
                ) : (
                    <div className="flex h-64 items-center justify-center rounded-lg border border-border bg-card">
                        <p className="text-muted-foreground">局面を読み込み中...</p>
                    </div>
                )}

                {/* 先手持ち駒（下） */}
                {position && (
                    <div className={`flex justify-${flipBoard ? "end" : "start"}`}>
                        <HandPiecesDisplay
                            owner="sente"
                            hand={position.hands.sente}
                            selectedPiece={myPlayer === "sente" ? selectedHand : null}
                            isActive={isMyTurn && myPlayer === "sente"}
                            onHandSelect={handleHandSelect}
                            hideEmptyPieces
                            isMatchRunning
                            size="medium"
                            flipBoard={flipBoard}
                        />
                    </div>
                )}

                {/* 先手情報（下） */}
                <PlayerHeader
                    name={playerNames.b}
                    seat="b"
                    isMyTurn={turn === "b"}
                    remainMs={clockDisplay.b}
                    isOffline={offlineSeats.has("b")}
                    isFlipped={flipBoard}
                />

                {/* 操作ボタン */}
                {!isSpectator && !gameResult && (
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={handleResign}
                            className="rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                            投了
                        </button>
                    </div>
                )}

                {/* 観戦者数 */}
                {snapshot.spectators > 0 && (
                    <p className="text-xs text-muted-foreground">
                        観戦者: {snapshot.spectators} 人
                    </p>
                )}
            </div>

            {/* サイドバー: AI 解析 + チャット */}
            <div className="w-full md:w-64 flex flex-col gap-3">
                {/* AI 解析パネル（T-A007） */}
                {aiSupport && (
                    <OnlineAiPanel
                        aiSupport={aiSupport}
                        seat={seat}
                        myAnalysisRemaining={myAnalysisRemaining}
                        isAnalyzing={isAnalyzing}
                        topMoves={topMoves}
                        canAnalyze={!gameResult && !isSpectator}
                        onAnalyze={() => void handleAnalyze()}
                    />
                )}
                <div className="flex-1 h-64 md:h-auto min-h-[160px]">
                    <ChatPanel messages={chatMessages} client={client} canSend={!gameResult} />
                </div>
            </div>

            {/* 成り判定ダイアログ */}
            {promoteDialog && (
                <PromoteDialog
                    onPromote={() => {
                        void sendMove(promoteDialog.usi + "+", promoteDialog.to);
                        setPromoteDialog(null);
                    }}
                    onNoPromote={() => {
                        void sendMove(promoteDialog.usi, promoteDialog.to);
                        setPromoteDialog(null);
                    }}
                />
            )}

            {/* 対局結果ダイアログ */}
            {gameResult && (
                <GameEndDialog
                    result={gameResult}
                    kifu={kifu}
                    playerNames={playerNames}
                    onDownloadKifu={handleDownloadKifu}
                    analysisLog={analysisLog}
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
}

function PlayerHeader({
    name,
    seat,
    isMyTurn,
    remainMs,
    isOffline,
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
            </div>
            <span
                className={`font-mono text-sm tabular-nums ${isMyTurn ? "text-primary font-bold" : "text-muted-foreground"}`}
            >
                {formatMs(remainMs)}
            </span>
        </div>
    );
}

interface PromoteDialogProps {
    onPromote: () => void;
    onNoPromote: () => void;
}

function PromoteDialog({ onPromote, onNoPromote }: PromoteDialogProps): ReactElement {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
            <div className="rounded-xl border border-border bg-card p-6 shadow-xl">
                <p className="mb-4 text-center text-foreground font-semibold">成りますか？</p>
                <div className="flex gap-3">
                    <button
                        type="button"
                        onClick={onPromote}
                        className="flex-1 rounded-lg bg-primary py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
                    >
                        成る
                    </button>
                    <button
                        type="button"
                        onClick={onNoPromote}
                        className="flex-1 rounded-lg bg-secondary py-2 text-sm font-semibold text-secondary-foreground hover:bg-secondary/80"
                    >
                        成らない
                    </button>
                </div>
            </div>
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
}

function GameEndDialog({
    result,
    kifu,
    playerNames,
    onDownloadKifu,
    analysisLog,
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

                {/* T-A008: 解析ログ開示 */}
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
                    <button
                        type="button"
                        onClick={() => {
                            window.location.href = "/";
                        }}
                        className="w-full rounded-lg bg-primary py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
                    >
                        トップへ戻る
                    </button>
                </div>
            </div>
        </div>
    );
}

// ─── OnlineAiPanel（T-A007） ──────────────────────────────────────────────────

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
