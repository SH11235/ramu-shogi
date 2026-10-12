import { redirect } from "@tanstack/react-router";
import { sanitizeReturnPath } from "./lib/loginReturn";

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
            throw redirect({
                to: "/auth",
                search: { next: sanitizeReturnPath(options.returnTo) ?? undefined },
            });
        }
        throw new Error(options.unauthorizedMessage ?? "ログインが必要です");
    }

    if (response.status === 404 && options.notFoundMessage) {
        throw new Error(options.notFoundMessage);
    }

    if (!response.ok) {
        throw new Error(options.errorMessage);
    }

    return "ok";
}
