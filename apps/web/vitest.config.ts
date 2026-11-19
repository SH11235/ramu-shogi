import { configDefaults, defineConfig } from "vitest/config";
import { wasmTestAliases, workspaceAliases } from "../../tooling/workspace-aliases.ts";

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
        exclude: [...configDefaults.exclude, "**/e2e/**", "**/*.e2e.*"],
    },
    resolve: { alias: [...wasmTestAliases, ...workspaceAliases] },
});
