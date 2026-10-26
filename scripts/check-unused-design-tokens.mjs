// デザイントークンの使われ残りを検出する。
// - theme.css で定義した CSS 変数が、どこからも var(--name) で参照されていない
// - tailwind.preset.ts の theme.extend に定義したキーが、クラスとして一度も使われていない
// クラス名は静的な文字列として書かれている前提で探す（`bg-${name}` のような組み立ては拾えない）。
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const THEME_CSS = "packages/design-system/src/theme.css";
const PRESET = "packages/design-system/tailwind.preset.ts";
const SOURCE_DIRS = ["packages", "apps"];
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".css", ".html"]);
const SKIPPED_DIRS = new Set(["node_modules", "dist", "target", "pkg", "pkg-threaded"]);

// 色トークンを受け取るユーティリティの接頭辞
const COLOR_PREFIXES = [
    "bg",
    "text",
    "border",
    "border-[trblxyse]",
    "ring",
    "ring-offset",
    "fill",
    "stroke",
    "from",
    "via",
    "to",
    "outline",
    "divide",
    "accent",
    "caret",
    "decoration",
    "shadow",
    "placeholder",
];

const ROUNDED_PREFIX = "rounded(?:-(?:[trblse]|[tb][lr]|[se][se]))?";

// theme.extend のキーごとに、そのトークンを使うクラスの接頭辞（正規表現）
const UTILITY_PREFIXES = {
    colors: `(?:${COLOR_PREFIXES.join("|")})`,
    boxShadow: "shadow",
    dropShadow: "drop-shadow",
    zIndex: "z",
    borderRadius: ROUNDED_PREFIX,
    fontFamily: "font",
    animation: "animate",
};

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** theme.css の宣言 `--name: ...` から変数名を集める（重複は 1 つにまとめる） */
export function collectCssVariables(css) {
    const names = new Set();
    for (const match of css.replaceAll(/\/\*[\s\S]*?\*\//g, "").matchAll(/(--[\w-]+)\s*:/g)) {
        names.add(match[1]);
    }
    return [...names];
}

/** 入れ子の色 `{ wafuu: { sumi, DEFAULT } }` を `wafuu-sumi` / `wafuu` に平たくする */
function flattenColors(colors, prefix = "") {
    return Object.entries(colors).flatMap(([key, value]) => {
        const name = key === "DEFAULT" ? prefix : prefix ? `${prefix}-${key}` : key;
        return typeof value === "object" ? flattenColors(value, name) : [[name, value]];
    });
}

/** preset の theme.extend から `{ group, name, value }` の一覧を作る */
export function collectPresetTokens(extend) {
    return Object.entries(extend).flatMap(([group, values]) => {
        const entries = group === "colors" ? flattenColors(values) : Object.entries(values);
        return entries.map(([name, value]) => ({ group, name, value }));
    });
}

/** トークンを使っている印になる正規表現。keyframes は animation の値か animate-[name_...] で使われる */
export function tokenUsagePattern({ group, name }) {
    const escaped = escapeRegExp(name);
    if (group === "keyframes") {
        return new RegExp(`(?:animate-\\[|["'\`\\s])${escaped}(?=[_\\s"'\`])`);
    }
    const prefix = UTILITY_PREFIXES[group];
    if (prefix === undefined) {
        throw new Error(`未対応の theme.extend のキー: ${group}`);
    }
    // 前後が名前の続き（英数字・-）でないことを見る。/50 のような不透明度は許す
    return new RegExp(`(?<![\\w-])${prefix}-${escaped}(?![\\w-])`);
}

/** 定義の外で var(--name) と参照されていない CSS 変数を返す */
export function findUnusedCssVariables(names, sources) {
    return names.filter((name) => {
        const pattern = new RegExp(`var\\(\\s*${escapeRegExp(name)}(?![\\w-])`);
        return !sources.some((source) => pattern.test(source));
    });
}

/** どのソースにも使われていない preset トークンを返す。keyframes は使われている animation の値も見る */
export function findUnusedPresetTokens(tokens, sources) {
    const isUnused = (token, haystack) => {
        const pattern = tokenUsagePattern(token);
        return !haystack.some((source) => pattern.test(source));
    };
    const unused = tokens.filter(
        (token) => token.group !== "keyframes" && isUnused(token, sources),
    );
    const usedAnimationValues = tokens
        .filter((token) => token.group === "animation" && !unused.includes(token))
        .map((token) => ` ${token.value}`);
    const unusedKeyframes = tokens.filter(
        (token) =>
            token.group === "keyframes" && isUnused(token, [...sources, ...usedAnimationValues]),
    );
    return [...unused, ...unusedKeyframes];
}

function listSourceFiles(dir) {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            return SKIPPED_DIRS.has(entry.name) ? [] : listSourceFiles(full);
        }
        const isTest = /\.(test|spec|visual)\.tsx?$/.test(entry.name);
        return SOURCE_EXTENSIONS.has(path.extname(entry.name)) && !isTest ? [full] : [];
    });
}

async function main() {
    const css = readFileSync(path.join(ROOT, THEME_CSS), "utf8");
    const { default: preset } = await import(pathToFileURL(path.join(ROOT, PRESET)).href);
    const extend = preset.theme.extend;

    // preset の値は、使われているトークンの分だけ CSS 変数の参照元として数える
    const sourceFiles = SOURCE_DIRS.flatMap((dir) => listSourceFiles(path.join(ROOT, dir))).filter(
        (file) => path.resolve(file) !== path.join(ROOT, PRESET),
    );
    // 定義そのものを参照と数えないよう、theme.css は宣言部分を除いて読む
    const sources = sourceFiles.map((file) => {
        const text = readFileSync(file, "utf8");
        return path.resolve(file) === path.join(ROOT, THEME_CSS)
            ? text.replaceAll(/--[\w-]+\s*:/g, "")
            : text;
    });

    const tokens = collectPresetTokens(extend);
    const unusedTokens = findUnusedPresetTokens(tokens, sources);
    const usedTokenValues = tokens
        .filter((token) => !unusedTokens.includes(token))
        .map((token) => JSON.stringify(token.value));
    const unusedVariables = findUnusedCssVariables(collectCssVariables(css), [
        ...sources,
        ...usedTokenValues,
    ]);

    for (const name of unusedVariables) {
        console.error(`${THEME_CSS}: ${name} はどこからも var() で参照されていない`);
    }
    for (const { group, name } of unusedTokens) {
        console.error(`${PRESET}: theme.extend.${group} の ${name} がクラスとして使われていない`);
    }
    if (unusedVariables.length > 0 || unusedTokens.length > 0) {
        process.exitCode = 1;
        return;
    }
    console.log("使われていないデザイントークンはない");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    await main();
}
