/**
 * @shogi/study-client パッケージ公開 API
 *
 * 研究ノートのローカル保存（IndexedDB）、サーバーとの同期、API クライアント。
 * 型と純粋ロジック（文書、操作の適用、識別子）は `@shogi/app-core` にある。
 */

// api-client
export type { StudyApiClientOptions } from "./api-client";
export { createStudyApiClient } from "./api-client";
// api-types
export type {
    CreateStudyRequest,
    CreateStudyResponse,
    GetStudyResponse,
    ListStudiesParams,
    ListStudiesResponse,
    StudyApi,
    StudyApiErrorBody,
    StudyApiResult,
    StudyDetail,
    StudyLimitsResponse,
    StudyOpsRequest,
    StudyOpsResponse,
    StudySummary,
} from "./api-types";
// browser
export type { BrowserStudySync, BrowserStudySyncOptions } from "./browser";
export {
    createBroadcastStudyChannel,
    createBrowserStudySync,
    createSessionVerifier,
    createWebLockManager,
} from "./browser";
// indexeddb-store
export type { IndexedDbStudyStoreOptions } from "./indexeddb-store";
export { createIndexedDbStudyStore, STUDY_DB_NAME, STUDY_DB_VERSION } from "./indexeddb-store";
// status
export type {
    StudySaveReason,
    StudySaveState,
    StudySaveStatus,
    StudySaveStatusInput,
} from "./status";
export { deriveStudySaveStatus } from "./status";
// store
export type {
    PendingStudyOp,
    StoredStudy,
    StoredStudySummary,
    StudyInflightBatch,
    StudyRemoteState,
    StudyStorageErrorCode,
    StudyStore,
    StudyStoreSnapshot,
    StudyStoreWrite,
    StudyViewState,
} from "./store";
export { createMemoryStudyStore, STUDY_RECORD_VERSION, StudyStorageError } from "./store";
// sync
export type {
    StudyChannel,
    StudyChannelMessage,
    StudyLocalSummary,
    StudyLockManager,
    StudyOpenResult,
    StudyScheduler,
    StudySession,
    StudySync,
    StudySyncErrorCode,
    StudySyncEvent,
    StudySyncOptions,
} from "./sync";
export { createInProcessLockManager, createStudySync, StudySyncError } from "./sync";
