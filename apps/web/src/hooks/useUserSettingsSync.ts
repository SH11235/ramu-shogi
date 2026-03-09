import type {
    JsonValue,
    ListUserSettingsResponse,
    PutUserSettingsRequest,
    UserSettingsDocumentKey,
} from "@shogi/api-contract";
import { dispatchLocalStorageSyncEvent, LOCAL_STORAGE_SYNC_EVENT } from "@shogi/ui";
import { useEffect, useRef } from "react";
import { parseApiError, useAuthSession } from "./useAuthSession";

interface UserSettingsStorageMapping {
    documentKey: UserSettingsDocumentKey;
    storageKey: string;
}

const SETTINGS_STORAGE_MAPPINGS: readonly UserSettingsStorageMapping[] = [
    {
        documentKey: "match.time-settings",
        storageKey: "shogi-match-time-settings",
    },
    {
        documentKey: "match.display-settings",
        storageKey: "shogi-display-settings",
    },
    {
        documentKey: "match.analysis-settings",
        storageKey: "shogi-analysis-settings",
    },
    {
        documentKey: "match.pass-rights-settings",
        storageKey: "shogi-pass-rights-settings",
    },
] as const;

const LAST_SYNCED_USER_ID_STORAGE_KEY = "shogi-user-settings-last-user-id";

function readLocalDocument(storageKey: string): JsonValue | null {
    if (typeof window === "undefined") return null;

    const stored = window.localStorage.getItem(storageKey);
    if (stored === null) {
        return null;
    }

    try {
        return JSON.parse(stored) as JsonValue;
    } catch (error) {
        console.warn(`Failed to parse local settings key "${storageKey}":`, error);
        return null;
    }
}

function writeLocalDocument(storageKey: string, value: JsonValue): void {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(storageKey, JSON.stringify(value));
    dispatchLocalStorageSyncEvent(storageKey);
}

function readLastSyncedUserId(): string | null {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(LAST_SYNCED_USER_ID_STORAGE_KEY);
}

function writeLastSyncedUserId(userId: string): void {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(LAST_SYNCED_USER_ID_STORAGE_KEY, userId);
}

function isSameJsonValue(left: JsonValue | null, right: JsonValue): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}

async function putUserSettingsDocument(
    documentKey: UserSettingsDocumentKey,
    value: JsonValue,
): Promise<void> {
    const requestBody: PutUserSettingsRequest = { value };
    const response = await fetch(`/api/user/settings/${documentKey}`, {
        method: "PUT",
        headers: {
            "Content-Type": "application/json",
        },
        credentials: "same-origin",
        body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
        throw new Error(await parseApiError(response));
    }
}

export function useUserSettingsSync(): void {
    const { session, isLoadingSession } = useAuthSession();
    const syncedUserIdRef = useRef<string | null>(null);
    const suppressUploadKeysRef = useRef<Set<string>>(new Set());
    const initialSyncCompletedRef = useRef(false);

    useEffect(() => {
        if (typeof window === "undefined") {
            return;
        }
        if (isLoadingSession) {
            return;
        }

        if (!session?.authenticated) {
            syncedUserIdRef.current = null;
            initialSyncCompletedRef.current = false;
            return;
        }

        if (syncedUserIdRef.current === session.user.id) {
            return;
        }

        const canSeedRemoteFromLocal = (() => {
            const lastSyncedUserId = readLastSyncedUserId();
            return lastSyncedUserId === null || lastSyncedUserId === session.user.id;
        })();

        let cancelled = false;
        syncedUserIdRef.current = session.user.id;
        initialSyncCompletedRef.current = false;

        void fetch("/api/user/settings", {
            credentials: "same-origin",
        })
            .then(async (response) => {
                if (!response.ok) {
                    throw new Error(await parseApiError(response));
                }
                return (await response.json()) as ListUserSettingsResponse;
            })
            .then(async (payload) => {
                const remoteDocuments = new Map(
                    payload.documents.map((document) => [document.documentKey, document]),
                );

                for (const mapping of SETTINGS_STORAGE_MAPPINGS) {
                    const remoteDocument = remoteDocuments.get(mapping.documentKey);
                    const localValue = readLocalDocument(mapping.storageKey);

                    if (remoteDocument) {
                        if (!isSameJsonValue(localValue, remoteDocument.value)) {
                            suppressUploadKeysRef.current.add(mapping.storageKey);
                            writeLocalDocument(mapping.storageKey, remoteDocument.value);
                            suppressUploadKeysRef.current.delete(mapping.storageKey);
                        }
                        continue;
                    }

                    if (canSeedRemoteFromLocal && localValue !== null) {
                        await putUserSettingsDocument(mapping.documentKey, localValue);
                    }
                }

                if (!cancelled) {
                    writeLastSyncedUserId(session.user.id);
                    initialSyncCompletedRef.current = true;
                }
            })
            .catch((error: unknown) => {
                console.error("[user-settings-sync] initial sync failed", error);
                if (!cancelled) {
                    initialSyncCompletedRef.current = true;
                }
            });

        return () => {
            cancelled = true;
        };
    }, [isLoadingSession, session]);

    useEffect(() => {
        if (typeof window === "undefined" || !session?.authenticated) {
            return;
        }

        const handleLocalStorageSync = (event: Event): void => {
            if (!initialSyncCompletedRef.current) {
                return;
            }

            const customEvent = event as CustomEvent<{ key?: string }>;
            const storageKey = customEvent.detail?.key;
            if (!storageKey) {
                return;
            }

            if (suppressUploadKeysRef.current.has(storageKey)) {
                return;
            }

            const mapping = SETTINGS_STORAGE_MAPPINGS.find(
                (candidate) => candidate.storageKey === storageKey,
            );
            if (!mapping) {
                return;
            }

            const value = readLocalDocument(storageKey);
            if (value === null) {
                return;
            }

            void putUserSettingsDocument(mapping.documentKey, value).catch((error: unknown) => {
                console.error("[user-settings-sync] document upload failed", {
                    documentKey: mapping.documentKey,
                    error,
                });
            });
        };

        window.addEventListener(LOCAL_STORAGE_SYNC_EVENT, handleLocalStorageSync as EventListener);
        return () => {
            window.removeEventListener(
                LOCAL_STORAGE_SYNC_EVENT,
                handleLocalStorageSync as EventListener,
            );
        };
    }, [session]);
}
