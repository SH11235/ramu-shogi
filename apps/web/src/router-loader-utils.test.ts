import { RATE_LIMITED_MESSAGE } from "@shogi/app-core";
import { describe, expect, it, vi } from "vitest";
import { handleLoaderResponse } from "./router-loader-utils";

describe("handleLoaderResponse", () => {
    it("401 を needs_auth として返せる", () => {
        const result = handleLoaderResponse(
            { ok: false, status: 401 },
            {
                errorMessage: "failed",
                onUnauthorized: "return_needs_auth",
            },
        );

        expect(result).toBe("needs_auth");
    });

    it("401 を既存メッセージで throw できる", () => {
        expect(() =>
            handleLoaderResponse(
                { ok: false, status: 401 },
                {
                    errorMessage: "failed",
                    onUnauthorized: "throw",
                },
            ),
        ).toThrow("ログインが必要です");
    });

    const catchRedirect = (returnTo: string | undefined): { to?: string; search?: unknown } => {
        try {
            handleLoaderResponse(
                { ok: false, status: 401 },
                { errorMessage: "failed", onUnauthorized: "redirect_to_auth", returnTo },
            );
        } catch (thrown) {
            return (thrown as { options: { to?: string; search?: unknown } }).options;
        }
        throw new Error("redirect が投げられなかった");
    };

    it("401 でログインの画面へ送るとき、開こうとしていたページを戻り先として付ける", () => {
        expect(catchRedirect("/games/abc/review?ply=3#c")).toMatchObject({
            to: "/auth",
            search: { next: "/games/abc/review?ply=3#c" },
        });
    });

    it("戻り先が無い・使えないときは、戻り先なしでログインの画面へ送る", () => {
        for (const returnTo of [undefined, "//evil.example", "https://evil.example/", "/auth"]) {
            expect(catchRedirect(returnTo)).toMatchObject({
                to: "/auth",
                search: { next: undefined },
            });
        }
    });

    it("401 でログインの画面へ送る前に、ログイン状態の取り直しを頼む（古い「ログイン中」のままだと、ログインのボタンが出ない）", () => {
        const onSync = vi.fn();
        window.addEventListener("ramu-auth-session-sync", onSync);
        try {
            catchRedirect("/games/abc");
            expect(onSync).toHaveBeenCalledTimes(1);

            // ログインの画面へ送らない扱いでは、頼まない。
            handleLoaderResponse(
                { ok: false, status: 401 },
                { errorMessage: "failed", onUnauthorized: "return_needs_auth" },
            );
            handleLoaderResponse({ ok: true, status: 200 }, { errorMessage: "failed" });
            expect(onSync).toHaveBeenCalledTimes(1);
        } finally {
            window.removeEventListener("ramu-auth-session-sync", onSync);
        }
    });

    it("404 を notFoundMessage で throw する", () => {
        expect(() =>
            handleLoaderResponse(
                { ok: false, status: 404 },
                {
                    errorMessage: "failed",
                    notFoundMessage: "棋譜が見つかりません",
                },
            ),
        ).toThrow("棋譜が見つかりません");
    });

    it("その他の !ok を errorMessage で throw する", () => {
        expect(() =>
            handleLoaderResponse(
                { ok: false, status: 500 },
                {
                    errorMessage: "取得に失敗しました",
                },
            ),
        ).toThrow("取得に失敗しました");
    });

    it("ok の場合は ok を返す", () => {
        const result = handleLoaderResponse(
            { ok: true, status: 200 },
            {
                errorMessage: "failed",
            },
        );

        expect(result).toBe("ok");
    });

    it("429 は画面ごとの失敗文言ではなく、待ってから試すよう案内する", () => {
        expect(() =>
            handleLoaderResponse(
                { ok: false, status: 429 },
                { errorMessage: "failed", notFoundMessage: "missing" },
            ),
        ).toThrow(RATE_LIMITED_MESSAGE);
    });
});
