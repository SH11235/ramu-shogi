import type { ErrorCode, RoomClient, ServerMessage, SnapshotPayload } from "@shogi/match-client";
import {
    createRoomClient,
    getStoredResumeToken,
    getStoredSeat,
    storeSeat,
} from "@shogi/match-client";
import { useEffect, useEffectEvent, useReducer, useRef } from "react";
import { type GameStartSnapshot, snapshotAtGameStart } from "../components/online-game-state";

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
    | { type: "error"; message: string }
    | { type: "room_changed" };

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
        case "room_changed":
            return { ...state, isJoining: false, error: null };
    }
}

// ─── ルーム状態（内部専用） ───────────────────────────────────────────────────

interface RoomState {
    snapshot: SnapshotPayload | null;
    joined: boolean;
    connectionLost: boolean;
    localStartSfen: string | null;
    gamePhase: "waiting" | "playing";
    client: RoomClient | null;
}

type RoomAction =
    | { type: "joined" }
    | { type: "snapshot_received"; snapshot: SnapshotPayload }
    | { type: "settings_updated"; startSfen: string }
    | { type: "game_start"; snapshot: SnapshotPayload | GameStartSnapshot }
    | { type: "connection_failed"; canResume: boolean }
    | { type: "client_set"; client: RoomClient }
    | { type: "client_cleared" }
    | { type: "room_changed" };

const INITIAL_ROOM_STATE: RoomState = {
    snapshot: null,
    joined: false,
    connectionLost: false,
    localStartSfen: null,
    gamePhase: "waiting",
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
            // 待機中の snapshot から引き継ぐのは観戦者数だけ。局面・手番・時計・設定は、
            // 待機中に開始局面が変更されると食い違うので引き継がない
            return {
                ...state,
                gamePhase: "playing",
                snapshot: { spectators: state.snapshot?.spectators ?? 0, ...action.snapshot },
            };
        case "connection_failed":
            // 参加済みのままにすると、待機画面は接続の切れた後も対局開始を待つ表示を続ける。
            // 席を持ったまま切れた対局者は、参加し直すと自分の席が埋まっていて相手の席にしか
            // 入れないので、参加フォームへは戻さず、再読み込みで席へ戻る案内に切り替えさせる。
            // snapshot は切れた時点の在席状況なので、表示に使い続けない
            return {
                ...state,
                joined: false,
                snapshot: null,
                connectionLost: state.joined && action.canResume,
            };
        case "client_set":
            return { ...state, client: action.client };
        case "client_cleared":
            return { ...state, client: null };
        case "room_changed":
            return INITIAL_ROOM_STATE;
    }
}

// ─── 待機中の参加者が受け取るメッセージの処理 ─────────────────────────────────

/** 開始局面を解釈できない game_start を受けてから、サーバーの snapshot を待つ上限 */
const FULL_SNAPSHOT_TIMEOUT_MS = 15_000;

interface MessageContext {
    client: RoomClient;
    message: ServerMessage;
    stopListening: () => void;
    fail: (message: string) => void;
    /** 指定した時間のうちに stopListening まで進まなければ fail する */
    failAfter: (delayMs: number, message: string) => void;
}

interface ConnectionHandlers {
    /** 切断後に RoomClient が resume し直したとき */
    onReconnect: (client: RoomClient) => void;
    onMessage: (context: MessageContext) => void;
}

/**
 * 参加した直後と、待機中に再読み込みして復帰した後とで、対局開始までの処理を共通にする。
 * requestFullSnapshot は、サーバーが必ず snapshot を返す要求を送る。送る手段が無ければ false を返す。
 */
function createWaitingRoomHandlers({
    roomId,
    seat,
    dispatchRoom,
    dispatchJoin,
    requestFullSnapshot,
    errorMessage,
}: {
    roomId: string;
    seat: "b" | "w" | "s";
    dispatchRoom: (action: RoomAction) => void;
    dispatchJoin: (action: JoinFormAction) => void;
    requestFullSnapshot: (client: RoomClient) => boolean;
    errorMessage: (code: ErrorCode) => string;
}): ConnectionHandlers {
    // 開始局面を解釈できない game_start を受けてから、サーバーの snapshot で盤面を開くまで真
    let needsFullSnapshot = false;

    return {
        onReconnect: (client) => {
            // RoomClient は再接続すると、最後に受け取ったイベントより後の差分だけを求める。
            // サーバーは差分に snapshot を含めないので、待っている間に切れたら要求を送り直す
            if (needsFullSnapshot) {
                requestFullSnapshot(client);
            }
        },
        onMessage: ({ client, message, stopListening, fail, failAfter }) => {
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
                        needsFullSnapshot = false;
                        stopListening();
                        dispatchRoom({ type: "game_start", snapshot: message.payload });
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
                        const started = snapshotAtGameStart(message.payload);
                        if (started) {
                            stopListening();
                            dispatchRoom({ type: "game_start", snapshot: started });
                            break;
                        }
                        // 開始局面を組み立てられないまま盤面を開くと、サーバーと違う局面から
                        // 指せてしまう。サーバーの snapshot を待ち、届いたらそこから開く
                        needsFullSnapshot = true;
                        if (requestFullSnapshot(client)) {
                            failAfter(FULL_SNAPSHOT_TIMEOUT_MS, errorCodeToMessage("DESYNC"));
                        } else {
                            fail(errorCodeToMessage("DESYNC"));
                        }
                    }
                    break;
                }
                case "error": {
                    fail(errorMessage(message.payload.code));
                    break;
                }
                default:
                    break;
            }
        },
    };
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
    /** 席を持ったまま接続に失敗した。再読み込みすると保存済みのトークンで席へ戻れる */
    connectionLost: boolean;
    localStartSfen: string | null;
    gamePhase: "waiting" | "playing";
    client: RoomClient | null;

    // アクション
    handleJoin: (seatToJoin: "b" | "w" | "s") => void;
    handleUpdateStartSfen: (startSfen: string) => void;
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
    const disposeConnectionRef = useRef<(() => void) | null>(null);

    const connectClient = ({
        timeoutMessage,
        onOpen,
        onReconnect,
        onMessage,
    }: {
        timeoutMessage: string;
        onOpen: (client: RoomClient) => void;
    } & ConnectionHandlers): void => {
        disposeConnectionRef.current?.();

        let isDisposed = false;
        let timeoutId: ReturnType<typeof setTimeout> | null = null;
        let failAfterId: ReturnType<typeof setTimeout> | null = null;

        const newClient = createRoomClient({
            wsUrl: buildWsUrl(roomId),
            autoReconnect: true,
            onOpen: ({ reconnect }) => {
                if (isDisposed) {
                    return;
                }
                if (reconnect) {
                    onReconnect(newClient);
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

        const fail = (messageText: string): void => {
            if (isDisposed) {
                return;
            }
            dispatchJoin({ type: "error", message: messageText });
            const storedSeat = getStoredSeat(roomId);
            dispatchRoom({
                type: "connection_failed",
                canResume:
                    getStoredResumeToken(roomId) !== null &&
                    (storedSeat === "b" || storedSeat === "w"),
            });
            cleanup();
        };

        const unsubscribe = newClient.subscribe((message: ServerMessage) => {
            if (isDisposed) {
                return;
            }
            onMessage({
                client: newClient,
                message,
                stopListening: () => {
                    if (failAfterId !== null) {
                        clearTimeout(failAfterId);
                        failAfterId = null;
                    }
                    unsubscribe();
                },
                fail,
                failAfter: (delayMs, messageText) => {
                    // 切断して要求を送り直しても、待つ時間は最初の要求から数える
                    failAfterId ??= setTimeout(() => fail(messageText), delayMs);
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
            if (failAfterId !== null) {
                clearTimeout(failAfterId);
                failAfterId = null;
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

        disposeConnectionRef.current = cleanup;
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
            ...createWaitingRoomHandlers({
                roomId,
                seat: seatToJoin,
                dispatchRoom,
                dispatchJoin,
                // サーバーが必ず snapshot を返すのは、対局者なら lastEventId 0 の resume、
                // 観戦者なら参加し直し
                requestFullSnapshot: (client) => {
                    if (seatToJoin === "s") {
                        client.join({ seat: "s", name: trimmedName });
                        return true;
                    }
                    const resumeToken = getStoredResumeToken(roomId);
                    if (!resumeToken) return false;
                    client.resume({ resumeToken, lastEventId: 0 });
                    return true;
                },
                errorMessage: errorCodeToMessage,
            }),
        });
    };

    // ─── ページロード時 resume 自動接続・ルームを離れる時の cleanup ─────────

    const connectClientEvent = useEffectEvent(connectClient);

    useEffect(() => {
        // ルーターは roomId だけが変わる遷移でページを作り直さないので、
        // 前のルームの接続と状態が次のルームに残らないようにする
        const leaveRoom = (): void => {
            disposeConnectionRef.current?.();
            disposeConnectionRef.current = null;
            dispatchRoom({ type: "room_changed" });
            dispatchJoin({ type: "room_changed" });
        };

        const token = getStoredResumeToken(roomId);
        const seat = getStoredSeat(roomId);
        if (!token || !seat) return leaveRoom;

        dispatchJoin({ type: "start_join", seat });

        connectClientEvent({
            timeoutMessage: "接続タイムアウト。再度参加してください。",
            onOpen: (client) => {
                client.resume({ resumeToken: token, lastEventId: 0 });
            },
            ...createWaitingRoomHandlers({
                roomId,
                seat,
                dispatchRoom,
                dispatchJoin,
                requestFullSnapshot: (client) => {
                    client.resume({ resumeToken: token, lastEventId: 0 });
                    return true;
                },
                errorMessage: () => "セッションが切れました。再度参加してください。",
            }),
        });
        return leaveRoom;
    }, [roomId]);

    // ─── ヘルパー ─────────────────────────────────────────────────────────────

    const handleUpdateStartSfen = (startSfen: string): void => {
        dispatchRoom({ type: "settings_updated", startSfen });
        // 空は「SFEN 直接入力」へ切り替えただけで、まだ局面が入力されていない状態。
        // 空の開始局面をエラーで返すサーバーがあり、待機中の接続はエラーを受けると切れる
        if (startSfen !== "") {
            clientRef.current?.updateSettings({ startSfen });
        }
    };

    return {
        joinName: joinForm.name,
        setJoinName: (name) => dispatchJoin({ type: "set_name", name }),
        joinSeat: joinForm.seat,
        isJoining: joinForm.isJoining,
        joinError: joinForm.error,

        snapshot: roomState.snapshot,
        joined: roomState.joined,
        connectionLost: roomState.connectionLost,
        localStartSfen: roomState.localStartSfen,
        gamePhase: roomState.gamePhase,
        client: roomState.client,

        handleJoin,
        handleUpdateStartSfen,
    };
}
