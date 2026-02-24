// apps/web/playwright.config.ts
// Playwright E2E テスト設定（T-404）
//
// 実行方法:
//   1. ブラウザのインストール: pnpm dlx playwright install chromium
//   2. wrangler dev を別ターミナルで起動（port 8787）
//   3. pnpm --filter web test:e2e

import { defineConfig, devices } from "@playwright/test";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:8787";

export default defineConfig({
    testDir: "./src",
    testMatch: "**/*.e2e.ts",
    fullyParallel: false, // 2 タブ対戦テストのため直列実行
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    workers: 1,
    reporter: "list",
    timeout: 30_000,

    use: {
        baseURL: BASE_URL,
        trace: "on-first-retry",
    },

    projects: [
        {
            name: "chromium",
            use: { ...devices["Desktop Chrome"] },
        },
    ],
});
