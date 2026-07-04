/**
 * rshogi CSA viewer 用 API クライアント。
 *
 * rshogi 側の配信 API (`/api/v1/games`, `/api/v1/games/:gameId`) と
 * UI の間に「decode 層」を 1 か所だけ挟み、wire format (snake_case + epoch_ms)
 * を UI が扱う camelCase + ドメイン型に変換する。decode 層の責務は本ファイルに集約する:
 *
 * - snake_case → camelCase 変換
 * - epoch_ms はそのまま number で保持し、Date 化は UI 側に任せる (タイムゾーン事故防止)
 * - 黒/白ハンドルは「黒 = 先手 (sente) / 白 = 後手 (gote)」マッピングで TS 名に reflect
 * - `result_kind` + `end_reason` を `{kind, winner?, endReason?}` 構造体にまとめる
 * - `clock.kind` を `RshogiTimeControl` の `kind` field として保持
 *
 * baseUrl 未指定時は `MOCK_RSHOGI_GAMES` のモック fixture を返す MVP 動作を維持し、
 * 本実装に差し替えても viewer Page 側を弄らずに済むよう同じ TS 型に decode する。
 */

import type {
    RshogiClockKindWire,
    RshogiEndReasonWire,
    RshogiGameSourceWire,
    RshogiResultKindWire,
} from "./fixtures";
import { MOCK_RSHOGI_GAME_LIST, MOCK_RSHOGI_GAMES, MOCK_RSHOGI_LIVE_GAME_LIST } from "./fixtures";

/**
 * 終局理由 (wire の `end_reason` をそのまま保持したいケース向け)。
 *
 * UI が独自に enum を増やす必要が出ないよう、サーバが追加する可能性を考慮して
 * `string` も許容するワイドユニオン型にする。
 */
export type RshogiEndReason = RshogiEndReasonWire | (string & {});

/** 持ち時間の方式 (Fischer / 秒読み / ストップウォッチ等)。 */
export type RshogiClockKind = RshogiClockKindWire | (string & {});

/** 棋譜のソース (kifu = ユーザー登録 / floodgate 等)。 */
export type RshogiGameSource = RshogiGameSourceWire | (string & {});

/**
 * 終局結果。
 *
 * - `kind`: 既存 viewer 互換のラベル (`resignation` / `time_expired` / `draw` / `abort` / `checkmate` / その他)
 * - `winner`: 勝敗 (引き分け・中断時は undefined)
 * - `endReason`: サーバが返す `end_reason` をそのまま保持し、より詳細な理由表示に使える
 */
export type RshogiGameResultKind =
    | "resignation"
    | "checkmate"
    | "time_expired"
    | "draw"
    | "jishogi"
    | "oute_sennichite"
    | "abort"
    | "max_moves"
    | "abnormal";

export interface RshogiGameResult {
    kind: RshogiGameResultKind;
    winner?: "sente" | "gote";
    endReason?: RshogiEndReason;
}

export interface RshogiTimeControl {
    /** 持ち時間方式 (`fischer` / `countdown` / `stopwatch` 等)。サーバが返す値をそのまま保持する。 */
    kind?: RshogiClockKind;
    /** 基本持ち時間 (秒)。サーバの `total_sec` 由来。 */
    mainSeconds: number;
    /** 秒読み (秒)。none の場合は 0。 */
    byoyomiSeconds: number;
    /** 秒読み (ミリ秒)。サーバが `byoyomi_ms` を返したときのみ含まれる。 */
    byoyomiMilliseconds?: number;
    /** Fischer 加算 (秒)。 */
    incrementSeconds?: number;
}

export interface RshogiGameMeta {
    gameId: string;
    /** 黒 (= 先手 / sente) のハンドル。 */
    senteName: string;
    /** 白 (= 後手 / gote) のハンドル。 */
    goteName: string;
    /** 開始時刻 (epoch ms)。Date 化は UI 側で行う (タイムゾーン事故防止)。 */
    startedAtMs?: number;
    /** 終了時刻 (epoch ms)。 */
    endedAtMs?: number;
    /** 大会名等の自由記述 (CSA `$EVENT`)。 */
    event?: string;
    timeControl?: RshogiTimeControl;
    result?: RshogiGameResult;
    /** 棋譜のソース。 */
    source?: RshogiGameSource;
    /** 手数。 */
    movesCount?: number;
}

export interface RshogiGame {
    meta: RshogiGameMeta;
    /** CSA V2.2 形式の棋譜全文 */
    csa: string;
}

/**
 * 一覧 API (`GET /api/v1/games`) の 1 件分。
 *
 * 単局取得 (`RshogiGame.meta`) と同じ camelCase 規約で揃える。
 * 一覧では CSA 棋譜本文は返らないため `csa` は持たない。
 */
export interface RshogiGameSummary {
    gameId: string;
    senteName: string;
    goteName: string;
    startedAtMs?: number;
    endedAtMs?: number;
    timeControl?: RshogiTimeControl;
    result?: RshogiGameResult;
    movesCount?: number;
    source?: RshogiGameSource;
}

export interface RshogiGameListPage {
    games: RshogiGameSummary[];
    /** 次ページ取得用カーソル。null/undefined の場合は末尾。 */
    nextCursor?: string;
}

/**
 * 進行中対局一覧 API (`GET /api/v1/games/live`) の 1 件分。
 *
 * 終局済一覧 (`RshogiGameSummary`) と同じ camelCase 規約で揃えるが、進行中対局
 * には `result` / `endedAtMs` / `movesCount` が存在しない (サーバ側
 * `LiveGamesIndexEntry` の wire にこれらのフィールドが無い契約)。live entry は
 * あくまで **発見手段** であり、実状態は行クリック時の WS spectate で確認する。
 */
export interface RshogiLiveGameSummary {
    gameId: string;
    /** 黒 (= 先手 / sente) のハンドル。 */
    senteName: string;
    /** 白 (= 後手 / gote) のハンドル。 */
    goteName: string;
    /** 開始時刻 (epoch ms)。Date 化は UI 側で行う (タイムゾーン事故防止)。 */
    startedAtMs?: number;
    timeControl?: RshogiTimeControl;
    /** 対局のソース (`kifu` / `floodgate`)。 */
    source?: RshogiGameSource;
}

export interface RshogiLiveGameListPage {
    liveGames: RshogiLiveGameSummary[];
    /** 次ページ取得用カーソル。null/undefined の場合は末尾。 */
    nextCursor?: string;
}

export interface FetchRshogiGameOptions {
    /**
     * rshogi 配信 API のベース URL。
     * 空文字 / undefined のときはモック fixture を返す (MVP 動作)。
     */
    baseUrl?: string;
    /** 主にテスト・SSR で fetch を差し替えるためのフック */
    fetchImpl?: typeof fetch;
    /** AbortController などからの中断に対応 */
    signal?: AbortSignal;
}

export interface FetchRshogiGameListOptions extends FetchRshogiGameOptions {
    /** 次ページ取得用カーソル。サーバが発行した opaque string をそのまま渡す。 */
    cursor?: string;
    /** 1 ページあたり件数 (1〜100、サーバ既定 50)。 */
    limit?: number;
}

export interface FetchRshogiLiveGameListOptions extends FetchRshogiGameOptions {
    /** 次ページ取得用カーソル。サーバが発行した opaque string をそのまま渡す。 */
    cursor?: string;
    /** 1 ページあたり件数 (1〜100、サーバ既定 50)。 */
    limit?: number;
}

export class RshogiGameNotFoundError extends Error {
    readonly gameId: string;
    constructor(gameId: string) {
        super(`rshogi game not found: ${gameId}`);
        this.name = "RshogiGameNotFoundError";
        this.gameId = gameId;
    }
}

export class RshogiGameFetchError extends Error {
    readonly status?: number;
    readonly gameId: string;
    constructor(gameId: string, message: string, status?: number) {
        super(message);
        this.name = "RshogiGameFetchError";
        this.gameId = gameId;
        this.status = status;
    }
}

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, "");

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

/**
 * `RequestInit` を組み立てるヘルパ。
 *
 * 既存テストは fetch を `(url, { signal })` の固定形で検証するため、`X-Client` を
 * 付与する必要がない場合は `headers` を含めない (= 既存挙動完全互換)。
 */
const buildRequestInit = (signal: AbortSignal | undefined): RequestInit => {
    const headers = buildClientHeaders();
    if (Object.keys(headers).length === 0) {
        return { signal };
    }
    return { signal, headers };
};

// ===== wire format (snake_case) =====
// サーバが返す JSON 1 件分。decode 層の入力でしか使わないため module 内部に閉じる。

interface ClockWire {
    kind?: RshogiClockKindWire | string;
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
    white_handle: string;
    result_kind?: RshogiResultKindWire | string | null;
    end_reason?: RshogiEndReasonWire | string | null;
    moves_count?: number | null;
    clock?: ClockWire | null;
    source?: RshogiGameSourceWire | string | null;
    event?: string | null;
}

interface GameDetailWire extends GameWireBase {
    csa: string;
}

interface GameListResponseWire {
    games?: GameWireBase[];
    next_cursor?: string | null;
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
    source?: RshogiGameSourceWire | string | null;
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
    goteName: wire.white_handle,
    startedAtMs: decodeNumberOrUndefined(wire.started_at_ms),
    endedAtMs: decodeNumberOrUndefined(wire.ended_at_ms),
    timeControl: decodeClock(wire.clock),
    result: decodeResult(wire.result_kind, wire.end_reason),
    movesCount: decodeNumberOrUndefined(wire.moves_count),
    source: decodeStringOrUndefined(wire.source ?? undefined),
});

const decodeGameDetail = (wire: GameDetailWire): RshogiGame => {
    const summary = decodeGameSummary(wire);
    const meta: RshogiGameMeta = {
        gameId: summary.gameId,
        senteName: summary.senteName,
        goteName: summary.goteName,
        startedAtMs: summary.startedAtMs,
        endedAtMs: summary.endedAtMs,
        event: decodeStringOrUndefined(wire.event ?? undefined),
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

/**
 * rshogi の対局 ID から CSA 棋譜とメタを取得する。
 *
 * @param gameId rshogi 上の対局 ID
 * @param options baseUrl 等の上書き。未指定時はモック fixture を返す。
 */
export async function fetchRshogiGame(
    gameId: string,
    options: FetchRshogiGameOptions = {},
): Promise<RshogiGame> {
    if (!gameId) {
        throw new RshogiGameFetchError(gameId, "gameId is required");
    }

    const baseUrl = options.baseUrl?.trim();
    if (!baseUrl) {
        const mock = MOCK_RSHOGI_GAMES[gameId];
        if (!mock) {
            throw new RshogiGameNotFoundError(gameId);
        }
        return mock;
    }

    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    if (!fetchImpl) {
        throw new RshogiGameFetchError(gameId, "fetch is not available in this environment");
    }

    const url = `${trimTrailingSlash(baseUrl)}/games/${encodeURIComponent(gameId)}`;
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
    if (!payload || typeof payload.csa !== "string" || typeof payload.game_id !== "string") {
        throw new RshogiGameFetchError(gameId, "rshogi API response missing csa/game_id");
    }
    return decodeGameDetail(payload as GameDetailWire);
}

/**
 * rshogi の棋譜一覧 (`GET /api/v1/games`) を取得する。
 *
 * @param options ページング・baseUrl の指定。`baseUrl` 未指定時はモック fixture を返す。
 */
export async function fetchRshogiGameList(
    options: FetchRshogiGameListOptions = {},
): Promise<RshogiGameListPage> {
    const baseUrl = options.baseUrl?.trim();
    if (!baseUrl) {
        // モック動作: cursor/limit に応じてスライス。
        // 本実装ではサーバ側でやるため、ここはあくまで MVP 用の挙動。
        return mockGameListPage(options.cursor, options.limit);
    }

    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    if (!fetchImpl) {
        throw new RshogiGameFetchError("", "fetch is not available in this environment");
    }

    const params = new URLSearchParams();
    if (options.cursor) params.set("cursor", options.cursor);
    if (options.limit !== undefined) params.set("limit", String(options.limit));
    const query = params.toString();
    const url = `${trimTrailingSlash(baseUrl)}/games${query.length > 0 ? `?${query}` : ""}`;

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
}

/**
 * rshogi の進行中対局一覧 (`GET /api/v1/games/live`) を取得する。
 *
 * 終局済一覧 (`fetchRshogiGameList`) と pagination semantics は同じだが、
 * レスポンスの配列キーが `live_games`、要素に `result` 系フィールドが無い点が
 * 異なる。サーバは edge で 60 秒キャッシュしており、best-effort eventual
 * consistency (既に終局済の対局が一時的に含まれることがある) を前提とする。
 *
 * @param options ページング・baseUrl の指定。`baseUrl` 未指定時はモック fixture を返す。
 */
export async function fetchRshogiLiveGameList(
    options: FetchRshogiLiveGameListOptions = {},
): Promise<RshogiLiveGameListPage> {
    const baseUrl = options.baseUrl?.trim();
    if (!baseUrl) {
        // モック動作: cursor/limit に応じてスライス (MVP 用)。
        return mockLiveGameListPage(options.cursor, options.limit);
    }

    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    if (!fetchImpl) {
        throw new RshogiGameFetchError("", "fetch is not available in this environment");
    }

    const params = new URLSearchParams();
    if (options.cursor) params.set("cursor", options.cursor);
    if (options.limit !== undefined) params.set("limit", String(options.limit));
    const query = params.toString();
    const url = `${trimTrailingSlash(baseUrl)}/games/live${query.length > 0 ? `?${query}` : ""}`;

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
}

const DEFAULT_MOCK_LIMIT = 50;
const MAX_MOCK_LIMIT = 100;

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

/**
 * モック対局 ID 一覧。一覧/選択 UI などからの参照用。
 */
export function listMockRshogiGameIds(): string[] {
    return Object.keys(MOCK_RSHOGI_GAMES);
}
