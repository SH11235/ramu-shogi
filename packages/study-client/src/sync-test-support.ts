/**
 * 同期エンジンのテスト用の道具: 契約（設計書 6 章）どおりに動く小さなサーバーと、
 * 手で進める時計、タブをまたぐ通知の模擬。
 */

import {
    applyStudyOp,
    applyStudyOps,
    createStudyDocumentFromMoves,
    STUDY_LIMITS,
    type StudyAnalysisResult,
    type StudyDocument,
    type StudyLimitName,
    type StudyOp,
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
    /** サーバーからノートを跡形なく消す（以後は 404。作り直しの確認用）。 */
    forget(studyId: string): void;
    /** サーバーの上限（テストで下げて、クライアントは通すがサーバーは拒否する状況を作れる）。 */
    limits: Record<StudyLimitName, number>;
    /** 呼び出しを処理する直前に呼ばれる（応答待ちのあいだの出来事を模擬する）。 */
    beforeHandle: ((call: Pick<FakeServerCall, "method" | "studyId">) => Promise<void>) | null;
    /** 同時に処理中だった `postOps` の最大数（1 ノート 1 送信の確認用）。 */
    maxConcurrentPostOps: number;
}

const fail = <T>(status: number, error: StudyApiErrorBody = {}): StudyApiResult<T> => ({
    ok: false,
    status,
    error,
});

const NETWORK_FAILURE = { ok: false, status: 0, error: { error: "NETWORK_ERROR" } } as const;

const USI_MOVE = /^(?:[1-9][a-i][1-9][a-i]\+?|[PLNSBRG]\*[1-9][a-i]|pass)$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type Rejection = { status: number; error: StudyApiErrorBody } | null;

const limitExceeded = (limit: StudyLimitName): Rejection => ({
    status: 422,
    error: { error: "LIMIT_EXCEEDED", limit },
});
const invalidRequest: Rejection = { status: 400, error: { error: "INVALID_REQUEST" } };

const utf8Bytes = (text: string): number => new TextEncoder().encode(text).length;

const hasExactKeys = (value: unknown, keys: readonly string[]): boolean => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
    const actual = Object.keys(value);
    return actual.length === keys.length && keys.every((key) => actual.includes(key));
};

/** 解析結果の検証（backend の zod スキーマと `assertAnalysisResult` に相当する部分）。 */
function validateResult(result: StudyAnalysisResult, limits: Record<StudyLimitName, number>) {
    const keys = ["runId", "completion", "depth", "nodes", "timeMs", "execution", "candidates"];
    if (!hasExactKeys(result, keys) || !UUID_V4.test(result.runId)) return invalidRequest;
    if (!Array.isArray(result.candidates) || result.candidates.length === 0) return invalidRequest;
    if (result.candidates.length > limits.multiPv) return limitExceeded("multiPv");
    const ranks = new Set<number>();
    for (const candidate of result.candidates) {
        if (!hasExactKeys(candidate, ["rank", "score", "depth", "seldepth", "pv"])) {
            return invalidRequest;
        }
        if (ranks.has(candidate.rank)) return invalidRequest;
        ranks.add(candidate.rank);
        if (candidate.pv.length > limits.pvLength) return limitExceeded("pvLength");
    }
    return ranks.has(1) ? null : invalidRequest;
}

/** 操作 1 つの検証（文書に依らない部分）。 */
function validateOp(op: StudyOp, limits: Record<StudyLimitName, number>): Rejection {
    switch (op.type) {
        case "setComment":
            return utf8Bytes(op.value) > limits.commentBytes ? limitExceeded("commentBytes") : null;
        case "setTitle":
            return Array.from(op.value).length > limits.titleLength
                ? limitExceeded("titleLength")
                : null;
        case "setSource":
            return op.value?.pv && op.value.pv.length > limits.pvLength
                ? limitExceeded("pvLength")
                : null;
        case "ensureLayer":
            if (typeof op.display?.label !== "string") return invalidRequest;
            if (utf8Bytes(JSON.stringify(op.display)) > limits.layerDisplayBytes) {
                return limitExceeded("layerDisplayBytes");
            }
            return op.spec.multiPv > limits.multiPv ? limitExceeded("multiPv") : null;
        case "putAnalysis":
            return validateResult(op.result, limits);
        default:
            return null;
    }
}

/** 適用後の文書が超えている上限（ノード数・手順の長さ・レイヤー数）。無ければ null。 */
function documentLimit(
    doc: Pick<StudyDocument, "tree" | "layers">,
    limits: Record<StudyLimitName, number>,
): StudyLimitName | null {
    const { nodes } = doc.tree;
    if (Object.keys(nodes).length > limits.nodesPerStudy) return "nodesPerStudy";
    if (doc.layers.length > limits.layersPerStudy) return "layersPerStudy";
    for (const node of Object.values(nodes)) {
        if (node.children.length > 0) continue;
        let depth = 0;
        for (let current = node; current.parentId !== null; current = nodes[current.parentId]) {
            depth++;
        }
        if (depth > limits.lineLength) return "lineLength";
    }
    return null;
}

/** 作成リクエストの検証。 */
function validateCreate(body: CreateStudyRequest, limits: Record<StudyLimitName, number>) {
    if (Array.from(body.title).length > limits.titleLength) return limitExceeded("titleLength");
    if (body.startSfen.split(" ").length !== 4) return invalidRequest;
    if (body.origin.kind === "paste" ? body.origin.ref !== null : !body.origin.ref) {
        return invalidRequest;
    }
    if (body.origin.ref !== null && body.origin.ref.length > 256) return invalidRequest;
    const layers = body.layers ?? [];
    const over = documentLimit(
        { tree: body.tree, layers: layers.map((l) => ({ ...l, id: "" })) },
        limits,
    );
    if (over) return limitExceeded(over);
    for (const node of Object.values(body.tree.nodes)) {
        if (utf8Bytes(node.comment) > limits.commentBytes) return limitExceeded("commentBytes");
        // 読み筋は USI の書式の手だけ。
        if (node.source?.pv?.some((move) => !USI_MOVE.test(move))) return invalidRequest;
    }
    const layerIds = new Set<string>();
    for (const layer of layers) {
        const id = studyLayerId(layer.spec);
        // 同じ spec のレイヤーが 2 つあれば入力不正。
        if (layerIds.has(id)) return invalidRequest;
        layerIds.add(id);
        for (const [nodeId, result] of Object.entries(layer.results)) {
            // ツリーに無いノードの結果は入力不正。
            if (!Object.hasOwn(body.tree.nodes, nodeId)) return invalidRequest;
            const rejected = validateResult(result, limits);
            if (rejected) return rejected;
        }
    }
    return null;
}

export function createFakeStudyServer(): FakeStudyServer {
    const studies = new Map<string, ServerStudy>();
    const calls: FakeServerCall[] = [];
    const once: Array<{ method: FakeServerCall["method"]; interception: Interception }> = [];
    const always: Array<{ method: FakeServerCall["method"] | "*"; interception: Interception }> =
        [];
    const limits: Record<StudyLimitName, number> = { ...STUDY_LIMITS };
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
        beforeHandle: null,
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
        forget(studyId) {
            studies.delete(studyId);
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
                if (server.beforeHandle) await server.beforeHandle({ method, studyId });
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
                // 未ログインは本文の検証より前に 401。ID は小文字の UUID v4 のみ（それ以外は 400）。
                const result =
                    userId === null
                        ? fail<T>(401, { error: "UNAUTHORIZED" })
                        : studyId !== null && !UUID_V4.test(studyId)
                          ? fail<T>(400, { error: "INVALID_REQUEST" })
                          : handle(userId);
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
                        const rejected = validateCreate(body, limits);
                        if (rejected) return fail(rejected.status, rejected.error);
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
                                layers: (body.layers ?? [])
                                    .map((layer) => ({
                                        // layerId はサーバーが spec から計算する。
                                        id: studyLayerId(layer.spec),
                                        ...structuredClone(layer),
                                    }))
                                    // レイヤーの並びは作成時刻・ID の順（一緒に作ると ID 順）。
                                    .sort((a, b) => (a.id < b.id ? -1 : 1)),
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
                            if (!UUID_V4.test(body.batchId)) {
                                return fail(400, { error: "INVALID_REQUEST" });
                            }
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
                            // 操作は配列の順に検証しながら適用し、1 つでも駄目なら全体を拒否する。
                            let next: StudyDocument = found.detail;
                            const layersBefore = found.detail.layers.map((layer) => layer.id);
                            for (const op of body.ops) {
                                const rejected = validateOp(op, limits);
                                if (rejected) return fail(rejected.status, rejected.error);
                                try {
                                    next = applyStudyOp(next, op);
                                } catch (error) {
                                    if (error instanceof StudyOpError) {
                                        return fail(400, {
                                            error: "INVALID_REQUEST",
                                            message: error.message,
                                        });
                                    }
                                    throw error;
                                }
                                const overLimit = documentLimit(next, limits);
                                if (overLimit) {
                                    return fail(422, { error: "LIMIT_EXCEEDED", limit: overLimit });
                                }
                            }
                            // このバッチで作ったレイヤーは作成時刻が同じなので、ID 順に並ぶ。
                            next = {
                                ...next,
                                layers: [
                                    // 同じバッチで消して作り直したレイヤーは、元の位置に戻る。
                                    ...next.layers
                                        .filter((layer) => layersBefore.includes(layer.id))
                                        .sort(
                                            (a, b) =>
                                                layersBefore.indexOf(a.id) -
                                                layersBefore.indexOf(b.id),
                                        ),
                                    ...next.layers
                                        .filter((layer) => !layersBefore.includes(layer.id))
                                        .sort((a, b) => (a.id < b.id ? -1 : 1)),
                                ],
                            };
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
export async function settle(rounds = 40): Promise<void> {
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
