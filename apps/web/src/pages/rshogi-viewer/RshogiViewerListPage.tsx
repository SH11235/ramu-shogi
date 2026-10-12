import {
    RshogiCsaGameBrowser,
    type RshogiGameBrowserSearch,
} from "@shogi/ui/components/rshogi-csa-game-browser";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { HeaderNav } from "../../components/HeaderNav";
import { PageContainer } from "../../components/PageContainer";
import { PageHeader } from "../../components/PageHeader";

const resolveApiBaseUrl = (): string | undefined => {
    const raw = import.meta.env.VITE_RSHOGI_API_BASE as string | undefined;
    return raw?.trim() || undefined;
};

const routeApi = getRouteApi("/rshogi-viewer");

/**
 * rshogi viewer の一覧ページ。進行中の対局と終局済みの棋譜を 1 ページに出す。
 *
 * 絞り込み条件 (対局場所・イベント・名前・結果・終了日) は URL のクエリに置く。
 * `/rshogi-viewer?event=WCSC36` のようなリンクで同じ絞り込みを再現できる。
 * クエリの検証は router の `validateSearch` (不正な値は捨てる)。
 */
export default function RshogiViewerListPage(): ReactElement {
    const navigate = useNavigate();
    const search = routeApi.useSearch();
    const apiBaseUrl = resolveApiBaseUrl();

    const handleSearchChange = (next: RshogiGameBrowserSearch): void => {
        void navigate({ to: "/rshogi-viewer", search: next });
    };

    return (
        <>
            <PageHeader
                items={[{ label: "ラム将棋", to: "/" }, { label: "rshogi viewer" }]}
                right={<HeaderNav />}
            />
            <PageContainer>
                {/* 一覧をすぐ見せるため、見出しは画面には出さない (現在地はパンくずにある)。 */}
                <h1 className="sr-only">rshogi 対局一覧</h1>

                <RshogiCsaGameBrowser
                    apiBaseUrl={apiBaseUrl}
                    search={search}
                    onSearchChange={handleSearchChange}
                    onSelectGame={(gameId) =>
                        void navigate({ to: "/rshogi-viewer/$gameId", params: { gameId } })
                    }
                    onSelectLiveGame={(gameId) =>
                        void navigate({ to: "/rshogi-viewer/live/$gameId", params: { gameId } })
                    }
                />
            </PageContainer>
        </>
    );
}
