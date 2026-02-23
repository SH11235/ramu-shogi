// apps/web/worker/room-do.ts
// Durable Object: ルーム状態管理、WebSocket 接続管理

// ─── 型定義 ──────────────────────────────────────────────────────────────

type Seat = "b" | "w" | "s";
type RoomStatus = "waiting" | "playing" | "finished";

interface PlayerInfo {
    seat: "b" | "w";
    name: string;
    resumeTokenHash: string; // SHA-256(resumeToken) のみ保存（平文禁止）
    joinedAt: number;
    lastSeenTs: number;
}

interface TimeControlSettings {
    type: "byoyomi" | "fischer";
    initialMs: number;
    byoyomiMs?: number;
    fischerIncrementMs?: number;
}

interface PassRightsConfig {
    initialCount: number;
}

interface AiSupportPlayerSettings {
    mode: "unlimited" | "limited";
    limitCount: number | null;
}

interface AiSupportSettings {
    b: AiSupportPlayerSettings;
    w: AiSupportPlayerSettings;
    searchDepth: number | null;
    searchTimeMs: number | null;
}

interface RoomSettings {
    startSfen: string;
    timeControl: TimeControlSettings;
    passRights: PassRightsConfig | null;
    aiSupport: AiSupportSettings | null;
}

interface ClockState {
    b: { remainMs: number };
    w: { remainMs: number };
    running: "b" | "w" | null;
    lastTickTs: number;
}

interface PassRightsState {
    b: number;
    w: number;
}

interface GameResult {
    winner: "b" | "w" | null;
    reason: string;
}

interface GameState {
    sfen: string;
    moves: string[];
    turn: "b" | "w";
    ply: number;
    clock: ClockState;
    passRights: PassRightsState | null;
    analysisUsed: { b: number; w: number };
    status: "playing" | "finished";
    result: GameResult | null;
}

interface RoomEvent {
    eventId: number;
    kind: string;
    serverTs: number;
    [key: string]: unknown;
}

interface RoomStorageState {
    roomId: string;
    createdAt: number;
    status: RoomStatus;
    settings: RoomSettings;
    players: {
        b: PlayerInfo | null;
        w: PlayerInfo | null;
    };
    game: GameState | null;
    events: RoomEvent[];
    latestEventId: number;
}

interface WsConnectionMeta {
    seat: Seat;
    name: string;
}

// ─── ヘルパー ──────────────────────────────────────────────────────────────

const INITIAL_SFEN = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1";

const HANDICAP_SFENS: Record<string, string> = {
    "handicap:bishop": "lnsgkgsnl/1r7/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1",
    "handicap:rook": "lnsgkgsnl/7b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1",
    "handicap:rook-bishop": "lnsgkgsnl/9/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1",
};

function resolveSfen(startSfen: string): string {
    if (startSfen === "startpos") return INITIAL_SFEN;
    return HANDICAP_SFENS[startSfen] ?? startSfen;
}

function determineFirstTurn(sfen: string): "b" | "w" {
    const parts = sfen.split(" ");
    return parts[1] === "w" ? "w" : "b";
}

async function generateResumeToken(): Promise<string> {
    const buffer = new Uint8Array(16);
    crypto.getRandomValues(buffer);
    return btoa(String.fromCharCode(...buffer))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=/g, "");
}

async function hashToken(token: string): Promise<string> {
    const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
    return Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}

function sendWsMessage(ws: WebSocket, msg: unknown): void {
    try {
        ws.send(JSON.stringify(msg));
    } catch {
        // WebSocket が閉じている場合は無視
    }
}

function errorResponse(status: number, code: string, message: string): Response {
    return new Response(JSON.stringify({ error: code, message }), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

function jsonResponse(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

function sendWsError(ws: WebSocket, code: string, message: string, clientMsgId?: number): void {
    sendWsMessage(ws, {
        v: 1,
        t: "error",
        payload: { code, message, ...(clientMsgId !== undefined ? { clientMsgId } : {}) },
    });
}

// ─── RoomDO ──────────────────────────────────────────────────────────────

/**
 * RoomDO: 1 部屋 = 1 Durable Object インスタンス
 *
 * DurableObject はクラス必須のため class を使用（CLAUDE.md の例外）。
 * 内部ロジックは関数型で実装する。
 */
export class RoomDO implements DurableObject {
    private readonly doState: DurableObjectState;

    // メモリ内 WS メタデータ（hibernation で消える - T-105 で改善予定）
    private readonly connMeta = new Map<WebSocket, WsConnectionMeta>();

    constructor(state: DurableObjectState, _env: unknown) {
        this.doState = state;
    }

    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);

        // 内部初期化エンドポイント（REST API から呼ばれる）
        if (url.pathname === "/init" && request.method === "POST") {
            return this.handleInit(request);
        }

        // WebSocket アップグレード
        if (request.headers.get("Upgrade") === "websocket") {
            return this.handleWebSocketUpgrade();
        }

        // GET: ルーム情報（REST API から転送される）
        if (request.method === "GET") {
            return this.handleInfo();
        }

        return errorResponse(404, "NOT_FOUND", "Not found");
    }

    // ─── WebSocket イベントハンドラ ──────────────────────────────────────

    async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
        const text = typeof message === "string" ? message : new TextDecoder().decode(message);
        let parsed: unknown;
        try {
            parsed = JSON.parse(text);
        } catch {
            return;
        }

        if (typeof parsed !== "object" || parsed === null || !("t" in parsed)) return;
        const msg = parsed as { v: number; t: string; clientMsgId: number; payload: unknown };

        switch (msg.t) {
            case "join":
                await this.handleJoin(
                    ws,
                    msg.clientMsgId,
                    msg.payload as { seat: Seat; name: string },
                );
                break;
            case "sync":
                await this.handleSync(ws, msg.payload as { sinceEventId: number });
                break;
            case "ping":
                await this.handlePing(ws, msg.payload as { ts: number });
                break;
            // T-103: move, resign
            // T-105: resume
            default:
                // 未知のメッセージは無視（前方互換）
                break;
        }
    }

    async webSocketClose(ws: WebSocket): Promise<void> {
        this.connMeta.delete(ws);
        ws.close();
    }

    async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
        this.connMeta.delete(ws);
    }

    // ─── DO 内部ハンドラ ─────────────────────────────────────────────────

    private async handleInit(request: Request): Promise<Response> {
        const body = (await request.json()) as { roomId: string; settings: RoomSettings };
        const { roomId, settings } = body;

        const initialState: RoomStorageState = {
            roomId,
            createdAt: Date.now(),
            status: "waiting",
            settings,
            players: { b: null, w: null },
            game: null,
            events: [],
            latestEventId: 0,
        };

        await this.doState.storage.put("room", initialState);
        return jsonResponse({ ok: true });
    }

    private async handleInfo(): Promise<Response> {
        const room = await this.doState.storage.get<RoomStorageState>("room");
        if (!room) {
            return errorResponse(404, "ROOM_NOT_FOUND", "Room not found");
        }

        const spectatorCount = Array.from(this.connMeta.values()).filter(
            (m) => m.seat === "s",
        ).length;

        return jsonResponse({
            roomId: room.roomId,
            status: room.status,
            players: {
                b: room.players.b ? { name: room.players.b.name } : null,
                w: room.players.w ? { name: room.players.w.name } : null,
            },
            spectators: spectatorCount,
            settings: {
                startSfen: room.settings.startSfen,
                timeControl: room.settings.timeControl,
                passRights: room.settings.passRights,
            },
        });
    }

    private handleWebSocketUpgrade(): Response {
        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);
        this.doState.acceptWebSocket(server);
        return new Response(null, {
            status: 101,
            webSocket: client,
        });
    }

    // ─── WebSocket メッセージハンドラ ────────────────────────────────────

    private async handleJoin(
        ws: WebSocket,
        clientMsgId: number,
        payload: { seat: Seat; name: string },
    ): Promise<void> {
        const room = await this.doState.storage.get<RoomStorageState>("room");
        if (!room) {
            sendWsError(ws, "ROOM_NOT_FOUND", "Room not found", clientMsgId);
            return;
        }

        const { seat, name } = payload;

        // 名前バリデーション（空白のみ・20文字超を拒否）
        const trimmedName = typeof name === "string" ? name.trim() : "";
        if (!trimmedName || trimmedName.length > 20) {
            sendWsError(ws, "UNKNOWN", "Invalid name: must be 1-20 characters", clientMsgId);
            return;
        }

        // 対局終了済みチェック
        if (room.status === "finished") {
            sendWsError(ws, "ROOM_FINISHED", "Room is already finished", clientMsgId);
            return;
        }

        // プレイヤー席の空きチェック
        if ((seat === "b" || seat === "w") && room.players[seat] !== null) {
            sendWsError(ws, "ROOM_FULL", `Seat ${seat} is already taken`, clientMsgId);
            return;
        }

        const now = Date.now();
        let resumeToken: string | undefined;

        // プレイヤーの場合は PlayerInfo を登録し resumeToken を発行
        if (seat === "b" || seat === "w") {
            resumeToken = await generateResumeToken();
            const tokenHash = await hashToken(resumeToken);

            room.players[seat] = {
                seat,
                name: trimmedName,
                resumeTokenHash: tokenHash,
                joinedAt: now,
                lastSeenTs: now,
            };

            await this.doState.storage.put("room", room);
        }

        // WS メタデータを記録
        this.connMeta.set(ws, { seat, name: trimmedName });

        // joined メッセージを送信
        sendWsMessage(ws, {
            v: 1,
            t: "joined",
            payload: {
                roomId: room.roomId,
                seat,
                ...(resumeToken ? { resumeToken } : {}),
                youAre: seat === "s" ? "spectator" : "player",
            },
        });

        // snapshot を送信（現在の状態）
        const updatedRoom = await this.doState.storage.get<RoomStorageState>("room");
        await this.sendSnapshot(ws, updatedRoom ?? room);

        // 先手・後手が揃った場合は対局開始
        const latestRoom = updatedRoom ?? room;
        if (
            latestRoom.players.b !== null &&
            latestRoom.players.w !== null &&
            latestRoom.status === "waiting"
        ) {
            await this.startGame(latestRoom);
        }
    }

    private async handleSync(ws: WebSocket, payload: { sinceEventId: number }): Promise<void> {
        const room = await this.doState.storage.get<RoomStorageState>("room");
        if (!room) return;

        const sinceId = payload.sinceEventId;
        const eventsToSend = room.events.filter((e) => e.eventId > sinceId);

        // 差分が多い場合は snapshot を送信
        if (eventsToSend.length > 20) {
            await this.sendSnapshot(ws, room);
        } else {
            for (const event of eventsToSend) {
                sendWsMessage(ws, { v: 1, t: "event", payload: event });
            }
        }
    }

    private async handlePing(ws: WebSocket, payload: { ts: number }): Promise<void> {
        sendWsMessage(ws, {
            v: 1,
            t: "pong",
            payload: {
                ts: payload.ts,
                serverTs: Date.now(),
            },
        });

        // lastSeenTs を更新（T-105 で切断検知に使用）
        const meta = this.connMeta.get(ws);
        if (meta && (meta.seat === "b" || meta.seat === "w")) {
            const room = await this.doState.storage.get<RoomStorageState>("room");
            if (room?.players[meta.seat]) {
                room.players[meta.seat]!.lastSeenTs = Date.now();
                await this.doState.storage.put("room", room);
            }
        }
    }

    // ─── ゲーム開始 ──────────────────────────────────────────────────────

    private async startGame(room: RoomStorageState): Promise<void> {
        const sfen = resolveSfen(room.settings.startSfen);
        const firstTurn = determineFirstTurn(sfen);
        const now = Date.now();

        const isUnlimited =
            room.settings.timeControl.initialMs === 0 &&
            (room.settings.timeControl.type !== "byoyomi" ||
                !room.settings.timeControl.byoyomiMs ||
                room.settings.timeControl.byoyomiMs === 0);

        const clock: ClockState = {
            b: { remainMs: room.settings.timeControl.initialMs },
            w: { remainMs: room.settings.timeControl.initialMs },
            running: isUnlimited ? null : firstTurn,
            lastTickTs: now,
        };

        const passRights: PassRightsState | null = room.settings.passRights
            ? {
                  b: room.settings.passRights.initialCount,
                  w: room.settings.passRights.initialCount,
              }
            : null;

        const game: GameState = {
            sfen,
            moves: [],
            turn: firstTurn,
            ply: 1,
            clock,
            passRights,
            analysisUsed: { b: 0, w: 0 },
            status: "playing",
            result: null,
        };

        room.game = game;
        room.status = "playing";

        const eventId = ++room.latestEventId;
        const gameStartEvent: RoomEvent = {
            eventId,
            kind: "game_start",
            settings: room.settings,
            players: {
                b: { name: room.players.b!.name, online: true },
                w: { name: room.players.w!.name, online: true },
            },
            serverTs: now,
        };

        room.events.push(gameStartEvent);
        await this.doState.storage.put("room", room);

        // 全クライアントにブロードキャスト
        this.broadcastToAll({ v: 1, t: "event", payload: gameStartEvent });

        // タイムアウトアラームの設定（T-104 で詳細実装）
        if (!isUnlimited) {
            const alarmMs =
                now +
                room.settings.timeControl.initialMs +
                (room.settings.timeControl.byoyomiMs ?? 0);
            await this.doState.storage.setAlarm(alarmMs);
        }
    }

    // ─── ユーティリティ ──────────────────────────────────────────────────

    private async sendSnapshot(ws: WebSocket, room: RoomStorageState): Promise<void> {
        const onlineSeats = new Set(Array.from(this.connMeta.values()).map((m) => m.seat));

        const spectatorCount = Array.from(this.connMeta.values()).filter(
            (m) => m.seat === "s",
        ).length;

        const chatEvents = room.events.filter((e) => e.kind === "chat").slice(-50);

        const snapshot = {
            eventId: room.latestEventId,
            status: room.status,
            sfen: room.game?.sfen ?? resolveSfen(room.settings.startSfen),
            moves: room.game?.moves ?? [],
            turn: room.game?.turn ?? determineFirstTurn(resolveSfen(room.settings.startSfen)),
            clock: room.game?.clock ?? {
                b: { remainMs: room.settings.timeControl.initialMs },
                w: { remainMs: room.settings.timeControl.initialMs },
                running: null,
                lastTickTs: Date.now(),
            },
            passRights: room.game?.passRights ?? null,
            players: {
                b: room.players.b
                    ? { name: room.players.b.name, online: onlineSeats.has("b") }
                    : null,
                w: room.players.w
                    ? { name: room.players.w.name, online: onlineSeats.has("w") }
                    : null,
            },
            spectators: spectatorCount,
            settings: room.settings,
            recentChat: chatEvents,
        };

        sendWsMessage(ws, { v: 1, t: "snapshot", payload: snapshot });
    }

    private broadcastToAll(msg: unknown): void {
        for (const ws of this.doState.getWebSockets()) {
            sendWsMessage(ws, msg);
        }
    }

    // ─── Alarm（T-104 で本実装予定）────────────────────────────────────────

    async alarm(): Promise<void> {
        // T-104: タイムアウト処理を実装予定
    }
}
