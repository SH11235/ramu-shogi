/**
 * 研究ノートのページのテストで使う道具: メモリ上の保存層を使う同期エンジン、届かない API、
 * 切り替えられるログイン状態。
 *
 * ページが使う `lib/studySync`（セッションの伝達と引き継ぎ）は本物を使い、その下の
 * `createBrowserStudySync` だけをメモリ上の同期エンジンに差し替える。
 */

import { createStudyDocumentFromMoves, type StudyDocument } from "@shogi/app-core";
import {
    createMemoryStudyStore,
    createStudySync,
    type StudyApi,
    type StudyStore,
    type StudySync,
} from "@shogi/study-client";
import { vi } from "vitest";

const offline = async () => ({ ok: false as const, status: 0, error: {} });

/** サーバーに届かない API（backend なしの想定）。必要な呼び出しだけ差し替える。 */
export const createOfflineApi = (overrides: Partial<StudyApi> = {}): StudyApi => ({
    list: vi.fn(offline),
    create: vi.fn(offline),
    get: vi.fn(offline),
    postOps: vi.fn(offline),
    delete: vi.fn(offline),
    limits: vi.fn(offline),
    ...overrides,
});

export const createTestSync = (
    api: StudyApi = createOfflineApi(),
    store: StudyStore = createMemoryStudyStore(),
): StudySync => createStudySync({ store, api });

export const createTestDoc = (id: string, title: string): StudyDocument =>
    createStudyDocumentFromMoves({
        id,
        title,
        origin: { kind: "paste", ref: null },
        startSfen: "startpos",
        moves: ["7g7f", "3c3d", "2g2f"],
        meta: { blackName: "先手太郎", whiteName: "後手花子" },
    });

/** テストから切り替えるログイン状態（`useAuthSession` の戻り値）。 */
export interface TestAuthState {
    session: { authenticated: boolean; user: { id: string } | null } | null;
    isLoadingSession: boolean;
}

/** 確認中。 */
export const AUTH_LOADING: TestAuthState = { session: null, isLoadingSession: true };
/** 未ログイン。 */
export const AUTH_SIGNED_OUT: TestAuthState = {
    session: { authenticated: false, user: null },
    isLoadingSession: false,
};
/** ログイン中。 */
export const authSignedIn = (userId: string): TestAuthState => ({
    session: { authenticated: true, user: { id: userId } },
    isLoadingSession: false,
});
