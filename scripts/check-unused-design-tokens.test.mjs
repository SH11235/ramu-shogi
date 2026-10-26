import assert from "node:assert/strict";
import test from "node:test";
import {
    collectCssVariables,
    collectPresetTokens,
    findUnusedCssVariables,
    findUnusedPresetTokens,
} from "./check-unused-design-tokens.mjs";

const names = (tokens) => tokens.map(({ group, name }) => `${group}.${name}`);

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
