import type { RshogiLiveGameSummary } from "@shogi/match-client";
import { fetchRshogiLiveGameList } from "@shogi/match-client";
import { RshogiCsaLiveGameList } from "@shogi/ui";
import { Button } from "@shogi/ui/components/button";
import { type ReactElement, useEffect, useState } from "react";

const PAGE_LIMIT = 50;
// サーバの edge cache TTL (60 秒) に合わせて自動再取得する。
const AUTO_REFRESH_MS = 60_000;

interface Props {
    onBackToLocal: () => void;
    onSelectGame: (gameId: string) => void;
}

/**
 * Desktop 用の rshogi 進行中対局一覧ビュー。
 *
 * Web 側 `RshogiLiveGamesPage` と同じ挙動 (初回ロード + 60 秒自動更新 + 手動更新 +
 * ページング) を持つ。行クリックで `onSelectGame` を呼び、呼出側 (`App.tsx`) が
 * live 観戦ビューへ遷移する。
 */
export function RshogiLiveGamesView({ onBackToLocal, onSelectGame }: Props): ReactElement {
    const apiBaseUrl =
        (import.meta.env.VITE_RSHOGI_API_BASE as string | undefined)?.trim() || undefined;

    const [games, setGames] = useState<RshogiLiveGameSummary[]>([]);
    const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [refreshNonce, setRefreshNonce] = useState<number>(0);

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
        };
    }, [apiBaseUrl, refreshNonce]);

    const handleLoadMore = async (): Promise<void> => {
        if (!nextCursor || isLoading) return;
        setIsLoading(true);
        setErrorMessage(null);
        try {
            const page = await fetchRshogiLiveGameList({
                baseUrl: apiBaseUrl,
                cursor: nextCursor,
                limit: PAGE_LIMIT,
            });
            setGames((prev) => [...prev, ...page.liveGames]);
            setNextCursor(page.nextCursor);
        } catch (error) {
            setErrorMessage(
                error instanceof Error
                    ? error.message
                    : `進行中対局一覧の取得に失敗しました: ${String(error)}`,
            );
        } finally {
            setIsLoading(false);
        }
    };

    const handleRefresh = (): void => {
        setRefreshNonce((n) => n + 1);
    };

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" onClick={onBackToLocal}>
                    ← ローカル対局へ戻る
                </Button>
                <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isLoading}>
                    {isLoading ? "更新中..." : "更新"}
                </Button>
                <span className="text-sm font-semibold text-wafuu-sumi">rshogi viewer (live)</span>
                <span className="text-xs text-muted-foreground">
                    進行中の対局を開始が新しい順で表示します (反映まで最大 60 秒)。
                </span>
            </div>

            {errorMessage && (
                <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                    {errorMessage}
                </div>
            )}

            <RshogiCsaLiveGameList
                games={games}
                onSelectGame={onSelectGame}
                onLoadMore={() => void handleLoadMore()}
                isLoading={isLoading}
                hasMore={nextCursor !== undefined}
                emptyMessage="現在進行中の対局はありません。"
            />
        </div>
    );
}
