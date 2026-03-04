import type { RoomClient, ServerMessage, SnapshotPayload } from "@shogi/match-client";
import {
    createRoomClient,
    getStoredResumeToken,
    getStoredSeat,
    storeSeat,
} from "@shogi/match-client";
import { useEffect, useReducer, useRef } from "react";

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
    | { type: "game_start"; eventId: number }
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
                    ? { ...state.snapshot, eventId: action.eventId }
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

    // ─── WebSocket 接続 + join 送信 ──────────────────────────────────────────

    const handleJoin = (seatToJoin: "b" | "w" | "s"): void => {
        if (joinForm.isJoining) return;
        if (!joinForm.name.trim()) {
            dispatchJoin({ type: "error", message: "プレイヤー名を入力してください" });
            return;
        }
        dispatchJoin({ type: "start_join", seat: seatToJoin });

        const wsUrl = buildWsUrl(roomId);

        const newClient = createRoomClient({
            wsUrl,
            autoReconnect: true,
            onReconnect: () => {},
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
                    if (msg.payload.status !== "waiting") {
                        unsub();
                        dispatchRoom({ type: "joined" });
                        dispatchJoin({ type: "joined" });
                        dispatchRoom({ type: "game_start", eventId: msg.payload.eventId });
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
                        unsub();
                        dispatchRoom({ type: "game_start", eventId: msg.payload.eventId });
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

        let joinAttempts = 0;
        const sendJoin = (): void => {
            if (newClient.getStatus() === "connected") {
                newClient.join({ seat: seatToJoin, name: joinForm.name.trim() });
            } else if (joinAttempts < 50) {
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

        const newClient = createRoomClient({
            wsUrl: buildWsUrl(roomId),
            autoReconnect: true,
            onReconnect: () => {},
        });

        clientRef.current = newClient;
        dispatchRoom({ type: "client_set", client: newClient });

        const unsub = newClient.subscribe((msg: ServerMessage) => {
            switch (msg.t) {
                case "joined": {
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
                        dispatchRoom({ type: "game_start", eventId: msg.payload.eventId });
                    }
                    break;
                }
                case "error": {
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

        let cancelled = false;
        let timerId: ReturnType<typeof setTimeout>;
        let resumeAttempts = 0;
        const sendResume = (): void => {
            if (cancelled) return;
            if (newClient.getStatus() === "connected") {
                newClient.resume({ resumeToken: token, lastEventId: 0 });
            } else if (resumeAttempts < 50) {
                resumeAttempts = resumeAttempts + 1;
                timerId = setTimeout(sendResume, 100);
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
        timerId = setTimeout(sendResume, 50);

        return () => {
            cancelled = true;
            clearTimeout(timerId);
            unsub();
            newClient.disconnect();
        };
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
