import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { visualizer } from "rollup-plugin-visualizer";
import { defineConfig, loadEnv } from "vite";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

// ANALYZE=true でバンドル分析レポートを生成
const isAnalyze = process.env.ANALYZE === "true";

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
    const env = loadEnv(mode, rootDir, "");

    return {
        // Cloudflare Workers 配信では "/" を使う。過去の GitHub Pages 向け fallback は維持するが、
        // 実際の値は .env.production などから loadEnv で解決する。
        base: env.VITE_BASE_PATH || (command === "build" ? "/ramu-shogi/" : "/"),
        server: {
            headers: {
                "Cross-Origin-Opener-Policy": "same-origin",
                "Cross-Origin-Embedder-Policy": "require-corp",
            },
            allowedHosts: env.VITE_ALLOWED_HOSTS?.split(",") ?? [],
            proxy: {
                "/api": {
                    target: "http://localhost:8787",
                    changeOrigin: true,
                    ws: true,
                },
            },
        },
        worker: {
            // ES モジュール形式の Worker を使用する。
            // engine-wasm 内の Worker が import 文を使用するため必須。
            // 主要ブラウザ対応状況: Chrome 80+, Edge 80+, Safari 15+, Firefox 114+
            // (Firefox が最後発で 2023年6月にサポート、現在は全主要ブラウザで利用可能)
            format: "es",
        },
        optimizeDeps: {
            // @shogi/engine-wasm を Vite の pre-bundle (esbuild 変換) から除外。
            // wasm-bindgen が生成する JS は特殊な形式のため、
            // esbuild で変換すると WASM の初期化が壊れる。
            exclude: ["@shogi/engine-wasm"],
        },
        preview: {
            headers: {
                "Cross-Origin-Opener-Policy": "same-origin",
                "Cross-Origin-Embedder-Policy": "require-corp",
            },
        },
        plugins: [
            tailwindcss(),
            react({
                babel: {
                    plugins: ["babel-plugin-react-compiler"],
                },
            }),
            ...(isAnalyze
                ? [
                      visualizer({
                          filename: "dist/stats.html",
                          open: true,
                          gzipSize: true,
                          brotliSize: true,
                      }),
                  ]
                : []),
        ],
        resolve: {
            alias: [
                {
                    find: /^@shogi\/app-core$/,
                    replacement: path.resolve(rootDir, "../../packages/app-core/src"),
                },
                {
                    find: /^@shogi\/design-system$/,
                    replacement: path.resolve(rootDir, "../../packages/design-system/src"),
                },
                { find: /^@shogi\/ui$/, replacement: path.resolve(rootDir, "../../packages/ui/src") },
                {
                    find: /^@shogi\/engine-client$/,
                    replacement: path.resolve(rootDir, "../../packages/engine-client/src"),
                },
                {
                    find: /^@shogi\/engine-wasm$/,
                    replacement: path.resolve(rootDir, "../../packages/engine-wasm/src"),
                },
                {
                    find: /^@shogi\/match-client$/,
                    replacement: path.resolve(rootDir, "../../packages/match-client/src"),
                },
            ],
            // React の重複インスタンスを防ぐ保険として dedupe を設定
            // バージョンが統一されていれば影響はないが、将来の安全性のため明示的に指定
            // ※ React バージョンを統一する場合: pnpm update react@X.X.X react-dom@X.X.X -r --filter "@shogi/*"
            dedupe: ["react", "react-dom"],
        },
    };
});
