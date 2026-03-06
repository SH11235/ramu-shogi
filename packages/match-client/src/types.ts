import type { Seat, ServerMessage } from "@shogi/match-protocol";

export type { ClientMessageType, Seat, ServerMessage } from "@shogi/match-protocol";

// ─── RoomClient インターフェース ──────────────────────────────────────────
export interface RoomClient {
    join(params: { seat: Seat; name: string }): void;
    resume(params: { resumeToken: string; lastEventId: number }): void;
    move(params: { eventId: number; usi: string; sfen: string }): void;
    resign(params: { eventId: number }): void;
    consumeAnalysis(params: { eventId: number; ply: number }): void;
    updateSettings(params: { startSfen: string }): void;
    ack(params: { lastEventId: number }): void;
    sync(params: { sinceEventId: number }): void;
    ping(): void;

    subscribe(handler: (msg: ServerMessage) => void): () => void;
    disconnect(): void;
    getStatus(): "connecting" | "connected" | "reconnecting" | "disconnected";
}

export interface RoomClientOptions {
    wsUrl: string;
    onReconnect?: () => void;
    autoReconnect?: boolean;
}
