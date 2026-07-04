import type { RshogiLiveGameSummary } from "@shogi/match-client";
import { fetchRshogiLiveGameList } from "@shogi/match-client";
import { useEffect, useRef, useState } from "react";

/** 一覧 fetch の 1 ページ件数。 */
const PAGE_LIMIT = 50;
// サーバの edge cache TTL (60 秒) に合わせて自動再取得する。それより短くしても
// stale cache が返るだけで新鮮なデータは得られないため 60 秒固定。
const AUTO_REFRESH_MS = 60_000;

export interface UseRshogiLiveGameListReturn {
    /** 取得済みの進行中対局 (先頭ページ + `loadMore` で追記した分)。 */
    games: RshogiLiveGameSummary[];
    /** 初回 / 再取得 / ページ追加読み込み中フラグ。 */
    isLoading: boolean;
    /** 直近の取得エラー文言 (無ければ null)。 */
    errorMessage: string | null;
    /** 次ページが存在するか。 */
    hasMore: boolean;
    /** 先頭ページから取り直す (自動更新タイマーもリセットされる)。 */
    refresh: () => void;
    /** 次ページを末尾に追記する。 */
    loadMore: () => Promise<void>;
}

/**
 * rshogi 進行中対局一覧の取得・自動更新・ページングを担う共有フック。
 *
 * Web (`RshogiLiveGamesPage`) と Desktop (`RshogiLiveGamesView`) で同一の
 * データ取得ロジックを共有する。挙動:
 * - マウント時に先頭ページを取得し、60 秒ごと (サーバ edge cache TTL に一致) に
 *   自動で先頭ページを取り直す
 * - `refresh()` で先頭ページ取り直し + 自動更新タイマーのリセット
 * - `loadMore()` で `next_cursor` を辿って末尾に追記
 * - アンマウント時は初回/自動更新・`loadMore` の in-flight リクエストをともに
 *   abort し、アンマウント後の state 更新を残さない
 */
export function useRshogiLiveGameList(apiBaseUrl: string | undefined): UseRshogiLiveGameListReturn {
    const [games, setGames] = useState<RshogiLiveGameSummary[]>([]);
    const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    // 手動更新のたびに増やして effect を再実行させる (先頭ページ取り直し +
    // 自動更新タイマーのリセットを一括処理)。
    const [refreshNonce, setRefreshNonce] = useState<number>(0);
    /** `loadMore` の in-flight リクエスト。アンマウント/refresh 時に abort する。 */
    const loadMoreControllerRef = useRef<AbortController | null>(null);

    // 初回ロード + 60 秒ごとの自動更新。手動更新 (refreshNonce 変化) でも再実行する。
    // biome-ignore lint/correctness/useExhaustiveDependencies: refreshNonce は手動更新の再取得トリガー。effect 本体では読まないが、依存に含めることで再実行させる。
    useEffect(() => {
        const controller = new AbortController();
        const loadFirstPage = async (): Promise<void> => {
            setIsLoading(true);
            setErrorMessage(null);
            try {
                const page = await fetchRshogiLiveGameList({
                    baseUrl: apiBaseUrl,
                    limit: PAGE_LIMIT,
                    signal: controller.signal,
                });
                if (controller.signal.aborted) return;
                setGames(page.liveGames);
                setNextCursor(page.nextCursor);
            } catch (error) {
                if (controller.signal.aborted) return;
                setErrorMessage(
                    error instanceof Error
                        ? error.message
                        : `進行中対局一覧の取得に失敗しました: ${String(error)}`,
                );
            } finally {
                if (!controller.signal.aborted) setIsLoading(false);
            }
        };
        void loadFirstPage();
        const intervalId = setInterval(() => {
            void loadFirstPage();
        }, AUTO_REFRESH_MS);
        return () => {
            controller.abort();
            clearInterval(intervalId);
            // ページング中のアンマウント/refresh でも state 更新を残さない。
            loadMoreControllerRef.current?.abort();
            loadMoreControllerRef.current = null;
        };
    }, [apiBaseUrl, refreshNonce]);

    const loadMore = async (): Promise<void> => {
        if (!nextCursor || isLoading) return;
        const controller = new AbortController();
        loadMoreControllerRef.current = controller;
        setIsLoading(true);
        setErrorMessage(null);
        try {
            const page = await fetchRshogiLiveGameList({
                baseUrl: apiBaseUrl,
                cursor: nextCursor,
                limit: PAGE_LIMIT,
                signal: controller.signal,
            });
            if (controller.signal.aborted) return;
            // append (開始が新しい順で連結)
            setGames((prev) => [...prev, ...page.liveGames]);
            setNextCursor(page.nextCursor);
        } catch (error) {
            if (controller.signal.aborted) return;
            setErrorMessage(
                error instanceof Error
                    ? error.message
                    : `進行中対局一覧の取得に失敗しました: ${String(error)}`,
            );
        } finally {
            if (!controller.signal.aborted) setIsLoading(false);
            if (loadMoreControllerRef.current === controller) {
                loadMoreControllerRef.current = null;
            }
        }
    };

    const refresh = (): void => {
        setRefreshNonce((n) => n + 1);
    };

    return {
        games,
        isLoading,
        errorMessage,
        hasMore: nextCursor !== undefined,
        refresh,
        loadMore,
    };
}
