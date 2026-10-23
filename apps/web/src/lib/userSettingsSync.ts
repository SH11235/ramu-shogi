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
import {
    dispatchLocalStorageSyncEvent,
    type LocalStorageChangeSource,
} from "@shogi/ui/components/shogi-match/hooks/useLocalStorage";

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
const INITIAL_OWNER_STORAGE_KEY = "shogi-user-settings-initial-owner";
const OWNERSHIP_STORAGE_PREFIX = "shogi-user-settings-owner:";
const REQUEST_ERROR = "設定を同期できませんでした。この端末の設定は保持しています。";
const AUTH_ERROR =
    "ログイン状態を確認できないため、設定の同期を停止しました。この端末の設定は保持しています。";

interface DocumentState {
    documentKey: UserSettingsDocumentKey;
    storageKey: string;
    label: string;
    localValue: string | null;
    editBase: string | null | undefined;
    remoteValue: string | null;
    version: number | null | undefined;
    dirty: boolean;
    failure: "conflict" | "request" | null;
    unconfirmedWrites: { value: string; version: number }[];
}

interface UserState {
    userId: string;
    documents: DocumentState[];
    initialError: string | null;
    authRefreshRequested: boolean;
}

interface LocalOwnership {
    userId: string | null;
    value: string | null;
}

function parseOwnership(value: unknown): LocalOwnership {
    if (
        typeof value === "object" &&
        value !== null &&
        "userId" in value &&
        typeof value.userId === "string" &&
        "value" in value &&
        (value.value === null || typeof value.value === "string")
    )
        return { userId: value.userId, value: value.value };
    return { userId: null, value: null };
}

function readOwnership(storageKey: string): LocalOwnership | null {
    const stored = window.localStorage.getItem(OWNERSHIP_STORAGE_PREFIX + storageKey);
    if (stored === null) return null;
    try {
        return parseOwnership(JSON.parse(stored));
    } catch {
        // 壊れた所属情報は匿名設定として引き継がない。
        return { userId: null, value: null };
    }
}

function writeOwnership(
    document: DocumentState,
    userId: string,
    value = document.localValue,
): void {
    window.localStorage.setItem(
        OWNERSHIP_STORAGE_PREFIX + document.storageKey,
        JSON.stringify({ userId, value }),
    );
}

function ownsLocalValue(document: DocumentState, userId: string): boolean {
    const owner = readOwnership(document.storageKey);
    return owner?.userId === userId && owner.value === document.localValue;
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

function captureLocalChange(document: DocumentState, explicit = false): boolean {
    const localValue = readLocalDocument(document.storageKey);
    if (localValue === document.localValue) return false;
    if (explicit && (!document.dirty || document.failure === "conflict")) {
        document.editBase = document.localValue;
    }
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
    localChanged: (storageKey: string, source?: LocalStorageChangeSource) => void;
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
        try {
            window.localStorage.setItem(LAST_SYNCED_USER_ID_STORAGE_KEY, candidate.user.userId);
        } catch (error) {
            fail(candidate, null, error);
        }
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
            document.editBase = undefined;
            document.failure = null;
        }
    }

    async function resolveConflict(
        candidate: Generation,
        document: DocumentState,
        canRetry: boolean,
    ): Promise<boolean> {
        const hadUnconfirmedWrites = document.unconfirmedWrites.length > 0;
        const payload = await request<GetUserSettingsResponse>(
            candidate,
            `/api/user/settings/${document.documentKey}`,
        );
        if (!isCurrent(candidate)) return false;
        captureLocalChange(document);
        const canRebase =
            canRetry &&
            !hadUnconfirmedWrites &&
            document.editBase !== undefined &&
            document.editBase ===
                (payload.document ? JSON.stringify(payload.document.value) : null);
        acceptRemote(document, payload.document);
        // 編集開始時に表示した値と一致する場合だけ、既知の更新として一度再送する。
        if (document.dirty && canRebase) return true;
        if (document.dirty) document.failure = "conflict";
        return false;
    }

    async function upload(
        candidate: Generation,
        document: DocumentState,
        canRetry = true,
    ): Promise<void> {
        if (
            !isCurrent(candidate) ||
            !candidate.ready ||
            candidate.uploading.has(document.documentKey)
        )
            return;
        candidate.uploading.add(document.documentKey);
        let attempt: DocumentState["unconfirmedWrites"][number] | undefined;
        let retry = false;
        try {
            while (isCurrent(candidate) && document.dirty && !document.failure) {
                if (document.version === undefined || document.localValue === null) break;
                if (!ownsLocalValue(document, candidate.user.userId)) {
                    throw new Error("Settings ownership is not confirmed");
                }
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
                if (document.dirty) document.editBase = document.remoteValue;
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
                    retry = await resolveConflict(candidate, document, canRetry);
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
                if (retry) void upload(candidate, document, false);
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
                    if (ownWrite && document.dirty) document.editBase = document.remoteValue;
                } else {
                    acceptRemote(document, remote);
                    if (remote) {
                        if (document.localValue !== remoteValue) {
                            document.localValue = remoteValue;
                            window.localStorage.setItem(
                                document.storageKey,
                                JSON.stringify(remote.value),
                            );
                            dispatchLocalStorageSyncEvent(document.storageKey, "automatic");
                        }
                        writeOwnership(document, candidate.user.userId);
                    } else if (
                        ownsLocalValue(document, candidate.user.userId) &&
                        document.localValue !== null
                    ) {
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
            user = {
                userId,
                initialError: null,
                authRefreshRequested: false,
                documents: SETTINGS_STORAGE_MAPPINGS.map((mapping) => ({
                    ...mapping,
                    localValue: readLocalDocument(mapping.storageKey),
                    editBase: undefined,
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
        try {
            let initialStored = window.localStorage.getItem(INITIAL_OWNER_STORAGE_KEY);
            if (initialStored === null) {
                const initialOwner =
                    window.localStorage.getItem(LAST_SYNCED_USER_ID_STORAGE_KEY) ?? userId;
                initialStored = JSON.stringify(
                    Object.fromEntries(
                        user.documents.map((document) => [
                            document.storageKey,
                            { userId: initialOwner, value: document.localValue },
                        ]),
                    ),
                );
                // 部分保存後の復旧でも、後から編集された値を初期所有者へ帰属させない。
                window.localStorage.setItem(INITIAL_OWNER_STORAGE_KEY, initialStored);
            }
            let initial: unknown;
            try {
                initial = JSON.parse(initialStored);
            } catch {
                initial = null;
            }
            // 初回の匿名設定だけを引き継ぎ、通信の成否に関係なく所属を確定する。
            for (const document of user.documents) {
                if (readOwnership(document.storageKey) === null) {
                    const owner = parseOwnership(
                        typeof initial === "object" && initial !== null
                            ? (initial as Record<string, unknown>)[document.storageKey]
                            : null,
                    );
                    if (owner.userId !== null) writeOwnership(document, owner.userId, owner.value);
                }
            }
        } catch (error) {
            fail(generation, null, error);
            pause();
            return;
        }
        publishError();
        void initialize(generation);
    }

    function reset(): void {
        pause();
        user = null;
        publishError();
    }

    function localChanged(storageKey: string, source: LocalStorageChangeSource = "user"): void {
        const document = user?.documents.find((candidate) => candidate.storageKey === storageKey);
        if (!document || !user) return;
        try {
            if (source === "automatic") {
                // 補正前へ戻す編集を検出できるよう、未保存の編集がないときだけ比較値を進める。
                if (!document.dirty) {
                    const owned = ownsLocalValue(document, user.userId);
                    document.localValue = readLocalDocument(document.storageKey);
                    if (owned) writeOwnership(document, user.userId);
                }
                return;
            }
            if (!captureLocalChange(document, true)) return;
            writeOwnership(document, user.userId);
            publishError();
            if (generation) void upload(generation, document);
        } catch (error) {
            if (generation) fail(generation, document, error);
            else {
                document.failure = "request";
                publishError();
            }
        }
    }

    return { start, pause, reset, localChanged };
}
