import type { components, operations, paths } from "./generated/schema";

export const USER_SETTINGS_DOCUMENT_KEYS = [
    "match.time-settings",
    "match.display-settings",
    "match.analysis-settings",
    "match.pass-rights-settings",
] as const;

export type ApiPaths = paths;
export type ApiOperations = operations;

export type ApiErrorResponse = components["schemas"]["ApiErrorResponse"];
export type OkResponse = components["schemas"]["OkResponse"];
export type JsonValue = components["schemas"]["JsonValue"];

export type RoomStatus = components["schemas"]["RoomStatus"];
export type TimeControlSettings = components["schemas"]["TimeControlSettings"];
export type PassRightsConfig = components["schemas"]["PassRightsConfig"];
export type AiSupportPlayerSettings = components["schemas"]["AiSupportPlayerSettings"];
export type AiSupportSettings = components["schemas"]["AiSupportSettings"];
export type RoomInfoPlayer = components["schemas"]["RoomInfoPlayer"];
export type RoomSettings = components["schemas"]["RoomSettings"];
export type RoomInfo = components["schemas"]["RoomInfo"];
export type CreateRoomRequest = components["schemas"]["CreateRoomRequest"];
export type CreateRoomResponse = components["schemas"]["CreateRoomResponse"];
export type GetRoomResponse =
    operations["getRoom"]["responses"][200]["content"]["application/json"];

export type UserSettingsDocumentKey = components["schemas"]["UserSettingsDocumentKey"];
export type UserSettingsDocument = components["schemas"]["UserSettingsDocument"];
export type ListUserSettingsResponse = components["schemas"]["ListUserSettingsResponse"];
export type GetUserSettingsResponse = components["schemas"]["GetUserSettingsResponse"];
export type PutUserSettingsRequest = components["schemas"]["PutUserSettingsRequest"];
export type PutUserSettingsResponse = components["schemas"]["PutUserSettingsResponse"];

export type GameRecordSource = components["schemas"]["GameRecordSource"];
export type GameRecordVisibility = components["schemas"]["GameRecordVisibility"];
export type GameRecordStatus = components["schemas"]["GameRecordStatus"];
export type GameRecordSeat = components["schemas"]["GameRecordSeat"];
export type GameResultPayload = components["schemas"]["GameResultPayload"];
export type GameRecordParticipant = components["schemas"]["GameRecordParticipant"];
export type GameRecordSummary = components["schemas"]["GameRecordSummary"];
export type GameRecordDetail = components["schemas"]["GameRecordDetail"];
export type ListGamesResponse = components["schemas"]["ListGamesResponse"];
export type GetGameResponse = components["schemas"]["GetGameResponse"];
export type UpdateGameVisibilityRequest = components["schemas"]["UpdateGameVisibilityRequest"];
export type UpdateGameVisibilityResponse = components["schemas"]["UpdateGameVisibilityResponse"];
export type ListPublicGamesResponse = components["schemas"]["ListPublicGamesResponse"];
export type GetPublicGameResponse = components["schemas"]["GetPublicGameResponse"];

export type AnalysisSnapshotEntry = components["schemas"]["AnalysisSnapshotEntry"];
export type AnalysisSnapshotSummary = components["schemas"]["AnalysisSnapshotSummary"];
export type AnalysisSnapshotDetail = components["schemas"]["AnalysisSnapshotDetail"];
export type CreateAnalysisSnapshotRequest = components["schemas"]["CreateAnalysisSnapshotRequest"];
export type CreateAnalysisSnapshotResponse =
    components["schemas"]["CreateAnalysisSnapshotResponse"];
export type ListAnalysisSnapshotsResponse = components["schemas"]["ListAnalysisSnapshotsResponse"];
export type GetAnalysisSnapshotResponse = components["schemas"]["GetAnalysisSnapshotResponse"];

export type NnueUploadStatus = components["schemas"]["NnueUploadStatus"];
export type NnueFileSummary = components["schemas"]["NnueFileSummary"];
export type ListNnueFilesResponse = components["schemas"]["ListNnueFilesResponse"];
export type InitializeNnueUploadRequest = components["schemas"]["InitializeNnueUploadRequest"];
export type InitializeNnueUploadResponse = components["schemas"]["InitializeNnueUploadResponse"];
export type UploadNnuePartResponse = components["schemas"]["UploadNnuePartResponse"];
export type CompleteNnueUploadRequest = components["schemas"]["CompleteNnueUploadRequest"];
export type CompleteNnueUploadResponse = components["schemas"]["CompleteNnueUploadResponse"];

export type AuthSessionUser = components["schemas"]["AuthSessionUser"];
export type AuthSessionResponse = components["schemas"]["AuthSessionResponse"];
export type UpdateProfileRequest = components["schemas"]["UpdateProfileRequest"];
export type UpdateProfileResponse = components["schemas"]["UpdateProfileResponse"];
