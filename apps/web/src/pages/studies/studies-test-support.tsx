/**
 * 研究ノートのページのテストで使う道具: メモリ上の保存層を使う同期エンジンと、届かない API。
 */

import { createStudyDocumentFromMoves, type StudyDocument } from "@shogi/app-core";
import {
    createMemoryStudyStore,
    createStudySync,
    type StudyApi,
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

export const createTestSync = (api: StudyApi = createOfflineApi()): StudySync =>
    createStudySync({ store: createMemoryStudyStore(), api });

export const createTestDoc = (id: string, title: string): StudyDocument =>
    createStudyDocumentFromMoves({
        id,
        title,
        origin: { kind: "paste", ref: null },
        startSfen: "startpos",
        moves: ["7g7f", "3c3d", "2g2f"],
        meta: { blackName: "先手太郎", whiteName: "後手花子" },
    });
