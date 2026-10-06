// 2 ブラウザで対局を最後まで進める E2E テストの設定
//
// frontend / backend の両 Worker が必要なので、既定の `pnpm --filter web test:e2e` には含めない。
// 実行方法は apps/web/README.md の「オンライン対局の E2E テスト」を参照。

import { defineConfig, devices } from "@playwright/test";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:8787";

export default defineConfig({
    testDir: "./src",
    testMatch: "**/*.room.e2e.ts",
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    retries: 0,
    workers: 1,
    reporter: "list",
    timeout: 90_000,
    expect: { timeout: 10_000 },

    use: {
        baseURL: BASE_URL,
        trace: "retain-on-failure",
        screenshot: "only-on-failure",
    },

    projects: [
        {
            name: "chromium",
            use: { ...devices["Desktop Chrome"] },
        },
    ],
});
