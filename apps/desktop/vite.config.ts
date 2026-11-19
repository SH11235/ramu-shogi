import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { workspaceAliases } from "../../tooling/workspace-aliases.ts";

const host = process.env.TAURI_DEV_HOST;
const rootDir = path.dirname(fileURLToPath(import.meta.url));

// build 時に package.json::version を読み、`import.meta.env.VITE_APP_VERSION` として
// literal 置換する。viewer API への X-Client ヘッダ (rshogi#564) でクライアント version を識別するために使う。
const pkg = JSON.parse(readFileSync(path.join(rootDir, "package.json"), "utf-8")) as {
    version: string;
};

// 内蔵エンジン（rshogi-core）の版を Cargo.lock から読み、`import.meta.env.VITE_RSHOGI_CORE_VERSION`
// として literal 置換する。研究ノートの解析レイヤー（どの AI で解析したか）の識別に使う。
// git 依存は同じ version のまま rev だけ進むことがあるので、`<version>+<rev の先頭 8 文字>` にする。
// 読めなければ空文字（利用側がアプリの版で代用する）。
function readRshogiCoreVersion(cargoLockPath: string): string {
    let lock: string;
    try {
        lock = readFileSync(cargoLockPath, "utf-8");
    } catch {
        return "";
    }
    const block = lock
        .split("[[package]]")
        .find((entry) => /^\s*name = "rshogi-core"\s*$/m.test(entry));
    const version = block?.match(/^version = "([^"]+)"/m)?.[1];
    if (!version) return "";
    const rev = block?.match(/^source = "git\+[^"#]*#([0-9a-f]{8})[0-9a-f]*"/m)?.[1];
    return rev ? `${version}+${rev}` : version;
}

const rshogiCoreVersion = readRshogiCoreVersion(path.join(rootDir, "src-tauri/Cargo.lock"));

// https://vite.dev/config/
export default defineConfig(async () => ({
    define: {
        "import.meta.env.VITE_APP_VERSION": JSON.stringify(pkg.version),
        "import.meta.env.VITE_RSHOGI_CORE_VERSION": JSON.stringify(rshogiCoreVersion),
    },
    plugins: [tailwindcss(), react(), babel({ presets: [reactCompilerPreset()] })],
    build: {
        target: ["chrome107", "edge107", "firefox104", "safari16"],
    },
    resolve: {
        alias: workspaceAliases,
        dedupe: ["react", "react-dom"],
    },

    // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
    //
    // 1. prevent Vite from obscuring rust errors
    clearScreen: false,
    // 2. tauri expects a fixed port, fail if that port is not available
    server: {
        port: 1420,
        strictPort: true,
        host: host || false,
        ws: host
            ? {
                  protocol: "ws",
                  host,
                  port: 1421,
              }
            : undefined,
        watch: {
            // 3. tell Vite to ignore watching `src-tauri`
            ignored: ["**/src-tauri/**"],
        },
    },
}));
