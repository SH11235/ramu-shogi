import { expect, test } from "@playwright/test";

test.use({ isMobile: true, hasTouch: true });

for (const viewport of [
    { width: 320, height: 568 },
    { width: 375, height: 667 },
    { width: 667, height: 375 },
]) {
    test(`モバイルの対局の設定・操作・ページメニューに到達できる ${viewport.width}x${viewport.height}`, async ({
        page,
    }) => {
        await page.setViewportSize(viewport);
        await page.goto("/play");
        // 最初の画面は対局の設定（相手・手番・時間を選んで始める）。
        const start = page.getByRole("button", { name: /対局開始$/ });
        await start.waitFor();
        await expect
            .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
            .toBeLessThanOrEqual(viewport.width);
        await start.click({ trial: true });
        await page.getByLabel("相手", { exact: true }).selectOption("material");
        await page.getByRole("button", { name: "詳細設定", exact: true }).click({ trial: true });
        await page.getByRole("button", { name: "メニュー", exact: true }).click();
        await expect(page.getByRole("dialog")).toBeVisible();
    });
}

test("小画面の対局中、操作が画面の中に留まり、探索情報の詳細も読める", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto("/play");
    await page.getByRole("button", { name: /対局開始$/ }).waitFor();
    await page.getByLabel("相手", { exact: true }).selectOption("material");
    // AI が先に指す（探索情報は AI の考慮中に出る）。
    await page.getByRole("button", { name: "☖ 後手", exact: true }).click();
    await page.getByRole("button", { name: "詳細設定", exact: true }).click();
    await page.getByLabel("探索情報 (NPS/深さ) を表示").check();
    await page.getByRole("button", { name: "閉じる", exact: true }).click();
    await page.getByRole("button", { name: "対局開始", exact: true }).click();
    const details = page.getByRole("button", { name: "探索情報の詳細", exact: true });
    await expect(details).toBeVisible();
    // 対局の操作は画面の下端に留まり、探索情報に覆われない。
    const pause = page.getByRole("button", { name: "一時停止", exact: true });
    await expect(pause).toBeInViewport();
    await pause.click({ trial: true });
    await details.click();
    await expect(page.getByRole("dialog", { name: "探索情報", exact: true })).toContainText(
        "nodes",
    );
    await page.getByRole("button", { name: "閉じる", exact: true }).click();
    await pause.click();
    await expect(page.getByRole("button", { name: "対局を再開", exact: true })).toBeVisible();
});
