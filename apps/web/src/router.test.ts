import { createMemoryHistory } from "@tanstack/react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readReturnPathFromSearch } from "./lib/loginReturn";
import { router } from "./router";

const load = async (url: string) => {
    router.update({ history: createMemoryHistory({ initialEntries: [url] }) });
    await router.load();
    return router.state.location;
};

describe("router: rshogi viewer", () => {
    it("廃止した進行中一覧 /rshogi-viewer/live は /rshogi-viewer へ送る", async () => {
        const location = await load("/rshogi-viewer/live");
        expect(location.pathname).toBe("/rshogi-viewer");
    });

    it("単局の観戦ページ /rshogi-viewer/live/$gameId は残す", async () => {
        const location = await load("/rshogi-viewer/live/game-1");
        expect(location.pathname).toBe("/rshogi-viewer/live/game-1");
        expect(router.state.matches.at(-1)?.routeId).toBe("/rshogi-viewer/live/$gameId");
    });

    it("絞り込み条件をクエリから読む", async () => {
        const loadSearch = async (url: string) => {
            const location = await load(url);
            expect(location.pathname).toBe("/rshogi-viewer");
            return router.state.matches.at(-1)?.search;
        };

        expect(await loadSearch("/rshogi-viewer?event=WCSC36&venue=floodgate")).toEqual({
            event: "WCSC36",
            venue: "floodgate",
        });
        expect(await loadSearch("/rshogi-viewer")).toEqual({});
    });

    it("数値や真偽値に見えるイベント名も文字列として読み、引用符なしで書き戻す", async () => {
        for (const event of ["2026", "true", "1.0", "null"]) {
            await load(`/rshogi-viewer?event=${event}`);
            expect(router.state.matches.at(-1)?.search).toEqual({ event });
        }

        await load("/rshogi-viewer");
        await router.navigate({ to: "/rshogi-viewer", search: { event: "2026" } });
        expect(router.state.location.searchStr).toBe("?event=2026");
        expect(router.state.matches.at(-1)?.search).toEqual({ event: "2026" });

        await router.navigate({
            to: "/rshogi-viewer",
            search: { event: "サンプル大会", venue: "other" },
        });
        expect(decodeURIComponent(router.state.location.searchStr)).toBe(
            "?event=サンプル大会&venue=other",
        );
    });

    it("validateSearch は不正な値を捨てる", () => {
        const validate = router.routesByPath["/rshogi-viewer"].options.validateSearch as (
            raw: Record<string, unknown>,
        ) => unknown;
        expect(validate({ venue: "wdoor", result: "bogus", from: "yesterday", x: 1 })).toEqual({});
        expect(validate({ event: "WCSC36", venue: "bogus", name: "RAMU" })).toEqual({
            event: "WCSC36",
            name: "RAMU",
        });
    });
});

describe("router: ログイン後の戻り先", () => {
    const GAME_ID = "11111111-2222-4333-8444-555555555555";

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    const stubUnauthorized = (): void => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => new Response(JSON.stringify({ error: {} }), { status: 401 })),
        );
    };

    it("未ログインで要ログインのページを開くと、そのページを戻り先にしてログインの画面へ送る", async () => {
        stubUnauthorized();

        const location = await load(`/games/${GAME_ID}/review?ply=12#comment`);

        expect(location.pathname).toBe("/auth");
        expect(readReturnPathFromSearch(location.searchStr)).toBe(
            `/games/${GAME_ID}/review?ply=12#comment`,
        );
    });

    it("棋譜の詳細ページも同じ", async () => {
        stubUnauthorized();

        const location = await load(`/games/${GAME_ID}`);

        expect(location.pathname).toBe("/auth");
        expect(readReturnPathFromSearch(location.searchStr)).toBe(`/games/${GAME_ID}`);
    });

    it("ログインの画面は、戻り先とユーザー名設定の指定をクエリに保つ", async () => {
        await load("/auth?setup=username&next=%2Fstudies%2Fabc%3Fa%3D1%23h");
        expect(router.state.matches.at(-1)?.search).toEqual({
            setup: "username",
            next: "/studies/abc?a=1#h",
        });

        await router.navigate({ to: "/auth", search: { next: "/rshogi-viewer?event=2026" } });
        expect(readReturnPathFromSearch(router.state.location.searchStr)).toBe(
            "/rshogi-viewer?event=2026",
        );
    });

    it("戻り先（クエリとハッシュつき）を履歴へ積むと、そのページへ遷移する", async () => {
        await load("/auth?setup=username&next=%2Frshogi-viewer%3Fevent%3DWCSC36%23list");
        const returnPath = readReturnPathFromSearch(router.state.location.searchStr);
        expect(returnPath).toBe("/rshogi-viewer?event=WCSC36#list");

        router.history.push(returnPath ?? "/");
        await router.load();

        expect(router.state.location.pathname).toBe("/rshogi-viewer");
        expect(router.state.matches.at(-1)?.search).toEqual({ event: "WCSC36" });
        expect(router.state.location.hash).toBe("list");
    });
});
