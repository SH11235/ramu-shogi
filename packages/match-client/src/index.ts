export type {
    AiSupportPlayerSettings,
    AiSupportSettings,
    ClockState,
    ErrorCode,
    GameResult,
    GameStartEvent,
    PassRightsState,
    RoomEvent,
    RoomSettings,
    Seat,
    ServerMessage,
    SnapshotPayload,
} from "@shogi/match-protocol";
export { createRoomClient } from "./client";
export {
    getStoredResumeToken,
    getStoredSeat,
    isResumeTokenRejected,
    removeStoredResumeToken,
    removeStoredSeat,
    storeSeat,
} from "./reconnect";
export type {
    FetchRshogiGameOptions,
    FetchRshogiGameSearchOptions,
    RshogiClockKind,
    RshogiGame,
    RshogiGameEventMeta,
    RshogiGameEventSummary,
    RshogiGameMeta,
    RshogiGameResult,
    RshogiGameResultKind,
    RshogiGameSearchPage,
    RshogiGameSummary,
    RshogiLiveGameSummary,
    RshogiPlayerDetail,
    RshogiPlayerList,
    RshogiPlayerSummary,
    RshogiTimeControl,
} from "./rshogi-csa/client";
export {
    fetchRshogiGame,
    fetchRshogiGameEvents,
    fetchRshogiGameList,
    fetchRshogiGameSearch,
    fetchRshogiLiveGameList,
    fetchRshogiPlayerDetail,
    fetchRshogiPlayerList,
    RshogiGameNotFoundError,
} from "./rshogi-csa/client";
export type {
    RshogiLiveCallbacks,
    RshogiLiveConnectionState,
    RshogiLiveMove,
    RshogiLiveSession,
    RshogiLiveSnapshot,
    RshogiLiveStaticFallbackReason,
} from "./rshogi-csa/live";
export { RshogiLiveRoomFullError, subscribeRshogiLiveGame } from "./rshogi-csa/live";
export type { RoomClient, RoomClientOptions, RoomClientStatus } from "./types";
