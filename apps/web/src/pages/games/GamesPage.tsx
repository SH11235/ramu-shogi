import type { GameRecordSummary, ListGamesResponse } from "@shogi/api-contract";
import { getRouteApi, Link } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { useEffect, useRef, useState } from "react";
import { AuthRequiredCard } from "../../components/AuthRequiredCard";
import { HeaderNav } from "../../components/HeaderNav";
import { PageContainer } from "../../components/PageContainer";
import { PageHeader } from "../../components/PageHeader";
import { PageHeading } from "../../components/PageHeading";
import { Section } from "../../components/Section";
import { formatGameResult } from "./gameResultUtils";

const routeApi = getRouteApi("/games");

function formatFinishedAt(finishedAt: string | null): string {
    if (!finishedAt) return "未完了";
    return new Date(finishedAt).toLocaleString("ja-JP");
}

export default function GamesPage(): ReactElement {
    const loaderData = routeApi.useLoaderData() as {
        needsAuth: boolean;
        games: GameRecordSummary[];
        nextCursor: string | null;
    };
    const needsAuth = loaderData.needsAuth;
    const [games, setGames] = useState(loaderData.games);
    const [nextCursor, setNextCursor] = useState(loaderData.nextCursor);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const loaderGenerationRef = useRef(0);
    const requestAbortRef = useRef<AbortController | null>(null);

    useEffect(() => {
        loaderGenerationRef.current += 1;
        requestAbortRef.current?.abort();
        requestAbortRef.current = null;
        setGames(loaderData.games);
        setNextCursor(loaderData.nextCursor);
        setIsLoadingMore(false);
        setLoadError(null);

        return () => requestAbortRef.current?.abort();
    }, [loaderData]);

    async function handleLoadMore(): Promise<void> {
        if (isLoadingMore || !nextCursor) return;
        const loaderGeneration = loaderGenerationRef.current;
        const abortController = new AbortController();
        requestAbortRef.current = abortController;
        setIsLoadingMore(true);
        setLoadError(null);

        try {
            const params = new URLSearchParams({ cursor: nextCursor });
            const response = await fetch(`/api/games?${params.toString()}`, {
                credentials: "same-origin",
                signal: abortController.signal,
            });
            if (!response.ok) throw new Error("棋譜の追加取得に失敗しました");

            const payload = (await response.json()) as ListGamesResponse;
            if (
                abortController.signal.aborted ||
                loaderGeneration !== loaderGenerationRef.current
            ) {
                return;
            }
            setGames((current) => [...current, ...payload.games]);
            setNextCursor(payload.nextCursor);
        } catch {
            if (
                abortController.signal.aborted ||
                loaderGeneration !== loaderGenerationRef.current
            ) {
                return;
            }
            setLoadError("棋譜の追加取得に失敗しました。時間をおいて再度お試しください。");
        } finally {
            if (requestAbortRef.current === abortController) {
                requestAbortRef.current = null;
                if (loaderGeneration === loaderGenerationRef.current) {
                    setIsLoadingMore(false);
                }
            }
        }
    }

    return (
        <>
            <PageHeader
                items={[{ label: "ラム将棋", to: "/" }, { label: "棋譜一覧" }]}
                right={<HeaderNav />}
            />
            <PageContainer>
                <PageHeading
                    title="棋譜一覧"
                    description="保存済みのオンライン対局を確認できます。"
                >
                    {!needsAuth && (
                        <p className="text-xs text-muted-foreground">{games.length}件を表示中</p>
                    )}
                </PageHeading>

                {needsAuth && (
                    <AuthRequiredCard
                        title="ログインすると棋譜を保存して確認できます"
                        details={[
                            "保存済みのオンライン対局を一覧で見返せます。",
                            "別の端末から同じアカウントでログインしても棋譜を参照できます。",
                            "公開設定を切り替えて共有リンクを管理できます。",
                        ]}
                        nextPath="/games"
                        loginLabel="Googleでログインして棋譜を見る"
                    />
                )}

                {!needsAuth && games.length === 0 && (
                    <Section>
                        <p className="text-sm text-muted-foreground">
                            まだ保存済みの棋譜はありません。
                        </p>
                    </Section>
                )}

                {!needsAuth && games.length > 0 && (
                    <div className="grid gap-4">
                        {games.map((game) => (
                            <Link
                                key={game.id}
                                to="/games/$gameId"
                                params={{ gameId: game.id }}
                                className="rounded-xl border border-border bg-card p-5 shadow-sm transition-colors hover:bg-muted/20"
                            >
                                <div className="flex flex-col gap-3">
                                    <div className="flex flex-wrap items-center gap-2 text-xs">
                                        <span className="rounded-full bg-muted px-2 py-1 text-muted-foreground">
                                            {game.visibility}
                                        </span>
                                        <span className="rounded-full bg-muted px-2 py-1 text-muted-foreground">
                                            {game.source}
                                        </span>
                                    </div>

                                    <div className="flex flex-col gap-1">
                                        <h2 className="text-base font-semibold text-foreground">
                                            {game.participants
                                                .map(
                                                    (participant) =>
                                                        participant.displayNameSnapshot,
                                                )
                                                .join(" vs ")}
                                        </h2>
                                        <p className="text-sm text-muted-foreground">
                                            {formatGameResult(game)}
                                        </p>
                                    </div>

                                    <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                                        <span>終了: {formatFinishedAt(game.finishedAt)}</span>
                                        <span>
                                            作成: {new Date(game.createdAt).toLocaleString("ja-JP")}
                                        </span>
                                    </div>
                                </div>
                            </Link>
                        ))}
                    </div>
                )}

                {!needsAuth && loadError && (
                    <p role="alert" className="text-center text-sm text-destructive">
                        {loadError}
                    </p>
                )}

                {!needsAuth && nextCursor && (
                    <div className="flex justify-center">
                        <button
                            type="button"
                            onClick={() => void handleLoadMore()}
                            disabled={isLoadingMore}
                            className="rounded-md border border-input px-6 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/50 disabled:pointer-events-none disabled:opacity-50"
                        >
                            {isLoadingMore ? "読み込み中..." : "もっと見る"}
                        </button>
                    </div>
                )}
            </PageContainer>
        </>
    );
}
