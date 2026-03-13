import { useRouter } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { useState } from "react";
import { PageHeader } from "../../components/PageHeader";
import {
    dispatchAuthSessionSyncEvent,
    parseApiError,
    type SessionUser,
    useAuthSession,
} from "../../hooks/useAuthSession";

function AuthenticatedProfileSection({
    sessionUser,
    isLoadingSession,
    isSubmitting,
    onRefreshSession,
    onSaveDisplayName,
    onLogout,
}: {
    sessionUser: SessionUser;
    isLoadingSession: boolean;
    isSubmitting: boolean;
    onRefreshSession: () => Promise<void>;
    onSaveDisplayName: (displayName: string) => Promise<void>;
    onLogout: () => Promise<void>;
}): ReactElement {
    const [profileDisplayName, setProfileDisplayName] = useState(sessionUser.displayName);

    return (
        <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                    <h2 className="text-lg font-semibold text-foreground">ユーザー名設定</h2>
                    <p className="text-sm text-muted-foreground">
                        ログイン後のオンライン対局で自動入力される名前です。
                    </p>
                </div>
                <button
                    type="button"
                    onClick={() => void onRefreshSession()}
                    disabled={isLoadingSession || isSubmitting}
                    className="rounded-md border border-input px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/50 disabled:pointer-events-none disabled:opacity-50"
                >
                    再読み込み
                </button>
            </div>

            <form
                onSubmit={(event) => {
                    event.preventDefault();
                    void onSaveDisplayName(profileDisplayName);
                }}
                className="flex flex-col gap-3"
            >
                <label className="flex flex-col gap-1 text-sm">
                    <span className="font-medium text-foreground">ユーザー名</span>
                    <input
                        type="text"
                        value={profileDisplayName}
                        onChange={(event) => setProfileDisplayName(event.target.value)}
                        autoComplete="nickname"
                        maxLength={50}
                        required
                        className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    />
                </label>
                <div className="flex flex-col gap-2 sm:flex-row">
                    <button
                        type="submit"
                        disabled={isSubmitting || !profileDisplayName.trim()}
                        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
                    >
                        ユーザー名を保存
                    </button>
                    <button
                        type="button"
                        onClick={() => void onLogout()}
                        disabled={isSubmitting}
                        className="rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground shadow-sm transition-colors hover:bg-destructive/90 disabled:pointer-events-none disabled:opacity-50"
                    >
                        ログアウト
                    </button>
                </div>
            </form>
        </section>
    );
}

export default function AuthPage(): ReactElement {
    const router = useRouter();
    const { session, sessionError, isLoadingSession, refreshSession } = useAuthSession();
    const searchParams = new URLSearchParams(
        typeof window !== "undefined" ? window.location.search : "",
    );
    const requiresUsernameSetup = searchParams.get("setup") === "username";
    const nextPath = searchParams.get("next");
    const [status, setStatus] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const displayedError = error ?? sessionError;

    async function handleLogout(): Promise<void> {
        if (isSubmitting) return;

        setIsSubmitting(true);
        setError(null);
        setStatus(null);

        try {
            const response = await fetch("/api/auth/logout", {
                method: "POST",
                credentials: "same-origin",
            });
            if (!response.ok) {
                setError(await parseApiError(response));
                setIsSubmitting(false);
                return;
            }

            dispatchAuthSessionSyncEvent();
            await refreshSession();
            await router.invalidate();
            setStatus("ログアウトしました。");
            setIsSubmitting(false);
        } catch (nextError) {
            setError(nextError instanceof Error ? nextError.message : "ログアウトに失敗しました");
            setIsSubmitting(false);
        }
    }

    async function handleUpdateProfile(displayName: string): Promise<void> {
        if (isSubmitting || !session?.authenticated) return;

        setIsSubmitting(true);
        setError(null);
        setStatus(null);

        await fetch("/api/auth/profile", {
            method: "PATCH",
            headers: {
                "Content-Type": "application/json",
            },
            credentials: "same-origin",
            body: JSON.stringify({
                displayName,
            }),
        })
            .then(async (response) => {
                if (!response.ok) {
                    setError(await parseApiError(response));
                    setIsSubmitting(false);
                    return;
                }

                dispatchAuthSessionSyncEvent();
                await refreshSession();
                await router.invalidate();

                if (requiresUsernameSetup) {
                    const destination = nextPath?.startsWith("/") ? nextPath : null;
                    setIsSubmitting(false);
                    if (destination && destination !== "/auth") {
                        window.location.assign(destination);
                        return;
                    }
                    window.history.replaceState(null, "", "/auth");
                }

                setStatus("ユーザー名を更新しました。");
                setIsSubmitting(false);
            })
            .catch((nextError: unknown) => {
                setError(
                    nextError instanceof Error
                        ? nextError.message
                        : "ユーザー名の更新に失敗しました",
                );
                setIsSubmitting(false);
            });
    }

    function handleGoogleLogin(): void {
        const query = new URLSearchParams({
            next: "/auth",
            t: String(Date.now()),
        });
        window.location.assign(`/api/auth/google/start?${query.toString()}`);
    }

    return (
        <>
            <PageHeader items={[{ label: "ラム将棋", to: "/" }, { label: "認証" }]} />
            <main className="mx-auto flex max-w-[960px] flex-col gap-6 px-4 py-8">
                <div className="flex flex-col gap-2">
                    <h1 className="text-2xl font-bold text-foreground">
                        {session?.authenticated
                            ? requiresUsernameSetup && !session.user.displayName.trim()
                                ? "ユーザー名設定"
                                : "アカウント設定"
                            : "ログイン"}
                    </h1>
                    <p className="text-sm text-muted-foreground">
                        {session?.authenticated
                            ? requiresUsernameSetup && !session.user.displayName.trim()
                                ? "オンライン対局で使うユーザー名を設定してください。"
                                : "オンライン対局で使うユーザー名を設定できます。"
                            : "Google アカウントで認証できます。"}
                    </p>
                </div>

                {status && (
                    <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700">
                        {status}
                    </div>
                )}
                {displayedError && (
                    <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                        {displayedError}
                    </div>
                )}

                {!session?.authenticated && (
                    <>
                        <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
                            <div className="flex flex-col gap-4">
                                <div className="space-y-1">
                                    <h2 className="text-lg font-semibold text-foreground">
                                        Google でログイン
                                    </h2>
                                    <p className="text-sm text-muted-foreground">
                                        Google アカウントでログインすると、このページに戻ります。
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={handleGoogleLogin}
                                    className="inline-flex h-10 items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted/50"
                                >
                                    Google アカウントでログイン
                                </button>
                                <p className="text-xs text-muted-foreground">
                                    メールアドレスとパスワードによる認証は廃止しました。
                                </p>
                            </div>
                        </section>
                    </>
                )}

                {isLoadingSession ? (
                    <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
                        <p className="text-sm text-muted-foreground">読み込み中...</p>
                    </section>
                ) : session?.authenticated ? (
                    <AuthenticatedProfileSection
                        key={`${session.user.id}:${session.user.displayName}`}
                        sessionUser={session.user}
                        isLoadingSession={isLoadingSession}
                        isSubmitting={isSubmitting}
                        onRefreshSession={refreshSession}
                        onSaveDisplayName={handleUpdateProfile}
                        onLogout={handleLogout}
                    />
                ) : (
                    <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
                        <p className="text-sm text-muted-foreground">未ログインです。</p>
                    </section>
                )}
            </main>
        </>
    );
}
