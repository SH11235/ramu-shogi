import type { RshogiGameSummary } from "@shogi/match-client";
import { fetchRshogiGameList } from "@shogi/match-client";
import { RshogiCsaGameList } from "@shogi/ui";
import { useNavigate } from "@tanstack/react-router";
import { type ReactElement, useEffect, useState } from "react";
import { HeaderNav } from "../../components/HeaderNav";
import { PageContainer } from "../../components/PageContainer";
import { PageHeader } from "../../components/PageHeader";
import { PageHeading } from "../../components/PageHeading";
import { StatusBanner } from "../../components/StatusBanner";

const PAGE_LIMIT = 50;

const resolveApiBaseUrl = (): string | undefined => {
    const raw = import.meta.env.VITE_RSHOGI_API_BASE as string | undefined;
    return raw?.trim() || undefined;
};

export default function RshogiViewerListPage(): ReactElement {
    const navigate = useNavigate();
    const apiBaseUrl = resolveApiBaseUrl();

    const [games, setGames] = useState<RshogiGameSummary[]>([]);
    const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    // 初回ロード
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
            // append (新→旧で連結)
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

    const handleSelect = (gameId: string): void => {
        void navigate({ to: "/rshogi-viewer/$gameId", params: { gameId } });
    };

    return (
        <>
            <PageHeader
                items={[{ label: "ラム将棋", to: "/" }, { label: "rshogi viewer" }]}
                right={<HeaderNav />}
            />
            <PageContainer>
                <PageHeading
                    title="rshogi 棋譜一覧"
                    description="rshogi CSA サーバで終局した棋譜を新着順で表示します。クリックすると個別の viewer に遷移します。"
                />

                {errorMessage && <StatusBanner variant="error">{errorMessage}</StatusBanner>}

                <RshogiCsaGameList
                    games={games}
                    onSelect={handleSelect}
                    onLoadMore={() => void handleLoadMore()}
                    isLoading={isLoading}
                    hasMore={nextCursor !== undefined}
                />
            </PageContainer>
        </>
    );
}
