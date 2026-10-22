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

// 高さはブラウザのバーを除いた実際の表示域（iPhone SE・大きめの iPhone）。
for (const viewport of [
    { width: 320, height: 568 },
    { width: 375, height: 553 },
    { width: 430, height: 717 },
]) {
    test(`対局の設定が縦にはみ出さず 1 画面に収まる ${viewport.width}x${viewport.height}`, async ({
        page,
    }) => {
        await page.setViewportSize(viewport);
        await page.goto("/play");
        const start = page.getByRole("button", { name: "対局開始", exact: true });
        await start.waitFor();
        // 駒落ちは「どちらから指すか」の 1 行が増えるので、その状態でも測る。
        for (const startPosition of ["hirate", "bishop"]) {
            await page.getByLabel("開始局面", { exact: true }).selectOption(startPosition);
            await expect(start).toBeInViewport({ ratio: 1 });
            await expect
                .poll(() => page.evaluate(() => document.documentElement.scrollHeight))
                .toBeLessThanOrEqual(viewport.height);
        }
    });
}

test("持ち時間の「指定」は時間だけを聞き、決めた時間が選択肢に出て、設定は 1 画面に収まる", async ({
    page,
}) => {
    await page.setViewportSize({ width: 375, height: 553 });
    await page.goto("/play");
    await page.getByRole("button", { name: "対局開始", exact: true }).waitFor();
    const myTime = page.getByRole("group", { name: "あなたの持ち時間" });
    await myTime.getByRole("button", { name: "指定", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "あなたの持ち時間を指定" });
    await dialog.getByLabel("持ち時間").fill("5");
    await dialog.getByLabel("秒読み").fill("20");
    await dialog.getByRole("button", { name: "この時間にする" }).click();
    await expect(dialog).toBeHidden();
    await expect(myTime.getByRole("button", { name: "5分 秒読み20秒" })).toHaveAttribute(
        "aria-pressed",
        "true",
    );
    await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollHeight))
        .toBeLessThanOrEqual(553);
});

test("開始局面の編集が縦にはみ出さず、先に指す側を対局者で選べる", async ({ page }) => {
    await page.setViewportSize({ width: 430, height: 717 });
    await page.goto("/play");
    await page.getByRole("button", { name: "対局開始", exact: true }).waitFor();
    await page.getByLabel("相手", { exact: true }).selectOption("material");
    await page.getByLabel("開始局面", { exact: true }).selectOption("edit");
    const decide = page.getByRole("button", { name: "この局面に決める", exact: true });
    await expect(decide).toBeInViewport({ ratio: 1 });
    await page.getByRole("button", { name: /^簡易AI（後手）$/ }).click();
    await expect(page.getByRole("button", { name: /^簡易AI（後手）$/ })).toHaveAttribute(
        "aria-pressed",
        "true",
    );
    await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollHeight))
        .toBeLessThanOrEqual(717);
});

test("小画面の対局中、操作が画面の中に留まり、探索情報の詳細も読める", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto("/play");
    await page.getByRole("button", { name: /対局開始$/ }).waitFor();
    await page.getByLabel("相手", { exact: true }).selectOption("material");
    // AI が先に指す（探索情報は AI の考慮中に出る）。
    await page.getByRole("button", { name: "☖ 後手", exact: true }).click();
    await page.getByRole("button", { name: "詳細設定", exact: true }).click();
    await page.getByLabel("AI の探索情報（NPS・深さ）を表示").check();
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

test("対局 → 投了 → 結果 → もう一局まで、盤が動かず操作に届く", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/play");
    await page.getByRole("button", { name: /対局開始$/ }).waitFor();
    await page.getByLabel("相手", { exact: true }).selectOption("material");
    await page.getByLabel("AI の考慮時間", { exact: true }).selectOption("1");
    await page.getByRole("button", { name: "対局開始", exact: true }).click();

    // 対局中: 盤と操作が 1 画面に収まり、縦にも横にもはみ出さない。
    const resign = page.getByRole("button", { name: "投了", exact: true });
    await expect(resign).toBeInViewport();
    const square = page.locator('[data-square="5e"]');
    const boardTop = (await square.boundingBox())?.y;
    await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollHeight))
        .toBeLessThanOrEqual(667);

    // 1 手指して、AI の応手を待つ。
    await page.locator('[data-square="7g"]').click();
    await page.locator('[data-square="7f"]').click();
    await expect(page.getByText("あなたの番です")).toBeVisible();

    // 投了すると、結果と次の一歩が下端に出る。盤は動かない。
    await resign.click();
    await page.getByRole("button", { name: "投了する", exact: true }).click();
    await expect(page.getByRole("heading", { name: "あなたの負け" })).toBeVisible();
    await expect(page.getByRole("button", { name: "研究ノートで振り返る" })).toBeInViewport();
    expect((await square.boundingBox())?.y).toBe(boardTop);

    // もう一局は、同じ設定ですぐ始まる。
    await page.getByRole("button", { name: "もう一局", exact: true }).click();
    await expect(page.getByText("あなたの番です")).toBeVisible();
    expect((await square.boundingBox())?.y).toBe(boardTop);
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
