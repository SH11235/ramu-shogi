import type {
    ApiErrorResponse,
    AuthSessionResponse,
    AuthSessionUser,
    UpdateProfileRequest,
} from "@shogi/api-contract";
import type { ReactElement, ReactNode } from "react";
import { createContext, useContext, useEffect, useEffectEvent, useRef, useState } from "react";
import { RATE_LIMITED_MESSAGE } from "../lib/rateLimitMessage";

const AUTH_SESSION_SYNC_EVENT = "ramu-auth-session-sync";

/**
 * `/api/auth/session` を待つ上限。返らないままだと `isLoadingSession` が true のまま残り、
 * ログイン状態が分かるのを待つ画面（研究ノートの入口など）が進めなくなる。
 */
export const AUTH_SESSION_TIMEOUT_MS = 10_000;
const SESSION_TIMEOUT_MESSAGE = "ログイン状態を確認できませんでした（時間切れ）";

export type SessionUser = AuthSessionUser;

export async function parseApiError(response: Response): Promise<string> {
    if (response.status === 429) return RATE_LIMITED_MESSAGE;
    try {
        const payload = (await response.json()) as ApiErrorResponse;
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

    const requestBody: UpdateProfileRequest = {
        displayName: normalizedDisplayName,
    };
    const response = await fetch("/api/auth/profile", {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json",
        },
        credentials: "same-origin",
        body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
        throw new Error(await parseApiError(response));
    }

    dispatchAuthSessionSyncEvent();
}

async function fetchSession(signal: AbortSignal): Promise<AuthSessionResponse> {
    const response = await fetch("/api/auth/session", {
        credentials: "same-origin",
        signal,
    });
    // 404 はバックエンド未接続のため未認証として扱う
    if (response.status === 404) return { authenticated: false, user: null };
    if (!response.ok) {
        throw new Error(await parseApiError(response));
    }
    return (await response.json()) as AuthSessionResponse;
}

interface AuthSessionContextValue {
    session: AuthSessionResponse | null;
    sessionError: string | null;
    isLoadingSession: boolean;
    refreshSession: () => Promise<void>;
}

const AuthSessionContext = createContext<AuthSessionContextValue | null>(null);

export function AuthSessionProvider({ children }: { children: ReactNode }): ReactElement {
    const [session, setSession] = useState<AuthSessionResponse | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    // 取り直しが重なったときは、最後に始めた問い合わせの結果だけを使う（先に始めた方の応答が
    // あとから届いて、切り替え後のアカウントを前のアカウントで上書きしないため）。
    const latestRequest = useRef(0);

    async function refreshSession(): Promise<void> {
        const request = ++latestRequest.current;
        const isLatest = (): boolean => request === latestRequest.current;
        setIsLoading(true);
        setError(null);

        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
                const timeoutError = new Error(SESSION_TIMEOUT_MESSAGE);
                controller.abort(timeoutError);
                reject(timeoutError);
            }, AUTH_SESSION_TIMEOUT_MS);
        });
        try {
            const next = await Promise.race([fetchSession(controller.signal), timeout]);
            if (isLatest()) setSession(next);
        } catch (nextError) {
            if (!isLatest()) return;
            setError(
                nextError instanceof Error ? nextError.message : "セッションの取得に失敗しました",
            );
        } finally {
            clearTimeout(timer);
            if (isLatest()) setIsLoading(false);
        }
    }

    const refreshSessionEvent = useEffectEvent(refreshSession);

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

    const value: AuthSessionContextValue = {
        session,
        sessionError: error,
        isLoadingSession: isLoading,
        refreshSession,
    };

    return <AuthSessionContext.Provider value={value}>{children}</AuthSessionContext.Provider>;
}

export function useAuthSession(): AuthSessionContextValue {
    const context = useContext(AuthSessionContext);
    if (context === null) {
        throw new Error("useAuthSession must be used within an AuthSessionProvider");
    }
    return context;
}
