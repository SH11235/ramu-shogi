import {
    LOCAL_STORAGE_SYNC_EVENT,
    type LocalStorageSyncDetail,
} from "@shogi/ui/components/shogi-match/hooks/useLocalStorage";
import { useEffect, useState } from "react";
import { createUserSettingsSync } from "../lib/userSettingsSync";
import { dispatchAuthSessionSyncEvent, useAuthSession } from "./useAuthSession";

export function useUserSettingsSync(): { syncError: string | null; retrySync: () => void } {
    const { session, sessionError, isLoadingSession } = useAuthSession();
    const [syncError, setSyncError] = useState<string | null>(null);
    const [sync] = useState(() =>
        createUserSettingsSync(setSyncError, dispatchAuthSessionSyncEvent),
    );

    useEffect(() => {
        const handleLocalStorageSync = (event: Event): void => {
            const detail = (event as CustomEvent<LocalStorageSyncDetail>).detail;
            if (detail?.key) sync.localChanged(detail.key, detail.source);
        };
        window.addEventListener(LOCAL_STORAGE_SYNC_EVENT, handleLocalStorageSync);
        return () => {
            window.removeEventListener(LOCAL_STORAGE_SYNC_EVENT, handleLocalStorageSync);
        };
    }, [sync]);

    useEffect(() => {
        if (isLoadingSession || sessionError) {
            sync.pause();
        } else if (session?.authenticated) {
            sync.start(session.user.id);
        } else {
            sync.reset();
        }
        return sync.pause;
    }, [isLoadingSession, session, sessionError, sync]);

    return { syncError, retrySync: dispatchAuthSessionSyncEvent };
}
