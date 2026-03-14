import type {
    ErrorCode,
    PassRightsState,
    PlayerPublicInfo,
    RoomClient,
    ServerMessage,
    SnapshotPayload,
} from "@shogi/match-client";
import {
    createRoomClient,
    getStoredResumeToken,
    getStoredSeat,
    storeSeat,
} from "@shogi/match-client";
import { useEffect, useReducer, useRef } from "react";

function errorCodeToMessage(code: ErrorCode): string {
    switch (code) {
        case "ROOM_FULL":
            return "この席はすでに埋まっています";
        case "ROOM_NOT_FOUND":
            return "ルームが見つかりません";
        case "ROOM_FINISHED":
            return "この対局はすでに終了しています";
        case "ROOM_EXPIRED":
            return "ルームの有効期限が切れました";
        case "INVALID_TOKEN":
            return "セッションが切れました。再度参加してください";
        case "DESYNC":
            return "同期エラーが発生しました。ページを再読み込みしてください";
        case "ILLEGAL_MOVE":
            return "不正な指し手です";
        case "NOT_YOUR_TURN":
            return "あなたの手番ではありません";
        case "RATE_LIMITED":
            return "操作が多すぎます。しばらく待ってからお試しください";
        case "SPECTATOR_FORBIDDEN":
            return "観戦者はこの操作を行えません";
        case "ANALYSIS_LIMIT_EXCEEDED":
            return "AI解析の使用回数が上限に達しました";
        case "AI_SUPPORT_DISABLED":
            return "このルームではAIサポートが無効です";
        default:
            return "エラーが発生しました";
    }
}

// ─── 参加フォーム状態（内部専用） ────────────────────────────────────────────

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

// ─── ルーム状態（内部専用） ───────────────────────────────────────────────────

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
    | {
          type: "game_start";
          eventId: number;
          players?: { b: PlayerPublicInfo; w: PlayerPublicInfo };
          passRights?: PassRightsState | null;
      }
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
            return {
                ...state,
                gamePhase: "playing",
                snapshot: state.snapshot
                    ? {
                          ...state.snapshot,
                          eventId: action.eventId,
                          ...(action.players ? { players: action.players } : {}),
                          ...("passRights" in action ? { passRights: action.passRights } : {}),
                      }
                    : state.snapshot,
            };
        case "client_set":
            return { ...state, client: action.client };
        case "client_cleared":
            return { ...state, client: null };
        case "start_review":
            return { ...state, reviewData: action.data, gamePhase: "reviewing" };
    }
}

// ─── デフォルト WebSocket URL ファクトリ ─────────────────────────────────────

const defaultBuildWsUrl = (roomId: string): string =>
    `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/api/rooms/${roomId}/ws`;

// ─── フック公開型 ─────────────────────────────────────────────────────────────

export interface UseRoomConnectionOptions {
    roomId: string;
    initialName?: string;
    /** WebSocket URL ファクトリ（デフォルト: window.location を使用） */
    buildWsUrl?: (roomId: string) => string;
}

export interface UseRoomConnectionReturn {
    // 参加フォーム
    joinName: string;
    setJoinName: (name: string) => void;
    joinSeat: "b" | "w" | "s";
    isJoining: boolean;
    joinError: string | null;

    // ルーム状態
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

    // アクション
    handleJoin: (seatToJoin: "b" | "w" | "s") => void;
    handleUpdateStartSfen: (startSfen: string) => void;
    startReview: (data: UseRoomConnectionReturn["reviewData"]) => void;
}

// ─── フック本体 ───────────────────────────────────────────────────────────────

export function useRoomConnection({
    roomId,
    initialName = "",
    buildWsUrl = defaultBuildWsUrl,
}: UseRoomConnectionOptions): UseRoomConnectionReturn {
    const [joinForm, dispatchJoin] = useReducer(joinFormReducer, {
        name: initialName,
        seat: "w" as "b" | "w" | "s",
        isJoining: false,
        error: null,
    });
    const [roomState, dispatchRoom] = useReducer(roomReducer, INITIAL_ROOM_STATE);

    const clientRef = useRef<RoomClient | null>(null);

    const connectClient = ({
        timeoutMessage,
        onOpen,
        onMessage,
    }: {
        timeoutMessage: string;
        onOpen: (client: RoomClient) => void;
        onMessage: (context: {
            client: RoomClient;
            message: ServerMessage;
            stopListening: () => void;
            fail: (message: string) => void;
        }) => void;
    }): (() => void) => {
        clientRef.current?.disconnect();

        let isDisposed = false;
        let timeoutId: ReturnType<typeof setTimeout> | null = null;

        const newClient = createRoomClient({
            wsUrl: buildWsUrl(roomId),
            autoReconnect: true,
            onOpen: ({ reconnect }) => {
                if (reconnect || isDisposed) {
                    return;
                }
                if (timeoutId !== null) {
                    clearTimeout(timeoutId);
                    timeoutId = null;
                }
                onOpen(newClient);
            },
        });

        clientRef.current = newClient;
        dispatchRoom({ type: "client_set", client: newClient });

        const unsubscribe = newClient.subscribe((message: ServerMessage) => {
            if (isDisposed) {
                return;
            }
            onMessage({
                client: newClient,
                message,
                stopListening: unsubscribe,
                fail: (messageText: string) => {
                    if (isDisposed) {
                        return;
                    }
                    dispatchJoin({ type: "error", message: messageText });
                    cleanup();
                },
            });
        });

        const cleanup = (): void => {
            if (isDisposed) {
                return;
            }
            isDisposed = true;
            if (timeoutId !== null) {
                clearTimeout(timeoutId);
                timeoutId = null;
            }
            unsubscribe();
            newClient.disconnect();
            if (clientRef.current === newClient) {
                clientRef.current = null;
                dispatchRoom({ type: "client_cleared" });
            }
        };

        timeoutId = setTimeout(() => {
            dispatchJoin({ type: "error", message: timeoutMessage });
            cleanup();
        }, 5_000);

        return cleanup;
    };

    // ─── WebSocket 接続 + join 送信 ──────────────────────────────────────────

    const handleJoin = (seatToJoin: "b" | "w" | "s"): void => {
        if (joinForm.isJoining) return;
        if (!joinForm.name.trim()) {
            dispatchJoin({ type: "error", message: "プレイヤー名を入力してください" });
            return;
        }
        dispatchJoin({ type: "start_join", seat: seatToJoin });

        const trimmedName = joinForm.name.trim();

        connectClient({
            timeoutMessage: "接続タイムアウト。再度お試しください。",
            onOpen: (client) => {
                client.join({ seat: seatToJoin, name: trimmedName });
            },
            onMessage: ({ message, stopListening, fail }) => {
                switch (message.t) {
                    case "joined": {
                        storeSeat(roomId, seatToJoin);
                        dispatchRoom({ type: "joined" });
                        dispatchJoin({ type: "joined" });
                        break;
                    }
                    case "snapshot": {
                        dispatchRoom({ type: "snapshot_received", snapshot: message.payload });
                        if (message.payload.status !== "waiting") {
                            stopListening();
                            dispatchRoom({ type: "joined" });
                            dispatchJoin({ type: "joined" });
                            dispatchRoom({ type: "game_start", eventId: message.payload.eventId });
                        }
                        break;
                    }
                    case "event": {
                        if (message.payload.kind === "settings_updated") {
                            dispatchRoom({
                                type: "settings_updated",
                                startSfen: message.payload.settings.startSfen,
                            });
                        }
                        if (message.payload.kind === "game_start") {
                            stopListening();
                            const pr = message.payload.settings.passRights;
                            dispatchRoom({
                                type: "game_start",
                                eventId: message.payload.eventId,
                                players: message.payload.players,
                                passRights: pr ? { b: pr.initialCount, w: pr.initialCount } : null,
                            });
                        }
                        break;
                    }
                    case "error": {
                        fail(errorCodeToMessage(message.payload.code));
                        break;
                    }
                    default:
                        break;
                }
            },
        });
    };

    // ─── アンマウント時 cleanup ───────────────────────────────────────────────

    useEffect(() => {
        return () => {
            clientRef.current?.disconnect();
        };
    }, []);

    // ─── ページロード時 resume 自動接続 ─────────────────────────────────────

    useEffect(() => {
        const token = getStoredResumeToken(roomId);
        const seat = getStoredSeat(roomId);
        if (!token || !seat) return;

        dispatchJoin({ type: "start_join", seat });

        return connectClient({
            timeoutMessage: "接続タイムアウト。再度参加してください。",
            onOpen: (client) => {
                client.resume({ resumeToken: token, lastEventId: 0 });
            },
            onMessage: ({ message, stopListening, fail }) => {
                switch (message.t) {
                    case "joined": {
                        storeSeat(roomId, seat);
                        dispatchRoom({ type: "joined" });
                        dispatchJoin({ type: "joined" });
                        break;
                    }
                    case "snapshot": {
                        dispatchRoom({ type: "snapshot_received", snapshot: message.payload });
                        dispatchRoom({ type: "joined" });
                        dispatchJoin({ type: "joined" });
                        if (message.payload.status !== "waiting") {
                            stopListening();
                            dispatchRoom({ type: "game_start", eventId: message.payload.eventId });
                        }
                        break;
                    }
                    case "error": {
                        fail("セッションが切れました。再度参加してください。");
                        break;
                    }
                    default:
                        break;
                }
            },
        });
    }, [roomId, buildWsUrl]);

    // ─── ヘルパー ─────────────────────────────────────────────────────────────

    const handleUpdateStartSfen = (startSfen: string): void => {
        dispatchRoom({ type: "settings_updated", startSfen });
        clientRef.current?.updateSettings({ startSfen });
    };

    const startReview = (data: UseRoomConnectionReturn["reviewData"]): void => {
        dispatchRoom({ type: "start_review", data });
    };

    return {
        joinName: joinForm.name,
        setJoinName: (name) => dispatchJoin({ type: "set_name", name }),
        joinSeat: joinForm.seat,
        isJoining: joinForm.isJoining,
        joinError: joinForm.error,

        snapshot: roomState.snapshot,
        joined: roomState.joined,
        localStartSfen: roomState.localStartSfen,
        gamePhase: roomState.gamePhase,
        reviewData: roomState.reviewData,
        client: roomState.client,

        handleJoin,
        handleUpdateStartSfen,
        startReview,
    };
}
