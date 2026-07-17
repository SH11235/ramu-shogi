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
    /** 先手の公開用不透明 player ID。過去棋譜では存在しないことがある。 */
    sentePlayerId?: string;
    /** 白 (= 後手 / gote) のハンドル。 */
    goteName: string;
    /** 後手の公開用不透明 player ID。過去棋譜では存在しないことがある。 */
    gotePlayerId?: string;
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
    sentePlayerId?: string;
    goteName: string;
    gotePlayerId?: string;
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

export interface RshogiGameSearchPage {
    games: RshogiGameSummary[];
    page: number;
    pageSize: number;
    totalCount: number;
}

/** 終局履歴から算出した選手の Elo と通算成績。 */
export interface RshogiPlayerSummary {
    playerId: string;
    displayName: string;
    rating: number;
    games: number;
    wins: number;
    losses: number;
    draws: number;
    lastPlayedAtMs?: number;
    /** secret-aware ID 導入前の、名前だけで集約された履歴か。 */
    legacy: boolean;
}

export interface RshogiPlayerList {
    players: RshogiPlayerSummary[];
    page: number;
    pageSize: number;
    totalCount: number;
    totalGames: number;
    /** 全ページを通したレーティング首位。選手がいない場合は undefined。 */
    leader?: RshogiPlayerSummary;
}

export interface RshogiPlayerDetail {
    player: RshogiPlayerSummary;
    games: RshogiGameSummary[];
    page: number;
    pageSize: number;
    totalCount: number;
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

export interface FetchRshogiGameSearchOptions extends FetchRshogiGameOptions {
    name?: string;
    result?: RshogiGameResultKind;
    source?: RshogiGameSource;
    from?: number;
    to?: number;
    /** 1 始まり (サーバ既定 1)。 */
    page?: number;
    /** 1 ページあたり件数 (1〜100、サーバ既定 20)。 */
    pageSize?: number;
}

export interface FetchRshogiLiveGameListOptions extends FetchRshogiGameOptions {
    /** 次ページ取得用カーソル。サーバが発行した opaque string をそのまま渡す。 */
    cursor?: string;
    /** 1 ページあたり件数 (1〜100、サーバ既定 50)。 */
    limit?: number;
}

export interface FetchRshogiPlayerListOptions extends FetchRshogiGameOptions {
    /** 1 始まり。 */
    page?: number;
    /** 1 ページあたり件数 (1〜100、サーバ既定 20)。 */
    pageSize?: number;
}

export interface FetchRshogiPlayerDetailOptions extends FetchRshogiGameOptions {
    /** 1 始まり。 */
    page?: number;
    /** 1 ページあたり件数 (1〜100、サーバ既定 20)。 */
    pageSize?: number;
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

export class RshogiPlayerNotFoundError extends Error {
    readonly playerId: string;
    constructor(playerId: string) {
        super(`rshogi player not found: ${playerId}`);
        this.name = "RshogiPlayerNotFoundError";
        this.playerId = playerId;
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
    black_player_id?: string | null;
    white_handle: string;
    white_player_id?: string | null;
    result_kind?: RshogiResultKindWire | string | null;
    end_reason?: RshogiEndReasonWire | string | null;
    moves_count?: number | null;
    clock?: ClockWire | null;
    source?: RshogiGameSourceWire | string | null;
    event?: string | null;
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
    sentePlayerId: decodeStringOrUndefined(wire.black_player_id ?? undefined),
    goteName: wire.white_handle,
    gotePlayerId: decodeStringOrUndefined(wire.white_player_id ?? undefined),
    startedAtMs: decodeNumberOrUndefined(wire.started_at_ms),
    endedAtMs: decodeNumberOrUndefined(wire.ended_at_ms),
    timeControl: decodeClock(wire.clock),
    result: decodeResult(wire.result_kind, wire.end_reason),
    movesCount: decodeNumberOrUndefined(wire.moves_count),
    source: decodeStringOrUndefined(wire.source ?? undefined),
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
        event: decodeStringOrUndefined(metaWire.event ?? undefined),
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

/** rshogi の終局済棋譜を条件検索する (`GET /api/v1/games/search`)。 */
export async function fetchRshogiGameSearch(
    options: FetchRshogiGameSearchOptions = {},
): Promise<RshogiGameSearchPage> {
    const baseUrl = options.baseUrl?.trim();
    if (!baseUrl) {
        return mockGameSearchPage(options);
    }

    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    if (!fetchImpl) {
        throw new RshogiGameFetchError("", "fetch is not available in this environment");
    }

    const params = new URLSearchParams();
    const name = options.name?.trim();
    if (name) params.set("name", name);
    if (options.result) params.set("result", options.result);
    if (options.source) params.set("source", options.source);
    if (options.from !== undefined) params.set("from", String(options.from));
    if (options.to !== undefined) params.set("to", String(options.to));
    if (options.page !== undefined) params.set("page", String(options.page));
    if (options.pageSize !== undefined) params.set("pageSize", String(options.pageSize));
    const query = params.toString();
    const url = `${trimTrailingSlash(baseUrl)}/games/search${query ? `?${query}` : ""}`;

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
}

/** 終局履歴から算出された選手ランキングを取得する。 */
export async function fetchRshogiPlayerList(
    options: FetchRshogiPlayerListOptions = {},
): Promise<RshogiPlayerList> {
    const baseUrl = options.baseUrl?.trim();
    if (!baseUrl) return mockPlayerList(options.page, options.pageSize);

    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    if (!fetchImpl) {
        throw new RshogiGameFetchError("", "fetch is not available in this environment");
    }
    const params = new URLSearchParams();
    if (options.page !== undefined) params.set("page", String(options.page));
    if (options.pageSize !== undefined) params.set("pageSize", String(options.pageSize));
    const query = params.toString();
    const response = await fetchImpl(
        `${trimTrailingSlash(baseUrl)}/players${query ? `?${query}` : ""}`,
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
}

/** 選手の集計成績と、その選手が参加した終局済棋譜を取得する。 */
export async function fetchRshogiPlayerDetail(
    playerId: string,
    options: FetchRshogiPlayerDetailOptions = {},
): Promise<RshogiPlayerDetail> {
    if (!playerId) throw new RshogiPlayerNotFoundError(playerId);
    const baseUrl = options.baseUrl?.trim();
    if (!baseUrl) return mockPlayerDetail(playerId, options.page, options.pageSize);

    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    if (!fetchImpl) {
        throw new RshogiGameFetchError("", "fetch is not available in this environment");
    }
    const params = new URLSearchParams();
    if (options.page !== undefined) params.set("page", String(options.page));
    if (options.pageSize !== undefined) params.set("pageSize", String(options.pageSize));
    const query = params.toString();
    const response = await fetchImpl(
        `${trimTrailingSlash(baseUrl)}/players/${encodeURIComponent(playerId)}${query ? `?${query}` : ""}`,
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
const DEFAULT_MOCK_SEARCH_PAGE_SIZE = 20;

const mockPlayerId = (name: string): string => `legacy_mock_${encodeURIComponent(name)}`;

const mockGamePlayerId = (game: RshogiGameSummary, side: "sente" | "gote"): string =>
    (side === "sente" ? game.sentePlayerId : game.gotePlayerId) ??
    mockPlayerId(side === "sente" ? game.senteName : game.goteName);

const buildMockPlayerList = (): RshogiPlayerSummary[] => {
    const records = new Map<string, Omit<RshogiPlayerSummary, "rating">>();
    for (const game of [...MOCK_RSHOGI_GAME_LIST].reverse()) {
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
        totalGames: MOCK_RSHOGI_GAME_LIST.length,
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
    const allGames = MOCK_RSHOGI_GAME_LIST.filter(
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

const mockGameSearchPage = (options: FetchRshogiGameSearchOptions): RshogiGameSearchPage => {
    const name = options.name?.trim().toLocaleLowerCase();
    const filtered = MOCK_RSHOGI_GAME_LIST.filter((game) => {
        if (
            name &&
            !game.senteName.toLocaleLowerCase().includes(name) &&
            !game.goteName.toLocaleLowerCase().includes(name)
        ) {
            return false;
        }
        if (options.result && game.result?.kind !== options.result) return false;
        if (options.source && game.source !== options.source) return false;
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

/**
 * モック対局 ID 一覧。一覧/選択 UI などからの参照用。
 */
export function listMockRshogiGameIds(): string[] {
    return Object.keys(MOCK_RSHOGI_GAMES);
}
