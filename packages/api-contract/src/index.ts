import type { RoomSettings, RoomStatus } from "@shogi/match-protocol";

export interface ApiErrorResponse {
    error: string;
    message?: string;
}

export interface RoomInfoPlayer {
    name: string;
    online: boolean;
}

export interface RoomInfo {
    roomId: string;
    status: RoomStatus;
    players: {
        b: RoomInfoPlayer | null;
        w: RoomInfoPlayer | null;
    };
    spectators: number;
    settings: RoomSettings;
}

export interface CreateRoomRequest {
    settings: RoomSettings;
}

export interface CreateRoomResponse {
    roomId: string;
    shareUrl: string;
}

export type GetRoomResponse = RoomInfo;
