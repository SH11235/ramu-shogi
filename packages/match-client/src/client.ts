import { createReconnectManager, getStoredResumeToken, storeResumeToken } from "./reconnect";
import type { ClientMessageType, RoomClient, RoomClientOptions, ServerMessage } from "./types";

type ConnectionStatus = "connecting" | "connected" | "reconnecting" | "disconnected";

// WebSocket コンストラクタの型（テスト時のインジェクション対応）
type WebSocketFactory = (url: string) => WebSocket;

/**
 * RoomClient を生成するファクトリ関数。
 * クラスでなく関数クロージャとして実装する（CLAUDE.md: 関数型スタイル優先）。
 *
 * @param options - 接続設定
 * @param _wsFactory - テスト用 WebSocket コンストラクタ（省略時は globalThis.WebSocket を使用）
 */
export function createRoomClient(
    options: RoomClientOptions,
    _wsFactory?: WebSocketFactory,
): RoomClient {
    const wsFactory: WebSocketFactory =
        _wsFactory ?? ((url: string) => new (globalThis.WebSocket as typeof WebSocket)(url));

    let status: ConnectionStatus = "connecting";
    let ws: WebSocket | null = null;
    let msgId = 0;
    let lastKnownEventId = 0;
    const handlers = new Set<(msg: ServerMessage) => void>();

    // wsUrl から roomId を抽出（sessionStorage のキー生成に使用）
    // 例: /api/rooms/abc123/ws → "abc123"
    const roomIdMatch = options.wsUrl.match(/\/rooms\/([^/]+)\/ws/);
    const roomId = roomIdMatch?.[1] ?? null;

    const reconnectManager = createReconnectManager({
        maxRetries: 5,
        onAttempt: (_attempt, _delayMs) => {
            status = "reconnecting";
        },
        onMaxRetriesReached: () => {
            status = "disconnected";
            options.onReconnect?.();
        },
    });

    function send<T>(t: ClientMessageType, payload: T): void {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            console.warn(
                `[RoomClient] Cannot send "${t}": WebSocket not open (state=${ws?.readyState})`,
            );
            return;
        }
        const currentMsgId = ++msgId;
        try {
            ws.send(JSON.stringify({ v: 1, t, clientMsgId: currentMsgId, payload }));
        } catch (err) {
            console.error(`[RoomClient] Failed to send "${t}":`, err);
        }
    }

    function notifyHandlers(msg: ServerMessage): void {
        // 最新 eventId を追跡（再接続時の差分送信に使用）
        if (msg.t === "event") {
            lastKnownEventId = msg.payload.eventId;
        } else if (msg.t === "snapshot") {
            lastKnownEventId = msg.payload.eventId;
        }

        // joined メッセージの resumeToken を sessionStorage に保存
        if (msg.t === "joined" && msg.payload.resumeToken && roomId) {
            storeResumeToken(roomId, msg.payload.resumeToken);
        }

        for (const handler of handlers) {
            handler(msg);
        }
    }

    function connect(): void {
        ws = wsFactory(options.wsUrl);

        ws.addEventListener("open", () => {
            // 再接続の場合は resume を試みる
            if (status === "reconnecting" && roomId) {
                const token = getStoredResumeToken(roomId);
                if (token) {
                    status = "connected";
                    reconnectManager.reset();
                    send("resume", { resumeToken: token, lastEventId: lastKnownEventId });
                    options.onReconnect?.();
                    return;
                }
            }
            status = "connected";
            reconnectManager.reset();
        });

        ws.addEventListener("message", (event: MessageEvent) => {
            let parsed: unknown;
            try {
                parsed = JSON.parse(event.data as string);
            } catch {
                return;
            }
            notifyHandlers(parsed as ServerMessage);
        });

        ws.addEventListener("close", () => {
            ws = null;
            if (status !== "disconnected" && options.autoReconnect !== false) {
                reconnectManager.schedule(connect);
            } else {
                status = "disconnected";
            }
        });

        ws.addEventListener("error", () => {
            // エラーは必ず close イベントが続くため、ここでは何もしない
        });
    }

    // 接続を開始
    connect();

    return {
        join(params) {
            send("join", params);
        },

        resume(params) {
            send("resume", params);
        },

        move(params) {
            send("move", params);
        },

        resign(params) {
            send("resign", params);
        },

        useAnalysis(params) {
            send("use_analysis", params);
        },

        updateSettings(params) {
            send("update_settings", params);
        },

        ack(params) {
            send("ack", params);
        },

        sync(params) {
            send("sync", params);
        },

        ping() {
            send("ping", { ts: Date.now() });
        },

        subscribe(handler) {
            handlers.add(handler);
            return () => handlers.delete(handler);
        },

        disconnect() {
            reconnectManager.cancel();
            status = "disconnected";
            ws?.close();
            ws = null;
            handlers.clear();
        },

        getStatus() {
            return status;
        },
    };
}
