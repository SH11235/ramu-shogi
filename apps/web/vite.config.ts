import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { visualizer } from "rollup-plugin-visualizer";
import { defineConfig, loadEnv } from "vite";
import { SHOGI_BOARD_MODULES } from "./shogi-board-chunk";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

// ANALYZE=true でバンドル分析レポートを生成
const isAnalyze = process.env.ANALYZE === "true";

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

const rshogiCoreVersion = readRshogiCoreVersion(
    path.join(rootDir, "../../packages/rust-core/Cargo.lock"),
);

/**
 * 小さな部品（packages/ui/src/components 直下）。ここに並べる部品は、react・radix・
 * class-variance-authority・design-system と、この一覧の部品だけを import すること。
 * 対局画面の部品（shogi-match/ 配下）などを import すると、ui-base から重い chunk を引き、
 * どの画面でも最初に読み込むようになる（ビルドは通るので気づきにくい）。
 */
const UI_PRIMITIVES = [
    "alert-dialog",
    "button",
    "chevron-icon",
    "dialog",
    "input",
    "native-select",
    "popover",
    "progress",
    "select",
    "sheet",
    "spinner",
    "switch",
    "tooltip",
];

function manualChunks(id: string): string | undefined {
    const normalizedId = id.split(path.sep).join("/");

    if (normalizedId.includes("/node_modules/")) {
        // react / react-dom / scheduler を専用 chunk に分離してはいけない。vendor 側の
        // react 依存 CJS interop と chunk 初期化順の循環が生じ、本番ビルドのみ
        // `Cannot set properties of undefined (setting 'Activity')` で起動不能になる。
        // (resolve.dedupe の react 指定は複数インスタンス重複を防ぐ別の保護で、
        //  この chunk 分割の制約とは独立)

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

    // ボタン・入力欄・ダイアログなどの小さな部品。どの画面も使うが、放置すると rollup が先に参照した
    // 重い chunk（shogi-match）へ同梱する。起動時に読む棋譜一覧の検索欄（rshogi-csa-game-browser）が
    // 入力欄を使うため、どの画面でも shogi-match（~400KB）を丸ごと読み込んでいた。
    // design-system（cn・テーマ）は ui-base の部品が使う。ui-base に入れないと rollup が app-shell に
    // 入れ、ui-base と app-shell が互いを読み込む（初期化の順によっては本番だけ落ちうる）。
    if (normalizedId.includes("/packages/design-system/src/")) {
        return "ui-base";
    }
    if (
        UI_PRIMITIVES.some((name) =>
            normalizedId.endsWith(`/packages/ui/src/components/${name}.tsx`),
        )
    ) {
        return "ui-base";
    }

    // 盤（ShogiBoard）と、盤が使う駒・座標・局面変換の小さな util。トップページの装飾の盤（HeroBoard）が
    // 使う。shogi-match/ 配下にあるものも、下の shogi-match ルールより前に分けないと、盤を出すだけで
    // shogi-match（~530KB）を丸ごと読み込む。一覧と、そのファイルが import してよいものは shogi-board-chunk.ts。
    // shogi-match/ のほかのファイルを import すると、2 つの chunk が互いを読み込む（ビルドは通り、初期化の順に
    // よっては本番だけ落ちうる）ので、shogi-board-chunk.test.ts で確かめる。
    if (
        SHOGI_BOARD_MODULES.some((file) =>
            normalizedId.endsWith(`/packages/ui/src/components/${file}`),
        )
    ) {
        return "shogi-board";
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

    // 研究ノートの画面（`/studies/$studyId` と一覧の取り込みフォームが使う）。放置すると
    // rollup が共有 chunk（app-shell）に同梱し、全ルートの初期読み込みに載ってしまう。
    if (
        normalizedId.includes("/packages/ui/src/components/study-workspace/") ||
        normalizedId.endsWith("/packages/ui/src/components/study-workspace.tsx")
    ) {
        return "study-workspace";
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
            "import.meta.env.VITE_RSHOGI_CORE_VERSION": JSON.stringify(rshogiCoreVersion),
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
                {
                    find: /^@shogi\/study-client$/,
                    replacement: path.resolve(rootDir, "../../packages/study-client/src"),
                },
            ],
            // React の重複インスタンスを防ぐ保険として dedupe を設定
            // バージョンが統一されていれば影響はないが、将来の安全性のため明示的に指定
            // ※ React バージョンを統一する場合: pnpm update react@X.X.X react-dom@X.X.X -r --filter "@shogi/*"
            dedupe: ["react", "react-dom"],
        },
    };
});
