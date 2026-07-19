import type { RshogiPlayerDetail } from "@shogi/match-client";
import { fetchRshogiPlayerDetail } from "@shogi/match-client";
import { RshogiCsaGameList } from "@shogi/ui/components/rshogi-csa-game-list";
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { useEffect, useState } from "react";
import { HeaderNav } from "../../components/HeaderNav";
import { PageContainer } from "../../components/PageContainer";
import { PageHeader } from "../../components/PageHeader";
import { StatusBanner } from "../../components/StatusBanner";
import { resolveRshogiApiBaseUrl } from "../../lib/rshogiApiBaseUrl";

const PAGE_SIZE = 20;
const routeApi = getRouteApi("/rshogi-viewer/players/$playerId");

export default function RshogiPlayerDetailPage(): ReactElement {
    const { playerId } = routeApi.useParams();
    const navigate = useNavigate();
    const apiBaseUrl = resolveRshogiApiBaseUrl();
    const [detail, setDetail] = useState<RshogiPlayerDetail | null>(null);
    const [pageRequest, setPageRequest] = useState({ page: 1, attempt: 0 });
    const [isLoading, setIsLoading] = useState(true);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    useEffect(() => {
        const controller = new AbortController();
        setIsLoading(true);
        setErrorMessage(null);
        void fetchRshogiPlayerDetail(playerId, {
            baseUrl: apiBaseUrl,
            page: pageRequest.page,
            pageSize: PAGE_SIZE,
            signal: controller.signal,
        })
            .then((response) => {
                if (!controller.signal.aborted) setDetail(response);
            })
            .catch((error: unknown) => {
                if (!controller.signal.aborted) {
                    setErrorMessage(
                        error instanceof Error
                            ? error.message
                            : `レーティング情報の取得に失敗しました: ${String(error)}`,
                    );
                }
            })
            .finally(() => {
                if (!controller.signal.aborted) setIsLoading(false);
            });
        return () => controller.abort();
    }, [apiBaseUrl, pageRequest, playerId]);

    const player = detail?.player;
    const totalPages = detail ? Math.max(1, Math.ceil(detail.totalCount / detail.pageSize)) : 1;
    const displayedPage = detail?.page ?? pageRequest.page;
    const requestPage = (nextPage: number): void => {
        setPageRequest((current) => ({ page: nextPage, attempt: current.attempt + 1 }));
    };

    return (
        <>
            <PageHeader
                items={[
                    { label: "ラム将棋", to: "/" },
                    { label: "rshogi viewer", to: "/rshogi-viewer" },
                    { label: "レーティング", to: "/rshogi-viewer/players" },
                    { label: player?.displayName ?? "レーティング詳細" },
                ]}
                right={<HeaderNav />}
            />
            <PageContainer width="wide" className="gap-5">
                {errorMessage && <StatusBanner variant="error">{errorMessage}</StatusBanner>}
                {isLoading && !detail && (
                    <div
                        className="rounded-xl border border-wafuu-border bg-wafuu-washi-warm px-5 py-16 text-center text-sm text-muted-foreground"
                        aria-live="polite"
                    >
                        対局記録を読み込み中…
                    </div>
                )}
                {player && (
                    <>
                        <section className="overflow-hidden rounded-2xl border border-wafuu-border bg-wafuu-washi-warm shadow-sm">
                            <div className="grid lg:grid-cols-[minmax(0,1fr)_18rem]">
                                <div className="flex min-w-0 flex-col justify-between gap-8 bg-wafuu-sumi px-5 py-7 text-wafuu-washi-warm sm:px-8 sm:py-9">
                                    <div className="flex flex-col gap-3">
                                        <div className="flex flex-wrap items-center gap-2 text-xs tracking-[0.18em] text-wafuu-kincha">
                                            RATING RECORD
                                            {player.legacy && (
                                                <span className="rounded-sm border border-wafuu-kincha/50 px-1.5 py-0.5 text-[9px]">
                                                    LEGACY
                                                </span>
                                            )}
                                        </div>
                                        <h1 className="truncate font-serif text-3xl font-bold sm:text-4xl">
                                            {player.displayName}
                                        </h1>
                                        <code className="truncate text-[10px] text-wafuu-washi-warm/45 sm:text-xs">
                                            {player.playerId}
                                        </code>
                                    </div>
                                    <Link
                                        to="/rshogi-viewer/players"
                                        className="w-fit border-b border-wafuu-kincha pb-1 text-sm hover:text-wafuu-kincha"
                                    >
                                        ← レーティングへ戻る
                                    </Link>
                                </div>
                                <div className="flex flex-col justify-center gap-1 border-t border-wafuu-border px-6 py-7 lg:border-l lg:border-t-0">
                                    <span className="text-xs tracking-[0.2em] text-muted-foreground">
                                        ELO RATING
                                    </span>
                                    <strong className="font-mono text-5xl font-bold tabular-nums text-wafuu-shu">
                                        {Math.round(player.rating).toLocaleString("ja-JP")}
                                    </strong>
                                    <span className="mt-2 text-xs text-muted-foreground">
                                        初期値 1500 · K=32
                                    </span>
                                </div>
                            </div>
                            <dl className="grid grid-cols-4 divide-x divide-wafuu-border border-t border-wafuu-border">
                                {[
                                    ["対局", player.games],
                                    ["勝", player.wins],
                                    ["敗", player.losses],
                                    ["分", player.draws],
                                ].map(([label, value]) => (
                                    <div
                                        key={label}
                                        className="flex flex-col items-center gap-1 px-2 py-4"
                                    >
                                        <dt className="text-[10px] tracking-widest text-muted-foreground">
                                            {label}
                                        </dt>
                                        <dd className="font-mono text-xl tabular-nums text-wafuu-sumi">
                                            {value}
                                        </dd>
                                    </div>
                                ))}
                            </dl>
                        </section>

                        <section className="flex flex-col gap-3">
                            <div className="flex items-end justify-between gap-4 border-b border-wafuu-border pb-2">
                                <div>
                                    <p className="text-[10px] font-semibold tracking-[0.2em] text-wafuu-shu">
                                        GAME ARCHIVE
                                    </p>
                                    <h2 className="font-serif text-xl font-bold text-wafuu-sumi">
                                        対局記録
                                    </h2>
                                </div>
                                <span className="text-xs text-muted-foreground">
                                    全 {detail.totalCount} 局
                                </span>
                            </div>
                            <RshogiCsaGameList
                                games={detail.games}
                                onSelect={(gameId) =>
                                    void navigate({
                                        to: "/rshogi-viewer/$gameId",
                                        params: { gameId },
                                    })
                                }
                                isLoading={isLoading}
                                emptyMessage="該当する棋譜はありません。"
                            />
                            {totalPages > 1 && (
                                <nav
                                    className="flex items-center justify-between border-t border-wafuu-border pt-3"
                                    aria-label="対局記録ページ"
                                >
                                    <button
                                        type="button"
                                        onClick={() => requestPage(Math.max(1, displayedPage - 1))}
                                        disabled={displayedPage <= 1 || isLoading}
                                        className="rounded-md border border-wafuu-border px-4 py-1.5 text-sm text-wafuu-sumi transition-colors hover:bg-wafuu-kincha/10 disabled:opacity-40"
                                    >
                                        ← 新しい対局
                                    </button>
                                    <span className="font-mono text-xs text-muted-foreground">
                                        {displayedPage} / {totalPages}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() =>
                                            requestPage(Math.min(totalPages, displayedPage + 1))
                                        }
                                        disabled={displayedPage >= totalPages || isLoading}
                                        className="rounded-md border border-wafuu-border px-4 py-1.5 text-sm text-wafuu-sumi transition-colors hover:bg-wafuu-kincha/10 disabled:opacity-40"
                                    >
                                        古い対局 →
                                    </button>
                                </nav>
                            )}
                        </section>
                    </>
                )}
            </PageContainer>
        </>
    );
}
