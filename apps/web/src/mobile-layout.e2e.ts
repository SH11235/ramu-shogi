import { expect, test } from "@playwright/test";

test.use({ isMobile: true, hasTouch: true });

for (const viewport of [
    { width: 320, height: 568 },
    { width: 375, height: 667 },
    { width: 667, height: 375 },
]) {
    test(`モバイルの盤・操作・ページメニューに到達できる ${viewport.width}x${viewport.height}`, async ({
        page,
    }) => {
        await page.setViewportSize(viewport);
        await page.goto("/play");
        await page.getByRole("button", { name: "設定を開く", exact: true }).waitFor();
        await expect
            .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
            .toBeLessThanOrEqual(viewport.width);
        await page.locator('[data-square="1i"]').click({ trial: true });
        await page.getByRole("button", { name: "対局を開始", exact: true }).click({ trial: true });
        await page.getByRole("button", { name: "設定を開く", exact: true }).click({ trial: true });
        await page.getByRole("button", { name: "メニュー", exact: true }).click();
        await expect(page.getByRole("dialog")).toBeVisible();
    });
}

test("小画面の探索情報が停止ボタンを覆わず、タップで詳細を読める", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto("/play");
    await page.getByRole("button", { name: "設定を開く", exact: true }).click();
    for (const select of await page.getByLabel("プレイヤー", { exact: true }).all()) {
        await select.selectOption("material");
    }
    await page.getByLabel("探索情報 (NPS/深さ) を表示").check();
    await page.getByRole("button", { name: "閉じる", exact: true }).click();
    await page.getByRole("button", { name: "対局を開始", exact: true }).click();
    const details = page.getByRole("button", { name: "探索情報の詳細", exact: true });
    await expect(details).toBeVisible();
    const stop = page.getByRole("button", { name: "停止", exact: true });
    await stop.click({ trial: true });
    await details.click();
    await expect(page.getByRole("dialog", { name: "探索情報", exact: true })).toContainText(
        "nodes",
    );
    await page.getByRole("button", { name: "閉じる", exact: true }).click();
    await stop.click();
    await expect(page.getByRole("button", { name: "対局再開", exact: true })).toBeVisible();
});
