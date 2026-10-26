import type { Seat, ServerMessage } from "@shogi/match-protocol";

export type { ClientMessage, ClientMessageType, Seat, ServerMessage } from "@shogi/match-protocol";

// ─── RoomClient インターフェース ──────────────────────────────────────────
export interface RoomClient {
    join(params: { seat: Seat; name: string }): void;
    resume(params: { resumeToken: string; lastEventId: number }): void;
    move(params: { eventId: number; usi: string; sfen: string }): void;
    resign(params: { eventId: number }): void;
    checkmate(params: { eventId: number }): void;
    consumeAnalysis(params: { eventId: number; ply: number }): void;
    updateSettings(params: { startSfen: string }): void;
    ack(params: { lastEventId: number }): void;
    sync(params: { sinceEventId: number }): void;
    ping(): void;

    takebackRequest(params: { eventId: number }): void;
    takebackResponse(params: { eventId: number; accept: boolean }): void;
    takebackCancel(params: { eventId: number }): void;

    subscribe(handler: (msg: ServerMessage) => void): () => void;
    /** 接続状態が変わるたびに、変わった後の状態で呼ばれる。disconnect() による切断は通知しない */
    subscribeStatus(handler: (status: RoomClientStatus) => void): () => void;
    disconnect(): void;
    getStatus(): RoomClientStatus;
}

export type RoomClientStatus = "connecting" | "connected" | "reconnecting" | "disconnected";

export interface RoomClientOpenEvent {
    reconnect: boolean;
}

export interface RoomClientOptions {
    wsUrl: string;
    onOpen?: (event: RoomClientOpenEvent) => void;
    onReconnect?: () => void;
    autoReconnect?: boolean;
}
