import { MOCK_RSHOGI_GAME_LIST, MOCK_RSHOGI_GAMES, MOCK_RSHOGI_LIVE_GAME_LIST } from "./fixtures";
import type {
    RshogiGameEventSummary,
    RshogiGameListPage,
    RshogiGameSearchPage,
    RshogiGameSummary,
    RshogiLiveGameListPage,
    RshogiObservationSource,
    RshogiPlayerDetail,
    RshogiPlayerList,
    RshogiPlayerSummary,
} from "./observation";
import {
    normalizeSearchSources,
    RshogiGameNotFoundError,
    RshogiPlayerNotFoundError,
} from "./observation";

const DEFAULT_MOCK_LIMIT = 50;
const MAX_MOCK_LIMIT = 100;
const DEFAULT_MOCK_SEARCH_PAGE_SIZE = 20;

const mockPlayerId = (name: string): string => `legacy_mock_${encodeURIComponent(name)}`;

const mockGamePlayerId = (game: RshogiGameSummary, side: "sente" | "gote"): string =>
    (side === "sente" ? game.sentePlayerId : game.gotePlayerId) ??
    mockPlayerId(side === "sente" ? game.senteName : game.goteName);

/** 外部から取り込んだ棋譜 (`wdoor` / `upload`) はサーバーと同じくレーティング集計から外す。 */
const mockRatedGames = (): RshogiGameSummary[] =>
    MOCK_RSHOGI_GAME_LIST.filter((game) => game.source !== "wdoor" && game.source !== "upload");

const buildMockPlayerList = (): RshogiPlayerSummary[] => {
    const records = new Map<string, Omit<RshogiPlayerSummary, "rating">>();
    for (const game of mockRatedGames().reverse()) {
        const winner = game.result?.winner;
        for (const [side, name] of [
            ["sente", game.senteName],
            ["gote", game.goteName],
        ] as const) {
            const id = mockGamePlayerId(game, side);
            const current = records.get(id) ?? {
                playerId: id,
                displayName: name,
                games: 0,
                wins: 0,
                losses: 0,
                draws: 0,
                lastPlayedAtMs: undefined,
                legacy: true,
            };
            current.games += 1;
            if (!winner) current.draws += 1;
            else if (winner === side) current.wins += 1;
            else current.losses += 1;
            if (game.endedAtMs !== undefined) {
                current.lastPlayedAtMs = Math.max(
                    current.lastPlayedAtMs ?? game.endedAtMs,
                    game.endedAtMs,
                );
            }
            records.set(id, current);
        }
    }
    return [...records.values()]
        .map((record) => ({
            ...record,
            rating: Math.round(1500 + (record.wins - record.losses) * 16),
        }))
        .sort((a, b) => b.rating - a.rating || a.displayName.localeCompare(b.displayName));
};

const mockPlayerList = (page = 1, pageSize = DEFAULT_MOCK_SEARCH_PAGE_SIZE): RshogiPlayerList => {
    const allPlayers = buildMockPlayerList();
    const normalizedPage = Math.max(1, page);
    const normalizedPageSize = Math.min(Math.max(1, pageSize), MAX_MOCK_LIMIT);
    const start = (normalizedPage - 1) * normalizedPageSize;
    return {
        players: allPlayers.slice(start, start + normalizedPageSize),
        page: normalizedPage,
        pageSize: normalizedPageSize,
        totalCount: allPlayers.length,
        totalGames: mockRatedGames().length,
        leader: allPlayers[0],
    };
};

const mockPlayerDetail = (
    playerId: string,
    page = 1,
    pageSize = DEFAULT_MOCK_SEARCH_PAGE_SIZE,
): RshogiPlayerDetail => {
    const player = buildMockPlayerList().find((candidate) => candidate.playerId === playerId);
    if (!player) throw new RshogiPlayerNotFoundError(playerId);
    const allGames = mockRatedGames().filter(
        (game) =>
            mockGamePlayerId(game, "sente") === playerId ||
            mockGamePlayerId(game, "gote") === playerId,
    );
    const normalizedPage = Math.max(1, page);
    const normalizedPageSize = Math.min(Math.max(1, pageSize), MAX_MOCK_LIMIT);
    const start = (normalizedPage - 1) * normalizedPageSize;
    return {
        player,
        games: allGames.slice(start, start + normalizedPageSize),
        page: normalizedPage,
        pageSize: normalizedPageSize,
        totalCount: allGames.length,
    };
};

const mockGameListPage = (
    cursor: string | undefined,
    limit: number | undefined,
): RshogiGameListPage => {
    const list = MOCK_RSHOGI_GAME_LIST;
    const startIndex = cursor ? Math.max(0, Number.parseInt(cursor, 10) || 0) : 0;
    const requested = limit ?? DEFAULT_MOCK_LIMIT;
    const clamped = Math.min(Math.max(1, requested), MAX_MOCK_LIMIT);
    const slice = list.slice(startIndex, startIndex + clamped);
    const next = startIndex + clamped;
    return {
        games: slice,
        nextCursor: next < list.length ? String(next) : undefined,
    };
};

const mockLiveGameListPage = (
    cursor: string | undefined,
    limit: number | undefined,
): RshogiLiveGameListPage => {
    const list = MOCK_RSHOGI_LIVE_GAME_LIST;
    const startIndex = cursor ? Math.max(0, Number.parseInt(cursor, 10) || 0) : 0;
    const requested = limit ?? DEFAULT_MOCK_LIMIT;
    const clamped = Math.min(Math.max(1, requested), MAX_MOCK_LIMIT);
    const slice = list.slice(startIndex, startIndex + clamped);
    const next = startIndex + clamped;
    return {
        liveGames: slice,
        nextCursor: next < list.length ? String(next) : undefined,
    };
};

const mockGameEvents = (): RshogiGameEventSummary[] => {
    const counts = new Map<string, RshogiGameEventSummary>();
    for (const game of MOCK_RSHOGI_GAME_LIST) {
        if (!game.event) continue;
        const key = `${game.event}\u0000${game.source ?? ""}`;
        const current = counts.get(key) ?? { event: game.event, source: game.source, games: 0 };
        current.games += 1;
        counts.set(key, current);
    }
    return [...counts.values()].sort((a, b) => b.games - a.games || a.event.localeCompare(b.event));
};

const mockGameSearchPage = (
    options: Parameters<RshogiObservationSource["gameSearch"]>[0],
): RshogiGameSearchPage => {
    const name = options.name?.trim().toLocaleLowerCase();
    const sources = normalizeSearchSources(options.source);
    const event = options.event?.trim();
    const filtered = MOCK_RSHOGI_GAME_LIST.filter((game) => {
        if (
            name &&
            !game.senteName.toLocaleLowerCase().includes(name) &&
            !game.goteName.toLocaleLowerCase().includes(name)
        ) {
            return false;
        }
        if (options.result && game.result?.kind !== options.result) return false;
        if (sources.length > 0 && (!game.source || !sources.includes(game.source))) return false;
        if (event && game.event !== event) return false;
        if (options.from !== undefined && (game.endedAtMs ?? -Infinity) < options.from)
            return false;
        if (options.to !== undefined && (game.endedAtMs ?? Infinity) > options.to) return false;
        return true;
    });
    const page = Math.max(1, options.page ?? 1);
    const pageSize = Math.min(
        Math.max(1, options.pageSize ?? DEFAULT_MOCK_SEARCH_PAGE_SIZE),
        MAX_MOCK_LIMIT,
    );
    const start = (page - 1) * pageSize;
    return {
        games: filtered.slice(start, start + pageSize),
        page,
        pageSize,
        totalCount: filtered.length,
    };
};

export const sampleObservationSource: RshogiObservationSource = {
    async game(gameId) {
        const game = MOCK_RSHOGI_GAMES[gameId];
        if (!game) throw new RshogiGameNotFoundError(gameId);
        return game;
    },
    async gameList({ cursor, limit }) {
        return mockGameListPage(cursor, limit);
    },
    async gameEvents() {
        return mockGameEvents();
    },
    async gameSearch(options) {
        return mockGameSearchPage(options);
    },
    async playerList({ page, pageSize }) {
        return mockPlayerList(page, pageSize);
    },
    async playerDetail(playerId, { page, pageSize }) {
        return mockPlayerDetail(playerId, page, pageSize);
    },
    async liveGameList({ cursor, limit }) {
        return mockLiveGameListPage(cursor, limit);
    },
};

export function listMockRshogiGameIds(): string[] {
    return Object.keys(MOCK_RSHOGI_GAMES);
}
