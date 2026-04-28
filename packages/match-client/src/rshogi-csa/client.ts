/**
 * rshogi CSA viewer 用 API クライアント (MVP モック)。
 *
 * 配信 API 本体は別タスク (rshogi#542) で設計中のため、ここでは
 * モックの fixture を返すだけの薄い stub を 1 箇所に集約する。
 * 本実装に差し替える際は本ファイルの `fetchRshogiGame` 内の分岐を
 * 実 fetch に置き換えるだけで viewer Page 側を弄らずに済む構造を維持する。
 */

import { MOCK_RSHOGI_GAMES } from "./fixtures";

export type RshogiGameResultKind = "resignation" | "checkmate" | "time_expired" | "draw" | "abort";

export interface RshogiGameResult {
    kind: RshogiGameResultKind;
    /** 勝者 (draw / abort 時は undefined) */
    winner?: "sente" | "gote";
}

export interface RshogiTimeControl {
    mainSeconds: number;
    byoyomiSeconds: number;
    incrementSeconds?: number;
}

export interface RshogiGameMeta {
    gameId: string;
    senteName: string;
    goteName: string;
    /** ISO 8601 UTC timestamp */
    startedAt?: string;
    /** ISO 8601 UTC timestamp */
    endedAt?: string;
    event?: string;
    timeControl?: RshogiTimeControl;
    result?: RshogiGameResult;
}

export interface RshogiGame {
    meta: RshogiGameMeta;
    /** CSA V2.2 形式の棋譜全文 */
    csa: string;
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
    const response = await fetchImpl(url, { signal: options.signal });
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

    const payload = (await response.json()) as Partial<RshogiGame> | null;
    if (!payload || typeof payload.csa !== "string" || !payload.meta) {
        throw new RshogiGameFetchError(gameId, "rshogi API response missing csa/meta");
    }
    return { csa: payload.csa, meta: payload.meta };
}

/**
 * モック対局 ID 一覧。一覧/選択 UI などからの参照用。
 */
export function listMockRshogiGameIds(): string[] {
    return Object.keys(MOCK_RSHOGI_GAMES);
}
