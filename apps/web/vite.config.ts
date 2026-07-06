import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { visualizer } from "rollup-plugin-visualizer";
import { defineConfig, loadEnv } from "vite";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

// ANALYZE=true でバンドル分析レポートを生成
const isAnalyze = process.env.ANALYZE === "true";

// build 時に package.json::version を読み、`import.meta.env.VITE_APP_VERSION` として
// literal 置換する。viewer API への X-Client ヘッダ (rshogi#564) でクライアント version を識別するために使う。
const pkg = JSON.parse(readFileSync(path.join(rootDir, "package.json"), "utf-8")) as {
    version: string;
};

function manualChunks(id: string): string | undefined {
    const normalizedId = id.split(path.sep).join("/");

    if (normalizedId.includes("/node_modules/")) {
        if (
            normalizedId.includes("/node_modules/react/") ||
            normalizedId.includes("/node_modules/react-dom/") ||
            normalizedId.includes("/node_modules/scheduler/")
        ) {
            return "vendor-react";
        }

        // 現状 @tanstack は react-router のみ。将来 @tanstack/query 等を足すと
        // この chunk に同梱され肥大化しうるので、その際は router 系に限定するか
        // chunk を分けること。
        if (normalizedId.includes("/node_modules/@tanstack/")) {
            return "vendor-router";
        }

        return "vendor";
    }

    // useLocalStorage は cross-tab 同期 util(react のみ依存の leaf)で、物理的には
    // shogi-match/hooks 配下にあるが app-shell の useUserSettingsSync(eager)からも
    // 使われる。shogi-match chunk に含めると eager path が重い shogi-match を丸ごと
    // 引くため、小さな専用 chunk に切り出す(shogi-match ルールより前に判定する)。
    if (normalizedId.endsWith("/packages/ui/src/components/shogi-match/hooks/useLocalStorage.ts")) {
        return "ui-storage";
    }

    // ShogiMatch は本体ファイル `shogi-match.tsx` と `shogi-match/` 配下(hooks/utils
    // 等)の両方から成る。trailing slash だけだと本体ファイルを取りこぼし entry 等へ
    // 落ちるため、ファイル本体も同 chunk に含める。
    if (
        normalizedId.includes("/packages/ui/src/components/shogi-match/") ||
        normalizedId.endsWith("/packages/ui/src/components/shogi-match.tsx")
    ) {
        return "shogi-match";
    }

    if (normalizedId.includes("/packages/app-core/src/")) {
        return "app-core";
    }

    if (normalizedId.includes("/packages/match-client/src/")) {
        return "match-client";
    }

    // NnueProvider(providers/) と engine-wasm の軽量 nnue glue は、アプリ全体を
    // 包む AppProviders(eager)が使うため eager path に載る。放置すると rollup 既定が
    // これらを重い shogi-match chunk に同梱し、全ルートで shogi-match(~440KB) が
    // modulepreload されてしまう。小さな専用 chunk に分離して eager path を軽く保つ。
    // (重い wasm/worker は `new Worker(new URL())` で別アセット化され static には載らない)
    if (normalizedId.includes("/packages/ui/src/providers/")) {
        return "ui-providers";
    }

    if (normalizedId.includes("/packages/engine-wasm/src/")) {
        return "engine-wasm-glue";
    }

    if (
        normalizedId.endsWith("/apps/web/src/components/HeaderNav.tsx") ||
        normalizedId.endsWith("/apps/web/src/components/PageHeader.tsx") ||
        normalizedId.endsWith("/apps/web/src/hooks/useAuthSession.tsx")
    ) {
        return "app-shell";
    }

    return undefined;
}

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
    const env = loadEnv(mode, rootDir, "");

    return {
        define: {
            "import.meta.env.VITE_APP_VERSION": JSON.stringify(pkg.version),
        },
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
        build: {
            rollupOptions: {
                output: {
                    manualChunks,
                },
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
