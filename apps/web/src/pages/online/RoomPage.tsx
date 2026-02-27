// 待機画面・対局ルームページ（/online/:roomId）

import { createWasmEngineClient } from "@shogi/engine-wasm";
import type { RoomClient, Seat, ServerMessage, SnapshotPayload } from "@shogi/match-client";
import {
    createRoomClient,
    getStoredResumeToken,
    getStoredSeat,
    storeSeat,
} from "@shogi/match-client";
import type { EngineOption } from "@shogi/ui";
import { OnlineGameView, PositionPresetSelector, ShogiMatch } from "@shogi/ui";
import { getRouteApi, useNavigate, useParams } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { useEffect, useReducer, useRef, useState } from "react";
import { useOnlineAnalysis } from "../../hooks/useOnlineAnalysis";

const nnueManifestUrl: string = (() => {
    const value = import.meta.env.VITE_NNUE_MANIFEST_URL as string | undefined;
    if (!value) {
        throw new Error("VITE_NNUE_MANIFEST_URL is required.");
    }
    return value;
})();

// ─── ルーム情報の型（GET /api/rooms/:roomId のレスポンス） ────────────────────

interface AiSupportPlayerSettings {
    mode: "unlimited" | "limited";
    limitCount: number | null;
}

export interface RoomInfo {
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

// ─── 参加フォーム状態 ────────────────────────────────────────────────────────

type JoinFormState = {
    name: string;
    seat: "b" | "w" | "s";
    isJoining: boolean;
    error: string | null;
};

type JoinFormAction =
    | { type: "set_name"; name: string }
    | { type: "start_join"; seat: "b" | "w" | "s" }
    | { type: "joined" }
    | { type: "error"; message: string };

function joinFormReducer(state: JoinFormState, action: JoinFormAction): JoinFormState {
    switch (action.type) {
        case "set_name":
            return { ...state, name: action.name };
        case "start_join":
            return { ...state, seat: action.seat, isJoining: true, error: null };
        case "joined":
            return { ...state, isJoining: false };
        case "error":
            return { ...state, isJoining: false, error: action.message };
    }
}

// ─── ルーム状態 ───────────────────────────────────────────────────────────────

interface RoomState {
    snapshot: SnapshotPayload | null;
    joined: boolean;
    localStartSfen: string | null;
    gamePhase: "waiting" | "playing" | "reviewing";
    reviewData: {
        sfen: string;
        moves: string[];
        analysisMarkers: Array<{ seat: "b" | "w"; ply: number }>;
    } | null;
    client: RoomClient | null;
}

type RoomAction =
    | { type: "joined" }
    | { type: "snapshot_received"; snapshot: SnapshotPayload }
    | { type: "settings_updated"; startSfen: string }
    | { type: "game_start" }
    | { type: "client_set"; client: RoomClient }
    | { type: "client_cleared" }
    | { type: "start_review"; data: RoomState["reviewData"] };

const INITIAL_ROOM_STATE: RoomState = {
    snapshot: null,
    joined: false,
    localStartSfen: null,
    gamePhase: "waiting",
    reviewData: null,
    client: null,
};

function roomReducer(state: RoomState, action: RoomAction): RoomState {
    switch (action.type) {
        case "joined":
            return { ...state, joined: true };
        case "snapshot_received":
            return { ...state, snapshot: action.snapshot };
        case "settings_updated":
            return { ...state, localStartSfen: action.startSfen };
        case "game_start":
            return { ...state, gamePhase: "playing" };
        case "client_set":
            return { ...state, client: action.client };
        case "client_cleared":
            return { ...state, client: null };
        case "start_review":
            return { ...state, reviewData: action.data, gamePhase: "reviewing" };
    }
}

// ─── ルートAPI（loaderData アクセス用） ──────────────────────────────────────

const routeApi = getRouteApi("/online/$roomId");

// ─── サブコンポーネント ───────────────────────────────────────────────────────

function InviteLinkSection({
    inviteUrl,
    copied,
    onCopy,
}: {
    inviteUrl: string;
    copied: boolean;
    onCopy: () => void;
}): ReactElement {
    return (
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
                    onClick={onCopy}
                    className="rounded-md bg-secondary px-3 py-2 text-sm font-medium text-secondary-foreground shadow-sm hover:bg-secondary/80 transition-colors"
                >
                    {copied ? "コピーしました！" : "コピー"}
                </button>
            </div>
        </div>
    );
}

function PlayersStatusSection({
    roomInfoPlayers,
    snapshotPlayers,
}: {
    roomInfoPlayers: RoomInfo["players"];
    snapshotPlayers?: SnapshotPayload["players"] | null;
}): ReactElement {
    return (
        <>
            <div className="rounded-lg border border-border bg-card p-4">
                <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-wafuu-shu">
                            先手（▲）:{" "}
                            {roomInfoPlayers.b?.name ?? (
                                <span className="text-muted-foreground">待機中...</span>
                            )}
                        </span>
                        {roomInfoPlayers.b && (
                            <span className="text-xs text-muted-foreground">✓ 登録済み</span>
                        )}
                    </div>
                    <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-wafuu-ai">
                            後手（△）:{" "}
                            {roomInfoPlayers.w?.name ?? (
                                <span className="text-muted-foreground">待機中...</span>
                            )}
                        </span>
                        {roomInfoPlayers.w && (
                            <span className="text-xs text-muted-foreground">✓ 登録済み</span>
                        )}
                    </div>
                </div>
            </div>
            {snapshotPlayers && (
                <div className="rounded-lg border border-border bg-card p-4">
                    <div className="flex flex-col gap-2">
                        <div className="flex items-center justify-between">
                            <span className="text-sm font-medium text-wafuu-shu">
                                先手（▲）:{" "}
                                {snapshotPlayers.b?.name ?? (
                                    <span className="text-muted-foreground">待機中...</span>
                                )}
                            </span>
                            {snapshotPlayers.b?.online && (
                                <span className="text-xs text-status-online">● オンライン</span>
                            )}
                        </div>
                        <div className="flex items-center justify-between">
                            <span className="text-sm font-medium text-wafuu-ai">
                                後手（△）:{" "}
                                {snapshotPlayers.w?.name ?? (
                                    <span className="text-muted-foreground">待機中...</span>
                                )}
                            </span>
                            {snapshotPlayers.w?.online && (
                                <span className="text-xs text-status-online">● オンライン</span>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

function JoinFormSection({
    joinForm,
    isSeatTaken,
    onJoin,
    dispatchJoin,
}: {
    joinForm: JoinFormState;
    isSeatTaken: (seat: "b" | "w") => boolean;
    onJoin: (seat: "b" | "w" | "s") => void;
    dispatchJoin: React.Dispatch<JoinFormAction>;
}): ReactElement {
    return (
        <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
            <h2 className="text-sm font-semibold text-foreground">参加する</h2>
            <div className="flex flex-col gap-1">
                <label htmlFor="join-name" className="text-sm text-foreground">
                    名前 <span className="text-destructive">*</span>
                </label>
                <input
                    id="join-name"
                    type="text"
                    value={joinForm.name}
                    onChange={(e) => dispatchJoin({ type: "set_name", name: e.target.value })}
                    placeholder="プレイヤー名を入力してください"
                    maxLength={20}
                    disabled={joinForm.isJoining}
                    className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50"
                />
            </div>
            {joinForm.error && <p className="text-sm text-destructive">{joinForm.error}</p>}
            <div className="flex flex-col gap-2">
                <button
                    type="button"
                    onClick={() => onJoin("b")}
                    disabled={joinForm.isJoining || isSeatTaken("b")}
                    className="w-full rounded-lg bg-wafuu-shu py-2.5 text-sm font-semibold text-wafuu-shu-fg shadow hover:opacity-90 disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                    {joinForm.isJoining && joinForm.seat === "b"
                        ? "接続中..."
                        : isSeatTaken("b")
                          ? "先手（▲）は満席です"
                          : "先手として参加する"}
                </button>
                <button
                    type="button"
                    onClick={() => onJoin("w")}
                    disabled={joinForm.isJoining || isSeatTaken("w")}
                    className="w-full rounded-lg bg-wafuu-ai py-2.5 text-sm font-semibold text-wafuu-ai-fg shadow hover:opacity-90 disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                    {joinForm.isJoining && joinForm.seat === "w"
                        ? "接続中..."
                        : isSeatTaken("w")
                          ? "後手（△）は満席です"
                          : "後手として参加する"}
                </button>
                <button
                    type="button"
                    onClick={() => onJoin("s")}
                    disabled={joinForm.isJoining}
                    className="w-full rounded-lg bg-secondary py-2.5 text-sm font-semibold text-secondary-foreground shadow-sm hover:bg-secondary/80 disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                    {joinForm.isJoining && joinForm.seat === "s"
                        ? "接続中..."
                        : "観戦者として参加する"}
                </button>
            </div>
        </div>
    );
}

function GameSettingsSection({
    settings,
    timeControlLabel,
    startSfenLabel,
    joined,
    currentStatus,
    displayStartSfen,
    onUpdateStartSfen,
}: {
    settings: RoomInfo["settings"];
    timeControlLabel: string;
    startSfenLabel: string;
    joined: boolean;
    currentStatus: string;
    displayStartSfen: string;
    onUpdateStartSfen: (sfen: string) => void;
}): ReactElement {
    return (
        <>
            {joined && currentStatus === "waiting" && (
                <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
                    <span className="text-sm font-semibold text-foreground">開始局面を変更</span>
                    <PositionPresetSelector value={displayStartSfen} onChange={onUpdateStartSfen} />
                </div>
            )}
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
                    {settings.passRights && (
                        <div className="flex justify-between">
                            <span>パス権</span>
                            <span>各 {settings.passRights.initialCount} 回</span>
                        </div>
                    )}
                    {settings.aiSupport && (
                        <div className="flex justify-between">
                            <span>AI サポート</span>
                            <span>
                                ▲{" "}
                                {settings.aiSupport.b.mode === "unlimited"
                                    ? "無制限"
                                    : `${settings.aiSupport.b.limitCount ?? 0} 回`}
                                {" / "}△{" "}
                                {settings.aiSupport.w.mode === "unlimited"
                                    ? "無制限"
                                    : `${settings.aiSupport.w.limitCount ?? 0} 回`}
                            </span>
                        </div>
                    )}
                </div>
            </div>
        </>
    );
}

// ─── ページコンポーネント ──────────────────────────────────────────────────────

export default function RoomPage(): ReactElement {
    const { roomId } = useParams({ from: "/online/$roomId" });
    const roomInfo = routeApi.useLoaderData() as RoomInfo;

    // URLクエリパラメータ（ルーム作成者から渡される名前）
    const urlParams = new URLSearchParams(
        typeof window !== "undefined" ? window.location.search : "",
    );

    const navigate = useNavigate();

    const [joinForm, dispatchJoin] = useReducer(joinFormReducer, {
        name: urlParams.get("name") ?? "",
        seat: "w" as "b" | "w" | "s",
        isJoining: false,
        error: null,
    });
    const [roomState, dispatchRoom] = useReducer(roomReducer, INITIAL_ROOM_STATE);
    const { snapshot, joined, localStartSfen, gamePhase, reviewData, client } = roomState;

    const clientRef = useRef<RoomClient | null>(null);
    const [copied, setCopied] = useState(false);

    const aiSupport = roomInfo.settings.aiSupport;
    const analysis = useOnlineAnalysis(
        aiSupport?.searchDepth ?? null,
        aiSupport?.searchTimeMs ?? null,
    );
    const inviteUrl =
        typeof window !== "undefined" ? `${window.location.origin}/online/${roomId}` : "";

    // ─── WebSocket 接続 + join 送信 ────────────────────────────────────────────

    const handleJoin = (seatToJoin: "b" | "w" | "s") => {
        if (joinForm.isJoining) return;
        if (!joinForm.name.trim()) {
            dispatchJoin({ type: "error", message: "プレイヤー名を入力してください" });
            return;
        }
        dispatchJoin({ type: "start_join", seat: seatToJoin });

        const wsUrl = `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/api/rooms/${roomId}/ws`;

        const newClient = createRoomClient({
            wsUrl,
            autoReconnect: true,
            onReconnect: () => {
                // 再接続後は subscribe 内の resumed ハンドラが処理
            },
        });

        clientRef.current = newClient;
        dispatchRoom({ type: "client_set", client: newClient });

        const unsub = newClient.subscribe((msg: ServerMessage) => {
            switch (msg.t) {
                case "joined": {
                    storeSeat(roomId, seatToJoin);
                    dispatchRoom({ type: "joined" });
                    dispatchJoin({ type: "joined" });
                    break;
                }
                case "snapshot": {
                    dispatchRoom({ type: "snapshot_received", snapshot: msg.payload });
                    // resume 後に対局中のスナップショットが届いた場合は直接対局画面へ
                    if (msg.payload.status !== "waiting") {
                        unsub();
                        dispatchRoom({ type: "joined" });
                        dispatchJoin({ type: "joined" });
                        dispatchRoom({ type: "game_start" });
                    }
                    break;
                }
                case "event": {
                    if (msg.payload.kind === "settings_updated") {
                        dispatchRoom({
                            type: "settings_updated",
                            startSfen: msg.payload.settings.startSfen,
                        });
                    }
                    if (msg.payload.kind === "game_start") {
                        // game_start → 待機画面からインプレースで対局画面へ切り替え
                        // WebSocket 接続を維持したまま OnlineGameView を表示する
                        unsub();
                        dispatchRoom({ type: "game_start" });
                    }
                    break;
                }
                case "error": {
                    dispatchJoin({
                        type: "error",
                        message: msg.payload.message ?? "参加に失敗しました",
                    });
                    newClient.disconnect();
                    clientRef.current = null;
                    dispatchRoom({ type: "client_cleared" });
                    break;
                }
                default:
                    break;
            }
        });

        // join メッセージ送信（open 後に自動実行される）
        // createRoomClient は接続後に send できるよう subscribe + open を待つ
        // open イベント後 send するため、少し遅延させる
        let joinAttempts = 0;
        const sendJoin = (): void => {
            if (newClient.getStatus() === "connected") {
                // seatToJoin をクロージャで直接参照し、setState の非同期更新に依存しない
                newClient.join({ seat: seatToJoin, name: joinForm.name.trim() });
            } else if (joinAttempts < 50) {
                // 最大5秒（100ms × 50回）待機
                joinAttempts = joinAttempts + 1;
                setTimeout(sendJoin, 100);
            } else {
                dispatchJoin({ type: "error", message: "接続タイムアウト。再度お試しください。" });
                newClient.disconnect();
                clientRef.current = null;
                dispatchRoom({ type: "client_cleared" });
            }
        };
        setTimeout(sendJoin, 50);
    };

    // アンマウント時に WebSocket を閉じる
    useEffect(() => {
        return () => {
            clientRef.current?.disconnect();
        };
    }, []);

    // ページロード時に resumeToken + seat があれば自動的に再接続する
    useEffect(() => {
        const token = getStoredResumeToken(roomId);
        const seat = getStoredSeat(roomId);
        if (!token || !seat) return;

        dispatchJoin({ type: "start_join", seat });

        const wsUrl = `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/api/rooms/${roomId}/ws`;
        const newClient = createRoomClient({ wsUrl, autoReconnect: true, onReconnect: () => {} });

        clientRef.current = newClient;
        dispatchRoom({ type: "client_set", client: newClient });

        const unsub = newClient.subscribe((msg: ServerMessage) => {
            switch (msg.t) {
                case "joined": {
                    // resume 後にサーバーが joined を返した場合
                    storeSeat(roomId, seat);
                    dispatchRoom({ type: "joined" });
                    dispatchJoin({ type: "joined" });
                    break;
                }
                case "snapshot": {
                    dispatchRoom({ type: "snapshot_received", snapshot: msg.payload });
                    dispatchRoom({ type: "joined" });
                    dispatchJoin({ type: "joined" });
                    if (msg.payload.status !== "waiting") {
                        unsub();
                        dispatchRoom({ type: "game_start" });
                    }
                    break;
                }
                case "error": {
                    // resumeToken 失効等
                    dispatchJoin({
                        type: "error",
                        message: "セッションが切れました。再度参加してください。",
                    });
                    newClient.disconnect();
                    clientRef.current = null;
                    dispatchRoom({ type: "client_cleared" });
                    break;
                }
                default:
                    break;
            }
        });

        // resume メッセージ送信（open 後に接続確認してから送る）
        let resumeAttempts = 0;
        const sendResume = (): void => {
            if (newClient.getStatus() === "connected") {
                newClient.resume({ resumeToken: token, lastEventId: 0 });
            } else if (resumeAttempts < 50) {
                resumeAttempts = resumeAttempts + 1;
                setTimeout(sendResume, 100);
            } else {
                dispatchJoin({
                    type: "error",
                    message: "接続タイムアウト。再度参加してください。",
                });
                newClient.disconnect();
                clientRef.current = null;
                dispatchRoom({ type: "client_cleared" });
            }
        };
        setTimeout(sendResume, 50);

        return () => {
            unsub();
        };
    }, [roomId]);

    // ─── ヘルパー ──────────────────────────────────────────────────────────────

    function isSeatTaken(seat: "b" | "w"): boolean {
        return (snapshot?.players ?? roomInfo?.players)?.[seat] != null;
    }

    function handleUpdateStartSfen(startSfen: string): void {
        dispatchRoom({ type: "settings_updated", startSfen });
        clientRef.current?.updateSettings({ startSfen });
    }

    // ─── コピー処理 ────────────────────────────────────────────────────────────

    async function handleCopyLink(): Promise<void> {
        try {
            await navigator.clipboard.writeText(inviteUrl);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // フォールバック: 選択状態にする
        }
    }

    // ─── レンダリング ──────────────────────────────────────────────────────────

    // 検討フェーズ: ShogiMatch で棋譜検討
    const reviewEngineOptions: EngineOption[] = [
        {
            id: "wasm",
            label: "内蔵エンジン",
            createClient: () => createWasmEngineClient({ stopMode: "terminate" }),
            kind: "internal",
        },
    ];

    if (gamePhase === "reviewing" && reviewData) {
        return (
            <ShogiMatch
                engineOptions={reviewEngineOptions}
                defaultSides={{ sente: { role: "human" }, gote: { role: "human" } }}
                initialReview={{ sfen: reviewData.sfen, moves: reviewData.moves }}
                analysisMarkers={reviewData.analysisMarkers}
                manifestUrl={nnueManifestUrl}
            />
        );
    }

    // 対局フェーズ: OnlineGameView にインプレース切り替え（WebSocket 維持）
    if (gamePhase === "playing" && snapshot && client) {
        return (
            <OnlineGameView
                client={client}
                snapshot={snapshot}
                seat={joinForm.seat as Seat}
                roomId={roomId}
                analysis={aiSupport ? analysis : undefined}
                onStartReview={(data) => {
                    dispatchRoom({ type: "start_review", data });
                }}
                onExit={() => void navigate({ to: "/" })}
            />
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

    const displayStartSfen = localStartSfen ?? roomInfo.settings.startSfen;
    const startSfenLabel = (() => {
        const s = displayStartSfen;
        if (s === "startpos") return "平手";
        if (s === "handicap:bishop") return "角落ち";
        if (s === "handicap:rook") return "飛車落ち";
        if (s === "handicap:rook-bishop") return "飛車角落ち";
        return "カスタム局面";
    })();
    const currentStatus = snapshot?.status ?? roomInfo.status;

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
                        className="rounded-md bg-secondary px-3 py-2 text-sm font-medium text-secondary-foreground shadow-sm hover:bg-secondary/80 transition-colors"
                    >
                        {copied ? "コピーしました！" : "コピー"}
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
                            名前 <span className="text-destructive">*</span>
                        </label>
                        <input
                            id="join-name"
                            type="text"
                            value={joinForm.name}
                            onChange={(e) =>
                                dispatchJoin({ type: "set_name", name: e.target.value })
                            }
                            placeholder="プレイヤー名を入力してください"
                            maxLength={20}
                            disabled={joinForm.isJoining}
                            className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50"
                        />
                    </div>

                    {joinForm.error && <p className="text-sm text-destructive">{joinForm.error}</p>}

                    <div className="flex flex-col gap-2">
                        <button
                            type="button"
                            onClick={() => handleJoin("b")}
                            disabled={joinForm.isJoining || isSeatTaken("b")}
                            className="w-full rounded-lg bg-wafuu-shu py-2.5 text-sm font-semibold text-wafuu-shu-fg shadow hover:opacity-90 disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        >
                            {joinForm.isJoining && joinForm.seat === "b"
                                ? "接続中..."
                                : isSeatTaken("b")
                                  ? "先手（▲）は満席です"
                                  : "先手として参加する"}
                        </button>
                        <button
                            type="button"
                            onClick={() => handleJoin("w")}
                            disabled={joinForm.isJoining || isSeatTaken("w")}
                            className="w-full rounded-lg bg-wafuu-ai py-2.5 text-sm font-semibold text-wafuu-ai-fg shadow hover:opacity-90 disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        >
                            {joinForm.isJoining && joinForm.seat === "w"
                                ? "接続中..."
                                : isSeatTaken("w")
                                  ? "後手（△）は満席です"
                                  : "後手として参加する"}
                        </button>
                        <button
                            type="button"
                            onClick={() => handleJoin("s")}
                            disabled={joinForm.isJoining}
                            className="w-full rounded-lg bg-secondary py-2.5 text-sm font-semibold text-secondary-foreground shadow-sm hover:bg-secondary/80 disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        >
                            {joinForm.isJoining && joinForm.seat === "s"
                                ? "接続中..."
                                : "観戦者として参加する"}
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

            {/* 開始局面変更（待機中のみ） */}
            {joined && currentStatus === "waiting" && (
                <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
                    <span className="text-sm font-semibold text-foreground">開始局面を変更</span>
                    <PositionPresetSelector
                        value={displayStartSfen}
                        onChange={handleUpdateStartSfen}
                    />
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
