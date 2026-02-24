// 待機画面・対局ルームページ（/online/:roomId）

import type { RoomClient, Seat, ServerMessage, SnapshotPayload } from "@shogi/match-client";
import { createRoomClient } from "@shogi/match-client";
import { useNavigate, useParams } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { OnlineGameView } from "./OnlineGameView";

// ─── ルーム情報の型（GET /api/rooms/:roomId のレスポンス） ────────────────────

interface AiSupportPlayerSettings {
    mode: "unlimited" | "limited";
    limitCount: number | null;
}

interface RoomInfo {
    roomId: string;
    status: "waiting" | "playing" | "finished";
    players: {
        b: { name: string } | null;
        w: { name: string } | null;
    };
    spectators: number;
    settings: {
        startSfen: string;
        timeControl:
            | { type: "byoyomi"; initialMs: number; byoyomiMs: number }
            | { type: "fischer"; initialMs: number; fischerIncrementMs: number };
        passRights: { initialCount: number } | null;
        aiSupport: {
            b: AiSupportPlayerSettings;
            w: AiSupportPlayerSettings;
            searchDepth: number | null;
            searchTimeMs: number | null;
        } | null;
    };
}

// ─── ページコンポーネント ──────────────────────────────────────────────────────

export default function RoomPage(): ReactElement {
    const { roomId } = useParams({ from: "/online/$roomId" });
    // URLクエリパラメータ（ルーム作成者から渡される名前・座席）
    const urlParams = new URLSearchParams(
        typeof window !== "undefined" ? window.location.search : "",
    );
    const search = {
        name: urlParams.get("name") ?? undefined,
        seat: urlParams.get("seat") ?? undefined,
    };

    const navigate = useNavigate();

    const [roomInfo, setRoomInfo] = useState<RoomInfo | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);

    const [joinName, setJoinName] = useState(search.name ?? "");
    const [joinSeat, setJoinSeat] = useState<"b" | "w" | "s">(
        (search.seat as "b" | "w" | "s" | undefined) ?? "w",
    );
    const [isJoining, setIsJoining] = useState(false);
    const [joinError, setJoinError] = useState<string | null>(null);
    const [snapshot, setSnapshot] = useState<SnapshotPayload | null>(null);
    const [joined, setJoined] = useState(false);
    const [gamePhase, setGamePhase] = useState<"waiting" | "playing">("waiting");

    const clientRef = useRef<RoomClient | null>(null);
    const inviteUrl =
        typeof window !== "undefined" ? `${window.location.origin}/online/${roomId}` : "";

    // ─── ルーム情報取得 ────────────────────────────────────────────────────────

    useEffect(() => {
        let cancelled = false;
        fetch(`/api/rooms/${roomId}`)
            .then(async (res) => {
                if (!res.ok) {
                    if (res.status === 404) throw new Error("ルームが見つかりません");
                    throw new Error("ルーム情報の取得に失敗しました");
                }
                return res.json() as Promise<RoomInfo>;
            })
            .then((info) => {
                if (!cancelled) setRoomInfo(info);
            })
            .catch((err: unknown) => {
                if (!cancelled)
                    setLoadError(err instanceof Error ? err.message : "エラーが発生しました");
            });
        return () => {
            cancelled = true;
        };
    }, [roomId]);

    // ─── WebSocket 接続 + join 送信 ────────────────────────────────────────────

    const handleJoin = useCallback(
        (seatToJoin: "b" | "w" | "s") => {
            if (!joinName.trim() || isJoining) return;
            setIsJoining(true);
            setJoinSeat(seatToJoin);
            setJoinError(null);

            const wsUrl = `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/api/rooms/${roomId}/ws`;

            const client = createRoomClient({
                wsUrl,
                autoReconnect: true,
                onReconnect: () => {
                    // 再接続後は subscribe 内の resumed ハンドラが処理
                },
            });

            clientRef.current = client;

            const unsub = client.subscribe((msg: ServerMessage) => {
                switch (msg.t) {
                    case "joined": {
                        setJoined(true);
                        setIsJoining(false);
                        break;
                    }
                    case "snapshot": {
                        setSnapshot(msg.payload);
                        break;
                    }
                    case "event": {
                        if (msg.payload.kind === "game_start") {
                            // game_start → 待機画面からインプレースで対局画面へ切り替え
                            // WebSocket 接続を維持したまま OnlineGameView を表示する
                            unsub();
                            setGamePhase("playing");
                        }
                        break;
                    }
                    case "error": {
                        setJoinError(msg.payload.message ?? "参加に失敗しました");
                        setIsJoining(false);
                        client.disconnect();
                        clientRef.current = null;
                        break;
                    }
                    default:
                        break;
                }
            });

            // join メッセージ送信（open 後に自動実行される）
            // createRoomClient は接続後に send できるよう subscribe + open を待つ
            // open イベント後 send するため、少し遅延させる
            const sendJoin = (): void => {
                if (client.getStatus() === "connected") {
                    // seatToJoin をクロージャで直接参照し、setState の非同期更新に依存しない
                    client.join({ seat: seatToJoin, name: joinName.trim() });
                } else {
                    setTimeout(sendJoin, 100);
                }
            };
            setTimeout(sendJoin, 50);
        },
        [joinName, isJoining, roomId],
    );

    // ルーム作成者（search.seat === "b"）は自動接続
    const autoJoinAttempted = useRef(false);
    useEffect(() => {
        if (search.seat === "b" && search.name && !autoJoinAttempted.current && roomInfo !== null) {
            autoJoinAttempted.current = true;
            handleJoin("b");
        }
    }, [search.seat, search.name, roomInfo, handleJoin]);

    // アンマウント時に WebSocket を閉じる
    useEffect(() => {
        return () => {
            clientRef.current?.disconnect();
        };
    }, []);

    // ─── コピー処理 ────────────────────────────────────────────────────────────

    async function handleCopyLink(): Promise<void> {
        try {
            await navigator.clipboard.writeText(inviteUrl);
        } catch {
            // フォールバック: 選択状態にする
        }
    }

    // ─── レンダリング ──────────────────────────────────────────────────────────

    // 対局フェーズ: OnlineGameView にインプレース切り替え（WebSocket 維持）
    if (gamePhase === "playing" && snapshot && clientRef.current) {
        return (
            <OnlineGameView
                client={clientRef.current}
                snapshot={snapshot}
                seat={joinSeat as Seat}
                roomId={roomId}
            />
        );
    }

    if (loadError) {
        return (
            <div className="mx-auto flex max-w-[480px] flex-col gap-4 px-4 py-10">
                <p className="text-destructive">{loadError}</p>
                <button
                    type="button"
                    onClick={() => void navigate({ to: "/online", search: undefined })}
                    className="text-sm text-muted-foreground hover:text-foreground"
                >
                    ← オンライン対局に戻る
                </button>
            </div>
        );
    }

    if (!roomInfo) {
        return (
            <div className="mx-auto flex max-w-[480px] flex-col gap-4 px-4 py-10">
                <p className="text-muted-foreground">読み込み中...</p>
            </div>
        );
    }

    const timeControlLabel = (() => {
        const tc = roomInfo.settings.timeControl;
        if (tc.type === "byoyomi") {
            const min = tc.initialMs / 60_000;
            const sec = (tc.byoyomiMs ?? 0) / 1000;
            return `${min} 分 + 秒読み ${sec} 秒`;
        }
        const min = tc.initialMs / 60_000;
        const inc = (tc.fischerIncrementMs ?? 0) / 1000;
        return `フィッシャー ${min} 分 + ${inc} 秒`;
    })();

    const startSfenLabel = (() => {
        const s = roomInfo.settings.startSfen;
        if (s === "startpos") return "平手";
        if (s === "handicap:bishop") return "角落ち";
        if (s === "handicap:rook") return "飛車落ち";
        if (s === "handicap:rook-bishop") return "飛車角落ち";
        return "カスタム局面";
    })();

    return (
        <div className="mx-auto flex max-w-[480px] flex-col gap-5 px-4 py-8">
            <h1 className="text-xl font-bold text-foreground">対局ルーム</h1>

            {/* 招待リンク */}
            <div className="flex flex-col gap-1">
                <span className="text-sm font-medium text-foreground">招待リンク</span>
                <div className="flex gap-2">
                    <input
                        readOnly
                        value={inviteUrl}
                        className="flex h-10 flex-1 rounded-md border border-input bg-muted px-3 py-2 text-xs text-muted-foreground"
                    />
                    <button
                        type="button"
                        onClick={() => void handleCopyLink()}
                        className="rounded-md bg-secondary px-3 py-2 text-sm font-medium text-secondary-foreground shadow-sm hover:bg-secondary/80"
                    >
                        コピー
                    </button>
                </div>
            </div>

            {/* プレイヤー状況 */}
            <div className="rounded-lg border border-border bg-card p-4">
                <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-wafuu-shu">
                            先手（▲）:{" "}
                            {roomInfo.players.b?.name ?? (
                                <span className="text-muted-foreground">待機中...</span>
                            )}
                        </span>
                        {roomInfo.players.b && (
                            <span className="text-xs text-muted-foreground">✓ 登録済み</span>
                        )}
                    </div>
                    <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-wafuu-ai">
                            後手（△）:{" "}
                            {roomInfo.players.w?.name ?? (
                                <span className="text-muted-foreground">待機中...</span>
                            )}
                        </span>
                        {roomInfo.players.w && (
                            <span className="text-xs text-muted-foreground">✓ 登録済み</span>
                        )}
                    </div>
                </div>
            </div>

            {/* snapshot がある場合のプレイヤー更新 */}
            {snapshot && (
                <div className="rounded-lg border border-border bg-card p-4">
                    <div className="flex flex-col gap-2">
                        <div className="flex items-center justify-between">
                            <span className="text-sm font-medium text-wafuu-shu">
                                先手（▲）:{" "}
                                {snapshot.players.b?.name ?? (
                                    <span className="text-muted-foreground">待機中...</span>
                                )}
                            </span>
                            {snapshot.players.b?.online && (
                                <span className="text-xs text-status-online">● オンライン</span>
                            )}
                        </div>
                        <div className="flex items-center justify-between">
                            <span className="text-sm font-medium text-wafuu-ai">
                                後手（△）:{" "}
                                {snapshot.players.w?.name ?? (
                                    <span className="text-muted-foreground">待機中...</span>
                                )}
                            </span>
                            {snapshot.players.w?.online && (
                                <span className="text-xs text-status-online">● オンライン</span>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* 参加フォーム（未参加の場合のみ） */}
            {!joined && (
                <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
                    <h2 className="text-sm font-semibold text-foreground">参加する</h2>

                    <div className="flex flex-col gap-1">
                        <label htmlFor="join-name" className="text-sm text-foreground">
                            名前
                        </label>
                        <input
                            id="join-name"
                            type="text"
                            value={joinName}
                            onChange={(e) => setJoinName(e.target.value)}
                            placeholder="プレイヤー名"
                            maxLength={20}
                            disabled={isJoining}
                            className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50"
                        />
                    </div>

                    {joinError && <p className="text-sm text-destructive">{joinError}</p>}

                    <div className="flex flex-col gap-2">
                        <button
                            type="button"
                            onClick={() => handleJoin("w")}
                            disabled={isJoining || !joinName.trim()}
                            className="w-full rounded-lg bg-wafuu-ai py-2.5 text-sm font-semibold text-wafuu-ai-fg shadow hover:opacity-90 disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        >
                            {isJoining && joinSeat === "w" ? "接続中..." : "後手として参加する"}
                        </button>
                        <button
                            type="button"
                            onClick={() => handleJoin("s")}
                            disabled={isJoining || !joinName.trim()}
                            className="w-full rounded-lg bg-secondary py-2.5 text-sm font-semibold text-secondary-foreground shadow-sm hover:bg-secondary/80 disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        >
                            {isJoining && joinSeat === "s" ? "接続中..." : "観戦者として参加する"}
                        </button>
                    </div>
                </div>
            )}

            {/* 接続済みメッセージ */}
            {joined && (
                <div className="rounded-lg border border-status-online-border bg-status-online-bg p-4 text-sm text-status-online">
                    接続しました。対局開始を待っています...
                </div>
            )}

            {/* 対局設定表示 */}
            <div className="rounded-lg border border-border bg-card p-4">
                <h2 className="mb-3 text-sm font-semibold text-foreground">対局設定</h2>
                <div className="flex flex-col gap-1 text-sm text-muted-foreground">
                    <div className="flex justify-between">
                        <span>持ち時間</span>
                        <span>{timeControlLabel}</span>
                    </div>
                    <div className="flex justify-between">
                        <span>開始局面</span>
                        <span>{startSfenLabel}</span>
                    </div>
                    {roomInfo.settings.passRights && (
                        <div className="flex justify-between">
                            <span>パス権</span>
                            <span>各 {roomInfo.settings.passRights.initialCount} 回</span>
                        </div>
                    )}
                    {roomInfo.settings.aiSupport && (
                        <div className="flex justify-between">
                            <span>AI サポート</span>
                            <span>
                                ▲{" "}
                                {roomInfo.settings.aiSupport.b.mode === "unlimited"
                                    ? "無制限"
                                    : `${roomInfo.settings.aiSupport.b.limitCount ?? 0} 回`}
                                {" / "}△{" "}
                                {roomInfo.settings.aiSupport.w.mode === "unlimited"
                                    ? "無制限"
                                    : `${roomInfo.settings.aiSupport.w.limitCount ?? 0} 回`}
                            </span>
                        </div>
                    )}
                </div>
            </div>

            <button
                type="button"
                onClick={() => void navigate({ to: "/online", search: undefined })}
                className="text-sm text-muted-foreground hover:text-foreground"
            >
                ← オンライン対局に戻る
            </button>
        </div>
    );
}
