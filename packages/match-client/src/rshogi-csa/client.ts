import { createHttpObservationSource } from "./http-observation";
import type {
    FetchRshogiGameListOptions,
    FetchRshogiGameOptions,
    FetchRshogiGameSearchOptions,
    FetchRshogiLiveGameListOptions,
    FetchRshogiPlayerDetailOptions,
    FetchRshogiPlayerListOptions,
    RshogiGame,
    RshogiGameEventSummary,
    RshogiGameListPage,
    RshogiGameSearchPage,
    RshogiLiveGameListPage,
    RshogiObservationSource,
    RshogiPlayerDetail,
    RshogiPlayerList,
} from "./observation";
import { RshogiGameFetchError, RshogiPlayerNotFoundError } from "./observation";
import { sampleObservationSource } from "./sample-observation";

export type {
    FetchRshogiGameOptions,
    FetchRshogiGameSearchOptions,
    RshogiClockKind,
    RshogiGame,
    RshogiGameEventMeta,
    RshogiGameEventSummary,
    RshogiGameMeta,
    RshogiGameResult,
    RshogiGameResultKind,
    RshogiGameSearchPage,
    RshogiGameSummary,
    RshogiLiveGameSummary,
    RshogiPlayerDetail,
    RshogiPlayerList,
    RshogiPlayerSummary,
    RshogiTimeControl,
} from "./observation";
export {
    RshogiGameFetchError,
    RshogiGameNotFoundError,
    RshogiPlayerNotFoundError,
} from "./observation";
export { listMockRshogiGameIds } from "./sample-observation";

function observationSource(options: FetchRshogiGameOptions): RshogiObservationSource {
    const baseUrl = options.baseUrl?.trim();
    return baseUrl
        ? createHttpObservationSource(baseUrl.replace(/\/+$/, ""), options.fetchImpl)
        : sampleObservationSource;
}

export async function fetchRshogiGame(
    gameId: string,
    options: FetchRshogiGameOptions = {},
): Promise<RshogiGame> {
    if (!gameId) {
        throw new RshogiGameFetchError(gameId, "gameId is required");
    }

    return observationSource(options).game(gameId, options);
}

export async function fetchRshogiGameList(
    options: FetchRshogiGameListOptions = {},
): Promise<RshogiGameListPage> {
    return observationSource(options).gameList(options);
}

export async function fetchRshogiGameEvents(
    options: FetchRshogiGameOptions = {},
): Promise<RshogiGameEventSummary[]> {
    return observationSource(options).gameEvents(options);
}

export async function fetchRshogiGameSearch(
    options: FetchRshogiGameSearchOptions = {},
): Promise<RshogiGameSearchPage> {
    return observationSource(options).gameSearch(options);
}

export async function fetchRshogiPlayerList(
    options: FetchRshogiPlayerListOptions = {},
): Promise<RshogiPlayerList> {
    return observationSource(options).playerList(options);
}

export async function fetchRshogiPlayerDetail(
    playerId: string,
    options: FetchRshogiPlayerDetailOptions = {},
): Promise<RshogiPlayerDetail> {
    if (!playerId) throw new RshogiPlayerNotFoundError(playerId);
    return observationSource(options).playerDetail(playerId, options);
}

export async function fetchRshogiLiveGameList(
    options: FetchRshogiLiveGameListOptions = {},
): Promise<RshogiLiveGameListPage> {
    return observationSource(options).liveGameList(options);
}
