import type { GameRecordSummary } from "@shogi/api-contract";
import { getRouteApi, Link } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { AuthRequiredCard } from "../../components/AuthRequiredCard";
import { HeaderNav } from "../../components/HeaderNav";
import { PageHeader } from "../../components/PageHeader";
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
    };
    const needsAuth = loaderData.needsAuth;
    const games = loaderData.games;
    return (
        <>
            <PageHeader
                items={[{ label: "ラム将棋", to: "/" }, { label: "棋譜一覧" }]}
                right={<HeaderNav />}
            />
            <main className="mx-auto flex max-w-[960px] flex-col gap-6 px-4 py-8">
                <div className="flex flex-col gap-2">
                    <h1 className="text-2xl font-bold text-foreground">棋譜一覧</h1>
                    <p className="text-sm text-muted-foreground">
                        保存済みのオンライン対局を確認できます。
                    </p>
                    {!needsAuth && (
                        <p className="text-xs text-muted-foreground">
                            {games.length} / 50件
                            {games.length >= 45 && (
                                <span className="ml-2 text-wafuu-shu">
                                    ※ 50件を超えると古い棋譜から自動削除されます
                                </span>
                            )}
                        </p>
                    )}
                </div>

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
                    <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
                        <p className="text-sm text-muted-foreground">
                            まだ保存済みの棋譜はありません。
                        </p>
                    </div>
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
            </main>
        </>
    );
}
