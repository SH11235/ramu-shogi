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

const PORT = Number(process.env.VISUAL_PORT ?? 5289);

export default defineConfig({
    testDir: "./src",
    testMatch: "**/*.visual.ts",
    snapshotPathTemplate: "visual-snapshots/{arg}{ext}",
    fullyParallel: true,
    reporter: [["list"], ["html", { open: "never" }]],
    timeout: 60_000,
    expect: {
        // threshold は色の近さの許容。既定（0.2）だと市松の濃淡のような近い色の違いを見逃す。
        // 0 にすると、角の丸みのにじみが撮るたびに数ピクセル揺れて落ちる。
        toHaveScreenshot: {
            animations: "disabled",
            caret: "hide",
            maxDiffPixels: 0,
            threshold: 0.05,
        },
    },
    use: {
        baseURL: `http://localhost:${PORT}`,
        ...devices["Desktop Chrome"],
    },
    webServer: {
        command: `pnpm exec vite --port ${PORT} --strictPort`,
        port: PORT,
        // 同じポートで別の作業ツリーのサーバーが動いていると、その画面を撮ってしまう。必ず自分で起動する。
        reuseExistingServer: false,
        timeout: 120_000,
    },
});
