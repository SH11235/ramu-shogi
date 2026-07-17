import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    fetchRshogiGame,
    fetchRshogiGameList,
    fetchRshogiGameSearch,
    fetchRshogiLiveGameList,
    fetchRshogiPlayerDetail,
    fetchRshogiPlayerList,
    listMockRshogiGameIds,
    RshogiGameFetchError,
    RshogiGameNotFoundError,
    RshogiPlayerNotFoundError,
} from "./client";

describe("rshogi player API (mock fallback)", () => {
    it("builds a ranked player list and paginated detail from fixtures", async () => {
        const list = await fetchRshogiPlayerList();
        expect(list.players.length).toBeGreaterThan(1);
        expect(list.players[0]).toEqual(
            expect.objectContaining({
                playerId: expect.stringMatching(/^legacy_mock_/),
                rating: expect.any(Number),
                games: expect.any(Number),
                legacy: true,
            }),
        );

        const detail = await fetchRshogiPlayerDetail(list.players[0].playerId, { pageSize: 1 });
        expect(detail.player).toEqual(list.players[0]);
        expect(detail.games).toHaveLength(1);
        expect(detail.totalCount).toBeGreaterThanOrEqual(1);
    });

    it("rejects an unknown player id", async () => {
        await expect(fetchRshogiPlayerDetail("missing")).rejects.toBeInstanceOf(
            RshogiPlayerNotFoundError,
        );
    });
});

describe("rshogi player API (real baseUrl)", () => {
    const summary = {
        player_id: "p_012345",
        display_name: "RAMU",
        rating: 1542.4,
        games: 12,
        wins: 7,
        losses: 4,
        draws: 1,
        last_played_at_ms: 1_777_392_877_244,
        legacy: false,
    };

    it("decodes the ranking list", async () => {
        const fetchImpl = vi.fn(
            async () => new Response(JSON.stringify({ players: [summary] }), { status: 200 }),
        ) as unknown as typeof fetch;
        const result = await fetchRshogiPlayerList({
            baseUrl: "https://rshogi.example.com/api/v1/",
            fetchImpl,
        });
        expect(fetchImpl).toHaveBeenCalledWith("https://rshogi.example.com/api/v1/players", {
            signal: undefined,
            cache: "no-store",
        });
        expect(result.players[0]).toEqual({
            playerId: "p_012345",
            displayName: "RAMU",
            rating: 1542.4,
            games: 12,
            wins: 7,
            losses: 4,
            draws: 1,
            lastPlayedAtMs: 1_777_392_877_244,
            legacy: false,
        });
    });

    it("encodes the player id and decodes detail games with player ids", async () => {
        const fetchImpl = vi.fn(
            async () =>
                new Response(
                    JSON.stringify({
                        player: summary,
                        games: [
                            {
                                game_id: "g-1",
                                black_handle: "RAMU",
                                black_player_id: "p_012345",
                                white_handle: "OTHER",
                                white_player_id: "p_987654",
                                result_kind: "WIN_BLACK",
                                end_reason: "RESIGN",
                            },
                        ],
                        page: 2,
                        page_size: 10,
                        total_count: 12,
                    }),
                    { status: 200 },
                ),
        ) as unknown as typeof fetch;
        const result = await fetchRshogiPlayerDetail("p/a", {
            baseUrl: "https://rshogi.example.com/api/v1",
            page: 2,
            pageSize: 10,
            fetchImpl,
        });
        expect(fetchImpl).toHaveBeenCalledWith(
            "https://rshogi.example.com/api/v1/players/p%2Fa?page=2&pageSize=10",
            { signal: undefined, cache: "no-store" },
        );
        expect(result.games[0]).toEqual(
            expect.objectContaining({
                sentePlayerId: "p_012345",
                gotePlayerId: "p_987654",
            }),
        );
        expect(result).toEqual(expect.objectContaining({ page: 2, pageSize: 10, totalCount: 12 }));
    });
});

describe("fetchRshogiGameSearch (mock fallback)", () => {
    it("filters by name and paginates the embedded fixtures", async () => {
        const first = await fetchRshogiGameSearch({ name: "ramu", page: 1, pageSize: 2 });
        expect(first.games).toHaveLength(2);
        expect(first.totalCount).toBeGreaterThan(2);
        expect(first.page).toBe(1);
        expect(first.pageSize).toBe(2);

        const second = await fetchRshogiGameSearch({ name: "ramu", page: 2, pageSize: 2 });
        expect(second.games[0].gameId).not.toBe(first.games[0].gameId);
    });
});

describe("fetchRshogiGameSearch (real baseUrl)", () => {
    it("builds all query parameters and decodes the search page", async () => {
        const fetchImpl = vi.fn(
            async () =>
                new Response(
                    JSON.stringify({
                        games: [
                            {
                                game_id: "searched-1",
                                black_handle: "Alice",
                                white_handle: "Bob",
                                ended_at_ms: 1777392877244,
                                result_kind: "WIN_BLACK",
                                end_reason: "RESIGN",
                                source: "floodgate",
                            },
                        ],
                        page: 2,
                        page_size: 20,
                        total_count: 35,
                    }),
                    { status: 200 },
                ),
        ) as unknown as typeof fetch;

        const result = await fetchRshogiGameSearch({
            baseUrl: "https://rshogi.example.com/api/v1/",
            fetchImpl,
            name: "Alice Bob",
            result: "resignation",
            source: "floodgate",
            from: 1000,
            to: 2000,
            page: 2,
            pageSize: 20,
        });

        expect(fetchImpl).toHaveBeenCalledWith(
            "https://rshogi.example.com/api/v1/games/search?name=Alice+Bob&result=resignation&source=floodgate&from=1000&to=2000&page=2&pageSize=20",
            { signal: undefined, cache: "no-store" },
        );
        expect(result).toEqual({
            games: [
                expect.objectContaining({
                    gameId: "searched-1",
                    senteName: "Alice",
                    goteName: "Bob",
                    endedAtMs: 1777392877244,
                    source: "floodgate",
                    result: {
                        kind: "resignation",
                        winner: "sente",
                        endReason: "RESIGN",
                    },
                }),
            ],
            page: 2,
            pageSize: 20,
            totalCount: 35,
        });
    });
});

// production code 側は `import.meta.env` → `process.env` の順で読むため、テストでは
// `vi.stubEnv` で両方を上書きする (Vitest 4 では `vi.stubEnv` が `import.meta.env` と
// `process.env` の両方に反映される)。
const setEnv = (key: string, value: string | undefined) => {
    if (value === undefined) {
        vi.stubEnv(key, "");
    } else {
        vi.stubEnv(key, value);
    }
};

describe("fetchRshogiGame (mock fallback)", () => {
    it("returns the embedded fixture when no baseUrl is provided", async () => {
        const game = await fetchRshogiGame("sample-1");
        expect(game.meta.gameId).toBe("sample-1");
        expect(game.meta.senteName).toBe("RAMU_TP");
        expect(typeof game.meta.startedAtMs).toBe("number");
        expect(typeof game.meta.endedAtMs).toBe("number");
        expect(game.meta.timeControl?.kind).toBe("fischer");
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
    it("decodes wire (snake_case + epoch_ms) into camelCase + epoch_ms domain types", async () => {
        const wirePayload = {
            game_id: "abc",
            csa: "V2.2\nN+alice\nN-bob\nPI\n+\n",
            meta: {
                game_id: "abc",
                started_at_ms: 1777391025209,
                ended_at_ms: 1777392877244,
                black_handle: "alice",
                white_handle: "bob",
                result_kind: "WIN_BLACK",
                end_reason: "RESIGN",
                moves_count: 142,
                clock: {
                    kind: "fischer",
                    total_sec: 300,
                    byoyomi_sec: 10,
                    byoyomi_ms: null,
                    increment_sec: 5,
                },
                source: "kifu",
                event: "test event",
            },
        };
        const fetchImpl = vi.fn(
            async () =>
                new Response(JSON.stringify(wirePayload), {
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
        // black=sente, white=gote
        expect(game.meta.senteName).toBe("alice");
        expect(game.meta.goteName).toBe("bob");
        expect(game.meta.startedAtMs).toBe(1777391025209);
        expect(game.meta.endedAtMs).toBe(1777392877244);
        expect(game.meta.event).toBe("test event");
        expect(game.meta.movesCount).toBe(142);
        expect(game.meta.source).toBe("kifu");
        expect(game.meta.timeControl).toEqual({
            kind: "fischer",
            mainSeconds: 300,
            byoyomiSeconds: 10,
            byoyomiMilliseconds: undefined,
            incrementSeconds: 5,
        });
        expect(game.meta.result).toEqual({
            kind: "resignation",
            winner: "sente",
            endReason: "RESIGN",
        });
        expect(game.csa).toContain("V2.2");
    });

    it("decodes WIN_WHITE + TIME_UP into gote winner + time_expired", async () => {
        const wirePayload = {
            game_id: "g1",
            csa: "V2.2\n",
            meta: {
                game_id: "g1",
                started_at_ms: 1,
                ended_at_ms: 2,
                black_handle: "B",
                white_handle: "W",
                result_kind: "WIN_WHITE",
                end_reason: "TIME_UP",
                moves_count: 50,
                clock: { kind: "countdown", total_sec: 60, byoyomi_sec: 30 },
                source: "floodgate",
            },
        };
        const fetchImpl = vi.fn(
            async () =>
                new Response(JSON.stringify(wirePayload), {
                    status: 200,
                }),
        ) as unknown as typeof fetch;
        const game = await fetchRshogiGame("g1", {
            baseUrl: "https://rshogi.example.com",
            fetchImpl,
        });
        expect(game.meta.result).toEqual({
            kind: "time_expired",
            winner: "gote",
            endReason: "TIME_UP",
        });
    });

    it("decodes DRAW + SENNICHITE into draw without winner", async () => {
        const wirePayload = {
            game_id: "g2",
            csa: "V2.2\n",
            meta: {
                game_id: "g2",
                black_handle: "B",
                white_handle: "W",
                result_kind: "DRAW",
                end_reason: "SENNICHITE",
            },
        };
        const fetchImpl = vi.fn(
            async () =>
                new Response(JSON.stringify(wirePayload), {
                    status: 200,
                }),
        ) as unknown as typeof fetch;
        const game = await fetchRshogiGame("g2", {
            baseUrl: "https://rshogi.example.com",
            fetchImpl,
        });
        expect(game.meta.result).toEqual({
            kind: "draw",
            winner: undefined,
            endReason: "SENNICHITE",
        });
    });

    it("decodes WIN_BLACK + JISHOGI into jishogi with sente winner", async () => {
        const wirePayload = {
            game_id: "g3",
            csa: "V2.2\n",
            meta: {
                game_id: "g3",
                black_handle: "B",
                white_handle: "W",
                result_kind: "WIN_BLACK",
                end_reason: "JISHOGI",
            },
        };
        const fetchImpl = vi.fn(
            async () =>
                new Response(JSON.stringify(wirePayload), {
                    status: 200,
                }),
        ) as unknown as typeof fetch;
        const game = await fetchRshogiGame("g3", {
            baseUrl: "https://rshogi.example.com",
            fetchImpl,
        });
        expect(game.meta.result).toEqual({
            kind: "jishogi",
            winner: "sente",
            endReason: "JISHOGI",
        });
    });

    it("decodes WIN_WHITE + OUTE_SENNICHITE into oute_sennichite with gote winner", async () => {
        const wirePayload = {
            game_id: "g4",
            csa: "V2.2\n",
            meta: {
                game_id: "g4",
                black_handle: "B",
                white_handle: "W",
                result_kind: "WIN_WHITE",
                end_reason: "OUTE_SENNICHITE",
            },
        };
        const fetchImpl = vi.fn(
            async () =>
                new Response(JSON.stringify(wirePayload), {
                    status: 200,
                }),
        ) as unknown as typeof fetch;
        const game = await fetchRshogiGame("g4", {
            baseUrl: "https://rshogi.example.com",
            fetchImpl,
        });
        expect(game.meta.result).toEqual({
            kind: "oute_sennichite",
            winner: "gote",
            endReason: "OUTE_SENNICHITE",
        });
    });

    it("normalizes stopwatch clock from total_min/byoyomi_min", async () => {
        const wirePayload = {
            game_id: "g5",
            csa: "V2.2\n",
            meta: {
                game_id: "g5",
                black_handle: "B",
                white_handle: "W",
                clock: { kind: "stopwatch", total_min: 30, byoyomi_min: 1 },
            },
        };
        const fetchImpl = vi.fn(
            async () =>
                new Response(JSON.stringify(wirePayload), {
                    status: 200,
                }),
        ) as unknown as typeof fetch;
        const game = await fetchRshogiGame("g5", {
            baseUrl: "https://rshogi.example.com",
            fetchImpl,
        });
        expect(game.meta.timeControl).toEqual({
            kind: "stopwatch",
            mainSeconds: 1800,
            byoyomiSeconds: 60,
            byoyomiMilliseconds: undefined,
            incrementSeconds: undefined,
        });
    });

    it("normalizes countdown_msec clock from total_ms/byoyomi_ms", async () => {
        const wirePayload = {
            game_id: "g6",
            csa: "V2.2\n",
            meta: {
                game_id: "g6",
                black_handle: "B",
                white_handle: "W",
                clock: { kind: "countdown_msec", total_ms: 30000, byoyomi_ms: 250 },
            },
        };
        const fetchImpl = vi.fn(
            async () =>
                new Response(JSON.stringify(wirePayload), {
                    status: 200,
                }),
        ) as unknown as typeof fetch;
        const game = await fetchRshogiGame("g6", {
            baseUrl: "https://rshogi.example.com",
            fetchImpl,
        });
        expect(game.meta.timeControl).toEqual({
            kind: "countdown_msec",
            mainSeconds: 30,
            byoyomiSeconds: 0,
            byoyomiMilliseconds: 250,
            incrementSeconds: undefined,
        });
    });

    it("degrades gracefully when meta is missing", async () => {
        const wirePayload = {
            game_id: "g7",
            csa: "V2.2\n",
        };
        const fetchImpl = vi.fn(
            async () =>
                new Response(JSON.stringify(wirePayload), {
                    status: 200,
                }),
        ) as unknown as typeof fetch;
        const game = await fetchRshogiGame("g7", {
            baseUrl: "https://rshogi.example.com",
            fetchImpl,
        });
        expect(game.meta.gameId).toBe("g7");
        expect(game.meta.senteName).toBe("");
        expect(game.meta.goteName).toBe("");
        expect(game.meta.result).toBeUndefined();
        expect(game.csa).toBe("V2.2\n");
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

describe("fetchRshogiGameList (mock fallback)", () => {
    it("returns the mock list when no baseUrl is provided", async () => {
        const page = await fetchRshogiGameList();
        expect(page.games.length).toBeGreaterThan(0);
        expect(page.games[0].gameId).toBeTruthy();
        // すべて summary 形式 (camelCase + epoch_ms)
        for (const game of page.games) {
            expect(typeof game.senteName).toBe("string");
            expect(typeof game.goteName).toBe("string");
            if (game.startedAtMs !== undefined) {
                expect(typeof game.startedAtMs).toBe("number");
            }
        }
    });

    it("respects limit and exposes nextCursor when more results exist", async () => {
        const first = await fetchRshogiGameList({ limit: 2 });
        expect(first.games).toHaveLength(2);
        expect(first.nextCursor).toBe("2");
        const second = await fetchRshogiGameList({ limit: 2, cursor: first.nextCursor });
        expect(second.games.length).toBeGreaterThan(0);
        expect(second.games[0].gameId).not.toBe(first.games[0].gameId);
    });
});

describe("fetchRshogiGameList (real baseUrl)", () => {
    it("calls baseUrl/games with cursor & limit query and decodes wire into RshogiGameListPage", async () => {
        const wirePayload = {
            games: [
                {
                    game_id: "room1-1777391025209",
                    started_at_ms: 1777391025209,
                    ended_at_ms: 1777392877244,
                    black_handle: "alice",
                    white_handle: "bob",
                    result_kind: "WIN_BLACK",
                    end_reason: "RESIGN",
                    moves_count: 142,
                    clock: {
                        kind: "fischer",
                        total_sec: 300,
                        byoyomi_sec: 10,
                        byoyomi_ms: null,
                        increment_sec: null,
                    },
                    source: "kifu",
                },
            ],
            next_cursor: "opaque-cursor",
        };
        const fetchImpl = vi.fn(
            async () =>
                new Response(JSON.stringify(wirePayload), {
                    status: 200,
                    headers: { "content-type": "application/json" },
                }),
        ) as unknown as typeof fetch;

        const page = await fetchRshogiGameList({
            baseUrl: "https://rshogi.example.com/api/v1/",
            cursor: "prev-cursor",
            limit: 25,
            fetchImpl,
        });

        const calledUrl = (fetchImpl as unknown as { mock: { calls: [string][] } }).mock
            .calls[0][0];
        expect(calledUrl).toBe(
            "https://rshogi.example.com/api/v1/games?cursor=prev-cursor&limit=25",
        );
        expect(page.nextCursor).toBe("opaque-cursor");
        expect(page.games).toHaveLength(1);
        expect(page.games[0]).toMatchObject({
            gameId: "room1-1777391025209",
            senteName: "alice",
            goteName: "bob",
            startedAtMs: 1777391025209,
            endedAtMs: 1777392877244,
            movesCount: 142,
            source: "kifu",
            result: {
                kind: "resignation",
                winner: "sente",
                endReason: "RESIGN",
            },
            timeControl: {
                kind: "fischer",
                mainSeconds: 300,
                byoyomiSeconds: 10,
            },
        });
    });

    it("omits null next_cursor", async () => {
        const wirePayload = { games: [], next_cursor: null };
        const fetchImpl = vi.fn(
            async () => new Response(JSON.stringify(wirePayload), { status: 200 }),
        ) as unknown as typeof fetch;
        const page = await fetchRshogiGameList({
            baseUrl: "https://rshogi.example.com",
            fetchImpl,
        });
        expect(page.games).toEqual([]);
        expect(page.nextCursor).toBeUndefined();
    });

    it("throws RshogiGameFetchError on non-2xx", async () => {
        const fetchImpl = vi.fn(
            async () => new Response("boom", { status: 500, statusText: "Server Error" }),
        ) as unknown as typeof fetch;
        await expect(
            fetchRshogiGameList({
                baseUrl: "https://rshogi.example.com",
                fetchImpl,
            }),
        ).rejects.toBeInstanceOf(RshogiGameFetchError);
    });

    it("throws RshogiGameFetchError when payload has no games array", async () => {
        const fetchImpl = vi.fn(
            async () =>
                new Response(JSON.stringify({ unrelated: true }), {
                    status: 200,
                }),
        ) as unknown as typeof fetch;
        await expect(
            fetchRshogiGameList({
                baseUrl: "https://rshogi.example.com",
                fetchImpl,
            }),
        ).rejects.toBeInstanceOf(RshogiGameFetchError);
    });
});

describe("fetchRshogiLiveGameList (mock fallback)", () => {
    it("returns the mock live list when no baseUrl is provided", async () => {
        const page = await fetchRshogiLiveGameList();
        expect(page.liveGames.length).toBeGreaterThan(0);
        expect(page.liveGames[0].gameId).toBeTruthy();
        for (const game of page.liveGames) {
            expect(typeof game.senteName).toBe("string");
            expect(typeof game.goteName).toBe("string");
            // 進行中対局には result / endedAtMs / movesCount が無い。
            expect(game).not.toHaveProperty("result");
            expect(game).not.toHaveProperty("endedAtMs");
            expect(game).not.toHaveProperty("movesCount");
        }
    });

    it("respects limit and exposes nextCursor when more results exist", async () => {
        const first = await fetchRshogiLiveGameList({ limit: 1 });
        expect(first.liveGames).toHaveLength(1);
        expect(first.nextCursor).toBe("1");
        const second = await fetchRshogiLiveGameList({ limit: 1, cursor: first.nextCursor });
        expect(second.liveGames.length).toBeGreaterThan(0);
        expect(second.liveGames[0].gameId).not.toBe(first.liveGames[0].gameId);
    });
});

describe("fetchRshogiLiveGameList (real baseUrl)", () => {
    it("calls baseUrl/games/live with cursor & limit query and decodes wire into RshogiLiveGameListPage", async () => {
        const wirePayload = {
            live_games: [
                {
                    game_id: "lobby-cross-fischer-1777391025209",
                    started_at_ms: 1777391025209,
                    black_handle: "alice",
                    white_handle: "bob",
                    clock: {
                        kind: "fischer",
                        total_sec: 300,
                        byoyomi_sec: 10,
                        byoyomi_ms: null,
                        increment_sec: 5,
                    },
                    source: "kifu",
                },
            ],
            next_cursor: "opaque-cursor",
        };
        const fetchImpl = vi.fn(
            async () =>
                new Response(JSON.stringify(wirePayload), {
                    status: 200,
                    headers: { "content-type": "application/json" },
                }),
        ) as unknown as typeof fetch;

        const page = await fetchRshogiLiveGameList({
            baseUrl: "https://rshogi.example.com/api/v1/",
            cursor: "prev-cursor",
            limit: 25,
            fetchImpl,
        });

        const calledUrl = (fetchImpl as unknown as { mock: { calls: [string][] } }).mock
            .calls[0][0];
        expect(calledUrl).toBe(
            "https://rshogi.example.com/api/v1/games/live?cursor=prev-cursor&limit=25",
        );
        expect(page.nextCursor).toBe("opaque-cursor");
        expect(page.liveGames).toHaveLength(1);
        expect(page.liveGames[0]).toEqual({
            gameId: "lobby-cross-fischer-1777391025209",
            // black=sente, white=gote
            senteName: "alice",
            goteName: "bob",
            startedAtMs: 1777391025209,
            source: "kifu",
            timeControl: {
                kind: "fischer",
                mainSeconds: 300,
                byoyomiSeconds: 10,
                byoyomiMilliseconds: undefined,
                incrementSeconds: 5,
            },
        });
        // live summary は result 系フィールドを持たない。
        expect(page.liveGames[0]).not.toHaveProperty("result");
        expect(page.liveGames[0]).not.toHaveProperty("endedAtMs");
        expect(page.liveGames[0]).not.toHaveProperty("movesCount");
    });

    it("omits null next_cursor", async () => {
        const wirePayload = { live_games: [], next_cursor: null };
        const fetchImpl = vi.fn(
            async () => new Response(JSON.stringify(wirePayload), { status: 200 }),
        ) as unknown as typeof fetch;
        const page = await fetchRshogiLiveGameList({
            baseUrl: "https://rshogi.example.com",
            fetchImpl,
        });
        expect(page.liveGames).toEqual([]);
        expect(page.nextCursor).toBeUndefined();
    });

    it("throws RshogiGameFetchError on non-2xx", async () => {
        const fetchImpl = vi.fn(
            async () => new Response("boom", { status: 500, statusText: "Server Error" }),
        ) as unknown as typeof fetch;
        await expect(
            fetchRshogiLiveGameList({
                baseUrl: "https://rshogi.example.com",
                fetchImpl,
            }),
        ).rejects.toBeInstanceOf(RshogiGameFetchError);
    });

    it("throws RshogiGameFetchError when payload has no live_games array", async () => {
        const fetchImpl = vi.fn(
            async () =>
                new Response(JSON.stringify({ games: [] }), {
                    status: 200,
                }),
        ) as unknown as typeof fetch;
        await expect(
            fetchRshogiLiveGameList({
                baseUrl: "https://rshogi.example.com",
                fetchImpl,
            }),
        ).rejects.toBeInstanceOf(RshogiGameFetchError);
    });
});

describe("fetchRshogiGame* X-Client header (rshogi#564)", () => {
    beforeEach(() => {
        setEnv("VITE_CLIENT_KIND", undefined);
        setEnv("VITE_APP_VERSION", undefined);
    });
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    const okPayload = {
        game_id: "x1",
        black_handle: "B",
        white_handle: "W",
        csa: "V2.2\n",
    };

    it("does not attach X-Client header when VITE_CLIENT_KIND is unset", async () => {
        const fetchImpl = vi.fn(
            async () => new Response(JSON.stringify(okPayload), { status: 200 }),
        ) as unknown as typeof fetch;
        await fetchRshogiGame("x1", { baseUrl: "https://rshogi.example.com", fetchImpl });
        const init = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock
            .calls[0][1];
        expect(init).toEqual({ signal: undefined, cache: "no-store" });
        expect((init as { headers?: unknown }).headers).toBeUndefined();
    });

    it("attaches X-Client: <kind>/<version> when both env are set", async () => {
        setEnv("VITE_CLIENT_KIND", "ramu-shogi-web");
        setEnv("VITE_APP_VERSION", "1.2.3");
        const fetchImpl = vi.fn(
            async () => new Response(JSON.stringify(okPayload), { status: 200 }),
        ) as unknown as typeof fetch;
        await fetchRshogiGame("x1", { baseUrl: "https://rshogi.example.com", fetchImpl });
        const init = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock
            .calls[0][1];
        expect((init as { headers?: Record<string, string> }).headers).toEqual({
            "X-Client": "ramu-shogi-web/1.2.3",
        });
    });

    it("attaches X-Client: <kind> when only VITE_CLIENT_KIND is set", async () => {
        setEnv("VITE_CLIENT_KIND", "ramu-shogi-desktop");
        const fetchImpl = vi.fn(
            async () =>
                new Response(JSON.stringify({ games: [], next_cursor: null }), { status: 200 }),
        ) as unknown as typeof fetch;
        await fetchRshogiGameList({ baseUrl: "https://rshogi.example.com", fetchImpl });
        const init = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock
            .calls[0][1];
        expect((init as { headers?: Record<string, string> }).headers).toEqual({
            "X-Client": "ramu-shogi-desktop",
        });
    });

    it("does not attach header when VITE_CLIENT_KIND is empty/whitespace", async () => {
        setEnv("VITE_CLIENT_KIND", "   ");
        setEnv("VITE_APP_VERSION", "1.0.0");
        const fetchImpl = vi.fn(
            async () => new Response(JSON.stringify(okPayload), { status: 200 }),
        ) as unknown as typeof fetch;
        await fetchRshogiGame("x1", { baseUrl: "https://rshogi.example.com", fetchImpl });
        const init = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock
            .calls[0][1];
        expect((init as { headers?: unknown }).headers).toBeUndefined();
    });
});
