import { describe, expect, it } from "vitest";
import { parseSearch, stringifySearch } from "./router-search";

describe("parseSearch", () => {
    it("値を解釈せず文字列のまま読む (数値・真偽値・null に見える値も文字列)", () => {
        expect(parseSearch("?event=2026&name=true&x=null&y=1.0&z=1e5&w=007")).toEqual({
            event: "2026",
            name: "true",
            x: "null",
            y: "1.0",
            z: "1e5",
            w: "007",
        });
    });

    it("日本語や記号をデコードし、先頭の ? は無くてもよい", () => {
        expect(parseSearch("event=%E3%82%B5%E3%83%B3%E3%83%97%E3%83%AB%E5%A4%A7%E4%BC%9A")).toEqual(
            { event: "サンプル大会" },
        );
        expect(parseSearch("?event=floodgate-300-10F&name=A+B")).toEqual({
            event: "floodgate-300-10F",
            name: "A B",
        });
        expect(parseSearch("")).toEqual({});
    });

    it("以前の形式の引用符付き文字列は中身を読む", () => {
        expect(parseSearch("?event=%222026%22")).toEqual({ event: "2026" });
        // 引用符で始まるが JSON の文字列でないものはそのまま。
        expect(parseSearch("?event=%22abc")).toEqual({ event: '"abc' });
    });

    it("同じキーが複数あれば配列にする", () => {
        expect(parseSearch("?a=1&a=2&a=3&b=x")).toEqual({ a: ["1", "2", "3"], b: "x" });
    });
});

describe("stringifySearch", () => {
    it("文字列を引用符なしで書き、undefined は書かない", () => {
        expect(stringifySearch({ event: "2026", venue: "floodgate", name: undefined })).toBe(
            "?event=2026&venue=floodgate",
        );
        expect(stringifySearch({ event: "true" })).toBe("?event=true");
        expect(stringifySearch({})).toBe("");
    });

    it("配列は同じキーを繰り返して書く", () => {
        expect(stringifySearch({ a: ["1", "2", "3"], b: "x" })).toBe("?a=1&a=2&a=3&b=x");
        expect(stringifySearch({ a: [] })).toBe("");
        expect(stringifySearch({ a: ["x", undefined, "y"] })).toBe("?a=x&a=y");
    });

    it("文字列以外は JSON で書く", () => {
        expect(stringifySearch({ page: 2, flag: false })).toBe("?page=2&flag=false");
    });
});

describe("parseSearch と stringifySearch の往復", () => {
    it("要素が 2 つ以上の配列は同じ配列として戻る", () => {
        for (const value of [
            ["1", "2"],
            ["kifu", "floodgate", "wdoor"],
            ["2026", "true", "サンプル大会", "a&b=c d", '"quoted"'],
        ]) {
            expect(parseSearch(stringifySearch({ source: value, event: "x" }))).toEqual({
                source: value,
                event: "x",
            });
        }
        // 読み込んだものを書き戻しても同じクエリになる。
        expect(stringifySearch(parseSearch("?a=1&a=2&a=3&b=x"))).toBe("?a=1&a=2&a=3&b=x");
    });

    it("要素が 1 つの配列は文字列として戻る (URL 上は区別できない)", () => {
        expect(parseSearch(stringifySearch({ a: ["only"] }))).toEqual({ a: "only" });
    });

    it.each([
        "2026",
        "true",
        "false",
        "null",
        "1.0",
        "1e5",
        "007",
        "WCSC36",
        "サンプル大会",
        "floodgate-300-10F",
        "a&b=c d",
        '"quoted"',
        '"',
        "{}",
        "[1]",
    ])("文字列 %j は同じ文字列として戻る", (value) => {
        expect(parseSearch(stringifySearch({ event: value }))).toEqual({ event: value });
    });
});
