import type { RshogiGameSummary } from "@shogi/match-client";
import { fetchRshogiGameList } from "@shogi/match-client";
import { RshogiCsaGameList } from "@shogi/ui";
import { Button } from "@shogi/ui/components/button";
import { type ReactElement, useEffect, useState } from "react";

const PAGE_LIMIT = 50;

interface Props {
    onBackToLocal: () => void;
    onSelectGame: (gameId: string) => void;
}

export function RshogiViewerListView({ onBackToLocal, onSelectGame }: Props): ReactElement {
    const apiBaseUrl =
        (import.meta.env.VITE_RSHOGI_API_BASE as string | undefined)?.trim() || undefined;

    const [games, setGames] = useState<RshogiGameSummary[]>([]);
    const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    useEffect(() => {
        const controller = new AbortController();
        setIsLoading(true);
        setErrorMessage(null);
        void (async () => {
            try {
                const page = await fetchRshogiGameList({
                    baseUrl: apiBaseUrl,
                    limit: PAGE_LIMIT,
                    signal: controller.signal,
                });
                if (controller.signal.aborted) return;
                setGames(page.games);
                setNextCursor(page.nextCursor);
            } catch (error) {
                if (controller.signal.aborted) return;
                setErrorMessage(
                    error instanceof Error
                        ? error.message
                        : `棋譜一覧の取得に失敗しました: ${String(error)}`,
                );
            } finally {
                if (!controller.signal.aborted) setIsLoading(false);
            }
        })();
        return () => {
            controller.abort();
        };
    }, [apiBaseUrl]);

    const handleLoadMore = async (): Promise<void> => {
        if (!nextCursor || isLoading) return;
        setIsLoading(true);
        setErrorMessage(null);
        try {
            const page = await fetchRshogiGameList({
                baseUrl: apiBaseUrl,
                cursor: nextCursor,
                limit: PAGE_LIMIT,
            });
            setGames((prev) => [...prev, ...page.games]);
            setNextCursor(page.nextCursor);
        } catch (error) {
            setErrorMessage(
                error instanceof Error
                    ? error.message
                    : `棋譜一覧の取得に失敗しました: ${String(error)}`,
            );
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" onClick={onBackToLocal}>
                    ← ローカル対局へ戻る
                </Button>
                <span className="text-sm font-semibold text-wafuu-sumi">rshogi viewer</span>
                <span className="text-xs text-muted-foreground">
                    終局済みの CSA 棋譜を新着順で表示します。
                </span>
            </div>

            {errorMessage && (
                <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                    {errorMessage}
                </div>
            )}

            <RshogiCsaGameList
                games={games}
                onSelect={onSelectGame}
                onLoadMore={() => void handleLoadMore()}
                isLoading={isLoading}
                hasMore={nextCursor !== undefined}
            />
        </div>
    );
}
