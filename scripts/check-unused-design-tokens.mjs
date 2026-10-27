// デザイントークンの使われ残りを検出する。
// - theme.css で定義した CSS 変数が、どこからも var(--name) / (--name) で参照されていない
// - tailwind.preset.ts の theme.extend に定義したキーが、クラスとして一度も使われていない
// - 影・角の丸み・重なり順を、トークンを通さずに書いている（任意値や、トークンで置き換えた既定の段）
// クラス名は静的な文字列として書かれている前提で探す（`bg-${name}` のような組み立ては拾えない）。
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

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
    // 正規表現のまま使う（border-t / border-x / border-s などの片側の枠）
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
        if (key === "DEFAULT" && prefix === "") {
            throw new Error("colors の一番上の DEFAULT は、クラス名が決まらないので扱えない");
        }
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

/**
 * コメントを取り除く。TS/TSX は正規表現リテラルやテンプレート内の式を字句として正しく扱うため、
 * TypeScript のトランスパイル（removeComments）を通す。型注釈も消えるが、クラス名や var() は
 * 文字列・JSX 属性に残るので探索には困らない。
 */
export function stripComments(text, fileName) {
    switch (path.extname(fileName)) {
        case ".ts":
        case ".tsx":
            return ts.transpileModule(text, {
                // .d.ts のままだと出力が生成されず例外になる
                fileName: fileName.replace(/\.d\.ts$/, ".ts"),
                compilerOptions: {
                    removeComments: true,
                    jsx: ts.JsxEmit.Preserve,
                    target: ts.ScriptTarget.ESNext,
                    module: ts.ModuleKind.ESNext,
                },
            }).outputText;
        case ".css":
            // CSS の `//` はコメントではない（url(https://...) など）
            return text.replaceAll(/\/\*[\s\S]*?\*\//g, "");
        case ".html":
            return text.replaceAll(/<!--[\s\S]*?-->/g, "");
        default:
            return text;
    }
}

/**
 * トークンを使っている印になる正規表現。keyframes は animation の値か animate-[name_...] で使われる。
 * shadow-<name> は boxShadow に同名があれば Tailwind がそちらで解決するので、色の接頭辞から外す。
 */
export function tokenUsagePattern({ group, name }, boxShadowNames = new Set()) {
    const escaped = escapeRegExp(name);
    // keyframes はクラスの接頭辞を持たず、animation の値か animate-[名前_…] から名前で参照される
    if (group === "keyframes") {
        return new RegExp(`(?:animate-\\[|["'\`\\s])${escaped}(?=[_\\s"'\`])`);
    }
    const prefix =
        group === "colors" && boxShadowNames.has(name)
            ? `(?:${COLOR_PREFIXES.filter((p) => p !== "shadow").join("|")})`
            : UTILITY_PREFIXES[group];
    if (prefix === undefined) {
        throw new Error(`未対応の theme.extend のキー: ${group}`);
    }
    // 前後が名前の続き（英数字・-）でないことを見る。/50 のような不透明度は許す
    return new RegExp(`(?<![\\w-])${prefix}-${escaped}(?![\\w-])`);
}

/**
 * 定義の外で参照されていない CSS 変数を返す。参照は var(--name) と、Tailwind v4 の省略記法
 * `bg-(--name)` / `font-(family-name:--name)` の両方を数える。
 */
export function findUnusedCssVariables(names, sources) {
    return names.filter((name) => {
        const pattern = new RegExp(
            `(?:var\\(\\s*|\\((?:[\\w-]+:)?)${escapeRegExp(name)}(?![\\w-])`,
        );
        return !sources.some((source) => pattern.test(source));
    });
}

/** どのソースにも使われていない preset トークンを返す。keyframes は使われている animation の値も見る */
export function findUnusedPresetTokens(tokens, sources) {
    const boxShadowNames = new Set(
        tokens.filter((token) => token.group === "boxShadow").map((token) => token.name),
    );
    const isUnused = (token, haystack) => {
        const pattern = tokenUsagePattern(token, boxShadowNames);
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

// トークンを通さずに書いた影・角の丸み・重なり順。浮く面の影は shadow-panel / shadow-modal 等、
// 画面全体に重なる層は z-modal 等を使う。ボタンなど部品の影は Tailwind の shadow-sm / shadow-md まで。
const AD_HOC_CLASS_PATTERNS = [
    { pattern: /(?<![\w-])(?:drop-|inset-)?shadow-\[/g, hint: "影の任意値" },
    {
        pattern: /\[(?:box-shadow|filter|border(?:-[a-z]+)*-radius|z-index):/g,
        hint: "影・角の丸み・重なり順の任意プロパティ",
    },
    {
        pattern: /(?<![\w-])shadow-(?:lg|xl|2xl|inner)(?![\w-])/g,
        hint: "影の段（浮く面は名前付きの影）",
    },
    { pattern: new RegExp(`(?<![\\w-])${ROUNDED_PREFIX}-\\[`, "g"), hint: "角の丸みの任意値" },
    {
        pattern: /(?<![\w-])z-(?:\[|(?:[5-9]\d|\d{3,})(?![\w-]))/g,
        hint: "重なり順の数値（50 以上は名前付き）",
    },
];

/** トークンを通さずに書いたクラスを `{ match, hint }` の一覧で返す */
export function findAdHocDesignClasses(source) {
    return AD_HOC_CLASS_PATTERNS.flatMap(({ pattern, hint }) =>
        [...source.matchAll(pattern)].map((match) => ({ match: match[0], hint })),
    );
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
    // 説明のための言及を使用と数えないよう、コメントを除いて読む。
    // 定義そのものも参照と数えないよう、theme.css は宣言部分を除く
    const sources = sourceFiles.map((file) => {
        const text = stripComments(readFileSync(file, "utf8"), file);
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
        console.error(`${THEME_CSS}: ${name} はどこからも参照されていない`);
    }
    for (const { group, name } of unusedTokens) {
        console.error(`${PRESET}: theme.extend.${group} の ${name} がクラスとして使われていない`);
    }
    const adHocClasses = sourceFiles.flatMap((file, index) =>
        findAdHocDesignClasses(sources[index]).map((found) => ({ file, ...found })),
    );
    for (const { file, match, hint } of adHocClasses) {
        console.error(`${path.relative(ROOT, file)}: ${match} はトークンを通していない（${hint}）`);
    }
    if (unusedVariables.length > 0 || unusedTokens.length > 0 || adHocClasses.length > 0) {
        process.exitCode = 1;
        return;
    }
    console.log("使われていないデザイントークンも、トークンを通さない影・角・重なり順もない");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    await main();
}
