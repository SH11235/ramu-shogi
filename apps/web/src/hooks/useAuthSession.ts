import { useEffect, useEffectEvent, useState } from "react";

export const AUTH_SESSION_SYNC_EVENT = "ramu-auth-session-sync";

export interface SessionUser {
    id: string;
    email: string;
    displayName: string;
    avatarUrl: string | null;
    emailVerified: boolean;
    emailVerifiedAt: string | null;
}

export type AuthSessionResponse =
    | {
          authenticated: false;
          user: null;
      }
    | {
          authenticated: true;
          user: SessionUser;
      };

interface ApiErrorPayload {
    error?: string;
    message?: string;
}

export async function parseApiError(response: Response): Promise<string> {
    try {
        const payload = (await response.json()) as ApiErrorPayload;
        if (typeof payload.message === "string" && payload.message.trim() !== "") {
            return payload.message;
        }
        if (typeof payload.error === "string" && payload.error.trim() !== "") {
            return payload.error;
        }
    } catch {
        // noop
    }

    return `リクエストに失敗しました (${response.status})`;
}

export function dispatchAuthSessionSyncEvent(): void {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new Event(AUTH_SESSION_SYNC_EVENT));
}

export async function syncProfileDisplayNameIfNeeded(
    session: AuthSessionResponse | null,
    displayName: string,
): Promise<void> {
    if (!session?.authenticated) return;

    const normalizedDisplayName = displayName.trim();
    const currentDisplayName = session.user.displayName.trim();
    if (!normalizedDisplayName || normalizedDisplayName === currentDisplayName) {
        return;
    }

    const response = await fetch("/api/auth/profile", {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json",
        },
        credentials: "same-origin",
        body: JSON.stringify({
            displayName: normalizedDisplayName,
        }),
    });

    if (!response.ok) {
        throw new Error(await parseApiError(response));
    }

    dispatchAuthSessionSyncEvent();
}

export function useAuthSession() {
    const [session, setSession] = useState<AuthSessionResponse | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    async function refreshSession(): Promise<void> {
        setIsLoading(true);
        setError(null);

        try {
            const response = await fetch("/api/auth/session", {
                credentials: "same-origin",
            });
            if (!response.ok) {
                throw new Error(await parseApiError(response));
            }
            setSession((await response.json()) as AuthSessionResponse);
        } catch (nextError) {
            setError(
                nextError instanceof Error ? nextError.message : "セッションの取得に失敗しました",
            );
        } finally {
            setIsLoading(false);
        }
    }

    const refreshSessionEvent = useEffectEvent(async (): Promise<void> => {
        await refreshSession();
    });

    useEffect(() => {
        void refreshSessionEvent();
    }, []);

    useEffect(() => {
        if (typeof window === "undefined") return;

        const handleSessionSync = (): void => {
            void refreshSessionEvent();
        };

        window.addEventListener(AUTH_SESSION_SYNC_EVENT, handleSessionSync);
        return () => {
            window.removeEventListener(AUTH_SESSION_SYNC_EVENT, handleSessionSync);
        };
    }, []);

    return {
        session,
        sessionError: error,
        isLoadingSession: isLoading,
        refreshSession,
    };
}
