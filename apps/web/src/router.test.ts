import { createMemoryHistory } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
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
