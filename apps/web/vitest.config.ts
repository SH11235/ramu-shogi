import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
    test: {
        environment: "happy-dom",
        globals: true,
        env: {
            VITE_NNUE_MANIFEST_URL: "https://example.test/nnue/manifest.json",
            VITE_WASM_THREADS: "false",
            VITE_DEFAULT_NNUE_PRESET: "standard",
            VITE_RSHOGI_API_BASE: "https://example.test/rshogi",
        },
        exclude: [
            "**/node_modules/**",
            "**/worker/**", // 統合テストは test:integration スクリプトで実行
            "**/e2e/**",
            "**/*.e2e.*",
        ],
    },
    resolve: {
        alias: [
            {
                find: /^@shogi\/app-core$/,
                replacement: path.resolve(rootDir, "../../packages/app-core/src"),
            },
            {
                find: /^@shogi\/api-contract$/,
                replacement: path.resolve(rootDir, "../../packages/api-contract/src"),
            },
            {
                find: /^@shogi\/app-controller$/,
                replacement: path.resolve(rootDir, "../../packages/app-controller/src"),
            },
            {
                find: /^@shogi\/design-system$/,
                replacement: path.resolve(rootDir, "../../packages/design-system/src"),
            },
            {
                find: /^@shogi\/ui$/,
                replacement: path.resolve(rootDir, "../../packages/ui/src"),
            },
            {
                find: /^@shogi\/ui\/(.+)$/,
                replacement: path.resolve(rootDir, "../../packages/ui/src/$1"),
            },
            {
                find: /^@shogi\/engine-client$/,
                replacement: path.resolve(rootDir, "../../packages/engine-client/src"),
            },
            {
                find: /^@shogi\/engine-wasm$/,
                replacement: path.resolve(rootDir, "../../packages/engine-wasm/src"),
            },
            {
                find: "../pkg/engine_wasm.js",
                replacement: path.resolve(
                    rootDir,
                    "../../packages/engine-wasm/src/__mocks__/engine-wasm-pkg.ts",
                ),
            },
            {
                find: "../pkg-threaded/engine_wasm.js",
                replacement: path.resolve(
                    rootDir,
                    "../../packages/engine-wasm/src/__mocks__/engine-wasm-pkg.ts",
                ),
            },
            {
                find: /^@shogi\/match-client$/,
                replacement: path.resolve(rootDir, "../../packages/match-client/src"),
            },
            {
                find: /^@shogi\/match-protocol$/,
                replacement: path.resolve(rootDir, "../../packages/match-protocol/src"),
            },
        ],
    },
});
