import assert from "node:assert/strict";
import test from "node:test";
import {
    collectCssVariables,
    collectPresetTokens,
    findUnusedCssVariables,
    findUnusedPresetTokens,
    stripComments,
} from "./check-unused-design-tokens.mjs";

const names = (tokens) => tokens.map(({ group, name }) => `${group}.${name}`);

test("コメントは取り除き、文字列中の // や /* は残す", () => {
    const source = [
        "// var(--a) の説明",
        'const url = "https://example.com"; /* var(--b) */',
        "const c = 'w-[var(--c)]'; // var(--d)",
        `const e = <div className={\`w-[var(--e)] \${/* var(--f) */ ''}\`}>{/* bg-wafuu-kin */}</div>;`,
    ].join("\n");
    const stripped = stripComments(source, "a.tsx");
    assert.deepEqual(
        findUnusedCssVariables(["--a", "--b", "--c", "--d", "--e", "--f"], [stripped]),
        ["--a", "--b", "--d", "--f"],
    );
    assert.match(stripped, /https:\/\/example\.com/);
    assert.doesNotMatch(stripped, /wafuu-kin/);
});

test("正規表現リテラル中の / をコメントの始まりと取り違えない", () => {
    const source = 'const cls = /\\//.test(path) ? "w-[var(--a)]" : "";';
    assert.deepEqual(findUnusedCssVariables(["--a"], [stripComments(source, "a.ts")]), []);
});

test("CSS は /* */ だけを取り除き、url(https://...) の後ろは残す", () => {
    const css = "a { background: url(https://x.test/a.png) var(--a); } /* var(--b) */";
    const stripped = stripComments(css, "a.css");
    assert.deepEqual(findUnusedCssVariables(["--a", "--b"], [stripped]), ["--b"]);
});

test("HTML は <!-- --> を取り除く", () => {
    const html = '<!-- <div class="w-[var(--a)]"> -->\n<div class="w-[var(--b)]"></div>';
    assert.deepEqual(findUnusedCssVariables(["--a", "--b"], [stripComments(html, "index.html")]), [
        "--a",
    ]);
});

test("Tailwind v4 の省略記法 (--name) / (type:--name) も参照と数える", () => {
    const sources = ['className="bg-(--a) font-(family-name:--b) w-(--c-long)"'];
    assert.deepEqual(findUnusedCssVariables(["--a", "--b", "--c"], sources), ["--c"]);
});

test("shadow-<name> は boxShadow に同名があれば色の使用と数えない", () => {
    const extend = { colors: { card: "c", ink: "i" }, boxShadow: { card: "x" } };
    const tokens = collectPresetTokens(extend);
    assert.deepEqual(names(findUnusedPresetTokens(tokens, ['"shadow-card shadow-ink"'])), [
        "colors.card",
    ]);
    assert.deepEqual(names(findUnusedPresetTokens(tokens, ['"bg-card shadow-card"'])), [
        "colors.ink",
    ]);
});

test("theme.css の宣言だけを変数として集め、コメントは無視する", () => {
    const css = ":root { --a: 1px; /* --b: 2px; */ --c-d: var(--a); }";
    assert.deepEqual(collectCssVariables(css), ["--a", "--c-d"]);
});

test("var() で参照されていない変数を返す。名前の前方一致は参照と数えない", () => {
    const sources = ["width: var(--a-long);", "color: hsl(var( --b ) / 0.5);"];
    assert.deepEqual(findUnusedCssVariables(["--a", "--a-long", "--b"], sources), ["--a"]);
});

test("入れ子の色は - でつなぎ、DEFAULT は親の名前にする", () => {
    const tokens = collectPresetTokens({
        colors: {
            card: "c",
            wafuu: { sumi: "s", "sumi-light": "l" },
            overlay: { DEFAULT: "o", light: "ol" },
        },
    });
    assert.deepEqual(names(tokens), [
        "colors.card",
        "colors.wafuu-sumi",
        "colors.wafuu-sumi-light",
        "colors.overlay",
        "colors.overlay-light",
    ]);
});

test("クラスの接頭辞・バリアント・不透明度を許し、長い名前の一部は使用と数えない", () => {
    const extend = {
        colors: {
            wafuu: { sumi: "s", "sumi-light": "l", kin: "k" },
            overlay: { DEFAULT: "o", light: "ol" },
        },
        zIndex: { modal: "51" },
        borderRadius: { lg: "1rem" },
        dropShadow: { piece: "x" },
    };
    const sources = [
        'className="hover:text-wafuu-sumi-light border-t-wafuu-kin/50 bg-overlay-light"',
        "cn('z-modal', 'rounded-tl-lg', 'drop-shadow-piece')",
    ];
    assert.deepEqual(names(findUnusedPresetTokens(collectPresetTokens(extend), sources)), [
        "colors.wafuu-sumi",
        "colors.overlay",
    ]);
});

test("keyframes は使われている animation か animate-[...] から参照されていれば使用と数える", () => {
    const extend = {
        keyframes: { spin: {}, wave: {}, fade: {} },
        animation: { spin: "spin 1s linear", wave: "wave 1s" },
    };
    const sources = ["animate-spin", "animate-[fade_0.2s_ease-out]"];
    assert.deepEqual(names(findUnusedPresetTokens(collectPresetTokens(extend), sources)), [
        "animation.wave",
        "keyframes.wave",
    ]);
});
