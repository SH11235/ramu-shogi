import { createReconnectManager, getStoredResumeToken, storeResumeToken } from "./reconnect";
import type {
    ClientMessage,
    ClientMessageType,
    RoomClient,
    RoomClientOptions,
    RoomClientStatus,
    ServerMessage,
} from "./types";

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

    let status: RoomClientStatus = "connecting";
    let ws: WebSocket | null = null;
    let msgId = 0;
    let pingIntervalId: ReturnType<typeof setInterval> | null = null;
    const handlers = new Set<(msg: ServerMessage) => void>();
    const statusHandlers = new Set<(status: RoomClientStatus) => void>();
    // 購読者がいない間に届いた event / snapshot。待機画面から対局画面へ購読者が
    // 入れ替わる間にも対局は進むので、捨てずに次の購読者へ届いた順に渡す。
    // 件数に上限は設けない: 捨てた分を取り直す手段がサーバーに無い（sync は差分が少ないと
    // snapshot を返さず、終局後は直近のイベントしか残らない）ので、捨てると盤面を復元できない。
    // 溜まるのは購読者が入れ替わる間に届いた分だけで、切断すれば空になる
    let undelivered: ServerMessage[] = [];

    // wsUrl から roomId を抽出（sessionStorage のキー生成に使用）
    // 例: /api/rooms/abc123/ws → "abc123"
    const roomIdMatch = options.wsUrl.match(/\/rooms\/([^/]+)\/ws/);
    const roomId = roomIdMatch?.[1] ?? null;

    function setStatus(next: RoomClientStatus): void {
        if (status === next) return;
        status = next;
        for (const handler of statusHandlers) {
            handler(next);
        }
    }

    const reconnectManager = createReconnectManager({
        maxRetries: 5,
        onAttempt: (_attempt, _delayMs) => {
            setStatus("reconnecting");
        },
        onMaxRetriesReached: () => {
            setStatus("disconnected");
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
            const message: ClientMessage<T> = { v: 1, t, clientMsgId: currentMsgId, payload };
            ws.send(JSON.stringify(message));
        } catch (err) {
            console.error(`[RoomClient] Failed to send "${t}":`, err);
        }
    }

    function notifyHandlers(msg: ServerMessage): void {
        // joined メッセージの resumeToken を sessionStorage に保存
        if (msg.t === "joined" && msg.payload.resumeToken && roomId) {
            storeResumeToken(roomId, msg.payload.resumeToken);
        }

        if (handlers.size === 0) {
            if (msg.t === "event" || msg.t === "snapshot") {
                undelivered.push(msg);
            }
            return;
        }

        for (const handler of handlers) {
            handler(msg);
        }
    }

    function connect(): void {
        ws = wsFactory(options.wsUrl);

        ws.addEventListener("open", () => {
            const isReconnect = status === "reconnecting";
            // 再接続の場合は resume を試みる
            let didResume = false;
            if (isReconnect && roomId) {
                const token = getStoredResumeToken(roomId);
                if (token) {
                    reconnectManager.reset();
                    // 差分だけの応答は、どこまでで終わりかを購読者が判別できない。購読者が snapshot を
                    // 求め直すと resume が 2 通になり、切断中の終局イベントが 2 回届くので、ここで
                    // 必ず snapshot が返る 0 を送る
                    send("resume", { resumeToken: token, lastEventId: 0 });
                    // 購読者が送るものは、席へ戻る resume より後にサーバーへ届ける
                    setStatus("connected");
                    options.onReconnect?.();
                    didResume = true;
                } else {
                    setStatus("connected");
                    reconnectManager.reset();
                }
            } else {
                setStatus("connected");
                reconnectManager.reset();
            }
            // resumeToken がない再接続は新規接続として扱う（reconnect: false）
            options.onOpen?.({ reconnect: didResume });
            // 接続確立後、30秒ごとにpingを送ってサーバーのオフライン判定を防ぐ
            // サーバーは lastSeenTs が 60秒以上更新されないとオフライン判定するため
            if (pingIntervalId === null) {
                pingIntervalId = setInterval(() => {
                    if (status === "connected") {
                        send("ping", { ts: Date.now() });
                    }
                }, 30_000);
            }
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
            if (pingIntervalId !== null) {
                clearInterval(pingIntervalId);
                pingIntervalId = null;
            }
            if (status !== "disconnected" && options.autoReconnect !== false) {
                reconnectManager.schedule(connect);
            } else {
                setStatus("disconnected");
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

        checkmate(params) {
            send("checkmate", params);
        },

        consumeAnalysis(params) {
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

        takebackRequest(params) {
            send("takeback_request", params);
        },

        takebackResponse(params) {
            send("takeback_response", params);
        },

        takebackCancel(params) {
            send("takeback_cancel", params);
        },

        subscribe(handler) {
            handlers.add(handler);
            const missed = undelivered;
            undelivered = [];
            for (const msg of missed) {
                handler(msg);
            }
            return () => handlers.delete(handler);
        },

        subscribeStatus(handler) {
            statusHandlers.add(handler);
            return () => statusHandlers.delete(handler);
        },

        disconnect() {
            reconnectManager.cancel();
            statusHandlers.clear();
            setStatus("disconnected");
            if (pingIntervalId !== null) {
                clearInterval(pingIntervalId);
                pingIntervalId = null;
            }
            ws?.close();
            ws = null;
            handlers.clear();
            undelivered = [];
        },

        getStatus() {
            return status;
        },
    };
}
