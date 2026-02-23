// apps/web/worker/room-do.ts
// Durable Object: ルーム状態管理、WebSocket 接続管理

// ─── 型定義 ──────────────────────────────────────────────────────────────

type Seat = "b" | "w" | "s";
type RoomStatus = "waiting" | "playing" | "finished";
type GameEndReason =
    | "resign"
    | "checkmate"
    | "timeout"
    | "sennichite"
    | "illegal_move"
    | "disconnect";

interface PlayerInfo {
    seat: "b" | "w";
    name: string;
    resumeTokenHash: string; // SHA-256(resumeToken) のみ保存（平文禁止）
    joinedAt: number;
    lastSeenTs: number;
    offlineSince: number | null; // null = オンライン, timestamp = オフライン開始時刻
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
    running: "b" | "w" | null; // 現在時計が動いている側
    lastTickTs: number; // 最後に時計を更新したサーバ時刻（ms）
}

interface PassRightsState {
    b: number;
    w: number;
}

interface GameResult {
    winner: "b" | "w" | null;
    reason: GameEndReason;
}

interface GameState {
    sfen: string; // 現在の局面（SFEN）
    moves: string[]; // USI 形式の指し手履歴
    turn: "b" | "w";
    ply: number;
    clock: ClockState;
    passRights: PassRightsState | null;
    analysisUsed: { b: number; w: number };
    status: "playing" | "finished";
    result: GameResult | null;
    sfenCounts: Record<string, number>; // 千日手検知用: 正規化SFEN → 出現回数
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

/** 千日手判定用: SFEN から手数部分を除いた正規化文字列を返す */
function normalizeSfen(sfen: string): string {
    // SFEN format: "<board> <turn> <hands> <movenum>"
    // 手数部分（第4フィールド）を除いて比較
    const parts = sfen.split(" ");
    return parts.slice(0, 3).join(" ");
}

/** 簡易 KIF テキストを生成する */
function buildKifu(room: RoomStorageState): string {
    const lines: string[] = [
        "# KIF形式",
        `先手：${room.players.b?.name ?? "不明"}`,
        `後手：${room.players.w?.name ?? "不明"}`,
    ];
    if (room.game?.moves) {
        room.game.moves.forEach((move, i) => {
            lines.push(`${i + 1} ${move}`);
        });
    }
    if (room.game?.result) {
        const { winner, reason } = room.game.result;
        if (winner) {
            lines.push(`${winner === "b" ? "先手" : "後手"}の勝ち（${reason}）`);
        } else {
            lines.push(`引き分け（${reason}）`);
        }
    }
    return lines.join("\n");
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

/**
 * 全 WebSocket から接続メタデータを取得する（hibernation 対応）
 * attachment に座席情報を保持しているため、メモリ上の Map 不要
 */
function getConnectedMetas(doState: DurableObjectState): Map<WebSocket, WsConnectionMeta> {
    const result = new Map<WebSocket, WsConnectionMeta>();
    for (const ws of doState.getWebSockets()) {
        const meta = ws.deserializeAttachment() as WsConnectionMeta | null;
        if (meta) {
            result.set(ws, meta);
        }
    }
    return result;
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
            case "resume":
                await this.handleResume(
                    ws,
                    msg.clientMsgId,
                    msg.payload as { resumeToken: string; lastEventId: number },
                );
                break;
            case "move":
                await this.handleMove(
                    ws,
                    msg.clientMsgId,
                    msg.payload as { eventId: number; usi: string; sfen: string },
                );
                break;
            case "resign":
                await this.handleResign(ws, msg.clientMsgId, msg.payload as { eventId: number });
                break;
            case "chat":
                await this.handleChat(ws, msg.clientMsgId, msg.payload as { text: string });
                break;
            case "sync":
                await this.handleSync(ws, msg.payload as { sinceEventId: number });
                break;
            case "ping":
                await this.handlePing(ws, msg.payload as { ts: number });
                break;
            default:
                // 未知のメッセージは無視（前方互換）
                break;
        }
    }

    async webSocketClose(ws: WebSocket): Promise<void> {
        ws.close();
    }

    async webSocketError(_ws: WebSocket, _error: unknown): Promise<void> {
        // hibernatable WS API では自動的に処理される
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

        const connectedMetas = getConnectedMetas(this.doState);
        const onlineSeats = new Set(Array.from(connectedMetas.values()).map((m) => m.seat));
        const spectatorCount = Array.from(connectedMetas.values()).filter(
            (m) => m.seat === "s",
        ).length;

        return jsonResponse({
            roomId: room.roomId,
            status: room.status,
            players: {
                b: room.players.b
                    ? { name: room.players.b.name, online: onlineSeats.has("b") }
                    : null,
                w: room.players.w
                    ? { name: room.players.w.name, online: onlineSeats.has("w") }
                    : null,
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
        // attachment は join/resume 後に設定する
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
                offlineSince: null,
            };

            await this.doState.storage.put("room", room);
        }

        // WS attachment にメタデータを設定（hibernation 対応）
        ws.serializeAttachment({ seat, name: trimmedName });

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

    /** T-105: resume メッセージ処理 */
    private async handleResume(
        ws: WebSocket,
        clientMsgId: number,
        payload: { resumeToken: string; lastEventId: number },
    ): Promise<void> {
        const room = await this.doState.storage.get<RoomStorageState>("room");
        if (!room) {
            sendWsError(ws, "ROOM_NOT_FOUND", "Room not found", clientMsgId);
            return;
        }

        const { resumeToken, lastEventId } = payload;

        // SHA-256(token) でトークン照合
        const tokenHash = await hashToken(resumeToken);
        let matchedSeat: "b" | "w" | null = null;
        for (const seat of ["b", "w"] as const) {
            if (room.players[seat]?.resumeTokenHash === tokenHash) {
                matchedSeat = seat;
                break;
            }
        }

        if (matchedSeat === null) {
            sendWsError(ws, "INVALID_TOKEN", "Invalid resume token", clientMsgId);
            return;
        }

        const player = room.players[matchedSeat];
        if (!player) return; // 照合済みなので実際には到達しない
        const now = Date.now();

        // WS attachment にメタデータを設定
        ws.serializeAttachment({ seat: matchedSeat, name: player.name });

        // lastSeenTs を更新、オフライン状態をリセット
        const wasOffline = player.offlineSince !== null;
        player.lastSeenTs = now;
        player.offlineSince = null;
        await this.doState.storage.put("room", room);

        // 差分イベントを送信（件数が多い場合は snapshot）
        const eventsToSend = room.events.filter((e) => e.eventId > lastEventId);
        if (eventsToSend.length === 0 || eventsToSend.length > 20) {
            await this.sendSnapshot(ws, room);
        } else {
            for (const event of eventsToSend) {
                sendWsMessage(ws, { v: 1, t: "event", payload: event });
            }
        }

        // オフラインだった場合は player_online をブロードキャスト
        if (wasOffline && room.status === "playing") {
            const eventId = ++room.latestEventId;
            const onlineEvent: RoomEvent = {
                eventId,
                kind: "player_online",
                seat: matchedSeat,
                serverTs: now,
            };
            room.events.push(onlineEvent);
            await this.doState.storage.put("room", room);
            this.broadcastToAll({ v: 1, t: "event", payload: onlineEvent });
        }

        // アラームを再設定
        await this.setNextAlarm(room);
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

        // lastSeenTs を更新（T-105 切断検知に使用）
        const meta = ws.deserializeAttachment() as WsConnectionMeta | null;
        if (meta && (meta.seat === "b" || meta.seat === "w")) {
            const room = await this.doState.storage.get<RoomStorageState>("room");
            const playerInfo = room?.players[meta.seat];
            if (room && playerInfo) {
                playerInfo.lastSeenTs = Date.now();
                playerInfo.offlineSince = null;
                await this.doState.storage.put("room", room);
            }
        }
    }

    /** T-103: move メッセージ処理（T-104 時計管理・T-106 千日手を含む） */
    private async handleMove(
        ws: WebSocket,
        clientMsgId: number,
        payload: { eventId: number; usi: string; sfen: string },
    ): Promise<void> {
        const room = await this.doState.storage.get<RoomStorageState>("room");
        if (!room) {
            sendWsError(ws, "ROOM_NOT_FOUND", "Room not found", clientMsgId);
            return;
        }

        const meta = ws.deserializeAttachment() as WsConnectionMeta | null;
        if (!meta || meta.seat === "s") {
            sendWsError(ws, "SPECTATOR_FORBIDDEN", "Spectators cannot move", clientMsgId);
            return;
        }

        const { seat } = meta;
        const game = room.game;

        if (!game || game.status !== "playing") {
            sendWsError(ws, "ROOM_FINISHED", "Game is not playing", clientMsgId);
            return;
        }

        // 手番チェック
        if (game.turn !== seat) {
            sendWsError(ws, "NOT_YOUR_TURN", "Not your turn", clientMsgId);
            return;
        }

        // eventId 一致チェック（DESYNC 検知）
        if (payload.eventId !== room.latestEventId) {
            sendWsError(
                ws,
                "DESYNC",
                `Expected eventId ${room.latestEventId}, got ${payload.eventId}`,
                clientMsgId,
            );
            return;
        }

        const now = Date.now();
        const { clock } = game;
        const nextTurn: "b" | "w" = seat === "b" ? "w" : "b";

        // T-104: 経過時間を計算して現在のプレイヤーの残り時間を更新
        if (clock.running !== null) {
            const elapsed = now - clock.lastTickTs;
            clock[clock.running].remainMs -= elapsed;
        }

        // T-104: Fischer 加算（指した後に加算）
        if (room.settings.timeControl.type === "fischer") {
            const increment = room.settings.timeControl.fischerIncrementMs ?? 0;
            clock[seat].remainMs += increment;
        }

        // 時計を次のプレイヤーに切り替え
        clock.lastTickTs = now;
        clock.running = nextTurn;

        // ゲーム状態更新
        game.moves.push(payload.usi);
        game.sfen = payload.sfen;
        game.turn = nextTurn;
        game.ply++;

        // lastSeenTs を更新
        const movingPlayer = room.players[seat];
        if (movingPlayer) {
            movingPlayer.lastSeenTs = now;
        }

        // T-106: 千日手チェック（SFEN のカウントを更新）
        const sfenKey = normalizeSfen(payload.sfen);
        game.sfenCounts[sfenKey] = (game.sfenCounts[sfenKey] ?? 0) + 1;

        // move イベントを作成
        const moveEventId = ++room.latestEventId;
        const moveEvent: RoomEvent = {
            eventId: moveEventId,
            kind: "move",
            usi: payload.usi,
            turn: nextTurn,
            clock: {
                b: { remainMs: clock.b.remainMs },
                w: { remainMs: clock.w.remainMs },
                running: clock.running,
                lastTickTs: clock.lastTickTs,
            },
            passRights: game.passRights,
            serverTs: now,
        };
        room.events.push(moveEvent);

        // T-106: 同一局面 4 回出現で千日手
        if (game.sfenCounts[sfenKey] >= 4) {
            const result: GameResult = { winner: null, reason: "sennichite" };

            const sennichiteEventId = ++room.latestEventId;
            const sennichiteEvent: RoomEvent = {
                eventId: sennichiteEventId,
                kind: "sennichite",
                result,
                serverTs: now,
            };

            const gameEndEventId = ++room.latestEventId;
            const gameEndEvent: RoomEvent = {
                eventId: gameEndEventId,
                kind: "game_end",
                result,
                kifu: buildKifu(room),
                serverTs: now,
            };

            game.status = "finished";
            game.result = result;
            game.clock.running = null;
            room.status = "finished";
            room.events.push(sennichiteEvent, gameEndEvent);

            await this.doState.storage.put("room", room);
            this.broadcastToAll({ v: 1, t: "event", payload: moveEvent });
            this.broadcastToAll({ v: 1, t: "event", payload: sennichiteEvent });
            this.broadcastToAll({ v: 1, t: "event", payload: gameEndEvent });

            // 24時間後にルームを削除
            await this.doState.storage.setAlarm(now + 24 * 60 * 60 * 1000);
            return;
        }

        await this.doState.storage.put("room", room);
        this.broadcastToAll({ v: 1, t: "event", payload: moveEvent });

        // T-104: 次のタイムアウトアラームを設定
        await this.setNextAlarm(room);
    }

    /** T-103: resign メッセージ処理 */
    private async handleResign(
        ws: WebSocket,
        clientMsgId: number,
        _payload: { eventId: number },
    ): Promise<void> {
        const room = await this.doState.storage.get<RoomStorageState>("room");
        if (!room) {
            sendWsError(ws, "ROOM_NOT_FOUND", "Room not found", clientMsgId);
            return;
        }

        const meta = ws.deserializeAttachment() as WsConnectionMeta | null;
        if (!meta || meta.seat === "s") {
            sendWsError(ws, "SPECTATOR_FORBIDDEN", "Spectators cannot resign", clientMsgId);
            return;
        }

        const game = room.game;
        if (!game || game.status !== "playing") {
            sendWsError(ws, "ROOM_FINISHED", "Game is not playing", clientMsgId);
            return;
        }

        const { seat } = meta;
        const winner: "b" | "w" = seat === "b" ? "w" : "b";
        const now = Date.now();
        const result: GameResult = { winner, reason: "resign" };

        const resignEventId = ++room.latestEventId;
        const resignEvent: RoomEvent = {
            eventId: resignEventId,
            kind: "resign",
            seat,
            result,
            serverTs: now,
        };

        const gameEndEventId = ++room.latestEventId;
        const gameEndEvent: RoomEvent = {
            eventId: gameEndEventId,
            kind: "game_end",
            result,
            kifu: buildKifu(room),
            serverTs: now,
        };

        game.status = "finished";
        game.result = result;
        game.clock.running = null;
        room.status = "finished";
        room.events.push(resignEvent, gameEndEvent);

        await this.doState.storage.put("room", room);
        this.broadcastToAll({ v: 1, t: "event", payload: resignEvent });
        this.broadcastToAll({ v: 1, t: "event", payload: gameEndEvent });

        // 24時間後にルームを削除
        await this.doState.storage.setAlarm(now + 24 * 60 * 60 * 1000);
    }

    /** chat メッセージ処理（基本実装） */
    private async handleChat(
        ws: WebSocket,
        clientMsgId: number,
        payload: { text: string },
    ): Promise<void> {
        const room = await this.doState.storage.get<RoomStorageState>("room");
        if (!room) return;

        const meta = ws.deserializeAttachment() as WsConnectionMeta | null;
        if (!meta) return;

        const text = typeof payload.text === "string" ? payload.text.trim() : "";
        if (!text || text.length > 200) {
            sendWsError(ws, "UNKNOWN", "Invalid chat text: must be 1-200 characters", clientMsgId);
            return;
        }

        const now = Date.now();
        const eventId = ++room.latestEventId;
        const chatEvent: RoomEvent = {
            eventId,
            kind: "chat",
            seat: meta.seat,
            text,
            serverTs: now,
        };

        room.events.push(chatEvent);
        await this.doState.storage.put("room", room);
        this.broadcastToAll({ v: 1, t: "event", payload: chatEvent });
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

        // 初期局面を千日手カウントに記録（初期局面の出現 = 1 回）
        const initialSfenKey = normalizeSfen(sfen);
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
            sfenCounts: { [initialSfenKey]: 1 },
        };

        room.game = game;
        room.status = "playing";

        const eventId = ++room.latestEventId;
        const gameStartEvent: RoomEvent = {
            eventId,
            kind: "game_start",
            settings: room.settings,
            players: {
                b: { name: room.players.b?.name ?? "", online: true },
                w: { name: room.players.w?.name ?? "", online: true },
            },
            serverTs: now,
        };

        room.events.push(gameStartEvent);
        await this.doState.storage.put("room", room);

        // 全クライアントにブロードキャスト
        this.broadcastToAll({ v: 1, t: "event", payload: gameStartEvent });

        // T-104: タイムアウトアラームを設定
        await this.setNextAlarm(room);
    }

    // ─── ユーティリティ ──────────────────────────────────────────────────

    private async sendSnapshot(ws: WebSocket, room: RoomStorageState): Promise<void> {
        const connectedMetas = getConnectedMetas(this.doState);
        const onlineSeats = new Set(Array.from(connectedMetas.values()).map((m) => m.seat));
        const spectatorCount = Array.from(connectedMetas.values()).filter(
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

    // ─── T-104: アラーム設定 ─────────────────────────────────────────────

    /**
     * 次に発火すべきアラーム時刻を計算して設定する。
     * ゲームクロックのタイムアウトとオフライン検知を一つのアラームで多重化する。
     * setInterval は使用せず、DO Alarm のみを使用する。
     */
    private async setNextAlarm(room: RoomStorageState): Promise<void> {
        const now = Date.now();
        let nextAlarmTs = Infinity;

        // ゲームクロックのタイムアウトアラーム
        if (room.game?.status === "playing" && room.game.clock.running !== null) {
            const { running, lastTickTs } = room.game.clock;
            const remainMs = room.game.clock[running].remainMs;

            if (room.settings.timeControl.type === "byoyomi") {
                const byoyomiMs = room.settings.timeControl.byoyomiMs ?? 0;
                // タイムアウト = lastTickTs + max(remainMs, 0) + byoyomiMs
                const timeoutTs = lastTickTs + Math.max(remainMs, 0) + byoyomiMs;
                nextAlarmTs = Math.min(nextAlarmTs, timeoutTs);
            } else if (room.settings.timeControl.type === "fischer") {
                if (remainMs > 0) {
                    const timeoutTs = lastTickTs + remainMs;
                    nextAlarmTs = Math.min(nextAlarmTs, timeoutTs);
                }
            }
        }

        // T-105: オフライン検知アラーム（対局中のプレイヤーのみ）
        if (room.status === "playing") {
            for (const seat of ["b", "w"] as const) {
                const player = room.players[seat];
                if (!player) continue;

                if (player.offlineSince === null) {
                    // 60秒無応答でオフライン検知
                    const offlineCheckTs = player.lastSeenTs + 60_000;
                    nextAlarmTs = Math.min(nextAlarmTs, offlineCheckTs);
                } else {
                    // 3分でdisconnect_loss
                    const disconnectTs = player.offlineSince + 3 * 60_000;
                    nextAlarmTs = Math.min(nextAlarmTs, disconnectTs);
                }
            }
        }

        if (nextAlarmTs !== Infinity) {
            // 最低 1 秒後に設定（過去の時刻は即時発火になる）
            const alarmTs = Math.max(nextAlarmTs, now + 1000);
            await this.doState.storage.setAlarm(alarmTs);
        }
    }

    // ─── T-104/T-105: Alarm ─────────────────────────────────────────────

    async alarm(): Promise<void> {
        const room = await this.doState.storage.get<RoomStorageState>("room");
        if (!room) return;

        const now = Date.now();

        // 対局終了済み: DO Storage を削除（24時間後の自動クリーンアップ）
        if (room.status === "finished") {
            await this.doState.storage.deleteAll();
            return;
        }

        if (!room.game || room.game.status !== "playing") return;

        const game = room.game;
        let modified = false;

        // T-105: オフライン検知・切断不戦敗
        for (const seat of ["b", "w"] as const) {
            const player = room.players[seat];
            if (!player) continue;

            if (player.offlineSince === null) {
                // lastSeenTs が 60 秒以上古い → オフライン判定
                if (now - player.lastSeenTs >= 60_000) {
                    player.offlineSince = now;
                    modified = true;

                    const eventId = ++room.latestEventId;
                    const offlineEvent: RoomEvent = {
                        eventId,
                        kind: "player_offline",
                        seat,
                        serverTs: now,
                    };
                    room.events.push(offlineEvent);
                    this.broadcastToAll({ v: 1, t: "event", payload: offlineEvent });
                }
            } else if (now - player.offlineSince >= 3 * 60_000 && game.status === "playing") {
                // 3分以上オフライン → 切断不戦敗
                const winner: "b" | "w" = seat === "b" ? "w" : "b";
                const result: GameResult = { winner, reason: "disconnect" };

                const disconnectEventId = ++room.latestEventId;
                const disconnectEvent: RoomEvent = {
                    eventId: disconnectEventId,
                    kind: "disconnect_loss",
                    seat,
                    result,
                    serverTs: now,
                };

                const gameEndEventId = ++room.latestEventId;
                const gameEndEvent: RoomEvent = {
                    eventId: gameEndEventId,
                    kind: "game_end",
                    result,
                    kifu: buildKifu(room),
                    serverTs: now,
                };

                game.status = "finished";
                game.result = result;
                game.clock.running = null;
                room.status = "finished";
                room.events.push(disconnectEvent, gameEndEvent);

                await this.doState.storage.put("room", room);
                this.broadcastToAll({ v: 1, t: "event", payload: disconnectEvent });
                this.broadcastToAll({ v: 1, t: "event", payload: gameEndEvent });

                // 24時間後に削除
                await this.doState.storage.setAlarm(now + 24 * 60 * 60 * 1000);
                return;
            }
        }

        // T-104: タイムアウトチェック
        if (game.status === "playing" && game.clock.running !== null) {
            const { running, lastTickTs } = game.clock;
            const elapsed = now - lastTickTs;
            const effectiveRemainMs = game.clock[running].remainMs - elapsed;

            let isTimeout = false;
            if (room.settings.timeControl.type === "byoyomi") {
                const byoyomiMs = room.settings.timeControl.byoyomiMs ?? 0;
                // byoyomi: 持ち時間 + 秒読みを合算してタイムアウト判定
                isTimeout = effectiveRemainMs + byoyomiMs <= 0;
            } else if (room.settings.timeControl.type === "fischer") {
                isTimeout = effectiveRemainMs <= 0;
            }

            if (isTimeout) {
                const winner: "b" | "w" = running === "b" ? "w" : "b";
                const result: GameResult = { winner, reason: "timeout" };

                const timeoutEventId = ++room.latestEventId;
                const timeoutEvent: RoomEvent = {
                    eventId: timeoutEventId,
                    kind: "timeout",
                    seat: running,
                    result,
                    serverTs: now,
                };

                const gameEndEventId = ++room.latestEventId;
                const gameEndEvent: RoomEvent = {
                    eventId: gameEndEventId,
                    kind: "game_end",
                    result,
                    kifu: buildKifu(room),
                    serverTs: now,
                };

                game.status = "finished";
                game.result = result;
                game.clock.running = null;
                room.status = "finished";
                room.events.push(timeoutEvent, gameEndEvent);

                await this.doState.storage.put("room", room);
                this.broadcastToAll({ v: 1, t: "event", payload: timeoutEvent });
                this.broadcastToAll({ v: 1, t: "event", payload: gameEndEvent });

                // 24時間後に削除
                await this.doState.storage.setAlarm(now + 24 * 60 * 60 * 1000);
                return;
            }
        }

        if (modified) {
            await this.doState.storage.put("room", room);
        }

        // 次のアラームを再設定
        await this.setNextAlarm(room);
    }
}
