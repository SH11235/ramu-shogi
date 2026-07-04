import type { RshogiLiveGameSummary } from "@shogi/match-client";
import { fetchRshogiLiveGameList } from "@shogi/match-client";
import { RshogiCsaLiveGameList } from "@shogi/ui";
import { Link, useNavigate } from "@tanstack/react-router";
import { type ReactElement, useEffect, useState } from "react";
import { HeaderNav } from "../../components/HeaderNav";
import { PageContainer } from "../../components/PageContainer";
import { PageHeader } from "../../components/PageHeader";
import { PageHeading } from "../../components/PageHeading";
import { StatusBanner } from "../../components/StatusBanner";

const PAGE_LIMIT = 50;
// サーバの edge cache TTL (60 秒) に合わせて自動再取得する。それより短くしても
// stale cache が返るだけで新鮮なデータは得られないため 60 秒固定。
const AUTO_REFRESH_MS = 60_000;

const resolveApiBaseUrl = (): string | undefined => {
    const raw = import.meta.env.VITE_RSHOGI_API_BASE as string | undefined;
    return raw?.trim() || undefined;
};

export default function RshogiLiveGamesPage(): ReactElement {
    const navigate = useNavigate();
    const apiBaseUrl = resolveApiBaseUrl();

    const [games, setGames] = useState<RshogiLiveGameSummary[]>([]);
    const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    // 手動更新ボタンを押すたびに増やして effect を再実行させる (先頭ページを
    // 取り直し + 自動更新タイマーをリセットする)。
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
            // append (開始が新しい順で連結)
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

    const handleSelect = (gameId: string): void => {
        void navigate({ to: "/rshogi-viewer/live/$gameId", params: { gameId } });
    };

    return (
        <>
            <PageHeader
                items={[
                    { label: "ラム将棋", to: "/" },
                    { label: "rshogi viewer", to: "/rshogi-viewer" },
                    { label: "進行中対局" },
                ]}
                right={<HeaderNav />}
            />
            <PageContainer>
                <PageHeading
                    title="rshogi 進行中対局一覧"
                    description="rshogi CSA サーバで進行中の対局を開始が新しい順で表示します。クリックすると live 観戦ページに遷移します。反映には最大 60 秒ほどの遅延があります。"
                >
                    <div className="flex flex-wrap items-center gap-3">
                        <button
                            type="button"
                            onClick={handleRefresh}
                            disabled={isLoading}
                            className="rounded-md border border-wafuu-border px-3 py-1.5 text-sm text-wafuu-sumi transition-colors hover:bg-wafuu-kincha/10 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {isLoading ? "更新中..." : "更新"}
                        </button>
                        <Link
                            to="/rshogi-viewer"
                            className="text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                        >
                            終局済みの棋譜一覧へ →
                        </Link>
                    </div>
                </PageHeading>

                {errorMessage && <StatusBanner variant="error">{errorMessage}</StatusBanner>}

                <RshogiCsaLiveGameList
                    games={games}
                    onSelectGame={handleSelect}
                    onLoadMore={() => void handleLoadMore()}
                    isLoading={isLoading}
                    hasMore={nextCursor !== undefined}
                    emptyMessage="現在進行中の対局はありません。"
                />
            </PageContainer>
        </>
    );
}
