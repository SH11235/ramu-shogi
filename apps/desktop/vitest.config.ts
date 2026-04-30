import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
    test: {
        environment: "happy-dom",
        globals: true,
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
                find: /^@shogi\/engine-tauri$/,
                replacement: path.resolve(rootDir, "../../packages/engine-tauri/src"),
            },
            {
                find: /^@shogi\/match-client$/,
                replacement: path.resolve(rootDir, "../../packages/match-client/src"),
            },
        ],
    },
});
