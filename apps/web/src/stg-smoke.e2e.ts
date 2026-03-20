import { expect, test } from "@playwright/test";

test.describe("stg smoke", () => {
    test.skip(!process.env.E2E, "E2E テストをスキップ: E2E=true を設定して実行してください");

    test("auth / games / nnue pages load after dev login", async ({ page }) => {
        await page.goto("/api/auth/dev-login?player=1");
        await page.waitForURL(/\/$/, { timeout: 15_000 });

        await page.goto("/auth");
        await expect(page.getByRole("heading", { name: "アカウント設定" })).toBeVisible();

        await page.goto("/games");
        await expect(page.getByRole("heading", { name: "棋譜一覧" })).toBeVisible();

        await page.goto("/nnue");
        await expect(page.getByRole("heading", { name: "NNUE ファイル" })).toBeVisible();
    });
});
