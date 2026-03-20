import type { GameRecordSummary, ListPublicGamesResponse } from "@shogi/api-contract";
import { getRouteApi, Link } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { useState } from "react";
import { HeaderNav } from "../../components/HeaderNav";
import { PageHeader } from "../../components/PageHeader";
import { formatGameResult } from "./gameResultUtils";

const routeApi = getRouteApi("/public/games");

function formatFinishedAt(finishedAt: string | null): string {
    if (!finishedAt) return "未完了";
    return new Date(finishedAt).toLocaleString("ja-JP");
}

export default function PublicGamesPage(): ReactElement {
    const loaderData = routeApi.useLoaderData() as {
        games: GameRecordSummary[];
        nextCursor: string | null;
    };
    const [games, setGames] = useState(loaderData.games);
    const [nextCursor, setNextCursor] = useState(loaderData.nextCursor);
    const [isLoadingMore, setIsLoadingMore] = useState(false);

    async function handleLoadMore(): Promise<void> {
        if (isLoadingMore || !nextCursor) return;
        setIsLoadingMore(true);

        const params = new URLSearchParams({ cursor: nextCursor });
        const response = await fetch(`/api/public/games?${params.toString()}`);
        if (response.ok) {
            const payload = (await response.json()) as ListPublicGamesResponse;
            setGames((prev) => [...prev, ...payload.games]);
            setNextCursor(payload.nextCursor);
        }
        setIsLoadingMore(false);
    }

    return (
        <>
            <PageHeader
                items={[{ label: "ラム将棋", to: "/" }, { label: "公開棋譜" }]}
                right={<HeaderNav />}
            />
            <main className="mx-auto flex max-w-[960px] flex-col gap-6 px-4 py-8">
                <div className="flex flex-col gap-2">
                    <h1 className="text-2xl font-bold text-foreground">公開棋譜</h1>
                    <p className="text-sm text-muted-foreground">
                        ユーザーが公開設定にした棋譜の一覧です。
                    </p>
                </div>

                {games.length === 0 && (
                    <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
                        <p className="text-sm text-muted-foreground">
                            公開されている棋譜はまだありません。
                        </p>
                    </div>
                )}

                {games.length > 0 && (
                    <div className="grid gap-4">
                        {games.map((game) => (
                            <Link
                                key={game.publicId ?? game.id}
                                to="/public/games/$publicId"
                                params={{ publicId: game.publicId ?? "" }}
                                className="rounded-xl border border-border bg-card p-5 shadow-sm transition-colors hover:bg-muted/20"
                            >
                                <div className="flex flex-col gap-3">
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
                                    </div>
                                </div>
                            </Link>
                        ))}
                    </div>
                )}

                {nextCursor && (
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
            </main>
        </>
    );
}
