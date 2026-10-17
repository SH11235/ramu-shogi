/**
 * 研究ノートの同期エンジン（設計書 7.1 / 7.2）。
 *
 * - 編集はまずローカルの保存層に書く（文書の更新と送信待ちへの追加は同じトランザクション）。
 * - 送信は間引く（既定 5 秒。`flush` で即時）。1 つのノートにつき送信中のバッチは 1 つ。
 * - ログイン中かつノートの持ち主がセッションのユーザーと一致するときだけ送る。
 * - 応答が届かなかったバッチは同じ `batchId` で再送する（サーバーが `replayed` を返す）。
 * - 409 のときは最新のノートを取得し、未送信の操作をその上に再適用して送り直す。
 * - 複数タブでは、送信役をロック（Web Locks）で 1 つにし、変更を他のタブへ通知する。
 *
 * 状態はすべて保存層にあり、このエンジンが持つのは表示用の写しとタイマーだけ。どのタブが
 * 送信役になっても続きから送れる。
 */

import { RATE_LIMITED_MESSAGE } from "@shogi/api-contract";
import {
    applyStudyOp,
    applyStudyOpsStrict,
    diffStudyDocuments,
    isStudyUuid,
    STUDY_LIMITS,
    type StudyDocument,
    type StudyLimitName,
    type StudyOp,
    studyChildNodeId,
    studyDocumentToOps,
    studyLayerId,
    studyOriginKey,
    validateStudyDocument,
} from "@shogi/app-core";
import type {
    CreateStudyRequest,
    StudyApi,
    StudyApiErrorBody,
    StudyApiResult,
    StudyDetail,
} from "./api-types";
import { deriveStudySaveStatus, isSameStudySaveStatus, type StudySaveStatus } from "./status";
import {
    type PendingStudyOp,
    STUDY_RECORD_VERSION,
    type StoredStudy,
    type StoredStudySummary,
    type StudyRemoteState,
    StudyStorageError,
    type StudyStorageErrorCode,
    type StudyStore,
    type StudyStoreSnapshot,
    type StudyStoreWrite,
    type StudyViewState,
} from "./store";

/** 送信役を 1 つにするためのロック。同じ名前の `request` は同時に 1 つしか実行されない。 */
export interface StudyLockManager {
    request<T>(name: string, task: () => Promise<T>): Promise<T>;
}

/** タブをまたいだ変更の通知。 */
export type StudyChannelMessage = { type: "changed"; studyId: string };

export interface StudyChannel {
    post(message: StudyChannelMessage): void;
    subscribe(handler: (message: StudyChannelMessage) => void): () => void;
    close(): void;
}

export interface StudyScheduler {
    setTimeout(callback: () => void, delayMs: number): unknown;
    clearTimeout(handle: unknown): void;
}

/** ログイン中のユーザー。 */
export interface StudySession {
    userId: string;
}

export type StudySyncEvent =
    /** 文書が変わった。`load` で読み直す。 */
    | { type: "document"; studyId: string; origin: "local" | "remote" | "other-tab" }
    /** 同じ元棋譜の既存ノートに統合された。画面は `into` のノートへ移る。 */
    | { type: "merged"; studyId: string; into: string }
    /** ノートがローカルから消えた。 */
    | { type: "removed"; studyId: string }
    /**
     * サーバーから見たログイン状態が、このエンジンに伝えられたものと違っていた（401 を受けた、
     * または送信の前後の確認でログアウト・別のアカウントへの切り替えが分かった）。
     * 受け取った側はログイン状態を取り直して `setSession` で伝え直し、再ログインを案内する。
     */
    | { type: "unauthorized" }
    /**
     * 開いたあとの最初の取り込みが済んだ（`getPullState` が `done` になった）。
     * 取り込んだ内容は、この通知より前に保存層へ書き終えている。
     */
    | { type: "pulled"; studyId: string };

/**
 * ノートを開いたあと、サーバーの最新の内容を取り込めたか。
 *
 * - `not_needed`: 取り込む相手がいない（匿名のノート、まだサーバーに作っていないノート、
 *   いまのアカウントから見えないノート）。ローカルの内容が最新。
 * - `pending`: まだ取り込めていない（取得の途中、オフライン、失敗、401 のあとの待機中）。
 *   ローカルの内容は、他の端末の変更を含んでいないかもしれない。
 * - `done`: 最後に `open` してから、サーバーの最新の内容を取り込んだ。
 */
export type StudyPullState = "not_needed" | "pending" | "done";

export type StudySyncErrorCode = "not_found" | "merged" | "already_exists";

export class StudySyncError extends Error {
    readonly code: StudySyncErrorCode;

    constructor(code: StudySyncErrorCode, message: string) {
        super(message);
        this.name = "StudySyncError";
        this.code = code;
    }
}

export type StudyOpenResult =
    | { status: "ok"; study: StoredStudy }
    /** 統合済み。`into` のノートを開く。 */
    | { status: "merged"; into: string }
    /** ローカルにもサーバーにも無い（未ログインでローカルに無い場合を含む）。 */
    | { status: "not_found" }
    /** ローカルに無く、サーバーにも問い合わせられなかった（オフラインなど）。 */
    | { status: "unavailable"; message: string };

export interface StudyLocalSummary extends StoredStudySummary {
    status: StudySaveStatus;
}

export interface StudySyncOptions {
    store: StudyStore;
    api: StudyApi;
    /** 既定はこのエンジンの中だけで直列化するロック。ブラウザでは Web Locks を渡す。 */
    locks?: StudyLockManager;
    /** 他のタブへの通知。無ければ通知しない。 */
    channel?: StudyChannel | null;
    scheduler?: StudyScheduler;
    now?: () => number;
    /** `batchId` の生成。既定は `crypto.randomUUID()`。 */
    randomId?: () => string;
    /**
     * サーバーから見た現在のログイン状態を取り直す（`/api/auth/session`）。
     * ノートをサーバーに作成する直前に呼び、ノートの持ち主と一致するときだけ作成する
     * （別のタブでアカウントが切り替わっていた場合に、別のアカウントへ作ってしまわないため）。
     * 削除が 404 だったときにも呼び、持ち主のままのときだけ削除済みとして扱う
     * （別のアカウントとして送った削除の 404 で、ローカルのノートを消してしまわないため）。
     * 未ログインなら null を返す。取得できなければ例外を投げる（あとで試し直す）。
     * 省略すると確認しない。
     */
    verifySession?: () => Promise<StudySession | null>;
    /** 送信の間引き（ミリ秒）。既定 5000。 */
    flushDelayMs?: number;
    /** 失敗時の再送の最初の間隔（ミリ秒）。既定 2000。失敗のたびに倍にする。 */
    retryBaseMs?: number;
    /** 再送の間隔の上限（ミリ秒）。既定 60000。 */
    retryMaxMs?: number;
}

export interface StudySync {
    /** ログイン状態を伝える。ログインしたら、そのアカウントのノートの送信を再開する。 */
    setSession(session: StudySession | null): void;
    getSession(): StudySession | null;
    /**
     * ログイン状態が分かっているか。`setSession` が一度も呼ばれていない間は `unknown`
     * （セッションの確認中）。`unknown` と `signed_out` の間は、匿名のノートだけが見える
     * （アカウントのノートは `load` / `open` / `listLocal` / `applyOps` に出てこない）。
     */
    getSessionStatus(): "unknown" | "signed_in" | "signed_out";
    /**
     * サーバーが 401 を返してから（セッション切れ）、`setSession` で伝え直されるまでの間か。
     * この間、`getSession` は 401 を受ける前のユーザーを返し続け、そのユーザーのノートは
     * ローカルでは読み書きできるが、サーバーへは送らない。画面は、これが true の間は
     * アカウントのノートの編集を止める（送れない編集を積み上げないため）。
     */
    isUnauthorized(): boolean;

    /**
     * 新しいノートをローカルに作る。持ち主は、ログイン中ならそのユーザー、未ログインなら匿名。
     * 同じ ID のノートが既にあれば `StudySyncError("already_exists")`。
     */
    createStudy(doc: StudyDocument): Promise<StoredStudy>;
    /**
     * ノートを開く。ローカルにあればそれを返し、裏でサーバーの変更を取り込む。
     * ローカルに無ければ（ログイン中なら）サーバーから取得して保存する。
     */
    open(studyId: string): Promise<StudyOpenResult>;
    /** 開いているノートの印を外す（`refreshOpen` の対象から外れる）。 */
    close(studyId: string): void;
    /**
     * ローカルのノートを読む（変更通知のあとの読み直し用）。無ければ null。
     * いまのアカウントのノートと匿名のノートだけを返す（それ以外は、あっても null）。
     */
    load(studyId: string): Promise<StoredStudy | null>;
    /**
     * 操作を適用する。ローカルに書き終えたら解決し、送信は間引いて裏で行う。
     * 何も変えない操作（対象が無い、既に同じ値、優先度が下の解析結果）は送信待ちに入れない。
     * 書き込みに失敗したら `StudyStorageError` で拒否する（保存の状態も「保存に失敗」になる）。
     *
     * いまのアカウントから見えないノート（別のアカウントのノート、ログアウト中・セッション確認中の
     * アカウントのノート）は、無いものとして `StudySyncError("not_found")` で拒否する。
     *
     * サーバーが受け付けない操作は、保存も送信待ちへの追加もせずに拒否する（1 つでもあれば全体）:
     * 上限超過は `StudyLimitError`（`limit` に上限の名前。例: `commentBytes`）、
     * 形として成り立たない入力は `StudyOpError`（どちらも `@shogi/app-core`）。
     */
    applyOps(studyId: string, ops: readonly StudyOp[]): Promise<StudyDocument>;
    /** 送信待ちをすぐ送る（解析の区切りなど）。省略時は全ノート。送信の試行が終わると解決する。 */
    flush(studyId?: string): Promise<void>;
    /** 上限超過・拒否で止まっている送信を、もう一度試す。 */
    retry(studyId: string): Promise<void>;
    /** サーバーの変更を取り込む。 */
    pull(studyId: string): Promise<void>;
    /**
     * ノートを開いたあと、サーバーの最新の内容を取り込めたか。`open` のたびに確かめ直す
     * （`open` は取り込みを待たずに返るので、ローカルの内容が最新かは、これで確かめる）。
     * `done` になったときに `pulled` のイベントを出す。
     */
    getPullState(studyId: string): StudyPullState;
    /** 開いているノートについて、サーバーの変更を取り込む（タブに戻ったとき）。 */
    refreshOpen(): Promise<void>;
    /**
     * ノートを削除する。クラウドにあるノートは、送れるようになったときにサーバーからも消す。
     * いまのアカウントから見えないノートは `StudySyncError("not_found")` で拒否する。
     */
    deleteStudy(studyId: string): Promise<void>;

    /**
     * 未ログイン中に作ったノート（匿名）の持ち主を、いまのアカウントに固定して送信を始める。
     * ログインして戻ってきたときに呼ぶ。引き継いだノートの ID を返す。
     */
    adoptAnonymousStudies(): Promise<string[]>;
    /**
     * ローカルのノートの一覧（更新が新しい順。統合済み・削除待ちは除く）。
     * いまのアカウントのノートと、匿名のノートだけを返す（未ログイン時は匿名のノートだけ）。
     */
    listLocal(): Promise<StudyLocalSummary[]>;
    /** 同じ元棋譜のローカルのノートを探す。無ければ null。 */
    findLocalByOrigin(origin: StudyDocument["origin"]): Promise<string | null>;

    /**
     * ノートの表示の状態（表示中のレイヤー、見ていた局面など）を読む。無ければ空のオブジェクト。
     * 同期しない、このブラウザだけの状態。
     */
    getViewState(studyId: string): Promise<StudyViewState>;
    /**
     * ノートの表示の状態に `patch` の項目を上書きして保存し、保存後の状態を返す。
     * 無いノート・削除したノート・いまのアカウントから見えないノートは
     * `StudySyncError("not_found")` で拒否する（行を作らない）。
     */
    setViewState(studyId: string, patch: StudyViewState): Promise<StudyViewState>;

    /** 保存の状態。内容が変わるまで同じ参照を返す（`useSyncExternalStore` で使える）。 */
    getStatus(studyId: string): StudySaveStatus;
    subscribeStatus(studyId: string, listener: () => void): () => void;
    subscribeEvents(listener: (event: StudySyncEvent) => void): () => void;

    /**
     * 進行中のローカルへの書き込みが終わるのを待つ。
     * ログインへ遷移する前（OAuth でページが遷移する前）に呼ぶ。
     */
    whenLocalWritesSettled(): Promise<void>;
    /** タイマーと通知の購読を止める（保存層は閉じない）。 */
    dispose(): void;
}

/** このエンジンの中だけで直列化するロック（Web Locks が無い環境とテスト用）。 */
export function createInProcessLockManager(): StudyLockManager {
    const tails = new Map<string, Promise<unknown>>();
    return {
        request<T>(name: string, task: () => Promise<T>): Promise<T> {
            const previous = tails.get(name) ?? Promise.resolve();
            const run = previous.then(task, task);
            const tail = run.catch(() => undefined);
            tails.set(name, tail);
            void tail.then(() => {
                if (tails.get(name) === tail) tails.delete(name);
            });
            return run;
        },
    };
}

const INITIAL_STATUS: StudySaveStatus = {
    state: "local",
    reason: null,
    pendingCount: 0,
    limit: null,
    retrying: false,
    message: null,
    lastSyncedAt: null,
};

/** 1 つのバッチの本文に使う上限。サーバーの上限（512 KiB）に対して余裕を持たせる。 */
const BATCH_BODY_BUDGET_BYTES = STUDY_LIMITS.opsBatchBytes - 32 * 1024;
/** 1 バッチに入れる解析結果の数の上限（サーバーの 1 リクエストの処理時間を抑えるため）。 */
const MAX_PUT_ANALYSIS_PER_BATCH = 20;
const MAX_SYNC_STEPS = 200;
/** 件数の上限などで拒否された作成を、自動で試し直すまでの間隔。 */
const CREATE_RETRY_INTERVAL_MS = 10 * 60 * 1000;
const MAX_CONFLICTS_PER_RUN = 3;
const OTHER_TAB_REFRESH_DELAY_MS = 250;

const lockName = (studyId: string): string => `ramu-study-sync:${studyId}`;

const isTransient = (status: number): boolean =>
    status === 0 || status === 408 || status === 429 || status >= 500;

const describeError = (status: number, error: StudyApiErrorBody): string =>
    status === 429 ? RATE_LIMITED_MESSAGE : (error.message ?? error.error ?? `HTTP ${status}`);

const toDocument = (detail: StudyDetail): StudyDocument => ({
    id: detail.id,
    title: detail.title,
    origin: detail.origin,
    startSfen: detail.startSfen,
    rules: detail.rules,
    meta: detail.meta,
    tree: detail.tree,
    layers: detail.layers,
});

/**
 * 作成リクエスト。ツリー（と対局時の評価値、メタ情報）だけを送り、解析レイヤーと結果は送らない
 * （結果つきの作成はサーバーの 1 リクエストの処理時間が長くなるため）。レイヤーと結果は、
 * 作成のあとに操作バッチ（`ensureLayer` + `putAnalysis` を少しずつ）で送る。
 */
const toCreateRequest = (doc: StudyDocument): CreateStudyRequest => ({
    id: doc.id,
    title: doc.title,
    origin: doc.origin,
    startSfen: doc.startSfen,
    rules: doc.rules,
    meta: doc.meta,
    tree: doc.tree,
    layers: [],
});

/** 文書が、ローカルの検証（作成 API と同じ規則）を通るか。 */
const isLocallyValid = (doc: StudyDocument): boolean => {
    try {
        validateStudyDocument(doc);
        return true;
    } catch {
        return false;
    }
};

/**
 * 操作を順に適用し、文書を実際に変えた操作だけを残す。
 *
 * 並べ替えは、利用者が作ったときの並び（意図）のまま残す。当て直したあとの完全な並びに
 * 書き直すと、次に当て直すとき、その間に他の端末が並べ替えた兄弟の順まで上書きしてしまう。
 * 作ったときより子が増減していても、サーバーは同じ規則（`applyStudyOp` の reorderChildren）で
 * 並べるので、結果は手元と一致する。
 */
const applyEffectiveOps = (
    doc: StudyDocument,
    ops: readonly StudyOp[],
): { doc: StudyDocument; effective: StudyOp[] } => {
    let next = doc;
    const effective: StudyOp[] = [];
    for (const op of ops) {
        const applied = applyStudyOp(next, op);
        if (applied !== next) {
            effective.push(op);
            next = applied;
        }
    }
    return { doc: next, effective };
};

const lastSeqOf = (pending: readonly PendingStudyOp[]): number =>
    pending.length > 0 ? pending[pending.length - 1].seq : 0;

interface Entry {
    study: Pick<
        StoredStudy,
        "owner" | "serverRevision" | "remote" | "lastSyncedAt" | "deleting"
    > | null;
    /** 保存層から一度でも読んだか（読む前の `getStatus` は裏で読みに行く）。 */
    hydrated: boolean;
    pendingCount: number;
    status: StudySaveStatus;
    storageError: StudyStorageErrorCode | null;
    retrying: boolean;
    message: string | null;
    attempt: number;
    timer: unknown;
    timerAt: number;
    running: Promise<void> | null;
    rerun: boolean;
    force: boolean;
    writeChain: Promise<unknown>;
    viewChain: Promise<unknown>;
    listeners: Set<() => void>;
    open: boolean;
    /** 最後に `open` してから、サーバーの最新の内容を取り込んだか。 */
    pulled: boolean;
    /**
     * `pulled` を確かめ直すたびに進む番号。確かめ直す前に始めた取得が、あとから届いて
     * 「取り込み済み」にしてしまわないようにする。
     */
    pullEpoch: number;
    refreshTimer: unknown;
}

/** `hold`: 同じユーザーで 401 が続いているので、間隔が空くまで待っている（予約済み）。 */
type StepOutcome = "continue" | "done" | "retry" | "hold";

export function createStudySync(options: StudySyncOptions): StudySync {
    const { store } = options;
    const locks = options.locks ?? createInProcessLockManager();
    const channel = options.channel ?? null;
    const scheduler: StudyScheduler = options.scheduler ?? {
        setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
        clearTimeout: (handle) =>
            globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
    };
    const now = options.now ?? (() => Date.now());
    const randomId = options.randomId ?? (() => crypto.randomUUID());
    const flushDelayMs = options.flushDelayMs ?? 5000;
    const retryBaseMs = options.retryBaseMs ?? 2000;
    const retryMaxMs = options.retryMaxMs ?? 60_000;

    let session: StudySession | null = null;
    /** `setSession` が呼ばれたか（呼ばれるまではセッションの確認中）。 */
    let sessionKnown = false;
    let unauthorized = false;
    /**
     * 同じユーザーのまま 401 が続いている回数。応答が成功したとき・別のユーザーになったときに
     * 0 に戻る。
     */
    let authFailures = 0;
    /**
     * この時刻までは、サーバーへ送らない。
     *
     * 401 を受けてセッションを取り直した結果が同じユーザーだった（セッションは有効と言われるのに
     * API は 401 を返す。サーバー側の障害など）ときは、すぐに送り直さず、他の失敗と同じ間隔の
     * 空け方（最初の間隔から倍々、上限あり）で送り直す。待ち時間なしで再送を回し続けて、
     * 障害時の負荷を増やさないため。
     */
    let authHoldUntil = 0;
    /** 待機が明けたときに、開いているノートの取り込みをやり直すためのタイマー。 */
    let authResumeTimer: unknown = null;
    let disposed = false;

    /** 応答が成功したら、401 の続いた回数を忘れる（通常の送り方に戻る）。 */
    const noteResponse = <T extends { ok: boolean }>(response: T): T => {
        if (response.ok) {
            authFailures = 0;
            authHoldUntil = 0;
        }
        return response;
    };
    const api: StudyApi = {
        list: (...args) => options.api.list(...args).then(noteResponse),
        create: (...args) => options.api.create(...args).then(noteResponse),
        get: (...args) => options.api.get(...args).then(noteResponse),
        postOps: (...args) => options.api.postOps(...args).then(noteResponse),
        delete: (...args) => options.api.delete(...args).then(noteResponse),
        limits: (...args) => options.api.limits(...args).then(noteResponse),
    };
    const entries = new Map<string, Entry>();
    const eventListeners = new Set<(event: StudySyncEvent) => void>();
    const localWrites = new Set<Promise<unknown>>();

    const entryOf = (studyId: string): Entry => {
        let entry = entries.get(studyId);
        if (!entry) {
            entry = {
                study: null,
                hydrated: false,
                pendingCount: 0,
                status: INITIAL_STATUS,
                storageError: null,
                retrying: false,
                message: null,
                attempt: 0,
                timer: null,
                timerAt: 0,
                running: null,
                rerun: false,
                force: false,
                writeChain: Promise.resolve(),
                viewChain: Promise.resolve(),
                listeners: new Set(),
                open: false,
                pulled: false,
                pullEpoch: 0,
                refreshTimer: null,
            };
            entries.set(studyId, entry);
        }
        return entry;
    };

    const emit = (event: StudySyncEvent): void => {
        for (const listener of [...eventListeners]) listener(event);
    };

    const statusOf = (
        entry: Pick<Entry, "study" | "pendingCount" | "storageError" | "retrying" | "message">,
    ): StudySaveStatus =>
        deriveStudySaveStatus({
            study: entry.study,
            pendingCount: entry.pendingCount,
            sessionUserId: session?.userId ?? null,
            unauthorized,
            storageError: entry.storageError,
            retrying: entry.retrying,
            message: entry.message,
        });

    const refreshStatus = (studyId: string): void => {
        const entry = entryOf(studyId);
        const next = statusOf(entry);
        if (isSameStudySaveStatus(entry.status, next)) return;
        entry.status = next;
        for (const listener of [...entry.listeners]) listener();
    };

    /** 保存層から読んだ状態を、表示用の写しに反映する。 */
    const observe = (studyId: string, study: StoredStudy | null, pendingCount: number): void => {
        const entry = entryOf(studyId);
        entry.study = study
            ? {
                  owner: study.owner,
                  serverRevision: study.serverRevision,
                  remote: study.remote,
                  lastSyncedAt: study.lastSyncedAt,
                  deleting: study.deleting,
              }
            : null;
        entry.hydrated = true;
        entry.pendingCount = study ? pendingCount : 0;
        refreshStatus(studyId);
    };

    /** 保存層に書き、書いたあとの状態を写しに反映し、他のタブへ知らせる。 */
    const mutate = async <T>(
        studyId: string,
        fn: (snapshot: StudyStoreSnapshot) => StudyStoreWrite<T>,
    ): Promise<T> => {
        let after: { study: StoredStudy | null; pendingCount: number; wrote: boolean } | null =
            null;
        const result = await store.transact(studyId, (snapshot) => {
            const write = fn(snapshot);
            const study = write.study === undefined ? snapshot.study : write.study;
            const removeUpTo = write.removeOpsUpTo;
            const remaining =
                removeUpTo === undefined
                    ? snapshot.pending.length
                    : snapshot.pending.filter((item) => item.seq > removeUpTo).length;
            const appended = write.appendOps?.length ?? 0;
            after = {
                study,
                pendingCount: study ? remaining + appended : 0,
                wrote: write.study !== undefined || removeUpTo !== undefined || appended > 0,
            };
            return write;
        });
        const written = after as {
            study: StoredStudy | null;
            pendingCount: number;
            wrote: boolean;
        } | null;
        if (written) {
            observe(studyId, written.study, written.pendingCount);
            if (written.wrote) channel?.post({ type: "changed", studyId });
        }
        return result;
    };

    const canSend = (study: Pick<StoredStudy, "owner">): boolean =>
        session !== null && !unauthorized && study.owner === session.userId;

    /** いまのセッションから見えるノートか（自分のノートか、匿名のノート）。 */
    const isVisible = (study: Pick<StoredStudy, "owner">): boolean =>
        study.owner === null || study.owner === (session?.userId ?? null);

    /** メモリ上の表示の状態（保存層が対応していないときの受け皿）。 */
    const fallbackViewStates = new Map<string, StudyViewState>();

    const markUnauthorized = (): void => {
        if (unauthorized) return;
        unauthorized = true;
        authFailures += 1;
        for (const studyId of entries.keys()) refreshStatus(studyId);
        emit({ type: "unauthorized" });
    };

    /**
     * サーバーから見たログイン状態（`verifySession` の結果）が、ノートの持ち主か。
     *
     * 違っていたら（別のタブでログアウトした・別のアカウントに切り替えた）、以後はサーバーから
     * 見たログイン状態に合わせ（保存の状態は `other_account` / `signed_out` になる）、画面にも
     * ログイン状態の取り直しを促す。知らせないと、画面は前の利用者のまま編集できる表示を続け、
     * 編集は「見えないノート」として拒否され続ける。
     */
    const isVerifiedOwner = (verified: StudySession | null, owner: string | null): boolean => {
        if ((verified?.userId ?? null) === owner) return true;
        if ((verified?.userId ?? null) !== (session?.userId ?? null)) {
            // `setSession` で別のユーザーに変わったときと同じ扱い。
            authFailures = 0;
            authHoldUntil = 0;
            for (const entry of entries.values()) {
                entry.pulled = false;
                entry.pullEpoch += 1;
            }
        }
        session = verified ? { userId: verified.userId } : null;
        unauthorized = false;
        for (const id of entries.keys()) refreshStatus(id);
        emit({ type: "unauthorized" });
        return false;
    };

    const setRemote = (
        studyId: string,
        remote: (lastSeq: number, study: StoredStudy) => StudyRemoteState,
    ) =>
        mutate(studyId, (snapshot) => {
            if (!snapshot.study) return { result: undefined };
            return {
                study: {
                    ...snapshot.study,
                    remote: remote(lastSeqOf(snapshot.pending), snapshot.study),
                    inflight: null,
                },
                result: undefined,
            };
        });

    /**
     * 取得・作成・送信に共通の失敗の扱い。
     * `bodyLimit` は、本文が大きすぎた（413）ときに超えた上限の名前。
     */
    const handleFailure = async (
        studyId: string,
        failure: { status: number; error: StudyApiErrorBody },
        bodyLimit: StudyLimitName = "opsBatchBytes",
    ): Promise<StepOutcome> => {
        const { status, error } = failure;
        const entry = entryOf(studyId);
        if (status === 401) {
            markUnauthorized();
            return "done";
        }
        if (status === 410) {
            await setRemote(studyId, () => ({ state: "deleted" }));
            return "done";
        }
        if (status === 413) {
            await setRemote(studyId, (atSeq, study) => ({
                state: "limit_exceeded",
                limit: bodyLimit,
                atSeq,
                locallyValid: isLocallyValid(study.doc),
                rejectedAt: now(),
            }));
            return "done";
        }
        if (status === 422) {
            await setRemote(studyId, (atSeq, study) => ({
                state: "limit_exceeded",
                limit: error.limit ?? "unknown",
                atSeq,
                locallyValid: isLocallyValid(study.doc),
                rejectedAt: now(),
            }));
            return "done";
        }
        if (isTransient(status)) {
            entry.message = describeError(status, error);
            return "retry";
        }
        // 400（入力不正）、403（`ORIGIN_FORBIDDEN`）、409 `ID_CONFLICT` など、同じ内容を
        // 送り直しても通らない失敗。再送を止めて「保存に失敗」にする。送信待ちの操作は残す。
        await setRemote(studyId, (atSeq, study) => ({
            state: "rejected",
            code: error.error ?? `HTTP_${status}`,
            message: describeError(status, error),
            atSeq,
            locallyValid: isLocallyValid(study.doc),
        }));
        return "done";
    };

    const newStoredStudy = (
        doc: StudyDocument,
        owner: string | null,
        serverRevision: number | null,
    ): StoredStudy => {
        const timestamp = now();
        return {
            recordVersion: STUDY_RECORD_VERSION,
            id: doc.id,
            owner,
            doc,
            serverRevision,
            inflight: null,
            remote: { state: "ok" },
            mergedInto: null,
            deleting: false,
            originKey: studyOriginKey(doc.origin.kind, doc.origin.ref),
            createdAt: timestamp,
            updatedAt: timestamp,
            lastSyncedAt: serverRevision === null ? null : timestamp,
        };
    };

    /**
     * サーバーの文書の上に、未送信の操作を再適用する。
     * サーバーの文書を変えない操作（既に反映済みなど）は送信待ちから落とす。
     */
    const rebaseOnto = async (
        studyId: string,
        detail: StudyDetail,
        /**
         * 送信待ちに無いローカルの成果（作成時に送らなかったレイヤーと結果など）も、
         * サーバーの文書に足す操作として送信待ちに積む（消す操作は作らない）。
         */
        keepLocalDocument = false,
    ): Promise<boolean> => {
        const changed = await mutate(studyId, (snapshot) => {
            if (!snapshot.study) return { result: false };
            const rebased = applyEffectiveOps(
                toDocument(detail),
                snapshot.pending.map((item) => item.op),
            );
            const extra = keepLocalDocument
                ? applyEffectiveOps(
                      rebased.doc,
                      studyDocumentToOps(snapshot.study.doc, { mergeInto: rebased.doc }),
                  )
                : { doc: rebased.doc, effective: [] };
            const doc = extra.doc;
            const effective = [...rebased.effective, ...extra.effective];
            return {
                study: {
                    ...snapshot.study,
                    doc,
                    serverRevision: detail.revision,
                    inflight: null,
                    updatedAt: now(),
                    lastSyncedAt: effective.length === 0 ? now() : snapshot.study.lastSyncedAt,
                },
                removeOpsUpTo: lastSeqOf(snapshot.pending),
                appendOps: effective,
                result: true,
            };
        });
        if (changed) emit({ type: "document", studyId, origin: "remote" });
        return changed;
    };

    /** 同じ元棋譜の既存ノートに、手元の成果を操作として統合する（設計書 7.2 の 4）。 */
    const mergeInto = async (study: StoredStudy, existingStudyId: string): Promise<StepOutcome> => {
        const fetched = await api.get(existingStudyId);
        if (!fetched.ok) {
            if (fetched.status === 401) {
                markUnauthorized();
                return "done";
            }
            if (isTransient(fetched.status)) {
                entryOf(study.id).message = describeError(fetched.status, fetched.error);
                return "retry";
            }
            await setRemote(study.id, (atSeq) => ({
                state: "rejected",
                code: "ORIGIN_EXISTS",
                message: "同じ棋譜の既存の研究ノートを取得できませんでした",
                atSeq,
            }));
            return "done";
        }
        const target = fetched.data.study;
        if (target.startSfen !== study.doc.startSfen) {
            await setRemote(study.id, (atSeq) => ({
                state: "rejected",
                code: "ORIGIN_MISMATCH",
                message: "同じ棋譜の既存の研究ノートと開始局面が一致しません",
                atSeq,
            }));
            return "done";
        }
        // まず元のノートを「統合済み（取り込み待ち）」にする。この 1 トランザクション以降、
        // 元のノートへの編集は拒否されるので、取り込みから漏れる編集は生まれない。
        // それより前に保存された編集は、元のノートの文書に入っている（下で読み直す）。
        await mutate(study.id, (snapshot) => {
            if (!snapshot.study) return { result: undefined };
            return {
                study: {
                    ...snapshot.study,
                    mergedInto: existingStudyId,
                    mergePending: true,
                    inflight: null,
                    updatedAt: now(),
                },
                removeOpsUpTo: lastSeqOf(snapshot.pending),
                result: undefined,
            };
        });
        emit({ type: "merged", studyId: study.id, into: existingStudyId });
        return finishMerge(study.id, existingStudyId, target);
    };

    /**
     * 統合済みにした元のノートの成果を、統合先に操作として積む。
     * 元のノートの最新の文書から作るので、途中で閉じられてもやり直せる（操作は冪等）。
     */
    const finishMerge = async (
        studyId: string,
        targetId: string,
        fetchedTarget: StudyDetail | null,
    ): Promise<StepOutcome> => {
        const source = (await store.read(studyId)).study;
        if (!source) return "done";
        let target = fetchedTarget;
        if (target === null && (await store.read(targetId)).study === null) {
            const fetched = await api.get(targetId);
            if (!fetched.ok) {
                if (fetched.status === 401) {
                    markUnauthorized();
                    return "done";
                }
                entryOf(studyId).message = describeError(fetched.status, fetched.error);
                return "retry";
            }
            target = fetched.data.study;
        }
        const seed = target;
        const applied = await mutate(targetId, (snapshot) => {
            const base =
                snapshot.study ??
                (seed ? newStoredStudy(toDocument(seed), source.owner, seed.revision) : null);
            if (!base) return { result: false };
            // 同じノードの両方にコメントがあれば、統合先のコメントを消さずにつなぐ。
            const ops = studyDocumentToOps(source.doc, { mergeInto: base.doc });
            const { doc, effective } = applyEffectiveOps(base.doc, ops);
            return {
                study: { ...base, doc, updatedAt: now() },
                appendOps: effective,
                result: true,
            };
        });
        if (!applied) return "retry";
        await mutate(studyId, (snapshot) =>
            snapshot.study
                ? { study: { ...snapshot.study, mergePending: false }, result: undefined }
                : { result: undefined },
        );
        emit({ type: "document", studyId: targetId, origin: "local" });
        schedule(targetId, 0);
        return "done";
    };

    const createRemote = async (
        study: StoredStudy,
        run: { conflicts: number; recreated: boolean },
    ): Promise<StepOutcome> => {
        if (options.verifySession) {
            // 別のタブでアカウントが切り替わっていないか、作成の直前に確かめる。
            let verified: StudySession | null;
            try {
                verified = await options.verifySession();
            } catch (error) {
                entryOf(study.id).message = error instanceof Error ? error.message : String(error);
                return "retry";
            }
            // 持ち主でなければ送らない。
            if (!isVerifiedOwner(verified, study.owner)) return "done";
        }
        const sentDoc = study.doc;
        const response = await api.create(toCreateRequest(sentDoc));
        if (response.ok && response.data.existing) {
            // 同じ ID のノートが既にある（作成の応答が届かなかった再送など）。サーバーの中身は
            // 分からない（他の端末が変えているかもしれない）ので、最新の文書を取得し、
            // 未送信の操作をその上に再適用してから続ける（409 のときと同じ）。
            const fetched = await api.get(study.id);
            if (!fetched.ok) return handleGetFailure(study.id, fetched, run);
            await rebaseOnto(study.id, fetched.data.study, true);
            return "continue";
        }
        if (response.ok) {
            const { revision } = response.data;
            await mutate(study.id, (snapshot) => {
                if (!snapshot.study) return { result: undefined };
                // サーバーにできたのは、送ったツリーだけのノート（レイヤーなし）。そこから
                // いまのローカルの文書までの差分（レイヤーと結果、送信後の編集）を送信待ちにする。
                // これが全部受理されるまで、保存の状態は「送信待ち」のまま。
                const created: StudyDocument = { ...sentDoc, layers: [] };
                const { effective } = applyEffectiveOps(
                    created,
                    diffStudyDocuments(created, snapshot.study.doc),
                );
                return {
                    study: {
                        ...snapshot.study,
                        serverRevision: revision,
                        inflight: null,
                        remote: { state: "ok" },
                        lastSyncedAt: effective.length === 0 ? now() : snapshot.study.lastSyncedAt,
                    },
                    removeOpsUpTo: lastSeqOf(snapshot.pending),
                    appendOps: effective,
                    result: undefined,
                };
            });
            return "continue";
        }
        if (response.status === 409 && response.error.error === "ORIGIN_EXISTS") {
            const existingStudyId = response.error.existingStudyId;
            if (isStudyUuid(existingStudyId) && existingStudyId !== study.id) {
                return mergeInto(study, existingStudyId);
            }
        }
        // 作成 API が無い（backend 未接続）場合は、あとで試し直す。
        if (response.status === 404) {
            entryOf(study.id).message = describeError(response.status, response.error);
            return "retry";
        }
        return handleFailure(study.id, response, "createBodyBytes");
    };

    /** 送信待ちの先頭から、1 バッチに入れる操作の最後の連番を決める。 */
    const pickBatchLastSeq = (pending: readonly PendingStudyOp[]): number => {
        const encoder = new TextEncoder();
        let bytes = 0;
        let analyses = 0;
        let newLayers = 0;
        const deletedLayerIds = new Set<string>();
        let count = 0;
        for (let i = 0; i < pending.length && i < STUDY_LIMITS.opsPerBatch; i++) {
            const { op } = pending[i];
            bytes += encoder.encode(JSON.stringify(op)).length + 1;
            if (op.type === "putAnalysis") analyses += 1;
            if (op.type === "ensureLayer") newLayers += 1;
            // 消したレイヤーと同じ spec のレイヤーを作り直す操作は、次のバッチに回す。同じバッチだと
            // サーバーは元の位置に戻し、ローカル（末尾に足す）と並びがずれる。
            if (op.type === "ensureLayer" && deletedLayerIds.has(studyLayerId(op.spec))) break;
            if (op.type === "deleteLayer") deletedLayerIds.add(op.layerId);
            // 1 つ目は大きくても入れる（入れなければ永久に送れない。超過はサーバーが 413 で返す）。
            if (i > 0 && bytes > BATCH_BODY_BUDGET_BYTES) break;
            // 解析結果は 1 バッチ 20 件まで（残りは次のバッチで、間引きを待たずに続けて送る）。
            if (analyses > MAX_PUT_ANALYSIS_PER_BATCH) break;
            // レイヤーの作成は 1 バッチ 1 つまで。サーバーはレイヤーを作成時刻・ID の順に並べるので、
            // 同じバッチで 2 つ作ると（作成時刻が同じになり）ローカルの追加順と並びがずれる。
            if (newLayers > 1) break;
            count = i + 1;
        }
        // ノードを足す操作と、そのノードにしおりを付ける操作は同じバッチに入れる。ノードは
        // 「しおりなし」で作られ、しおりを付けると JSON が 1 バイト短くなるので、間で切ると
        // 上限ちょうどのツリーが 1 バイトだけ上限を超えて拒否されうる。
        if (count > 1 && count < pending.length) {
            const last = pending[count - 1].op;
            const next = pending[count].op;
            if (
                last.type === "addMoves" &&
                next.type === "setBookmark" &&
                next.value &&
                next.nodeId === last.moves.reduce(studyChildNodeId, last.parentId)
            ) {
                count -= 1;
            }
        }
        return pending[Math.max(count, 1) - 1].seq;
    };

    const sendBatch = async (
        study: StoredStudy,
        pending: readonly PendingStudyOp[],
        run: { conflicts: number; recreated: boolean },
    ): Promise<StepOutcome> => {
        const studyId = study.id;
        const revision = study.serverRevision as number;
        let inflight = study.inflight;
        if (inflight && !pending.some((item) => item.seq <= (inflight?.lastSeq ?? 0))) {
            inflight = null;
        }
        if (!inflight) {
            const batch = {
                batchId: randomId(),
                expectedRevision: revision,
                lastSeq: pickBatchLastSeq(pending),
            };
            // 送る前に記録する。応答が届かなくても、同じ batchId・同じ操作で送り直せる。
            await mutate(studyId, (snapshot) =>
                snapshot.study
                    ? { study: { ...snapshot.study, inflight: batch }, result: undefined }
                    : { result: undefined },
            );
            inflight = batch;
        }
        const batchLastSeq = inflight.lastSeq;
        const ops = pending.filter((item) => item.seq <= batchLastSeq).map((item) => item.op);
        const response = await api.postOps(studyId, {
            batchId: inflight.batchId,
            expectedRevision: inflight.expectedRevision,
            ops,
        });
        if (response.ok) {
            // `replayed: true`（応答が届かなかった再送）も受理済みとして扱う。
            const accepted = response.data.revision;
            await mutate(studyId, (snapshot) => {
                if (!snapshot.study) return { result: undefined };
                return {
                    study: {
                        ...snapshot.study,
                        serverRevision: Math.max(snapshot.study.serverRevision ?? 0, accepted),
                        inflight: null,
                        remote: { state: "ok" },
                        lastSyncedAt: now(),
                    },
                    removeOpsUpTo: batchLastSeq,
                    result: undefined,
                };
            });
            return "continue";
        }
        if (response.status === 409) {
            run.conflicts += 1;
            if (run.conflicts > MAX_CONFLICTS_PER_RUN) {
                entryOf(studyId).message = "他の端末の変更との競合が続いています";
                return "retry";
            }
            const fetched = await api.get(studyId);
            if (fetched.ok) {
                await rebaseOnto(studyId, fetched.data.study);
                return "continue";
            }
            return handleGetFailure(studyId, fetched, run);
        }
        if (response.status === 404) {
            return handleMissing(studyId, run);
        }
        return handleFailure(studyId, response);
    };

    /** サーバーに無い（404）。ローカルの成果から作り直す。繰り返すなら拒否として止める。 */
    const handleMissing = async (
        studyId: string,
        run: { recreated: boolean },
    ): Promise<StepOutcome> => {
        if (run.recreated) {
            await setRemote(studyId, (atSeq) => ({
                state: "rejected",
                code: "NOT_FOUND",
                message: "サーバーに研究ノートが見つかりません",
                atSeq,
            }));
            return "done";
        }
        run.recreated = true;
        await mutate(studyId, (snapshot) =>
            snapshot.study
                ? {
                      study: { ...snapshot.study, serverRevision: null, inflight: null },
                      result: undefined,
                  }
                : { result: undefined },
        );
        return "continue";
    };

    const handleGetFailure = (
        studyId: string,
        failure: Extract<StudyApiResult<unknown>, { ok: false }>,
        run: { recreated: boolean },
    ): Promise<StepOutcome> =>
        failure.status === 404 ? handleMissing(studyId, run) : handleFailure(studyId, failure);

    /**
     * サーバーに操作を拒否された（上限超過・入力不正）あとの復帰。
     * サーバーの最新の文書を取得し、その上に送信待ちを再適用した文書を新しいローカルの文書とし、
     * 送信待ちを「サーバーの文書 → その文書」の差分で置き換える。利用者がローカルで超過を
     * 解消していれば（短く直す、枝を消すなどの操作が送信待ちにあれば）、次の送信で通る。
     */
    const rebuildPending = async (
        studyId: string,
        run: { recreated: boolean },
    ): Promise<StepOutcome> => {
        const fetched = await api.get(studyId);
        if (!fetched.ok) return handleGetFailure(studyId, fetched, run);
        const detail = fetched.data.study;
        const changed = await mutate(studyId, (snapshot) => {
            if (!snapshot.study) return { result: false };
            const serverDoc = toDocument(detail);
            // まず送信待ちをサーバーの最新の文書に再適用する（他の端末の変更は残る。サーバー側が
            // 優先度で勝つ解析結果はサーバーのものになる）。その結果とサーバーの文書の差分に
            // 畳むことで、拒否された途中の操作（長すぎたコメントなど）を引きずらずに、最終的な
            // 状態だけを送る。ローカルに無いことを理由にした削除は作らない: 削除になるのは、
            // 送信待ちに明示的な削除の操作があるものだけ。
            const pendingOps = snapshot.pending.map((item) => item.op);
            const rebased = applyEffectiveOps(serverDoc, pendingOps);
            // 送信待ちの中の明示的な削除（サーバーの文書に対象があるもの）は、差分に畳まずに
            // 先頭でそのまま送る。「消して同じものを作り直す」操作（大きくなりすぎたレイヤーの
            // 結果を消して作り直す、枝を消して同じ手順で作り直す）は、再適用後の文書に同じ ID が
            // 残るので、差分だけでは削除が消えて旧い結果や表示名が戻ってしまうため。
            const explicitDeletes = applyEffectiveOps(
                serverDoc,
                pendingOps.filter(
                    (op) =>
                        (op.type === "deleteLayer" &&
                            serverDoc.layers.some((layer) => layer.id === op.layerId)) ||
                        (op.type === "deleteSubtree" &&
                            op.nodeId !== serverDoc.tree.rootId &&
                            Object.hasOwn(serverDoc.tree.nodes, op.nodeId)),
                ),
            );
            // 残りは「サーバーの文書にその削除を適用した文書 → 再適用後の文書」の差分。
            const { doc, effective } = applyEffectiveOps(serverDoc, [
                ...explicitDeletes.effective,
                ...diffStudyDocuments(explicitDeletes.doc, rebased.doc),
            ]);
            return {
                study: {
                    ...snapshot.study,
                    doc,
                    serverRevision: detail.revision,
                    inflight: null,
                    remote: { state: "ok" },
                    updatedAt: now(),
                },
                removeOpsUpTo: lastSeqOf(snapshot.pending),
                appendOps: effective,
                result: true,
            };
        });
        if (changed) emit({ type: "document", studyId, origin: "remote" });
        return "continue";
    };

    const deleteRemote = async (study: StoredStudy): Promise<StepOutcome> => {
        const studyId = study.id;
        const response = await api.delete(studyId);
        if (!response.ok && response.status === 404 && options.verifySession) {
            // 404 は「既に無い」だけでなく「いまのセッションのノートではない」でも返る。別のタブで
            // アカウントが切り替わっていたら、持ち主のノートはサーバーに残っている。その場合は
            // ローカルのレコードを消さず、削除待ちのまま残す（持ち主でログインし直したときに送り直す）。
            let verified: StudySession | null;
            try {
                verified = await options.verifySession();
            } catch (error) {
                entryOf(studyId).message = error instanceof Error ? error.message : String(error);
                return "retry";
            }
            if (!isVerifiedOwner(verified, study.owner)) return "done";
        }
        if (response.ok || response.status === 404 || response.status === 410) {
            await mutate(studyId, () => ({ study: null, result: undefined }));
            emit({ type: "removed", studyId });
            return "done";
        }
        if (response.status === 401) {
            markUnauthorized();
            return "done";
        }
        entryOf(studyId).message = describeError(response.status, response.error);
        return "retry";
    };

    /**
     * 作成が拒否された（上限超過・入力不正）ノートの作成を、明示の再試行なしで送り直してよいか。
     * - 拒否の時点でローカルの検証が通っていなかった（内容に問題がある）場合:
     *   検証が通るようになったとき（内容の問題が直ったとき）だけ。
     * - ローカルでは判定できない上限（ノートの件数など）の場合: 一定の間隔を空けてから。
     * - それ以外（ローカルの検証は通るのに入力不正で拒否された）: 明示の再試行だけ。
     */
    const shouldRetryCreate = (study: StoredStudy): boolean => {
        const { remote } = study;
        if (remote.state !== "limit_exceeded" && remote.state !== "rejected") return true;
        if (remote.locallyValid === false) return isLocallyValid(study.doc);
        if (remote.state === "limit_exceeded" && remote.rejectedAt !== undefined) {
            return now() - remote.rejectedAt >= CREATE_RETRY_INTERVAL_MS;
        }
        return false;
    };

    /** ロックの中で、送れるものが無くなるまで送る。 */
    const syncLocked = async (studyId: string, force: boolean): Promise<StepOutcome> => {
        const run = { conflicts: 0, recreated: false };
        let forced = force;
        for (let step = 0; step < MAX_SYNC_STEPS; step++) {
            const { study, pending } = await store.read(studyId);
            observe(studyId, study, pending.length);
            if (!study) return "done";
            if (study.mergedInto !== null) {
                // 統合先への取り込みが途中なら、続きを行う。
                if (study.mergePending && canSend(study)) {
                    return finishMerge(studyId, study.mergedInto, null);
                }
                return "done";
            }
            if (!canSend(study)) return "done";
            // 同じユーザーで 401 が続いている間は、間隔が空くまで送らない。
            const authHoldMs = authHoldUntil - now();
            if (authHoldMs > 0) {
                schedule(studyId, authHoldMs);
                // 送るものがあるのに待っているときだけ、待っていることを状態に出す。
                return pending.length > 0 || study.serverRevision === null ? "hold" : "done";
            }
            if (study.deleting) return deleteRemote(study);
            if (study.remote.state === "deleted") return "done";
            if (study.remote.state === "limit_exceeded" || study.remote.state === "rejected") {
                // 同じ内容を送り直しても通らない。新しい操作が積まれるか、明示の再試行まで待つ。
                if (study.serverRevision === null) {
                    // 作成が拒否されたノートは、編集のたびに作成（ツリーの全体）を送り直さない。
                    if (!forced && !shouldRetryCreate(study)) return "done";
                } else {
                    if (!forced && lastSeqOf(pending) <= study.remote.atSeq) return "done";
                    // 拒否された操作の列は引きずらない。サーバーの最新の文書といまのローカルの
                    // 文書の差分から、送信待ちを作り直してから送る。
                    forced = false;
                    const rebuilt = await rebuildPending(studyId, run);
                    if (rebuilt !== "continue") return rebuilt;
                    continue;
                }
            }
            forced = false;

            let outcome: StepOutcome;
            if (study.serverRevision === null) {
                outcome = await createRemote(study, run);
            } else if (pending.length === 0) {
                return "done";
            } else {
                outcome = await sendBatch(study, pending, run);
            }
            if (outcome !== "continue") return outcome;
        }
        return "retry";
    };

    const clearTimer = (entry: Entry): void => {
        if (entry.timer !== null) {
            scheduler.clearTimeout(entry.timer);
            entry.timer = null;
        }
    };

    function schedule(studyId: string, delayMs: number): void {
        if (disposed) return;
        const entry = entryOf(studyId);
        const at = now() + delayMs;
        // 既に同じか早い時刻に予定があれば、そのまま（間引き）。
        if (entry.timer !== null && entry.timerAt <= at) return;
        clearTimer(entry);
        entry.timerAt = at;
        entry.timer = scheduler.setTimeout(() => {
            entry.timer = null;
            void runSync(studyId, false);
        }, delayMs);
    }

    function runSync(studyId: string, force: boolean): Promise<void> {
        const entry = entryOf(studyId);
        if (force) entry.force = true;
        if (entry.running) {
            // 1 つのノートにつき送信は 1 つ。終わったらもう一度回す。
            entry.rerun = true;
            return entry.running;
        }
        const running = (async () => {
            try {
                do {
                    entry.rerun = false;
                    const forced = entry.force;
                    entry.force = false;
                    let outcome: StepOutcome;
                    try {
                        outcome = await locks.request(lockName(studyId), () =>
                            syncLocked(studyId, forced),
                        );
                    } catch (error) {
                        outcome = "retry";
                        entry.message = error instanceof Error ? error.message : String(error);
                        if (error instanceof StudyStorageError) entry.storageError = error.code;
                    }
                    if (outcome === "hold") {
                        // 待機が明けたら送る（予約済み）。保存の状態は「再送待ち」にする。
                        entry.retrying = true;
                        refreshStatus(studyId);
                        return;
                    }
                    if (outcome === "retry") {
                        // 間隔を空けて再送する（失敗のたびに倍、上限あり）。
                        const delay = Math.min(retryMaxMs, retryBaseMs * 2 ** entry.attempt);
                        entry.attempt += 1;
                        entry.retrying = true;
                        refreshStatus(studyId);
                        schedule(studyId, delay);
                        return;
                    }
                    entry.attempt = 0;
                    entry.retrying = false;
                    entry.message = null;
                    entry.storageError = null;
                    refreshStatus(studyId);
                } while (entry.rerun && !disposed);
            } finally {
                entry.running = null;
            }
        })();
        entry.running = running;
        return running;
    }

    /**
     * サーバーの最新の内容を取り込む（ロックの中で）。
     * @returns `fetched`: 取り込めた（内容が同じだった場合を含む）。`inflight`: 応答待ちの
     *   バッチがあるので、送信側に任せた。`skipped`: 取り込めなかった・取り込む相手がいない。
     */
    const pullLocked = async (studyId: string): Promise<"fetched" | "inflight" | "skipped"> => {
        const { study, pending } = await store.read(studyId);
        observe(studyId, study, pending.length);
        if (!study || study.mergedInto !== null || study.deleting) return "skipped";
        if (!canSend(study) || study.serverRevision === null) return "skipped";
        // 同じユーザーで 401 が続いている間は、取得も間隔が空くまで待つ（待機が明けたときに、
        // 開いているノートを取り込み直す。`setSession` を参照）。
        if (now() < authHoldUntil) return "skipped";
        if (study.remote.state === "deleted") return "skipped";
        // 応答待ちのバッチがあるときは、送信側の再送（replayed / 409）に任せる。
        if (study.inflight !== null) return "inflight";
        const fetched = await api.get(studyId);
        if (fetched.ok) {
            if (fetched.data.study.revision !== study.serverRevision) {
                await rebaseOnto(studyId, fetched.data.study);
            }
            return "fetched";
        }
        if (isTransient(fetched.status)) return "skipped";
        await handleGetFailure(studyId, fetched, { recreated: false });
        return "skipped";
    };

    /**
     * 開いたあとの最初の取り込みが済んだことを覚え、知らせる。
     * 取得を始めたあとに確かめ直し（開き直し・ユーザーの切り替え）があった場合は、その取得の
     * 結果では「済んだ」にしない（確かめ直したあとに始めた取得だけが済ませられる）。
     */
    const markPulled = (studyId: string, epoch: number): void => {
        const entry = entryOf(studyId);
        if (entry.pullEpoch !== epoch) return;
        if (entry.pulled) return;
        entry.pulled = true;
        emit({ type: "pulled", studyId });
    };

    const trackWrite = <T>(promise: Promise<T>): Promise<T> => {
        const settled = promise.then(
            () => undefined,
            () => undefined,
        );
        localWrites.add(settled);
        void settled.then(() => localWrites.delete(settled));
        return promise;
    };

    const noteStorageResult = (studyId: string, error: unknown): void => {
        const entry = entryOf(studyId);
        const next = error instanceof StudyStorageError ? error.code : null;
        if (error !== null && next === null) return;
        if (entry.storageError === next) return;
        entry.storageError = next;
        if (next !== null) entry.message = (error as Error).message;
        refreshStatus(studyId);
    };

    /** ノートごとに書き込みを直列にする（呼んだ順に適用する）。 */
    const enqueueWrite = <T>(studyId: string, task: () => Promise<T>): Promise<T> => {
        const entry = entryOf(studyId);
        const result = entry.writeChain.then(task, task);
        entry.writeChain = result.catch(() => undefined);
        void result.then(
            () => noteStorageResult(studyId, null),
            (error: unknown) => noteStorageResult(studyId, error),
        );
        return trackWrite(result);
    };

    const unsubscribeChannel = channel?.subscribe((message) => {
        if (message.type !== "changed" || disposed) return;
        const { studyId } = message;
        const entry = entryOf(studyId);
        // 連続した通知（一括解析など）はまとめて 1 回だけ読み直す。
        if (entry.refreshTimer !== null) return;
        entry.refreshTimer = scheduler.setTimeout(() => {
            entry.refreshTimer = null;
            void store.read(studyId).then(
                ({ study, pending }) => {
                    observe(studyId, study, pending.length);
                    if (!study) emit({ type: "removed", studyId });
                    else if (study.mergedInto !== null) {
                        emit({ type: "merged", studyId, into: study.mergedInto });
                    } else emit({ type: "document", studyId, origin: "other-tab" });
                },
                () => undefined,
            );
        }, OTHER_TAB_REFRESH_DELAY_MS);
    });

    const pull = async (studyId: string): Promise<void> => {
        const entry = entryOf(studyId);
        let epoch = entry.pullEpoch;
        let outcome = await locks.request(lockName(studyId), () => pullLocked(studyId));
        // 取り込んだ内容は、ここまでに保存層へ書き終えている。
        if (outcome === "fetched") markPulled(studyId, epoch);
        if (entry.pendingCount > 0 || entry.study?.serverRevision === null) {
            await runSync(studyId, false);
        }
        if (outcome === "inflight") {
            // 応答待ちだったバッチの再送が済んだあとで、取り込み直す。
            epoch = entry.pullEpoch;
            outcome = await locks.request(lockName(studyId), () => pullLocked(studyId));
            if (outcome === "fetched") markPulled(studyId, epoch);
        }
    };

    /**
     * まだ保存層から読んでいないノートの状態を、裏で読みに行く。
     * `open` / `load` の前に `getStatus` / `subscribeStatus` を呼んでも、同期済みのノートが
     * 「ブラウザ内」と出たままにならないようにする（読めたら購読側に通知される）。
     */
    const hydrate = (studyId: string): void => {
        const entry = entryOf(studyId);
        if (entry.hydrated || disposed) return;
        entry.hydrated = true;
        void store.read(studyId).then(
            ({ study, pending }) => observe(studyId, study, pending.length),
            () => undefined,
        );
    };

    /** いまのアカウントから使えるノートか（ある・削除していない・見える）。 */
    const isUsable = async (studyId: string): Promise<boolean> => {
        let known = entries.get(studyId)?.study ?? null;
        if (!known) {
            const { study, pending } = await store.read(studyId);
            observe(studyId, study, pending.length);
            known = study;
        }
        return known !== null && !known.deleting && isVisible(known);
    };

    const resumeOwned = async (): Promise<void> => {
        const current = session;
        if (!current) return;
        const summaries = await store.list();
        for (const summary of summaries) {
            if (summary.owner !== current.userId) continue;
            if (summary.mergedInto !== null) {
                if (summary.mergePending) schedule(summary.id, 0);
                continue;
            }
            if (summary.pendingCount > 0 || summary.serverRevision === null || summary.deleting) {
                schedule(summary.id, 0);
            }
        }
    };

    return {
        setSession(next) {
            const previousUserId = session?.userId ?? null;
            const nextUserId = next?.userId ?? null;
            if (nextUserId !== previousUserId) {
                // 別のユーザー（またはログアウト）。401 の続いた回数は引き継がない。
                authFailures = 0;
                authHoldUntil = 0;
            } else if (unauthorized && nextUserId !== null) {
                // 401 を受けて取り直したセッションが、同じユーザーだった。間隔を空けて送り直す
                // （続くほど間隔を延ばす）。
                const holdMs = Math.min(
                    retryMaxMs,
                    retryBaseMs * 2 ** Math.max(0, authFailures - 1),
                );
                authHoldUntil = now() + holdMs;
                // 待機中に頼まれた取り込みは行っていない。待機が明けたら、開いているノートを
                // 取り込み直す（送信待ちの無いノートは、送信の再開では取り込まれないため）。
                if (authResumeTimer !== null) scheduler.clearTimeout(authResumeTimer);
                authResumeTimer = scheduler.setTimeout(() => {
                    authResumeTimer = null;
                    if (disposed) return;
                    for (const [studyId, entry] of entries) {
                        if (entry.open) void pull(studyId).catch(() => undefined);
                    }
                }, holdMs);
            }
            if (nextUserId !== previousUserId) {
                // 別のアカウントから見た内容は、取り込み直すまで最新とは言えない。
                for (const entry of entries.values()) {
                    entry.pulled = false;
                    entry.pullEpoch += 1;
                }
            }
            session = next ? { userId: next.userId } : null;
            sessionKnown = true;
            unauthorized = false;
            for (const studyId of entries.keys()) refreshStatus(studyId);
            if (session) void resumeOwned().catch(() => undefined);
        },
        getSession() {
            return session;
        },
        getSessionStatus() {
            if (!sessionKnown) return "unknown";
            return session ? "signed_in" : "signed_out";
        },
        isUnauthorized() {
            return unauthorized;
        },

        createStudy(doc) {
            const owner = session?.userId ?? null;
            return enqueueWrite(doc.id, async () => {
                const study = await mutate(doc.id, (snapshot) => {
                    if (snapshot.study) {
                        throw new StudySyncError(
                            "already_exists",
                            `研究ノートは既にあります: ${doc.id}`,
                        );
                    }
                    const created = newStoredStudy(doc, owner, null);
                    return { study: created, result: created };
                });
                emit({ type: "document", studyId: doc.id, origin: "local" });
                schedule(doc.id, 0);
                return study;
            });
        },

        async open(studyId) {
            const local = await store.read(studyId);
            if (local.study) {
                observe(studyId, local.study, local.pending.length);
                if (local.study.mergedInto !== null) {
                    return { status: "merged", into: local.study.mergedInto };
                }
                if (local.study.deleting) return { status: "not_found" };
                // 別のアカウントのノートは、このアカウントからは存在しないものとして扱う。
                if (!isVisible(local.study)) return { status: "not_found" };
                const entry = entryOf(studyId);
                entry.open = true;
                // 開くたびに、最新の内容を取り込めたかを確かめ直す。
                entry.pulled = false;
                entry.pullEpoch += 1;
                // 他の端末の変更を裏で取り込み、送信待ちがあれば送る。
                void pull(studyId).catch(() => undefined);
                return { status: "ok", study: local.study };
            }
            const current = session;
            if (!current || unauthorized) return { status: "not_found" };
            return locks.request(lockName(studyId), async (): Promise<StudyOpenResult> => {
                const fetched = await api.get(studyId);
                if (!fetched.ok) {
                    if (fetched.status === 401) markUnauthorized();
                    if (isTransient(fetched.status)) {
                        return {
                            status: "unavailable",
                            message: describeError(fetched.status, fetched.error),
                        };
                    }
                    return { status: "not_found" };
                }
                const detail = fetched.data.study;
                const study = await mutate(studyId, (snapshot) => {
                    if (snapshot.study) return { result: snapshot.study };
                    const created = newStoredStudy(
                        toDocument(detail),
                        current.userId,
                        detail.revision,
                    );
                    return { study: created, result: created };
                });
                const entry = entryOf(studyId);
                entry.open = true;
                // いまサーバーから取得した内容そのもの。
                entry.pulled = true;
                return { status: "ok", study };
            });
        },

        close(studyId) {
            const entry = entries.get(studyId);
            if (entry) entry.open = false;
        },

        getPullState(studyId) {
            const entry = entries.get(studyId);
            const study = entry?.study ?? null;
            // 取り込む相手がいないノート（匿名・サーバーに未作成・いまのアカウントから見えない）。
            if (!entry || !study || study.owner === null || study.serverRevision === null) {
                return "not_needed";
            }
            if (study.owner !== (session?.userId ?? null)) return "not_needed";
            return entry.pulled ? "done" : "pending";
        },

        async load(studyId) {
            const { study, pending } = await store.read(studyId);
            observe(studyId, study, pending.length);
            // セッションの確認中・ログアウト中は、アカウントのノートを返さない。
            return study && isVisible(study) ? study : null;
        },

        applyOps(studyId, ops) {
            return enqueueWrite(studyId, async () => {
                const { doc, changed } = await mutate(studyId, (snapshot) => {
                    if (!snapshot.study || snapshot.study.deleting || !isVisible(snapshot.study)) {
                        throw new StudySyncError("not_found", `研究ノートがありません: ${studyId}`);
                    }
                    if (snapshot.study.mergedInto !== null) {
                        throw new StudySyncError(
                            "merged",
                            `研究ノートは統合済みです: ${snapshot.study.mergedInto}`,
                        );
                    }
                    // サーバーが受け付けない操作（上限超過・形の不正）は、保存する前に弾く。
                    applyStudyOpsStrict(snapshot.study.doc, ops);
                    const applied = applyEffectiveOps(snapshot.study.doc, ops);
                    if (applied.effective.length === 0) {
                        return { result: { doc: snapshot.study.doc, changed: false } };
                    }
                    return {
                        study: { ...snapshot.study, doc: applied.doc, updatedAt: now() },
                        appendOps: applied.effective,
                        result: { doc: applied.doc, changed: true },
                    };
                });
                if (changed) {
                    emit({ type: "document", studyId, origin: "local" });
                    schedule(studyId, flushDelayMs);
                }
                return doc;
            });
        },

        async flush(studyId) {
            if (studyId !== undefined) {
                const entry = entryOf(studyId);
                clearTimer(entry);
                await entry.writeChain;
                await runSync(studyId, false);
                return;
            }
            await Promise.allSettled([...localWrites]);
            const summaries = await store.list();
            await Promise.all(
                summaries
                    .filter(
                        (summary) =>
                            summary.pendingCount > 0 ||
                            summary.serverRevision === null ||
                            summary.deleting,
                    )
                    .map((summary) => {
                        clearTimer(entryOf(summary.id));
                        return runSync(summary.id, false);
                    }),
            );
        },

        async retry(studyId) {
            const entry = entryOf(studyId);
            clearTimer(entry);
            entry.attempt = 0;
            await entry.writeChain;
            await runSync(studyId, true);
        },

        pull,

        async refreshOpen() {
            const openIds = [...entries].filter(([, entry]) => entry.open).map(([id]) => id);
            await Promise.all(openIds.map((studyId) => pull(studyId).catch(() => undefined)));
        },

        async deleteStudy(studyId) {
            const removed = await enqueueWrite(studyId, () =>
                mutate(studyId, (snapshot) => {
                    if (!snapshot.study) return { result: true };
                    // 別のアカウントのノート（セッションの確認中・ログアウト中のアカウントの
                    // ノートを含む）は、無いものとして扱う。消せてしまうと、持ち主が戻ったときに
                    // サーバーからも削除される。
                    if (!isVisible(snapshot.study)) {
                        throw new StudySyncError("not_found", `研究ノートがありません: ${studyId}`);
                    }
                    // サーバーに渡っていない匿名のノートは、ローカルから消すだけでよい。
                    if (snapshot.study.owner === null) return { study: null, result: true };
                    return {
                        study: {
                            ...snapshot.study,
                            deleting: true,
                            inflight: null,
                            updatedAt: now(),
                        },
                        removeOpsUpTo: lastSeqOf(snapshot.pending),
                        result: false,
                    };
                }),
            );
            const entry = entryOf(studyId);
            entry.open = false;
            emit({ type: "removed", studyId });
            if (!removed) {
                clearTimer(entry);
                await runSync(studyId, false);
            }
        },

        async adoptAnonymousStudies() {
            const current = session;
            if (!current) return [];
            const summaries = await store.list();
            const adopted: string[] = [];
            for (const summary of summaries) {
                if (summary.owner !== null || summary.mergedInto !== null) continue;
                const done = await enqueueWrite(summary.id, () =>
                    mutate(summary.id, (snapshot) => {
                        // 他のタブが先に持ち主を決めていたら、それを変えない。
                        if (!snapshot.study || snapshot.study.owner !== null) {
                            return { result: false };
                        }
                        // 一覧の読み込みや先行する書き込みを待つ間に、ログアウトや別のアカウントへの
                        // 切り替えが起きていたら、古いアカウントのものにしない。
                        if (session?.userId !== current.userId) {
                            return { result: false };
                        }
                        return {
                            study: { ...snapshot.study, owner: current.userId, updatedAt: now() },
                            result: true,
                        };
                    }),
                );
                if (done) {
                    adopted.push(summary.id);
                    schedule(summary.id, 0);
                }
            }
            return adopted;
        },

        async listLocal() {
            const summaries = await store.list();
            return summaries
                .filter(
                    (summary) =>
                        summary.mergedInto === null && !summary.deleting && isVisible(summary),
                )
                .map((summary) => {
                    const entry = entries.get(summary.id);
                    return {
                        ...summary,
                        status: statusOf({
                            study: summary,
                            pendingCount: summary.pendingCount,
                            storageError: entry?.storageError ?? null,
                            retrying: entry?.retrying ?? false,
                            message: entry?.message ?? null,
                        }),
                    };
                });
        },

        async findLocalByOrigin(origin) {
            const originKey = studyOriginKey(origin.kind, origin.ref);
            if (originKey === null) return null;
            const ids = await store.findByOriginKey(originKey);
            const currentUserId = session?.userId ?? null;
            for (const studyId of ids) {
                const { study } = await store.read(studyId);
                if (!study || study.deleting) continue;
                // 別のアカウントのノートは「同じ棋譜のノート」として開かない。
                if (study.owner !== null && study.owner !== currentUserId) continue;
                return study.mergedInto ?? study.id;
            }
            return null;
        },

        async getViewState(studyId) {
            if (!(await isUsable(studyId))) return {};
            if (!store.readViewState) return { ...fallbackViewStates.get(studyId) };
            return (await store.readViewState(studyId)) ?? {};
        },
        async setViewState(studyId, patch) {
            const entry = entryOf(studyId);
            // 同じノートへの書き込みは呼んだ順に行う（読んでから書くので、順序が前後しないように）。
            const result = entry.viewChain.then(async () => {
                if (!(await isUsable(studyId))) {
                    throw new StudySyncError("not_found", `研究ノートがありません: ${studyId}`);
                }
                if (!store.readViewState || !store.writeViewState) {
                    const next = { ...fallbackViewStates.get(studyId), ...patch };
                    fallbackViewStates.set(studyId, next);
                    return next;
                }
                const next = { ...((await store.readViewState(studyId)) ?? {}), ...patch };
                await store.writeViewState(studyId, next);
                return next;
            });
            entry.viewChain = result.catch(() => undefined);
            return result;
        },

        getStatus(studyId) {
            hydrate(studyId);
            return entries.get(studyId)?.status ?? INITIAL_STATUS;
        },
        subscribeStatus(studyId, listener) {
            hydrate(studyId);
            const entry = entryOf(studyId);
            entry.listeners.add(listener);
            return () => {
                entry.listeners.delete(listener);
            };
        },
        subscribeEvents(listener) {
            eventListeners.add(listener);
            return () => {
                eventListeners.delete(listener);
            };
        },

        async whenLocalWritesSettled() {
            while (localWrites.size > 0) {
                await Promise.allSettled([...localWrites]);
            }
        },

        dispose() {
            disposed = true;
            for (const entry of entries.values()) {
                clearTimer(entry);
                if (entry.refreshTimer !== null) {
                    scheduler.clearTimeout(entry.refreshTimer);
                    entry.refreshTimer = null;
                }
            }
            if (authResumeTimer !== null) {
                scheduler.clearTimeout(authResumeTimer);
                authResumeTimer = null;
            }
            unsubscribeChannel?.();
            eventListeners.clear();
        },
    };
}
