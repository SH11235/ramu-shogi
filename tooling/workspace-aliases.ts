import { fileURLToPath } from "node:url";
import workspace from "../tsconfig.workspace.json" with { type: "json" };

export const workspaceAliases = Object.entries(workspace.compilerOptions.paths).map(
    ([name, [target]]) => {
        const pattern = name.replaceAll(".", "\\.").replace("*", "(.+)");
        const replacement = fileURLToPath(
            new URL(`../${target.replace("*", "$1")}`, import.meta.url),
        );
        return { find: new RegExp(`^${pattern}$`), replacement };
    },
);

const wasmTestMock = fileURLToPath(
    new URL("../packages/engine-wasm/src/__mocks__/engine-wasm-pkg.ts", import.meta.url),
);

export const wasmTestAliases = [
    { find: "../pkg/engine_wasm.js", replacement: wasmTestMock },
    { find: "../pkg-threaded/engine_wasm.js", replacement: wasmTestMock },
];
