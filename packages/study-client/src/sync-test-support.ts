/**
 * 同期エンジンのテスト用の道具: 契約（設計書 6 章）どおりに動く小さなサーバーと、
 * 手で進める時計、タブをまたぐ通知の模擬。
 */

import {
    applyStudyOps,
    createStudyDocumentFromMoves,
    STUDY_LIMITS,
    type StudyDocument,
    StudyOpError,
    studyLayerId,
    studyOriginKey,
} from "@shogi/app-core";
import type {
    CreateStudyRequest,
    StudyApi,
    StudyApiErrorBody,
    StudyApiResult,
    StudyDetail,
    StudyOpsRequest,
} from "./api-types";
import type { StudyChannel, StudyChannelMessage, StudyScheduler } from "./sync";

interface ServerStudy {
    ownerId: string;
    detail: StudyDetail;
    lastBatchId: string | null;
    deleted: boolean;
}

interface FakeServerCall {
    method: "list" | "create" | "get" | "postOps" | "delete" | "limits";
    studyId: string | null;
    userId: string | null;
    body?: unknown;
    status: number;
}

/**
 * 呼び出しへの割り込み。
 * - `offline`: サーバーに届かない（何も適用せず、通信失敗を返す）
 * - `drop-response`: サーバーは処理するが、応答が届かない
 * - `{ status, error }`: その応答を返す（サーバーは処理しない）
 */
type Interception = "offline" | "drop-response" | { status: number; error?: StudyApiErrorBody };

export interface FakeStudyServer {
    /** そのユーザーのセッション Cookie を持つクライアント。`getUserId` が null なら未ログイン。 */
    apiFor(getUserId: () => string | null): StudyApi;
    calls: FakeServerCall[];
    /** 次に一致した呼び出し 1 回に割り込む。 */
    interceptOnce(method: FakeServerCall["method"], interception: Interception): void;
    /** 一致する呼び出しすべてに割り込む。解除は返り値の関数。 */
    intercept(method: FakeServerCall["method"] | "*", interception: Interception): () => void;
    /** サーバー上のノート（無い・削除済みなら null）。 */
    study(studyId: string): StudyDetail | null;
    /** 他の端末からの変更を模擬する（リビジョンが 1 進む）。 */
    applyFromOtherDevice(studyId: string, ops: StudyOpsRequest["ops"]): void;
    /** サーバーに直接ノートを置く（別の端末で作ったノートの模擬）。 */
    seed(ownerId: string, doc: StudyDocument): void;
    /** サーバー側で削除する（別の端末で消した模擬）。 */
    remove(studyId: string): void;
    limits: { nodesPerStudy: number; studiesPerUser: number; opsPerBatch: number };
    /** 同時に処理中だった `postOps` の最大数（1 ノート 1 送信の確認用）。 */
    maxConcurrentPostOps: number;
}

const fail = <T>(status: number, error: StudyApiErrorBody = {}): StudyApiResult<T> => ({
    ok: false,
    status,
    error,
});

const NETWORK_FAILURE = { ok: false, status: 0, error: { error: "NETWORK_ERROR" } } as const;

export function createFakeStudyServer(): FakeStudyServer {
    const studies = new Map<string, ServerStudy>();
    const calls: FakeServerCall[] = [];
    const once: Array<{ method: FakeServerCall["method"]; interception: Interception }> = [];
    const always: Array<{ method: FakeServerCall["method"] | "*"; interception: Interception }> =
        [];
    const limits = { nodesPerStudy: 2000, studiesPerUser: 200, opsPerBatch: 200 };
    let concurrentPostOps = 0;
    let clock = Date.UTC(2026, 9, 12);

    const timestamp = (): string => {
        clock += 1000;
        return new Date(clock).toISOString();
    };

    const takeInterception = (method: FakeServerCall["method"]): Interception | undefined => {
        const index = once.findIndex((item) => item.method === method);
        if (index >= 0) return once.splice(index, 1)[0].interception;
        return always.find((item) => item.method === method || item.method === "*")?.interception;
    };

    const server: FakeStudyServer = {
        calls,
        limits,
        maxConcurrentPostOps: 0,
        interceptOnce(method, interception) {
            once.push({ method, interception });
        },
        intercept(method, interception) {
            const item = { method, interception };
            always.push(item);
            return () => {
                const index = always.indexOf(item);
                if (index >= 0) always.splice(index, 1);
            };
        },
        study(studyId) {
            const found = studies.get(studyId);
            return found && !found.deleted ? structuredClone(found.detail) : null;
        },
        applyFromOtherDevice(studyId, ops) {
            const found = studies.get(studyId);
            if (!found || found.deleted) throw new Error(`no such study: ${studyId}`);
            found.detail = {
                ...found.detail,
                ...applyStudyOps(found.detail, ops),
                revision: found.detail.revision + 1,
                updatedAt: timestamp(),
            };
            found.lastBatchId = `other-device-${found.detail.revision}`;
        },
        seed(ownerId, doc) {
            const createdAt = timestamp();
            studies.set(doc.id, {
                ownerId,
                detail: { ...structuredClone(doc), revision: 1, createdAt, updatedAt: createdAt },
                lastBatchId: null,
                deleted: false,
            });
        },
        remove(studyId) {
            const found = studies.get(studyId);
            if (found) found.deleted = true;
        },
        apiFor(getUserId) {
            /** 割り込みを適用しつつ、1 回の呼び出しを処理して記録する。 */
            const call = async <T>(
                method: FakeServerCall["method"],
                studyId: string | null,
                body: unknown,
                handle: (userId: string) => StudyApiResult<T>,
            ): Promise<StudyApiResult<T>> => {
                const userId = getUserId();
                const interception = takeInterception(method);
                // 本文は JSON で送られる。構造化複製できない値・循環はここで弾かれる。
                const sent = body === undefined ? undefined : JSON.parse(JSON.stringify(body));
                await Promise.resolve();
                const record = (status: number): void => {
                    calls.push({ method, studyId, userId, body: sent, status });
                };
                if (interception === "offline") {
                    record(0);
                    return NETWORK_FAILURE;
                }
                if (interception !== undefined && interception !== "drop-response") {
                    record(interception.status);
                    return fail(interception.status, interception.error);
                }
                const result =
                    userId === null ? fail<T>(401, { error: "UNAUTHORIZED" }) : handle(userId);
                if (interception === "drop-response") {
                    record(0);
                    return NETWORK_FAILURE;
                }
                record(result.status);
                return result.ok ? { ...result, data: structuredClone(result.data) } : result;
            };

            const owned = (
                studyId: string,
                userId: string,
            ): ServerStudy | { status: number; error: StudyApiErrorBody } => {
                const found = studies.get(studyId);
                if (!found || found.ownerId !== userId) {
                    return { status: 404, error: { error: "STUDY_NOT_FOUND" } };
                }
                if (found.deleted) return { status: 410, error: { error: "STUDY_DELETED" } };
                return found;
            };

            return {
                list() {
                    return call("list", null, undefined, (userId) => ({
                        ok: true,
                        status: 200,
                        data: {
                            studies: [...studies.values()]
                                .filter((item) => item.ownerId === userId && !item.deleted)
                                .map(({ detail }) => ({
                                    id: detail.id,
                                    title: detail.title,
                                    origin: detail.origin,
                                    meta: detail.meta,
                                    revision: detail.revision,
                                    nodeCount: Object.keys(detail.tree.nodes).length,
                                    layerCount: detail.layers.length,
                                    resultCount: detail.layers.reduce(
                                        (max, layer) =>
                                            Math.max(max, Object.keys(layer.results).length),
                                        0,
                                    ),
                                    updatedAt: detail.updatedAt,
                                })),
                            nextCursor: null,
                        },
                    }));
                },
                create(body: CreateStudyRequest) {
                    return call("create", body.id, body, (userId) => {
                        const existing = studies.get(body.id);
                        if (existing) {
                            if (existing.ownerId !== userId) {
                                return fail(409, { error: "ID_CONFLICT" });
                            }
                            if (existing.deleted) return fail(410, { error: "STUDY_DELETED" });
                            return {
                                ok: true,
                                status: 200,
                                data: {
                                    studyId: body.id,
                                    revision: existing.detail.revision,
                                    existing: true,
                                },
                            };
                        }
                        const originKey = studyOriginKey(body.origin.kind, body.origin.ref);
                        const live = [...studies.values()].filter(
                            (item) => item.ownerId === userId && !item.deleted,
                        );
                        const sameOrigin = live.find(
                            ({ detail }) =>
                                originKey !== null &&
                                studyOriginKey(detail.origin.kind, detail.origin.ref) === originKey,
                        );
                        if (sameOrigin) {
                            return fail(409, {
                                error: "ORIGIN_EXISTS",
                                existingStudyId: sameOrigin.detail.id,
                            });
                        }
                        if (live.length >= limits.studiesPerUser) {
                            return fail(422, { error: "LIMIT_EXCEEDED", limit: "studiesPerUser" });
                        }
                        if (Object.keys(body.tree.nodes).length > limits.nodesPerStudy) {
                            return fail(422, { error: "LIMIT_EXCEEDED", limit: "nodesPerStudy" });
                        }
                        const createdAt = timestamp();
                        studies.set(body.id, {
                            ownerId: userId,
                            detail: {
                                id: body.id,
                                title: body.title,
                                origin: body.origin,
                                startSfen: body.startSfen,
                                rules: body.rules,
                                meta: body.meta,
                                tree: structuredClone(body.tree),
                                layers: (body.layers ?? []).map((layer) => ({
                                    // layerId はサーバーが spec から計算する。
                                    id: studyLayerId(layer.spec),
                                    ...structuredClone(layer),
                                })),
                                revision: 1,
                                createdAt,
                                updatedAt: createdAt,
                            },
                            lastBatchId: null,
                            deleted: false,
                        });
                        return {
                            ok: true,
                            status: 201,
                            data: { studyId: body.id, revision: 1 },
                        };
                    });
                },
                get(studyId: string) {
                    return call("get", studyId, undefined, (userId) => {
                        const found = owned(studyId, userId);
                        if ("status" in found) return fail(found.status, found.error);
                        return { ok: true, status: 200, data: { study: found.detail } };
                    });
                },
                async postOps(studyId: string, body: StudyOpsRequest) {
                    concurrentPostOps += 1;
                    server.maxConcurrentPostOps = Math.max(
                        server.maxConcurrentPostOps,
                        concurrentPostOps,
                    );
                    try {
                        // 通信に時間がかかる様子を模擬する（同時送信があれば重なる）。
                        await new Promise((resolve) => setTimeout(resolve, 0));
                        return await call("postOps", studyId, body, (userId) => {
                            const found = owned(studyId, userId);
                            if ("status" in found) return fail(found.status, found.error);
                            if (body.ops.length > limits.opsPerBatch) {
                                return fail(422, { error: "LIMIT_EXCEEDED", limit: "opsPerBatch" });
                            }
                            if (body.expectedRevision !== found.detail.revision) {
                                if (body.batchId === found.lastBatchId) {
                                    return {
                                        ok: true,
                                        status: 200,
                                        data: { revision: found.detail.revision, replayed: true },
                                    };
                                }
                                return fail(409, {
                                    error: "REVISION_CONFLICT",
                                    currentRevision: found.detail.revision,
                                });
                            }
                            let next: StudyDocument;
                            try {
                                next = applyStudyOps(found.detail, body.ops);
                            } catch (error) {
                                if (error instanceof StudyOpError) {
                                    return fail(400, {
                                        error: "INVALID_REQUEST",
                                        message: error.message,
                                    });
                                }
                                throw error;
                            }
                            if (Object.keys(next.tree.nodes).length > limits.nodesPerStudy) {
                                return fail(422, {
                                    error: "LIMIT_EXCEEDED",
                                    limit: "nodesPerStudy",
                                });
                            }
                            found.detail = {
                                ...found.detail,
                                ...next,
                                revision: found.detail.revision + 1,
                                updatedAt: timestamp(),
                            };
                            found.lastBatchId = body.batchId;
                            return {
                                ok: true,
                                status: 200,
                                data: { revision: found.detail.revision },
                            };
                        });
                    } finally {
                        concurrentPostOps -= 1;
                    }
                },
                delete(studyId: string) {
                    return call<null>("delete", studyId, undefined, (userId) => {
                        const found = owned(studyId, userId);
                        // 削除済みのノートへの DELETE の再送は 204。
                        if ("status" in found && found.status === 410) {
                            return { ok: true, status: 204, data: null };
                        }
                        if ("status" in found) return fail(found.status, found.error);
                        found.deleted = true;
                        return { ok: true, status: 204, data: null };
                    });
                },
                limits() {
                    return call("limits", null, undefined, (userId) => ({
                        ok: true,
                        status: 200,
                        data: {
                            limits: { ...STUDY_LIMITS, ...limits },
                            usage: {
                                studyCount: [...studies.values()].filter(
                                    (item) => item.ownerId === userId && !item.deleted,
                                ).length,
                            },
                        },
                    }));
                },
            };
        },
    };
    return server;
}

export interface ManualScheduler extends StudyScheduler {
    now(): number;
    /** 時刻を進め、期限の来たタイマーを順に実行する。 */
    advance(ms: number): void;
    /** 予定されているタイマーの残り時間（昇順）。 */
    pendingDelays(): number[];
}

export function createManualScheduler(): ManualScheduler {
    let current = 1_000_000;
    let nextHandle = 1;
    const timers = new Map<number, { at: number; callback: () => void }>();
    return {
        now: () => current,
        setTimeout(callback, delayMs) {
            const handle = nextHandle++;
            timers.set(handle, { at: current + delayMs, callback });
            return handle;
        },
        clearTimeout(handle) {
            timers.delete(handle as number);
        },
        advance(ms) {
            const target = current + ms;
            for (;;) {
                const due = [...timers.entries()]
                    .filter(([, timer]) => timer.at <= target)
                    .sort((a, b) => a[1].at - b[1].at)[0];
                if (!due) break;
                timers.delete(due[0]);
                current = Math.max(current, due[1].at);
                due[1].callback();
            }
            current = target;
        },
        pendingDelays() {
            return [...timers.values()].map((timer) => timer.at - current).sort((a, b) => a - b);
        },
    };
}

/** タブをまたぐ通知の模擬。同じハブから作ったチャンネルは、自分以外の全員に届く。 */
export function createChannelHub(): { join(): StudyChannel } {
    const members = new Set<Set<(message: StudyChannelMessage) => void>>();
    return {
        join() {
            const handlers = new Set<(message: StudyChannelMessage) => void>();
            members.add(handlers);
            return {
                post(message) {
                    for (const other of members) {
                        if (other === handlers) continue;
                        for (const handler of [...other]) handler(structuredClone(message));
                    }
                },
                subscribe(handler) {
                    handlers.add(handler);
                    return () => {
                        handlers.delete(handler);
                    };
                },
                close() {
                    members.delete(handlers);
                },
            };
        },
    };
}

/** 進行中の非同期処理（保存層・模擬サーバー）が落ち着くまで待つ。 */
export async function settle(rounds = 20): Promise<void> {
    for (let i = 0; i < rounds; i++) {
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
}

export const TEST_STUDY_ID = "b1181ba0-5387-4d97-9e3c-e89bdfb94c7b";

/** 本譜 2 手のノートの文書を作る。 */
export function createTestDocument(overrides: Partial<StudyDocument> = {}): StudyDocument {
    return {
        ...createStudyDocumentFromMoves({
            id: TEST_STUDY_ID,
            title: "RAMU 対 Panda",
            origin: { kind: "paste", ref: null },
            startSfen: "startpos",
            moves: ["7g7f", "3c3d"],
        }),
        ...overrides,
    };
}
