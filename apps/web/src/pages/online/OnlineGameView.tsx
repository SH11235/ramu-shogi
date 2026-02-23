// apps/web/src/pages/online/OnlineGameView.tsx
// オンライン対局ビュー T-304, T-306, T-307

import {
    applyMoveWithState,
    getPositionService,
    type PieceType,
    type Player,
    type PositionState,
} from "@shogi/app-core";
import type {
    ChatEvent,
    ClockState,
    GameResult,
    RoomClient,
    Seat,
    SnapshotPayload,
} from "@shogi/match-client";
import { ShogiBoard, HandPiecesDisplay, boardToGrid } from "@shogi/ui";
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

            {/* サイドバー: チャット */}
            <div className="w-full md:w-64 h-64 md:h-auto">
                <ChatPanel messages={chatMessages} client={client} canSend={!gameResult} />
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
}

function GameEndDialog({
    result,
    kifu,
    playerNames,
    onDownloadKifu,
}: GameEndDialogProps): ReactElement {
    const winnerName =
        result.winner === "b" ? playerNames.b : result.winner === "w" ? playerNames.w : null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
            <div className="rounded-xl border border-border bg-card p-6 shadow-xl min-w-[280px]">
                <h2 className="mb-3 text-center text-xl font-bold text-foreground">
                    {winnerName ? `${winnerName} の勝ち` : "引き分け"}
                </h2>
                <p className="mb-5 text-center text-sm text-muted-foreground">
                    {GAME_END_REASONS[result.reason] ?? result.reason}
                </p>
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
