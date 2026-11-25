/** サーバーが返す終局理由。未知の値も保持する。 */
type RshogiEndReason = RshogiKnownEndReason | (string & {});

export type RshogiKnownEndReason =
    | "RESIGN"
    | "TIME_UP"
    | "ILLEGAL"
    | "JISHOGI"
    | "OUTE_SENNICHITE"
    | "SENNICHITE"
    | "MAX_MOVES"
    | "ABNORMAL";

/** 持ち時間の方式 (Fischer / 秒読み / ストップウォッチ等)。 */
export type RshogiClockKind =
    | "fischer"
    | "countdown"
    | "countdown_msec"
    | "stopwatch"
    | (string & {});

/**
 * 棋譜のソース。
 *
 * - `kifu` / `floodgate`: 自前サーバーの対局 (後者は Floodgate モード)
 * - `wdoor`: wdoor の Floodgate から取り込んだ対局
 * - `upload`: 管理者がアップロードした棋譜
 */
type RshogiGameSource = "kifu" | "floodgate" | "wdoor" | "upload" | (string & {});

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
    /** 棋譜のタグ。`wdoor` はゲーム名 (例 `floodgate-300-10F`)、`upload` は大会名など。 */
    event?: string;
    /** `wdoor` のときの元棋譜 URL。 */
    originUrl?: string;
    /** 持ち時間。サーバーが判定できなかった棋譜では無い。 */
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
    /** 棋譜のタグ。`wdoor` はゲーム名、`upload` は大会名など。 */
    event?: string;
    /** `wdoor` のときの元棋譜 URL。 */
    originUrl?: string;
}

/**
 * イベント (大会など) のメタデータ。サーバーに登録されているイベントにだけ付く。
 *
 * 大会名や公式ページの URL はアプリに書かず、このデータで管理する。
 */
export interface RshogiGameEventMeta {
    /** 正式名称。 */
    title: string;
    /** 主催。 */
    organizer?: string;
    /** 大会の公式ページ。`http(s)://` の URL だけを採用する。 */
    officialUrl?: string;
    /** 棋譜の出典のページ。`http(s)://` の URL だけを採用する。 */
    kifuSourceUrl?: string;
    /** 利用条件についての運用メモ。利用者向けの文ではないので、画面には出さない。 */
    termsNote?: string;
}

/** イベント一覧 API (`GET /api/v1/games/events`) の 1 件分。 */
export interface RshogiGameEventSummary {
    event: string;
    source?: RshogiGameSource;
    /** そのイベント・ソースの対局数。 */
    games: number;
    /** メタデータ。未登録のイベント (と、メタに対応していない古いサーバー) では付かない。 */
    meta?: RshogiGameEventMeta;
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

/** 進行中対局の一覧項目。現在の対局状態は WebSocket の観戦 API で取得する。 */
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
     * 未指定または空白のみの場合は組み込みのサンプルを返す。
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
    /** 複数渡すとカンマ区切りで送り、いずれかに一致する棋譜を返す。 */
    source?: RshogiGameSource | readonly RshogiGameSource[];
    /** `event` の完全一致。 */
    event?: string;
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

export const normalizeSearchSources = (
    source: FetchRshogiGameSearchOptions["source"],
): RshogiGameSource[] => {
    if (source === undefined) return [];
    const list = typeof source === "string" ? source.split(",") : [...source];
    return list.map((value) => value.trim()).filter((value) => value.length > 0);
};

type RequestOptions<T extends FetchRshogiGameOptions> = Omit<T, "baseUrl" | "fetchImpl">;

export interface RshogiObservationSource {
    game(gameId: string, options: RequestOptions<FetchRshogiGameOptions>): Promise<RshogiGame>;
    gameList(options: RequestOptions<FetchRshogiGameListOptions>): Promise<RshogiGameListPage>;
    gameEvents(options: RequestOptions<FetchRshogiGameOptions>): Promise<RshogiGameEventSummary[]>;
    gameSearch(
        options: RequestOptions<FetchRshogiGameSearchOptions>,
    ): Promise<RshogiGameSearchPage>;
    playerList(options: RequestOptions<FetchRshogiPlayerListOptions>): Promise<RshogiPlayerList>;
    playerDetail(
        playerId: string,
        options: RequestOptions<FetchRshogiPlayerDetailOptions>,
    ): Promise<RshogiPlayerDetail>;
    liveGameList(
        options: RequestOptions<FetchRshogiLiveGameListOptions>,
    ): Promise<RshogiLiveGameListPage>;
}
