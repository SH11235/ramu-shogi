// ─── 基本型 ──────────────────────────────────────────────────────────────
export type Seat = "b" | "w" | "s";
export type RoomStatus = "waiting" | "playing" | "finished";
export type GameEndReason =
    | "resign"
    | "checkmate"
    | "timeout"
    | "sennichite"
    | "illegal_move"
    | "disconnect";

// ─── ルーム設定 ──────────────────────────────────────────────────────────
export interface TimeControlSettings {
    type: "byoyomi" | "fischer";
    initialMs: number;
    byoyomiMs?: number;
    fischerIncrementMs?: number;
}

export interface PassRightsConfig {
    initialCount: number;
}

export interface AiSupportPlayerSettings {
    mode: "unlimited" | "limited";
    limitCount: number | null;
}

export interface AiSupportSettings {
    b: AiSupportPlayerSettings;
    w: AiSupportPlayerSettings;
    searchDepth: number | null;
    searchTimeMs: number | null;
}

export interface RoomSettings {
    startSfen: string;
    timeControl: TimeControlSettings;
    passRights: PassRightsConfig | null;
    aiSupport: AiSupportSettings | null;
    takeback: boolean;
}

// ─── 時計 ─────────────────────────────────────────────────────────────────
export interface ClockState {
    b: { remainMs: number };
    w: { remainMs: number };
    running: "b" | "w" | null;
    lastTickTs: number;
}

// ─── パス権 ───────────────────────────────────────────────────────────────
export interface PassRightsState {
    b: number;
    w: number;
}

// ─── ゲーム結果 ──────────────────────────────────────────────────────────
export interface GameResult {
    winner: "b" | "w" | null;
    reason: GameEndReason;
}

// ─── プレイヤー情報 ──────────────────────────────────────────────────────
export interface PlayerPublicInfo {
    name: string;
    online: boolean;
}

// ─── RoomEvent（サーバ → クライアント差分イベント） ────────────────────────
interface RoomEventBase {
    eventId: number;
    serverTs: number;
}

export interface GameStartEvent extends RoomEventBase {
    kind: "game_start";
    settings: RoomSettings;
    players: {
        b: PlayerPublicInfo;
        w: PlayerPublicInfo;
    };
}

export interface MoveEvent extends RoomEventBase {
    kind: "move";
    usi: string;
    turn: "b" | "w";
    clock: ClockState;
    passRights: PassRightsState | null;
}

export interface ResignEvent extends RoomEventBase {
    kind: "resign";
    seat: Seat;
    result: GameResult;
}

export interface TimeoutEvent extends RoomEventBase {
    kind: "timeout";
    seat: Seat;
    result: GameResult;
}

export interface CheckmateEvent extends RoomEventBase {
    kind: "checkmate";
    result: GameResult;
}

export interface SennichiteEvent extends RoomEventBase {
    kind: "sennichite";
    result: GameResult;
}

export interface IllegalMoveEvent extends RoomEventBase {
    kind: "illegal_move";
    seat: Seat;
    usi: string;
    result: GameResult;
}

export interface DisconnectLossEvent extends RoomEventBase {
    kind: "disconnect_loss";
    seat: Seat;
    result: GameResult;
}

export interface GameEndEvent extends RoomEventBase {
    kind: "game_end";
    result: GameResult;
    kifu: string;
}

export interface PlayerOnlineEvent extends RoomEventBase {
    kind: "player_online";
    seat: Seat;
}

export interface PlayerOfflineEvent extends RoomEventBase {
    kind: "player_offline";
    seat: Seat;
}

export interface AnalysisUsedEvent extends RoomEventBase {
    kind: "analysis_used";
    seat: Seat;
    analysisRemaining: number | null;
}

export interface SettingsUpdatedEvent extends RoomEventBase {
    kind: "settings_updated";
    settings: Pick<RoomSettings, "startSfen">;
}

// ─── 待った イベント ───────────────────────────────────────────────────────
export interface TakebackRequestedEvent extends RoomEventBase {
    kind: "takeback_requested";
    seat: Seat;
    ply: number;
}

export interface TakebackAcceptedEvent extends RoomEventBase {
    kind: "takeback_accepted";
    sfen: string;
    turn: "b" | "w";
    clock: ClockState;
    passRights: PassRightsState | null;
}

export interface TakebackRejectedEvent extends RoomEventBase {
    kind: "takeback_rejected";
}

export interface TakebackCancelledEvent extends RoomEventBase {
    kind: "takeback_cancelled";
}

export type RoomEvent =
    | GameStartEvent
    | MoveEvent
    | ResignEvent
    | TimeoutEvent
    | CheckmateEvent
    | SennichiteEvent
    | IllegalMoveEvent
    | DisconnectLossEvent
    | GameEndEvent
    | PlayerOnlineEvent
    | PlayerOfflineEvent
    | AnalysisUsedEvent
    | SettingsUpdatedEvent
    | TakebackRequestedEvent
    | TakebackAcceptedEvent
    | TakebackRejectedEvent
    | TakebackCancelledEvent;

// ─── SnapshotPayload ──────────────────────────────────────────────────────
export interface SnapshotPayload {
    eventId: number;
    status: RoomStatus;
    sfen: string;
    moves: string[];
    turn: "b" | "w";
    clock: ClockState;
    passRights: PassRightsState | null;
    players: {
        b: PlayerPublicInfo | null;
        w: PlayerPublicInfo | null;
    };
    spectators: number;
    settings: RoomSettings;
}

// ─── エラーコード ─────────────────────────────────────────────────────────
export type ErrorCode =
    | "ROOM_FULL"
    | "ROOM_NOT_FOUND"
    | "ROOM_FINISHED"
    | "ROOM_EXPIRED"
    | "INVALID_TOKEN"
    | "DESYNC"
    | "ILLEGAL_MOVE"
    | "NOT_YOUR_TURN"
    | "RATE_LIMITED"
    | "SPECTATOR_FORBIDDEN"
    | "ANALYSIS_LIMIT_EXCEEDED"
    | "AI_SUPPORT_DISABLED"
    | "TAKEBACK_DISABLED"
    | "TAKEBACK_NOT_PENDING"
    | "TAKEBACK_ALREADY_PENDING"
    | "TAKEBACK_NO_MOVES"
    | "UNKNOWN";

// ─── サーバ → クライアント メッセージ ───────────────────────────────────────
export interface JoinedMessage {
    v: 1;
    t: "joined";
    payload: {
        roomId: string;
        seat: Seat;
        resumeToken?: string;
        youAre: "player" | "spectator";
    };
}

export interface SnapshotMessage {
    v: 1;
    t: "snapshot";
    payload: SnapshotPayload;
}

export interface EventMessage {
    v: 1;
    t: "event";
    payload: RoomEvent;
}

export interface ErrorMessage {
    v: 1;
    t: "error";
    payload: {
        code: ErrorCode;
        message: string;
        clientMsgId?: number;
    };
}

export interface PongMessage {
    v: 1;
    t: "pong";
    payload: {
        ts: number;
        serverTs: number;
    };
}

export type ServerMessage =
    | JoinedMessage
    | SnapshotMessage
    | EventMessage
    | ErrorMessage
    | PongMessage;

// ─── クライアント → サーバ メッセージ ───────────────────────────────────────
export type ClientMessageType =
    | "join"
    | "resume"
    | "move"
    | "resign"
    | "checkmate"
    | "use_analysis"
    | "update_settings"
    | "ack"
    | "sync"
    | "ping"
    | "takeback_request"
    | "takeback_response"
    | "takeback_cancel";

export interface ClientMessage<T = unknown> {
    v: 1;
    t: ClientMessageType;
    clientMsgId: number;
    payload: T;
}
