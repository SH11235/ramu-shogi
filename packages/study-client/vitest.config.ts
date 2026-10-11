import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
    resolve: {
        alias: [
            {
                find: /^@shogi\/api-contract$/,
                replacement: path.resolve(rootDir, "../api-contract/src/index.ts"),
            },
            {
                // app-core は dist を公開しているので、ビルド前でもテストできるよう src を見る。
                find: /^@shogi\/app-core$/,
                replacement: path.resolve(rootDir, "../app-core/src/index.ts"),
            },
        ],
    },
    test: {
        environment: "node",
        globals: true,
    },
});
