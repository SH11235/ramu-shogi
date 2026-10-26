/**
 * @shogi/study-client パッケージ公開 API
 *
 * 研究ノートのローカル保存（IndexedDB）、サーバーとの同期、API クライアント。
 * 型と純粋ロジック（文書、操作の適用、識別子）は `@shogi/app-core` にある。
 */

export { createStudyApiClient } from "./api-client";
export type { StudyApi, StudySummary } from "./api-types";
export type { BrowserStudySync } from "./browser";
export { createBrowserStudySync, createSessionVerifier } from "./browser";
export { createIndexedDbStudyStore } from "./indexeddb-store";
export type { StudySaveStatus } from "./status";
export type { StoredStudy, StudyStore } from "./store";
export { createMemoryStudyStore } from "./store";
export type { StudyLocalSummary, StudySession, StudySync, StudySyncEvent } from "./sync";
export { createStudySync } from "./sync";
