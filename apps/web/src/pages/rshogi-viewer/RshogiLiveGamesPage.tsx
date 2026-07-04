import { RshogiCsaLiveGameList, useRshogiLiveGameList } from "@shogi/ui";
import { Link, useNavigate } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { HeaderNav } from "../../components/HeaderNav";
import { PageContainer } from "../../components/PageContainer";
import { PageHeader } from "../../components/PageHeader";
import { PageHeading } from "../../components/PageHeading";
import { StatusBanner } from "../../components/StatusBanner";

const resolveApiBaseUrl = (): string | undefined => {
    const raw = import.meta.env.VITE_RSHOGI_API_BASE as string | undefined;
    return raw?.trim() || undefined;
};

export default function RshogiLiveGamesPage(): ReactElement {
    const navigate = useNavigate();
    const apiBaseUrl = resolveApiBaseUrl();

    // 取得・60 秒自動更新・手動更新・ページングは desktop と共有のフックに委譲する。
    const { games, isLoading, errorMessage, hasMore, refresh, loadMore } =
        useRshogiLiveGameList(apiBaseUrl);

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
                            onClick={refresh}
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
                    onLoadMore={() => void loadMore()}
                    isLoading={isLoading}
                    hasMore={hasMore}
                    emptyMessage="現在進行中の対局はありません。"
                />
            </PageContainer>
        </>
    );
}
