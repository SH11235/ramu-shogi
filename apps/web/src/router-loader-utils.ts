import { redirect } from "@tanstack/react-router";
import { dispatchAuthSessionSyncEvent } from "./hooks/useAuthSession";
import { sanitizeReturnPath } from "./lib/loginReturn";
import { RATE_LIMITED_MESSAGE } from "./lib/rateLimitMessage";

type LoaderResponseStatus = "ok" | "needs_auth";

interface HandleLoaderResponseOptions {
    errorMessage: string;
    notFoundMessage?: string;
    onUnauthorized?: "return_needs_auth" | "throw" | "redirect_to_auth";
    unauthorizedMessage?: string;
    /**
     * `redirect_to_auth` でログインの画面へ送るときの、ログイン後の戻り先
     * （開こうとしていたページのパス + クエリ + ハッシュ）。
     */
    returnTo?: string;
}

export function handleLoaderResponse(
    response: Pick<Response, "ok" | "status">,
    options: HandleLoaderResponseOptions,
): LoaderResponseStatus {
    if (response.status === 401) {
        if (options.onUnauthorized === "return_needs_auth") {
            return "needs_auth";
        }
        if (options.onUnauthorized === "redirect_to_auth") {
            // サーバーから見ると未ログイン。画面の認証状態が古い（ログイン中のまま）と、ログインの
            // 画面にログインのボタンが出ず、戻り先が使われない。取り直しを頼んでから送る。
            dispatchAuthSessionSyncEvent();
            throw redirect({
                to: "/auth",
                search: { next: sanitizeReturnPath(options.returnTo) ?? undefined },
            });
        }
        throw new Error(options.unauthorizedMessage ?? "ログインが必要です");
    }

    if (response.status === 429) {
        throw new Error(RATE_LIMITED_MESSAGE);
    }

    if (response.status === 404 && options.notFoundMessage) {
        throw new Error(options.notFoundMessage);
    }

    if (!response.ok) {
        throw new Error(options.errorMessage);
    }

    return "ok";
}
