import type {
    RshogiGame,
    RshogiGameEventMeta,
    RshogiGameEventSummary,
    RshogiGameListPage,
    RshogiGameMeta,
    RshogiGameResult,
    RshogiGameResultKind,
    RshogiGameSearchPage,
    RshogiGameSummary,
    RshogiLiveGameListPage,
    RshogiLiveGameSummary,
    RshogiObservationSource,
    RshogiPlayerSummary,
    RshogiTimeControl,
} from "./observation";
import {
    normalizeSearchSources,
    RshogiGameFetchError,
    RshogiGameNotFoundError,
    RshogiPlayerNotFoundError,
} from "./observation";

/**
 * `VITE_*` env を読む。
 *
 * - 本番 (Vite build): `vite.config.ts::define` 経由で `import.meta.env.VITE_APP_VERSION` が
 *   literal 置換され、`VITE_CLIENT_KIND` は `.env*` / shell export 経由で `import.meta.env` に乗る
 * - Vitest 上: `import.meta.env` は提供されるが `vi.stubEnv` の反映タイミングに依存するため、
 *   Node 環境にある `process.env` も fallback として読む
 *
 * 値が undefined または空文字なら次のソースを試す。最終的にどこにも無ければ undefined を返す。
 */
const readViteEnv = (key: "VITE_CLIENT_KIND" | "VITE_APP_VERSION"): string | undefined => {
    const importMetaEnv = (import.meta as unknown as { env?: Record<string, string | undefined> })
        .env;
    const fromImport = importMetaEnv?.[key];
    if (fromImport !== undefined && fromImport !== "") return fromImport;
    const proc = (
        globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }
    ).process;
    return proc?.env?.[key];
};

/**
 * `X-Client` header を組み立てる。
 *
 * - `VITE_CLIENT_KIND` と `VITE_APP_VERSION` の両方が set なら `X-Client: <kind>/<version>`
 * - `VITE_CLIENT_KIND` のみ set なら `X-Client: <kind>`
 * - kind が未設定 (空文字含む) ならヘッダ自体を付与しない (= 既存挙動互換、サーバログでは `unknown` 扱い)
 */
const buildClientHeaders = (): Record<string, string> => {
    const kind = readViteEnv("VITE_CLIENT_KIND")?.trim();
    if (!kind) return {};
    const version = readViteEnv("VITE_APP_VERSION")?.trim();
    return {
        "X-Client": version ? `${kind}/${version}` : kind,
    };
};

const buildRequestInit = (signal: AbortSignal | undefined): RequestInit => {
    // `cache: "no-store"`: rshogi API は CDN edge 経由で `max-age` が長い値 (数時間)
    // に書き換わることがあり、ブラウザ HTTP キャッシュに乗ると live 一覧のポーリングが
    // ネットワークに出ず終局済み対局を「対局中」のまま表示し続ける。鮮度はサーバ側の
    // edge キャッシュ (60 秒) に任せ、ブラウザ側では常にネットワークへ出す。
    const headers = buildClientHeaders();
    if (Object.keys(headers).length === 0) {
        return { signal, cache: "no-store" };
    }
    return { signal, headers, cache: "no-store" };
};

export type RshogiResultKindWire = "WIN_BLACK" | "WIN_WHITE" | "DRAW" | "ABORT";

interface ClockWire {
    kind?: string;
    total_sec?: number | null;
    /** countdown_msec 用。total_sec の代わりに使う。 */
    total_ms?: number | null;
    /** stopwatch 用。total_sec の代わりに使う (分単位)。 */
    total_min?: number | null;
    byoyomi_sec?: number | null;
    byoyomi_ms?: number | null;
    /** stopwatch 用。byoyomi_sec の代わりに使う (分単位)。 */
    byoyomi_min?: number | null;
    increment_sec?: number | null;
}

interface GameWireBase {
    game_id: string;
    started_at_ms?: number | null;
    ended_at_ms?: number | null;
    black_handle: string;
    black_player_id?: string | null;
    white_handle: string;
    white_player_id?: string | null;
    result_kind?: RshogiResultKindWire | (string & {}) | null;
    end_reason?: string | null;
    moves_count?: number | null;
    clock?: ClockWire | null;
    source?: string | null;
    event?: string | null;
    origin_url?: string | null;
}

/**
 * 単局 GET (`/api/v1/games/:gameId`) のレスポンス (wire)。
 *
 * 一覧 (`GameWireBase` をフラットに並べる) と異なり、サーバ
 * (rshogi-csa-server-workers viewer_api.rs::GameResponse) はメタを `meta` に
 * ネストして返す。`meta` の中身は一覧 entry と同じ shape。
 */
interface GameDetailWire {
    game_id: string;
    csa: string;
    meta?: GameWireBase | null;
}

interface GameEventWire {
    event?: string | null;
    source?: string | null;
    games?: number | null;
    /** 形を信用せず、`decodeEventMeta` で検証して読む。 */
    meta?: unknown;
}

interface GameEventsResponseWire {
    events?: GameEventWire[];
}

interface GameListResponseWire {
    games?: GameWireBase[];
    next_cursor?: string | null;
}

interface GameSearchResponseWire {
    games?: GameWireBase[];
    page?: number;
    page_size?: number;
    total_count?: number;
}

interface PlayerSummaryWire {
    player_id: string;
    display_name: string;
    rating: number;
    games: number;
    wins: number;
    losses: number;
    draws: number;
    last_played_at_ms?: number | null;
    legacy?: boolean;
}

interface PlayerListResponseWire {
    players?: PlayerSummaryWire[];
    page?: number;
    page_size?: number;
    total_count?: number;
    total_games?: number;
    leader?: PlayerSummaryWire | null;
}

interface PlayerDetailResponseWire {
    player?: PlayerSummaryWire;
    games?: GameWireBase[];
    page?: number;
    page_size?: number;
    total_count?: number;
}

/**
 * 進行中対局一覧 (`/api/v1/games/live`) の 1 件分 (wire, snake_case)。
 *
 * サーバ側 `LiveGamesIndexEntry` に一致させる。終局済 (`GameWireBase`) と異なり
 * `ended_at_ms` / `result_kind` / `end_reason` / `moves_count` は存在しない。
 */
interface LiveGameWireBase {
    game_id: string;
    started_at_ms?: number | null;
    black_handle: string;
    white_handle: string;
    clock?: ClockWire | null;
    source?: string | null;
}

interface LiveGameListResponseWire {
    live_games?: LiveGameWireBase[];
    next_cursor?: string | null;
}

const decodeNumberOrUndefined = (value: number | null | undefined): number | undefined => {
    if (typeof value !== "number") return undefined;
    if (!Number.isFinite(value)) return undefined;
    return value;
};

const decodeStringOrUndefined = (value: string | null | undefined): string | undefined => {
    if (typeof value !== "string") return undefined;
    if (value.length === 0) return undefined;
    return value;
};

/** リンクにしてよい URL (`http://` か `https://` で始まり、URL として解釈できるもの) だけを返す。 */
const decodeHttpUrlOrUndefined = (value: unknown): string | undefined => {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    if (!/^https?:\/\//i.test(trimmed)) return undefined;
    try {
        const url = new URL(trimmed);
        return url.protocol === "https:" || url.protocol === "http:" ? trimmed : undefined;
    } catch {
        return undefined;
    }
};

const decodeTrimmedStringOrUndefined = (value: unknown): string | undefined => {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
};

/**
 * イベントのメタデータを検証して読む。正式名称 (`title`) の無いもの・オブジェクトでないものは
 * 未知の形として捨てる (メタ無しと同じ扱いになり、イベントのタグだけが表示される)。
 */
const decodeEventMeta = (wire: unknown): RshogiGameEventMeta | undefined => {
    if (typeof wire !== "object" || wire === null || Array.isArray(wire)) return undefined;
    const record = wire as Record<string, unknown>;
    const title = decodeTrimmedStringOrUndefined(record.title);
    if (title === undefined) return undefined;
    const meta: RshogiGameEventMeta = { title };
    const organizer = decodeTrimmedStringOrUndefined(record.organizer);
    if (organizer !== undefined) meta.organizer = organizer;
    const officialUrl = decodeHttpUrlOrUndefined(record.official_url);
    if (officialUrl !== undefined) meta.officialUrl = officialUrl;
    const kifuSourceUrl = decodeHttpUrlOrUndefined(record.kifu_source_url);
    if (kifuSourceUrl !== undefined) meta.kifuSourceUrl = kifuSourceUrl;
    const termsNote = decodeTrimmedStringOrUndefined(record.terms_note);
    if (termsNote !== undefined) meta.termsNote = termsNote;
    return meta;
};

const decodeClock = (clock: ClockWire | null | undefined): RshogiTimeControl | undefined => {
    if (!clock) return undefined;
    const totalSec = decodeNumberOrUndefined(clock.total_sec);
    const totalMs = decodeNumberOrUndefined(clock.total_ms);
    const totalMin = decodeNumberOrUndefined(clock.total_min);
    const byoyomiSec = decodeNumberOrUndefined(clock.byoyomi_sec);
    const byoyomiMs = decodeNumberOrUndefined(clock.byoyomi_ms);
    const byoyomiMin = decodeNumberOrUndefined(clock.byoyomi_min);
    const inc = decodeNumberOrUndefined(clock.increment_sec);
    const kind = decodeStringOrUndefined(clock.kind);
    // 何もフィールドが入っていないなら timeControl ごと undefined にする
    if (
        totalSec === undefined &&
        totalMs === undefined &&
        totalMin === undefined &&
        byoyomiSec === undefined &&
        byoyomiMs === undefined &&
        byoyomiMin === undefined &&
        inc === undefined &&
        kind === undefined
    ) {
        return undefined;
    }
    // kind に応じて主単位を秒に正規化する。サーバ実装 (rshogi-csa-server-workers
    // games_index.rs::ClockSpec::from_server) は kind ごとに排他的に下記フィールドを
    // 出すため、UI 側ではここで秒換算に揃える。
    const mainSeconds =
        totalSec ??
        (totalMs !== undefined ? Math.round(totalMs / 1000) : undefined) ??
        (totalMin !== undefined ? totalMin * 60 : undefined) ??
        0;
    const byoyomiSeconds =
        byoyomiSec ??
        (byoyomiMs !== undefined ? Math.round(byoyomiMs / 1000) : undefined) ??
        (byoyomiMin !== undefined ? byoyomiMin * 60 : undefined) ??
        0;
    return {
        kind,
        mainSeconds,
        byoyomiSeconds,
        byoyomiMilliseconds: byoyomiMs,
        incrementSeconds: inc,
    };
};

/**
 * `result_kind` + `end_reason` (wire) を UI 用の `{kind, winner?, endReason?}` に decode する。
 *
 * - `WIN_BLACK` → 先手勝ち、`WIN_WHITE` → 後手勝ち
 * - 終了理由 (`end_reason`) を見て `kind` を resignation/time_expired/draw/abort 等に振り分ける
 * - 不明な end_reason の場合は最も妥当な fallback (`abort` 等) を入れつつ生の値を `endReason` で残す
 */
const decodeResult = (
    resultKind: string | null | undefined,
    endReason: string | null | undefined,
): RshogiGameResult | undefined => {
    if (!resultKind) return undefined;
    const winner: "sente" | "gote" | undefined =
        resultKind === "WIN_BLACK" ? "sente" : resultKind === "WIN_WHITE" ? "gote" : undefined;

    const reason = decodeStringOrUndefined(endReason ?? undefined);
    let kind: RshogiGameResultKind;
    switch (reason) {
        case "RESIGN":
            kind = "resignation";
            break;
        case "TIME_UP":
            kind = "time_expired";
            break;
        case "ILLEGAL":
            kind = "abort";
            break;
        case "JISHOGI":
            // 入玉宣言勝ち。winner は server が WIN_BLACK / WIN_WHITE で示す。
            kind = "jishogi";
            break;
        case "OUTE_SENNICHITE":
            // 連続王手の千日手 (反則勝ち)。winner は server が WIN_* で示す。
            kind = "oute_sennichite";
            break;
        case "SENNICHITE":
            // 通常の千日手。result_kind = DRAW を伴う。
            kind = "draw";
            break;
        case "MAX_MOVES":
            kind = "max_moves";
            break;
        case "ABNORMAL":
            kind = "abnormal";
            break;
        default:
            // 終局種別だけ来て理由不明な場合のフォールバック
            kind =
                resultKind === "DRAW"
                    ? "draw"
                    : resultKind === "ABORT"
                      ? "abort"
                      : winner !== undefined
                        ? "resignation"
                        : "abort";
            break;
    }

    return {
        kind,
        winner,
        endReason: reason,
    };
};

const decodeGameSummary = (wire: GameWireBase): RshogiGameSummary => ({
    gameId: wire.game_id,
    // black=sente, white=gote のマッピング (rshogi 側の命名と TS 側の慣習を橋渡しする)
    senteName: wire.black_handle,
    sentePlayerId: decodeStringOrUndefined(wire.black_player_id ?? undefined),
    goteName: wire.white_handle,
    gotePlayerId: decodeStringOrUndefined(wire.white_player_id ?? undefined),
    startedAtMs: decodeNumberOrUndefined(wire.started_at_ms),
    endedAtMs: decodeNumberOrUndefined(wire.ended_at_ms),
    timeControl: decodeClock(wire.clock),
    result: decodeResult(wire.result_kind, wire.end_reason),
    movesCount: decodeNumberOrUndefined(wire.moves_count),
    source: decodeStringOrUndefined(wire.source ?? undefined),
    event: decodeStringOrUndefined(wire.event ?? undefined),
    originUrl: decodeStringOrUndefined(wire.origin_url ?? undefined),
});

const decodeGameDetail = (wire: GameDetailWire): RshogiGame => {
    const metaWire: GameWireBase = wire.meta ?? {
        game_id: wire.game_id,
        black_handle: "",
        white_handle: "",
    };
    const summary = decodeGameSummary(metaWire);
    const meta: RshogiGameMeta = {
        gameId: wire.game_id,
        senteName: summary.senteName,
        sentePlayerId: summary.sentePlayerId,
        goteName: summary.goteName,
        gotePlayerId: summary.gotePlayerId,
        startedAtMs: summary.startedAtMs,
        endedAtMs: summary.endedAtMs,
        event: summary.event,
        originUrl: summary.originUrl,
        timeControl: summary.timeControl,
        result: summary.result,
        source: summary.source,
        movesCount: summary.movesCount,
    };
    return { meta, csa: wire.csa };
};

const decodeGameListResponse = (wire: GameListResponseWire): RshogiGameListPage => {
    const games = Array.isArray(wire.games) ? wire.games.map(decodeGameSummary) : [];
    return {
        games,
        nextCursor: decodeStringOrUndefined(wire.next_cursor ?? undefined),
    };
};

const decodeGameSearchResponse = (wire: GameSearchResponseWire): RshogiGameSearchPage => ({
    games: Array.isArray(wire.games) ? wire.games.map(decodeGameSummary) : [],
    page: wire.page ?? 1,
    pageSize: wire.page_size ?? 20, // server default
    totalCount: wire.total_count ?? 0,
});

const decodePlayerSummary = (wire: PlayerSummaryWire): RshogiPlayerSummary => ({
    playerId: wire.player_id,
    displayName: wire.display_name,
    rating: Number.isFinite(wire.rating) ? wire.rating : 1500,
    games: Number.isFinite(wire.games) ? wire.games : 0,
    wins: Number.isFinite(wire.wins) ? wire.wins : 0,
    losses: Number.isFinite(wire.losses) ? wire.losses : 0,
    draws: Number.isFinite(wire.draws) ? wire.draws : 0,
    lastPlayedAtMs: decodeNumberOrUndefined(wire.last_played_at_ms),
    legacy: wire.legacy === true,
});

const decodeLiveGameSummary = (wire: LiveGameWireBase): RshogiLiveGameSummary => ({
    gameId: wire.game_id,
    // black=sente, white=gote のマッピング (終局済 decode と対称)。
    senteName: wire.black_handle,
    goteName: wire.white_handle,
    startedAtMs: decodeNumberOrUndefined(wire.started_at_ms),
    timeControl: decodeClock(wire.clock),
    source: decodeStringOrUndefined(wire.source ?? undefined),
});

const decodeLiveGameListResponse = (wire: LiveGameListResponseWire): RshogiLiveGameListPage => {
    const liveGames = Array.isArray(wire.live_games)
        ? wire.live_games.map(decodeLiveGameSummary)
        : [];
    return {
        liveGames,
        nextCursor: decodeStringOrUndefined(wire.next_cursor ?? undefined),
    };
};

export function createHttpObservationSource(
    baseUrl: string,
    configuredFetch: typeof fetch | undefined,
): RshogiObservationSource {
    const requireFetch = (gameId = ""): typeof fetch => {
        const fetchImpl = configuredFetch ?? globalThis.fetch;
        if (!fetchImpl) {
            throw new RshogiGameFetchError(gameId, "fetch is not available in this environment");
        }
        return fetchImpl;
    };

    return {
        async game(gameId, options) {
            const fetchImpl = requireFetch(gameId);

            const url = `${baseUrl}/games/${encodeURIComponent(gameId)}`;
            const response = await fetchImpl(url, buildRequestInit(options.signal));
            if (response.status === 404) {
                throw new RshogiGameNotFoundError(gameId);
            }
            if (!response.ok) {
                throw new RshogiGameFetchError(
                    gameId,
                    `rshogi API returned ${response.status} ${response.statusText}`,
                    response.status,
                );
            }

            const payload = (await response.json()) as Partial<GameDetailWire> | null;
            if (
                !payload ||
                typeof payload.csa !== "string" ||
                typeof payload.game_id !== "string"
            ) {
                throw new RshogiGameFetchError(gameId, "rshogi API response missing csa/game_id");
            }
            return decodeGameDetail(payload as GameDetailWire);
        },
        async gameList(options) {
            const fetchImpl = requireFetch();

            const params = new URLSearchParams();
            if (options.cursor) params.set("cursor", options.cursor);
            if (options.limit !== undefined) params.set("limit", String(options.limit));
            const query = params.toString();
            const url = `${baseUrl}/games${query.length > 0 ? `?${query}` : ""}`;

            const response = await fetchImpl(url, buildRequestInit(options.signal));
            if (!response.ok) {
                throw new RshogiGameFetchError(
                    "",
                    `rshogi API returned ${response.status} ${response.statusText}`,
                    response.status,
                );
            }

            const payload = (await response.json()) as GameListResponseWire | null;
            if (!payload || !Array.isArray(payload.games)) {
                throw new RshogiGameFetchError("", "rshogi API response missing games array");
            }
            return decodeGameListResponse(payload);
        },
        async gameEvents(options) {
            const fetchImpl = requireFetch();

            const url = `${baseUrl}/games/events`;
            const response = await fetchImpl(url, buildRequestInit(options.signal));
            if (!response.ok) {
                throw new RshogiGameFetchError(
                    "",
                    `rshogi API returned ${response.status} ${response.statusText}`,
                    response.status,
                );
            }

            const payload = (await response.json()) as GameEventsResponseWire | null;
            if (!payload || !Array.isArray(payload.events)) {
                throw new RshogiGameFetchError("", "rshogi API response missing events array");
            }
            const events: RshogiGameEventSummary[] = [];
            for (const wire of payload.events) {
                const event = decodeStringOrUndefined(wire.event ?? undefined);
                if (event === undefined) continue;
                const summary: RshogiGameEventSummary = {
                    event,
                    source: decodeStringOrUndefined(wire.source ?? undefined),
                    games: decodeNumberOrUndefined(wire.games) ?? 0,
                };
                const meta = decodeEventMeta(wire.meta);
                if (meta !== undefined) summary.meta = meta;
                events.push(summary);
            }
            return events;
        },
        async gameSearch(options) {
            const fetchImpl = requireFetch();

            const params = new URLSearchParams();
            const name = options.name?.trim();
            if (name) params.set("name", name);
            if (options.result) params.set("result", options.result);
            const sources = normalizeSearchSources(options.source);
            if (sources.length > 0) params.set("source", sources.join(","));
            const event = options.event?.trim();
            if (event) params.set("event", event);
            if (options.from !== undefined) params.set("from", String(options.from));
            if (options.to !== undefined) params.set("to", String(options.to));
            if (options.page !== undefined) params.set("page", String(options.page));
            if (options.pageSize !== undefined) params.set("pageSize", String(options.pageSize));
            const query = params.toString();
            const url = `${baseUrl}/games/search${query ? `?${query}` : ""}`;

            const response = await fetchImpl(url, buildRequestInit(options.signal));
            if (!response.ok) {
                throw new RshogiGameFetchError(
                    "",
                    `rshogi API returned ${response.status} ${response.statusText}`,
                    response.status,
                );
            }

            const payload = (await response.json()) as GameSearchResponseWire | null;
            if (!payload || !Array.isArray(payload.games)) {
                throw new RshogiGameFetchError("", "rshogi API response missing games array");
            }
            return decodeGameSearchResponse(payload);
        },
        async playerList(options) {
            const fetchImpl = requireFetch();
            const params = new URLSearchParams();
            if (options.page !== undefined) params.set("page", String(options.page));
            if (options.pageSize !== undefined) params.set("pageSize", String(options.pageSize));
            const query = params.toString();
            const response = await fetchImpl(
                `${baseUrl}/players${query ? `?${query}` : ""}`,
                buildRequestInit(options.signal),
            );
            if (!response.ok) {
                throw new RshogiGameFetchError(
                    "",
                    `rshogi API returned ${response.status} ${response.statusText}`,
                    response.status,
                );
            }
            const payload = (await response.json()) as PlayerListResponseWire | null;
            if (!payload || !Array.isArray(payload.players)) {
                throw new RshogiGameFetchError("", "rshogi API response missing players array");
            }
            const players = payload.players.map(decodePlayerSummary);
            return {
                players,
                page: payload.page ?? 1,
                pageSize: payload.page_size ?? 20,
                totalCount: payload.total_count ?? players.length,
                totalGames: payload.total_games ?? 0,
                leader: payload.leader ? decodePlayerSummary(payload.leader) : undefined,
            };
        },
        async playerDetail(playerId, options) {
            const fetchImpl = requireFetch();
            const params = new URLSearchParams();
            if (options.page !== undefined) params.set("page", String(options.page));
            if (options.pageSize !== undefined) params.set("pageSize", String(options.pageSize));
            const query = params.toString();
            const response = await fetchImpl(
                `${baseUrl}/players/${encodeURIComponent(playerId)}${query ? `?${query}` : ""}`,
                buildRequestInit(options.signal),
            );
            if (response.status === 404) throw new RshogiPlayerNotFoundError(playerId);
            if (!response.ok) {
                throw new RshogiGameFetchError(
                    "",
                    `rshogi API returned ${response.status} ${response.statusText}`,
                    response.status,
                );
            }
            const payload = (await response.json()) as PlayerDetailResponseWire | null;
            if (!payload?.player || !Array.isArray(payload.games)) {
                throw new RshogiGameFetchError("", "rshogi API response missing player/games");
            }
            return {
                player: decodePlayerSummary(payload.player),
                games: payload.games.map(decodeGameSummary),
                page: payload.page ?? 1,
                pageSize: payload.page_size ?? 20,
                totalCount: payload.total_count ?? 0,
            };
        },
        async liveGameList(options) {
            const fetchImpl = requireFetch();

            const params = new URLSearchParams();
            if (options.cursor) params.set("cursor", options.cursor);
            if (options.limit !== undefined) params.set("limit", String(options.limit));
            const query = params.toString();
            const url = `${baseUrl}/games/live${query.length > 0 ? `?${query}` : ""}`;

            const response = await fetchImpl(url, buildRequestInit(options.signal));
            if (!response.ok) {
                throw new RshogiGameFetchError(
                    "",
                    `rshogi API returned ${response.status} ${response.statusText}`,
                    response.status,
                );
            }

            const payload = (await response.json()) as LiveGameListResponseWire | null;
            if (!payload || !Array.isArray(payload.live_games)) {
                throw new RshogiGameFetchError("", "rshogi API response missing live_games array");
            }
            return decodeLiveGameListResponse(payload);
        },
    };
}
