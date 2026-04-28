import { describe, expect, it, vi } from "vitest";
import {
    fetchRshogiGame,
    listMockRshogiGameIds,
    RshogiGameFetchError,
    RshogiGameNotFoundError,
} from "./client";

describe("fetchRshogiGame (mock fallback)", () => {
    it("returns the embedded fixture when no baseUrl is provided", async () => {
        const game = await fetchRshogiGame("sample-1");
        expect(game.meta.gameId).toBe("sample-1");
        expect(game.meta.senteName).toBe("RAMU_TP");
        expect(game.csa).toContain("V2.2");
        expect(game.csa).toContain("+7776FU");
    });

    it("throws RshogiGameNotFoundError for unknown ids in mock mode", async () => {
        await expect(fetchRshogiGame("does-not-exist")).rejects.toBeInstanceOf(
            RshogiGameNotFoundError,
        );
    });

    it("rejects when gameId is empty", async () => {
        await expect(fetchRshogiGame("")).rejects.toBeInstanceOf(RshogiGameFetchError);
    });

    it("lists mock game ids", () => {
        const ids = listMockRshogiGameIds();
        expect(ids).toContain("sample-1");
    });
});

describe("fetchRshogiGame (real baseUrl)", () => {
    it("calls baseUrl/games/<id> and returns the parsed payload", async () => {
        const payload = {
            meta: { gameId: "abc", senteName: "S", goteName: "G" },
            csa: "V2.2\nN+S\nN-G\nPI\n+\n",
        };
        const fetchImpl = vi.fn(
            async () =>
                new Response(JSON.stringify(payload), {
                    status: 200,
                    headers: { "content-type": "application/json" },
                }),
        ) as unknown as typeof fetch;

        const game = await fetchRshogiGame("abc", {
            baseUrl: "https://rshogi.example.com/api/",
            fetchImpl,
        });

        expect(fetchImpl).toHaveBeenCalledTimes(1);
        const calledUrl = (fetchImpl as unknown as { mock: { calls: [string][] } }).mock
            .calls[0][0];
        expect(calledUrl).toBe("https://rshogi.example.com/api/games/abc");
        expect(game.meta.gameId).toBe("abc");
        expect(game.csa).toContain("V2.2");
    });

    it("maps 404 to RshogiGameNotFoundError", async () => {
        const fetchImpl = vi.fn(
            async () => new Response("not found", { status: 404 }),
        ) as unknown as typeof fetch;

        await expect(
            fetchRshogiGame("missing", {
                baseUrl: "https://rshogi.example.com",
                fetchImpl,
            }),
        ).rejects.toBeInstanceOf(RshogiGameNotFoundError);
    });

    it("maps non-2xx (other than 404) to RshogiGameFetchError", async () => {
        const fetchImpl = vi.fn(
            async () => new Response("boom", { status: 500, statusText: "Server Error" }),
        ) as unknown as typeof fetch;

        await expect(
            fetchRshogiGame("boom", {
                baseUrl: "https://rshogi.example.com",
                fetchImpl,
            }),
        ).rejects.toBeInstanceOf(RshogiGameFetchError);
    });
});
