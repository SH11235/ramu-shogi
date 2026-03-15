import { redirect } from "@tanstack/react-router";

type LoaderResponseStatus = "ok" | "needs_auth";

interface HandleLoaderResponseOptions {
    errorMessage: string;
    notFoundMessage?: string;
    onUnauthorized?: "return_needs_auth" | "throw" | "redirect_to_auth";
    unauthorizedMessage?: string;
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
            throw redirect({ to: "/auth" });
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
