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

// 入力欄とボタンを横に並べた行・盤・パンくずが、いちばん狭い幅でも横にはみ出さないこと。
for (const [path, settled] of [
    ["/online", "ルームID を入力して参加"],
    ["/online/create", "部屋を作成する"],
    ["/book-viewer", "定跡ファイルを選ぶ"],
    ["/studies", "研究ノートにする"],
    ["/privacy", "9. ポリシーの変更"],
] as const) {
    test(`320px 幅で横にはみ出さない ${path}`, async ({ page }) => {
        await page.setViewportSize({ width: 320, height: 568 });
        await page.goto(path);
        // 本文が出そろってから測る（出る前は、はみ出していなくて当たり前なので）。
        await page.getByText(settled, { exact: true }).waitFor();
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
            320,
        );
    });
}

test("ルームID の「参加する」が縦書きに折れない", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto("/online");
    const box = await page.getByRole("button", { name: "参加する", exact: true }).boundingBox();
    expect(box?.height).toBeLessThanOrEqual(48);
});

test("定跡ビュアーの盤が画面の幅に収まる", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto("/book-viewer");
    await page.getByLabel("定跡ファイル").setInputFiles({
        name: "book.db",
        mimeType: "text/plain",
        buffer: Buffer.from(
            [
                "#YANEURAOU-DB2016 1.00",
                "sfen lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1",
                "7g7f 3c3d 0 32 1",
                "",
            ].join("\n"),
        ),
    });
    const square = page.locator('[data-square="1a"]');
    await square.waitFor();
    await expect
        .poll(async () => {
            const box = await square.boundingBox();
            return box ? box.x + box.width : Number.POSITIVE_INFINITY;
        })
        .toBeLessThanOrEqual(320);
    await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(320);
});
