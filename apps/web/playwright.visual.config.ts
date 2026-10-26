// 画面の見た目の比較（スクリーンショット）。リファクタリングの前後で見た目が変わっていないかを確かめる。
//
// 実行方法:
//   1. ブラウザのインストール: pnpm dlx playwright install chromium
//   2. 変更前（main など）で基準を撮る: pnpm --filter web test:visual:update
//   3. 変更後に比べる: pnpm --filter web test:visual
//      差分は playwright-report に出る（pnpm exec playwright show-report）。
//
// 基準の画像はフォントや OS で変わるので、リポジトリには入れない（visual-snapshots/ は .gitignore）。

import { defineConfig, devices } from "@playwright/test";

const PORT = 5199;

export default defineConfig({
    testDir: "./src",
    testMatch: "**/*.visual.ts",
    snapshotPathTemplate: "visual-snapshots/{arg}{ext}",
    fullyParallel: true,
    reporter: [["list"], ["html", { open: "never" }]],
    timeout: 60_000,
    expect: {
        toHaveScreenshot: { animations: "disabled", caret: "hide", maxDiffPixels: 0 },
    },
    use: {
        baseURL: `http://localhost:${PORT}`,
        ...devices["Desktop Chrome"],
    },
    webServer: {
        command: `pnpm exec vite --port ${PORT} --strictPort`,
        port: PORT,
        reuseExistingServer: true,
        timeout: 120_000,
    },
});
