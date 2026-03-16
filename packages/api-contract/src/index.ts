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

export const USER_SETTINGS_DOCUMENT_KEYS = [
    "match.time-settings",
    "match.display-settings",
    "match.analysis-settings",
    "match.pass-rights-settings",
] as const;

export type UserSettingsDocumentKey = (typeof USER_SETTINGS_DOCUMENT_KEYS)[number];

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface UserSettingsDocument<
    DocumentKey extends UserSettingsDocumentKey = UserSettingsDocumentKey,
> {
    documentKey: DocumentKey;
    value: JsonValue;
    version: number;
    updatedAt: string;
}

export interface ListUserSettingsResponse {
    documents: UserSettingsDocument[];
}

export interface GetUserSettingsResponse {
    document: UserSettingsDocument | null;
}

export interface PutUserSettingsRequest {
    value: JsonValue;
    expectedVersion?: number | null;
}

export interface PutUserSettingsResponse {
    document: UserSettingsDocument;
}

export type GameRecordSource = "online_room" | "local_app" | "import";
export type GameRecordVisibility = "private" | "unlisted" | "public";
export type GameRecordStatus = "finished" | "aborted";
export type GameRecordSeat = "b" | "w";

export interface GameResultPayload {
    winner: GameRecordSeat | null;
    reason: string;
}

export interface GameRecordParticipant {
    seat: GameRecordSeat;
    userId: string | null;
    displayNameSnapshot: string;
}

export interface GameRecordSummary {
    id: string;
    roomId: string | null;
    source: GameRecordSource;
    visibility: GameRecordVisibility;
    publicId: string | null;
    status: GameRecordStatus;
    result: GameResultPayload | null;
    participants: GameRecordParticipant[];
    createdAt: string;
    finishedAt: string | null;
}

export interface GameRecordDetail extends GameRecordSummary {
    initialSfen: string;
    metadata: JsonValue;
    moves: string[];
    kifuText: string;
    startedAt: string | null;
}

export interface ListGamesResponse {
    games: GameRecordSummary[];
}

export interface GetGameResponse {
    game: GameRecordDetail;
}

export interface UpdateGameVisibilityRequest {
    visibility: GameRecordVisibility;
}

export interface UpdateGameVisibilityResponse {
    game: GameRecordSummary;
}

export interface ListPublicGamesResponse {
    games: GameRecordSummary[];
    nextCursor: string | null;
}

export interface GetPublicGameResponse {
    game: GameRecordDetail;
}

export interface AnalysisSnapshotEntry {
    ply: number;
    evalCp: number | null;
    evalMate: number | null;
    depth: number | null;
    pv: string[] | null;
    multiPv: JsonValue | null;
}

export interface AnalysisSnapshotSummary {
    id: string;
    gameId: string;
    label: string | null;
    createdAt: string;
    entryCount: number;
}

export interface AnalysisSnapshotDetail extends AnalysisSnapshotSummary {
    lineMoves: string[];
    analysisSettings: JsonValue;
    metadata: JsonValue;
    entries: AnalysisSnapshotEntry[];
}

export interface CreateAnalysisSnapshotRequest {
    label?: string | null;
    lineMoves: string[];
    analysisSettings: JsonValue;
    metadata?: JsonValue;
    entries: AnalysisSnapshotEntry[];
}

export interface CreateAnalysisSnapshotResponse {
    snapshot: AnalysisSnapshotSummary;
}

export interface ListAnalysisSnapshotsResponse {
    snapshots: AnalysisSnapshotSummary[];
}

export interface GetAnalysisSnapshotResponse {
    snapshot: AnalysisSnapshotDetail;
}

export type NnueUploadStatus = "pending" | "completed" | "failed" | "deleted";

export interface NnueFileSummary {
    id: string;
    originalFilename: string;
    sizeBytes: number;
    sha256Hex: string;
    uploadStatus: NnueUploadStatus;
    createdAt: string;
    completedAt: string | null;
}

export interface ListNnueFilesResponse {
    files: NnueFileSummary[];
}

export interface InitializeNnueUploadRequest {
    originalFilename: string;
    sizeBytes: number;
    sha256Hex: string;
}

export interface InitializeNnueUploadResponse {
    file: NnueFileSummary;
    uploadId: string;
}

export interface UploadNnuePartResponse {
    partNumber: number;
    etag: string;
}

export interface CompleteNnueUploadRequest {
    uploadId: string;
    parts: Array<{
        partNumber: number;
        etag: string;
    }>;
}

export interface CompleteNnueUploadResponse {
    file: NnueFileSummary;
}
