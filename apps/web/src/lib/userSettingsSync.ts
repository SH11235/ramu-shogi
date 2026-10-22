import type {
    ApiErrorResponse,
    GetUserSettingsResponse,
    JsonValue,
    ListUserSettingsResponse,
    PutUserSettingsRequest,
    PutUserSettingsResponse,
    UserSettingsDocument,
    UserSettingsDocumentKey,
} from "@shogi/api-contract";
// 起動時の同期から対局画面の chunk を読み込まないよう、軽量な storage モジュールを直接参照する。
import { dispatchLocalStorageSyncEvent } from "@shogi/ui/components/shogi-match/hooks/useLocalStorage";

const SETTINGS_STORAGE_MAPPINGS = [
    {
        documentKey: "match.time-settings",
        storageKey: "shogi-match-time-settings",
        label: "持ち時間設定",
    },
    {
        documentKey: "match.display-settings",
        storageKey: "shogi-display-settings",
        label: "表示設定",
    },
    {
        documentKey: "match.analysis-settings",
        storageKey: "shogi-analysis-settings",
        label: "解析設定",
    },
    {
        documentKey: "match.pass-rights-settings",
        storageKey: "shogi-pass-rights-settings",
        label: "パス権設定",
    },
] as const;

const LAST_SYNCED_USER_ID_STORAGE_KEY = "shogi-user-settings-last-user-id";
const REQUEST_ERROR = "設定を同期できませんでした。この端末の設定は保持しています。";
const AUTH_ERROR =
    "ログイン状態を確認できないため、設定の同期を停止しました。この端末の設定は保持しています。";

interface DocumentState {
    documentKey: UserSettingsDocumentKey;
    storageKey: string;
    label: string;
    localValue: string | null;
    remoteValue: string | null;
    version: number | null | undefined;
    dirty: boolean;
    failure: "conflict" | "request" | null;
    unconfirmedWrites: { value: string; version: number }[];
}

interface UserState {
    userId: string;
    canSeed: boolean;
    documents: DocumentState[];
    initialError: string | null;
    authRefreshRequested: boolean;
}

interface Generation {
    user: UserState;
    abort: AbortController;
    ready: boolean;
    uploading: Set<UserSettingsDocumentKey>;
}

interface RequestError extends Error {
    status: number;
    code?: string;
}

function isRequestError(error: unknown): error is RequestError {
    return error instanceof Error && "status" in error;
}

function readLocalDocument(storageKey: string): string | null {
    const stored = window.localStorage.getItem(storageKey);
    if (stored === null) return null;
    try {
        const value = JSON.parse(stored) as JsonValue;
        return value === null ? null : JSON.stringify(value);
    } catch {
        return null;
    }
}

function captureLocalChange(document: DocumentState): boolean {
    const localValue = readLocalDocument(document.storageKey);
    if (localValue === document.localValue) return false;
    document.localValue = localValue;
    document.dirty = localValue !== null;
    document.failure = null;
    return true;
}

function hasUnconfirmedChange(document: DocumentState): boolean {
    // 中断した PUT がサーバーで完了し得るため、その送信値と異なる編集は GET の一致だけでは確定しない。
    return document.unconfirmedWrites.some((write) => write.value !== document.localValue);
}

export function createUserSettingsSync(
    onError: (message: string | null) => void,
    refreshAuth: () => void,
): {
    start: (userId: string) => void;
    pause: () => void;
    reset: () => void;
    localChanged: (storageKey: string) => void;
} {
    let user: UserState | null = null;
    let generation: Generation | null = null;

    const isCurrent = (candidate: Generation): boolean => generation === candidate;

    function publishError(): void {
        const failed = user?.documents.find((document) => document.failure);
        const message =
            failed?.failure === "conflict"
                ? `${failed.label}の更新が競合しました。この端末の設定は保持しています。設定を変更すると同期を再開します。`
                : failed
                  ? REQUEST_ERROR
                  : null;
        onError(user?.initialError ?? message);
    }

    function pause(): void {
        const previous = generation;
        generation = null;
        previous?.abort.abort();
    }

    function markSynced(candidate: Generation): void {
        if (!isCurrent(candidate) || !candidate.ready) return;
        if (candidate.user.documents.some((document) => document.dirty)) return;
        window.localStorage.setItem(LAST_SYNCED_USER_ID_STORAGE_KEY, candidate.user.userId);
        candidate.user.authRefreshRequested = false;
    }

    async function request<T>(
        candidate: Generation,
        path: string,
        body?: PutUserSettingsRequest,
    ): Promise<T> {
        const response = await fetch(path, {
            method: body ? "PUT" : "GET",
            credentials: "same-origin",
            signal: candidate.abort.signal,
            headers: {
                "X-Expected-User-Id": candidate.user.userId,
                ...(body ? { "Content-Type": "application/json" } : {}),
            },
            ...(body ? { body: JSON.stringify(body) } : {}),
        });
        if (!response.ok) {
            let code: string | undefined;
            try {
                code = ((await response.json()) as ApiErrorResponse).error;
            } catch {
                code = undefined;
            }
            throw Object.assign(new Error("Settings request failed"), {
                status: response.status,
                code,
            });
        }
        return (await response.json()) as T;
    }

    function fail(candidate: Generation, document: DocumentState | null, error: unknown): void {
        if (!isCurrent(candidate)) return;
        if (
            isRequestError(error) &&
            (error.status === 401 || error.code === "SETTINGS_USER_MISMATCH")
        ) {
            pause();
            candidate.user.initialError = AUTH_ERROR;
            const shouldRefresh = !candidate.user.authRefreshRequested;
            candidate.user.authRefreshRequested = true;
            publishError();
            if (shouldRefresh) refreshAuth();
            return;
        }
        if (document) {
            document.failure = "request";
        } else {
            candidate.user.initialError = REQUEST_ERROR;
        }
        publishError();
    }

    function acceptRemote(document: DocumentState, remote: UserSettingsDocument | null): void {
        document.version = remote?.version ?? null;
        document.remoteValue = remote ? JSON.stringify(remote.value) : null;
        document.unconfirmedWrites = document.unconfirmedWrites.filter(
            (write) => write.version > (document.version ?? 0),
        );
        if (document.localValue === document.remoteValue && !hasUnconfirmedChange(document)) {
            document.dirty = false;
            document.failure = null;
        }
    }

    async function resolveConflict(candidate: Generation, document: DocumentState): Promise<void> {
        const payload = await request<GetUserSettingsResponse>(
            candidate,
            `/api/user/settings/${document.documentKey}`,
        );
        if (!isCurrent(candidate)) return;
        captureLocalChange(document);
        acceptRemote(document, payload.document);
        if (document.dirty) document.failure = "conflict";
    }

    async function upload(candidate: Generation, document: DocumentState): Promise<void> {
        if (
            !isCurrent(candidate) ||
            !candidate.ready ||
            candidate.uploading.has(document.documentKey)
        )
            return;
        candidate.uploading.add(document.documentKey);
        let attempt: DocumentState["unconfirmedWrites"][number] | undefined;
        try {
            while (isCurrent(candidate) && document.dirty && !document.failure) {
                if (document.version === undefined || document.localValue === null) break;
                if (
                    document.localValue === document.remoteValue &&
                    !hasUnconfirmedChange(document)
                ) {
                    document.dirty = false;
                    break;
                }
                const value = document.localValue;
                attempt = { value, version: (document.version ?? 0) + 1 };
                document.unconfirmedWrites.push(attempt);
                const payload = await request<PutUserSettingsResponse>(
                    candidate,
                    `/api/user/settings/${document.documentKey}`,
                    { value: JSON.parse(value) as JsonValue, expectedVersion: document.version },
                );
                if (!isCurrent(candidate)) return;
                acceptRemote(document, payload.document);
            }
        } catch (error) {
            if (isRequestError(error) && error.status >= 400 && error.status < 500) {
                document.unconfirmedWrites = document.unconfirmedWrites.filter(
                    (write) => write !== attempt,
                );
            }
            if (!isCurrent(candidate)) return;
            if (
                isRequestError(error) &&
                error.status === 409 &&
                error.code === "SETTINGS_VERSION_CONFLICT"
            ) {
                try {
                    await resolveConflict(candidate, document);
                } catch (conflictError) {
                    fail(candidate, document, conflictError);
                }
            } else {
                fail(candidate, document, error);
            }
        } finally {
            candidate.uploading.delete(document.documentKey);
            if (isCurrent(candidate)) {
                publishError();
                markSynced(candidate);
            }
        }
    }

    async function initialize(candidate: Generation): Promise<void> {
        try {
            const payload = await request<ListUserSettingsResponse>(
                candidate,
                "/api/user/settings",
            );
            if (!isCurrent(candidate)) return;
            const remoteDocuments = new Map(
                payload.documents.map((document) => [document.documentKey, document]),
            );
            for (const document of candidate.user.documents) {
                if (!isCurrent(candidate)) return;
                // 画面の初回保存は編集ではない。編集通知がなければ取得した設定を優先する。
                if (!document.dirty) document.localValue = readLocalDocument(document.storageKey);
                const remote = remoteDocuments.get(document.documentKey) ?? null;
                const remoteVersion = remote?.version ?? null;
                const remoteValue = remote ? JSON.stringify(remote.value) : null;
                const ownWrite = document.unconfirmedWrites.some(
                    (write) => write.version === remoteVersion && write.value === remoteValue,
                );
                if (document.dirty) {
                    if (
                        document.version !== undefined &&
                        document.version !== remoteVersion &&
                        !ownWrite
                    ) {
                        document.failure = "conflict";
                    } else if (document.failure === "request") {
                        document.failure = null;
                    }
                    acceptRemote(document, remote);
                } else {
                    acceptRemote(document, remote);
                    if (remote) {
                        if (document.localValue !== remoteValue) {
                            document.localValue = remoteValue;
                            window.localStorage.setItem(
                                document.storageKey,
                                JSON.stringify(remote.value),
                            );
                            dispatchLocalStorageSyncEvent(document.storageKey);
                        }
                    } else if (candidate.user.canSeed && document.localValue !== null) {
                        document.dirty = true;
                    }
                }
            }
            if (!isCurrent(candidate)) return;
            candidate.ready = true;
            publishError();
            markSynced(candidate);
            for (const document of candidate.user.documents) void upload(candidate, document);
        } catch (error) {
            fail(candidate, null, error);
        }
    }

    function start(userId: string): void {
        pause();
        if (user?.userId !== userId) {
            const lastUserId = window.localStorage.getItem(LAST_SYNCED_USER_ID_STORAGE_KEY);
            user = {
                userId,
                canSeed: lastUserId === null || lastUserId === userId,
                initialError: null,
                authRefreshRequested: false,
                documents: SETTINGS_STORAGE_MAPPINGS.map((mapping) => ({
                    ...mapping,
                    localValue: readLocalDocument(mapping.storageKey),
                    remoteValue: null,
                    version: undefined,
                    dirty: false,
                    failure: null,
                    unconfirmedWrites: [],
                })),
            };
        }
        user.initialError = null;
        generation = { user, abort: new AbortController(), ready: false, uploading: new Set() };
        publishError();
        void initialize(generation);
    }

    function reset(): void {
        pause();
        user = null;
        publishError();
    }

    function localChanged(storageKey: string): void {
        const document = user?.documents.find((candidate) => candidate.storageKey === storageKey);
        if (!document || !captureLocalChange(document)) return;
        publishError();
        if (generation) void upload(generation, document);
    }

    return { start, pause, reset, localChanged };
}
