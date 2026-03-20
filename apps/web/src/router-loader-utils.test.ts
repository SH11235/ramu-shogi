import { describe, expect, it } from "vitest";
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
});
