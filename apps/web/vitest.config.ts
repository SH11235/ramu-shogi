import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
    test: {
        environment: "happy-dom",
        globals: true,
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
                find: /^@shogi\/design-system$/,
                replacement: path.resolve(rootDir, "../../packages/design-system/src"),
            },
            {
                find: /^@shogi\/ui$/,
                replacement: path.resolve(rootDir, "../../packages/ui/src"),
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
                find: /^@shogi\/match-client$/,
                replacement: path.resolve(rootDir, "../../packages/match-client/src"),
            },
        ],
    },
});
