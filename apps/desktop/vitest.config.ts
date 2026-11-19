import { defineConfig } from "vitest/config";
import { workspaceAliases } from "../../tooling/workspace-aliases.ts";

export default defineConfig({
    test: {
        environment: "happy-dom",
        globals: true,
    },
    resolve: { alias: workspaceAliases },
});
