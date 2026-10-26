/**
 * 保存の状態（画面に表示する 5 つの状態）と、その決め方。
 */

import type { StoredStudy, StudyStorageErrorCode } from "./store";

/**
 * 保存の状態。
 * - `local`: ブラウザ内に保存済み（クラウドには送っていない・送れない）
 * - `pending`: 送信待ち（ブラウザ内には保存済み）
 * - `synced`: クラウドに保存済み（サーバーが受理した）
 * - `limit_exceeded`: 上限超過（ブラウザ内には保存済み）
 * - `error`: 保存に失敗
 */
export type StudySaveState = "local" | "pending" | "synced" | "limit_exceeded" | "error";

export type StudySaveReason =
    /** 未ログイン中に作ったノート。「ログインすると保存できます」を出す。 */
    | "anonymous"
    /** アカウントのノートだが、いまログインしていない（セッション切れを含む）。 */
    | "signed_out"
    /** 別のアカウントのノート。いまのアカウントでは送らない。 */
    | "other_account"
    /** ブラウザ内の保存領域が使えない。 */
    | "storage_unavailable"
    /** ブラウザの保存容量が足りない。 */
    | "storage_quota"
    /** ブラウザ内への書き込みに失敗した。 */
    | "storage_failed"
    /** サーバー側で削除済み。 */
    | "deleted_remotely"
    /** サーバーが入力を受け付けなかった。 */
    | "rejected";

export interface StudySaveStatus {
    state: StudySaveState;
    /** `local` / `error` の理由。 */
    reason: StudySaveReason | null;
    /** 送信待ちの操作の数。 */
    pendingCount: number;
    /** `limit_exceeded` のとき、超えた上限の名前。 */
    limit: string | null;
    /** 通信の失敗などで再送を待っている。 */
    retrying: boolean;
    /** 直近の失敗の説明（ログ・詳細表示用）。 */
    message: string | null;
    /** サーバーが最後に受理した時刻（Unix ミリ秒）。 */
    lastSyncedAt: number | null;
}

interface StudySaveStatusInput {
    study: Pick<StoredStudy, "owner" | "serverRevision" | "remote" | "lastSyncedAt"> | null;
    pendingCount: number;
    /** ログイン中のユーザー ID。未ログインなら null。 */
    sessionUserId: string | null;
    /** サーバーが 401 を返した（セッション切れ）。 */
    unauthorized: boolean;
    /** 直近のローカルへの書き込みの失敗。 */
    storageError: StudyStorageErrorCode | null;
    retrying: boolean;
    message: string | null;
}

const STORAGE_REASON: Record<StudyStorageErrorCode, StudySaveReason> = {
    unavailable: "storage_unavailable",
    quota_exceeded: "storage_quota",
    failed: "storage_failed",
};

/** 保存層の状態とセッションから、表示する保存の状態を決める。 */
export function deriveStudySaveStatus(input: StudySaveStatusInput): StudySaveStatus {
    const base = {
        pendingCount: input.pendingCount,
        limit: null,
        retrying: false,
        message: input.message,
        lastSyncedAt: input.study?.lastSyncedAt ?? null,
    };
    if (input.storageError !== null) {
        return { ...base, state: "error", reason: STORAGE_REASON[input.storageError] };
    }
    const { study } = input;
    if (!study) {
        return { ...base, state: "local", reason: null };
    }
    if (study.remote.state === "deleted") {
        return { ...base, state: "error", reason: "deleted_remotely" };
    }
    if (study.owner === null) {
        return { ...base, state: "local", reason: "anonymous" };
    }
    if (input.sessionUserId === null || input.unauthorized) {
        return { ...base, state: "local", reason: "signed_out" };
    }
    if (input.sessionUserId !== study.owner) {
        return { ...base, state: "local", reason: "other_account" };
    }
    if (study.remote.state === "limit_exceeded") {
        return { ...base, state: "limit_exceeded", reason: null, limit: study.remote.limit };
    }
    if (study.remote.state === "rejected") {
        return { ...base, state: "error", reason: "rejected", message: study.remote.message };
    }
    // クラウドに保存済みと出すのは、サーバーが受理してから。
    if (study.serverRevision !== null && input.pendingCount === 0) {
        return { ...base, state: "synced", reason: null, message: null };
    }
    return { ...base, state: "pending", reason: null, retrying: input.retrying };
}

/** 2 つの状態が同じ内容か（購読側に同じ参照を返し続けるために使う）。 */
export function isSameStudySaveStatus(a: StudySaveStatus, b: StudySaveStatus): boolean {
    return (
        a.state === b.state &&
        a.reason === b.reason &&
        a.pendingCount === b.pendingCount &&
        a.limit === b.limit &&
        a.retrying === b.retrying &&
        a.message === b.message &&
        a.lastSyncedAt === b.lastSyncedAt
    );
}
