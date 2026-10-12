import { describe, expect, it } from "vitest";
import {
    buildLoginHref,
    currentReturnPath,
    loginSearch,
    readReturnPathFromSearch,
    sanitizeReturnPath,
} from "./loginReturn";

describe("sanitizeReturnPath", () => {
    it("サイト内の相対パスは、クエリとハッシュごとそのまま通す", () => {
        expect(sanitizeReturnPath("/studies/abc")).toBe("/studies/abc");
        expect(sanitizeReturnPath("/rshogi-viewer?event=WCSC36&venue=floodgate")).toBe(
            "/rshogi-viewer?event=WCSC36&venue=floodgate",
        );
        expect(sanitizeReturnPath("/games/1/review?ply=12#comment")).toBe(
            "/games/1/review?ply=12#comment",
        );
        expect(sanitizeReturnPath("/rshogi-viewer?event=%E5%A4%A7%E4%BC%9A")).toBe(
            "/rshogi-viewer?event=%E5%A4%A7%E4%BC%9A",
        );
    });

    it("トップは既定の戻り先なので、覚えない", () => {
        expect(sanitizeReturnPath("/")).toBeNull();
    });

    it("文字列でない値・空の値は捨てる", () => {
        for (const value of [undefined, null, "", 1, {}, ["/studies"]]) {
            expect(sanitizeReturnPath(value)).toBeNull();
        }
    });

    it("別のサイトを指す値は捨てる", () => {
        for (const value of [
            "https://evil.example/",
            "http://evil.example/studies",
            "//evil.example",
            "//evil.example/studies",
            "/\\evil.example",
            "/\\/evil.example",
            "\\\\evil.example",
            "/studies\\..\\x",
            "javascript:alert(1)",
            "data:text/html,x",
            "evil.example/studies",
            "studies",
            " /studies",
            "/\t/evil.example",
            "/\n/evil.example",
            "/studies\u0000",
            "/.//evil.example",
            "/x/..//evil.example",
        ]) {
            expect(sanitizeReturnPath(value), JSON.stringify(value)).toBeNull();
        }
    });

    it("ログインの画面と API は、戻ると循環する（またはページではない）ので捨てる", () => {
        for (const value of [
            "/auth",
            "/auth?next=%2Fstudies",
            "/auth?setup=username",
            "/auth#x",
            "/auth/",
            "/x/../auth",
            "/./auth",
            "/api/auth/logout",
            "/api/auth/google/start?next=%2F",
            "/api",
        ]) {
            expect(sanitizeReturnPath(value), value).toBeNull();
        }
    });

    it("大文字やパーセントエンコードで書いたログインの画面・API も捨てる（ルーターは同じ画面として開く）", () => {
        for (const value of [
            "/AUTH",
            "/Auth?next=%2Fstudies",
            "/AUTH/",
            "/%61uth",
            "/%41UTH",
            "/a%75th#x",
            "/x/../%61uth",
            "/x/%2e%2e/auth",
            "/API/auth/logout",
            "/%61pi/auth/logout",
            "/%61pi",
        ]) {
            expect(sanitizeReturnPath(value), value).toBeNull();
        }
    });

    it("パスの中のエンコードした `/`・`\\`（解く層によって別のパスになる）と、解けないエンコードは捨てる", () => {
        for (const value of [
            "/auth%2F",
            "/auth%2f",
            "/x/..%2Fauth",
            "/x/..%2fauth",
            "/%2F%2Fhost",
            "/%2f%2fhost",
            "/%5Chost",
            "/%5chost",
            "/studies%2Fabc",
            "/%zz",
            "/studies/%E3%81",
            "/studies/%00",
            "/studies/%0d%0aabc",
        ]) {
            expect(sanitizeReturnPath(value), value).toBeNull();
        }
    });

    it("`/auth` で始まるだけの別のページは通す", () => {
        expect(sanitizeReturnPath("/authors")).toBe("/authors");
        expect(sanitizeReturnPath("/apiary")).toBe("/apiary");
        expect(sanitizeReturnPath("/Authors")).toBe("/Authors");
    });

    it("ページのパスのエンコード・大文字と、クエリやハッシュの中の `%2F` は、そのまま通す", () => {
        expect(sanitizeReturnPath("/studies/%E3%81%82?next=%2Fauth%5C#a%2Fb")).toBe(
            "/studies/%E3%81%82?next=%2Fauth%5C#a%2Fb",
        );
        expect(sanitizeReturnPath("/Games/ABC")).toBe("/Games/ABC");
    });

    it("`.` や `..` を含むパスは、正規化した形で返す", () => {
        expect(sanitizeReturnPath("/games/../studies/abc")).toBe("/studies/abc");
    });

    it("長すぎる値は捨てる（backend が cookie に持てる長さに収める）", () => {
        expect(sanitizeReturnPath(`/studies?q=${"a".repeat(1000)}`)).not.toBeNull();
        expect(sanitizeReturnPath(`/studies?q=${"a".repeat(1100)}`)).toBeNull();
    });
});

describe("readReturnPathFromSearch", () => {
    it("`?next=...` を読んで検証する", () => {
        expect(readReturnPathFromSearch("?next=%2Fstudies%2Fabc%3Fa%3D1%23h")).toBe(
            "/studies/abc?a=1#h",
        );
        expect(readReturnPathFromSearch("?setup=username&next=%2Fgames")).toBe("/games");
        expect(readReturnPathFromSearch("?next=https%3A%2F%2Fevil.example")).toBeNull();
        expect(readReturnPathFromSearch("?next=%2F%2Fevil.example")).toBeNull();
        expect(readReturnPathFromSearch("?next=%2Fauth")).toBeNull();
        expect(readReturnPathFromSearch("")).toBeNull();
    });
});

describe("currentReturnPath", () => {
    it("いま開いている画面のパス + クエリ + ハッシュを戻り先にする", () => {
        expect(
            currentReturnPath({
                pathname: "/rshogi-viewer",
                search: "?event=WCSC36",
                hash: "#top",
            }),
        ).toBe("/rshogi-viewer?event=WCSC36#top");
        expect(currentReturnPath({ pathname: "/", search: "", hash: "" })).toBeNull();
    });

    it("ログインの画面にいるときは、その画面が運んできた戻り先を引き継ぐ", () => {
        expect(
            currentReturnPath({ pathname: "/auth", search: "?next=%2Fstudies%2Fabc", hash: "" }),
        ).toBe("/studies/abc");
        expect(currentReturnPath({ pathname: "/auth", search: "", hash: "" })).toBeNull();
        // 大文字・エンコード・末尾の `/` で開いたログインの画面も、同じ画面として扱う。
        for (const pathname of ["/AUTH", "/%61uth", "/auth/"]) {
            expect(
                currentReturnPath({ pathname, search: "?next=%2Fstudies%2Fabc", hash: "" }),
                pathname,
            ).toBe("/studies/abc");
            expect(currentReturnPath({ pathname, search: "", hash: "" }), pathname).toBeNull();
        }
        expect(
            currentReturnPath({ pathname: "/auth", search: "?next=%2F%2Fevil.example", hash: "" }),
        ).toBeNull();
    });

    it("引数を省くと、ブラウザの現在の URL を使う", () => {
        window.history.replaceState(null, "", "/public/games?page=2#list");
        expect(currentReturnPath()).toBe("/public/games?page=2#list");
        expect(loginSearch()).toEqual({ next: "/public/games?page=2#list" });

        window.history.replaceState(null, "", "/");
        expect(currentReturnPath()).toBeNull();
        expect(loginSearch()).toEqual({ next: undefined });
    });
});

describe("buildLoginHref", () => {
    it("戻り先を `?next=...` に載せる", () => {
        expect(buildLoginHref("/studies/abc")).toBe("/auth?next=%2Fstudies%2Fabc");
        expect(buildLoginHref("/rshogi-viewer?event=WCSC36#top")).toBe(
            "/auth?next=%2Frshogi-viewer%3Fevent%3DWCSC36%23top",
        );
    });

    it("使えない戻り先は付けない", () => {
        expect(buildLoginHref(null)).toBe("/auth");
        expect(buildLoginHref("/")).toBe("/auth");
        expect(buildLoginHref("/auth")).toBe("/auth");
        expect(buildLoginHref("//evil.example")).toBe("/auth");
        expect(buildLoginHref("https://evil.example/")).toBe("/auth");
    });

    it("作ったリンクから、同じ戻り先を読み戻せる", () => {
        const returnPath = "/games/1/review?ply=12&name=%E3%83%A9%E3%83%A0#c";
        const href = buildLoginHref(returnPath);
        expect(readReturnPathFromSearch(href.slice(href.indexOf("?")))).toBe(returnPath);
    });
});
