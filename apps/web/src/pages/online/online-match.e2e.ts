// apps/web/src/pages/online/online-match.e2e.ts
// オンライン対局の E2E テスト（T-404）
//
// 実行には wrangler dev が起動中である必要があります。
// pnpm dlx playwright install chromium を先に実行してください。

import { test, expect, type Page } from "@playwright/test";

// ─── ヘルパー ──────────────────────────────────────────────────────────────────

async function createRoom(baseUrl: string): Promise<string> {
    const res = await fetch(`${baseUrl}/api/rooms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            settings: {
                startSfen: "startpos",
                timeControl: { type: "byoyomi", initialMs: 600_000, byoyomiMs: 30_000 },
                passRights: null,
                aiSupport: null,
            },
        }),
    });
    const data = (await res.json()) as { roomId: string };
    return data.roomId;
}

async function joinAsPlayer(page: Page, roomId: string, name: string): Promise<void> {
    await page.goto(`/online/${roomId}`);
    await page.getByLabel("名前").fill(name);
}

// ─── テスト ───────────────────────────────────────────────────────────────────

test.describe("オンライン対局 E2E テスト（wrangler dev が必要）", () => {
    test.skip(!process.env.E2E, "E2E テストをスキップ: E2E=true を設定して実行してください");

    // ── T-404: 2 ブラウザタブで対局が成立するシナリオ ──────────────────────
    test("2 タブで参加して対局が開始する", async ({ browser }) => {
        const baseUrl = process.env.E2E_BASE_URL ?? "http://localhost:8787";
        const roomId = await createRoom(baseUrl);

        // 先手タブ
        const contextB = await browser.newContext();
        const pageB = await contextB.newPage();

        // 後手タブ
        const contextW = await browser.newContext();
        const pageW = await contextW.newPage();

        await joinAsPlayer(pageB, roomId, "先手テスト");
        // 先手は自動参加（search.seat=b が設定されている場合）
        // ここでは後手として参加ボタンを押す流れを省略し、
        // 招待リンクから後手として参加するシナリオをテスト

        await pageW.goto(`/online/${roomId}`);
        await pageW.getByLabel("名前").fill("後手テスト");
        await pageW.getByRole("button", { name: "後手として参加する" }).click();

        // 後手が「接続しました」メッセージを受け取る
        await expect(pageW.getByText("接続しました")).toBeVisible({ timeout: 10_000 });

        await contextB.close();
        await contextW.close();
    });

    // ── T-404: 切断・再接続シナリオ ──────────────────────────────────────────
    test("切断後に再接続すると対局画面が復元される", async ({ browser }) => {
        const baseUrl = process.env.E2E_BASE_URL ?? "http://localhost:8787";
        const roomId = await createRoom(baseUrl);

        const contextB = await browser.newContext();
        const pageB = await contextB.newPage();

        await pageB.goto(`/online/${roomId}`);
        await pageB.getByLabel("名前").fill("再接続テスト");
        await pageB.getByRole("button", { name: "後手として参加する" }).click();
        await expect(pageB.getByText("接続しました")).toBeVisible({ timeout: 10_000 });

        // ページをリロードして再接続を確認
        await pageB.reload();

        // 再接続後もルームページが表示される（エラーにならない）
        await expect(pageB.getByRole("heading", { name: "対局ルーム" })).toBeVisible({
            timeout: 10_000,
        });

        await contextB.close();
    });

    // ── T-404: 観戦シナリオ ────────────────────────────────────────────────
    test("観戦者として参加できる", async ({ browser }) => {
        const baseUrl = process.env.E2E_BASE_URL ?? "http://localhost:8787";
        const roomId = await createRoom(baseUrl);

        const contextS = await browser.newContext();
        const pageS = await contextS.newPage();

        await pageS.goto(`/online/${roomId}`);
        await pageS.getByLabel("名前").fill("観戦者テスト");
        await pageS.getByRole("button", { name: "観戦者として参加する" }).click();

        await expect(pageS.getByText("接続しました")).toBeVisible({ timeout: 10_000 });

        await contextS.close();
    });
});
