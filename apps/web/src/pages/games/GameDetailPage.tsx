import type {
    GameRecordDetail,
    GameRecordVisibility,
    UpdateGameVisibilityResponse,
} from "@shogi/api-contract";
import { getRouteApi, Link, useParams } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { useState } from "react";
import { PageHeader } from "../../components/PageHeader";
import { parseApiError } from "../../hooks/useAuthSession";
import { formatGameResult } from "./gameResultUtils";

const routeApi = getRouteApi("/games/$gameId");

export default function GameDetailPage(): ReactElement {
    const { gameId } = useParams({ from: "/games/$gameId" });
    const loaderGame = routeApi.useLoaderData() as GameRecordDetail;
    const [game, setGame] = useState(loaderGame);
    const [isUpdatingVisibility, setIsUpdatingVisibility] = useState(false);
    const [status, setStatus] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    async function handleUpdateVisibility(visibility: GameRecordVisibility): Promise<void> {
        if (isUpdatingVisibility) return;

        setIsUpdatingVisibility(true);
        setStatus(null);
        setError(null);

        const response = await fetch(`/api/games/${game.id}/visibility`, {
            method: "PATCH",
            headers: {
                "Content-Type": "application/json",
            },
            credentials: "same-origin",
            body: JSON.stringify({ visibility }),
        });

        if (!response.ok) {
            setError(await parseApiError(response));
            setIsUpdatingVisibility(false);
            return;
        }

        const payload = (await response.json()) as UpdateGameVisibilityResponse;
        setGame((prev) => ({ ...prev, ...payload.game }));
        setStatus("公開設定を更新しました。");
        setIsUpdatingVisibility(false);
    }

    return (
        <>
            <PageHeader
                items={[
                    { label: "ラム将棋", to: "/" },
                    { label: "棋譜一覧", to: "/games" },
                    { label: "棋譜詳細" },
                ]}
                right={
                    <Link
                        to="/auth"
                        className="rounded-md border border-border px-3 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                    >
                        ログイン
                    </Link>
                }
            />
            <main className="mx-auto flex max-w-[960px] flex-col gap-6 px-4 py-8">
                {status && (
                    <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700">
                        {status}
                    </div>
                )}

                {error && (
                    <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                        {error}
                    </div>
                )}

                <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
                    <div className="flex flex-col gap-3">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                            <span className="rounded-full bg-muted px-2 py-1 text-muted-foreground">
                                {game.visibility}
                            </span>
                            <span className="rounded-full bg-muted px-2 py-1 text-muted-foreground">
                                {game.source}
                            </span>
                            {game.publicId && (
                                <Link
                                    to="/public/games/$publicId"
                                    params={{ publicId: game.publicId }}
                                    className="rounded-full bg-secondary px-2 py-1 text-secondary-foreground"
                                >
                                    公開ページ
                                </Link>
                            )}
                        </div>

                        <div className="flex flex-col gap-1">
                            <h1 className="text-2xl font-bold text-foreground">
                                {game.participants
                                    .map((participant) => participant.displayNameSnapshot)
                                    .join(" vs ")}
                            </h1>
                            <p className="text-sm text-muted-foreground">
                                {formatGameResult(game)}
                            </p>
                        </div>

                        <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                            <span>
                                開始:{" "}
                                {game.startedAt
                                    ? new Date(game.startedAt).toLocaleString("ja-JP")
                                    : "不明"}
                            </span>
                            <span>
                                終了:{" "}
                                {game.finishedAt
                                    ? new Date(game.finishedAt).toLocaleString("ja-JP")
                                    : "不明"}
                            </span>
                        </div>
                    </div>
                </section>

                <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
                    <div className="mb-3 flex items-center justify-between gap-3">
                        <div>
                            <h2 className="text-lg font-semibold text-foreground">公開設定</h2>
                            <p className="text-sm text-muted-foreground">
                                public / unlisted はメール確認済みアカウントのみ変更できます。
                            </p>
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {(["private", "unlisted", "public"] as const).map((visibility) => (
                            <button
                                key={visibility}
                                type="button"
                                onClick={() => void handleUpdateVisibility(visibility)}
                                disabled={isUpdatingVisibility || game.visibility === visibility}
                                className="rounded-md border border-input px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/50 disabled:pointer-events-none disabled:opacity-50"
                            >
                                {visibility}
                            </button>
                        ))}
                    </div>
                </section>

                <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <h2 className="text-lg font-semibold text-foreground">検討</h2>
                            <p className="text-sm text-muted-foreground">
                                この棋譜を検討室で開き、解析結果 snapshot を保存できます。
                            </p>
                        </div>
                        <Link
                            to="/games/$gameId/review"
                            params={{ gameId }}
                            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
                        >
                            棋譜を検討する
                        </Link>
                    </div>
                </section>

                <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
                    <h2 className="mb-3 text-lg font-semibold text-foreground">指し手</h2>
                    <ol className="grid gap-2 text-sm text-foreground">
                        {game.moves.map((move, index) => {
                            const ply = index + 1;
                            return (
                                <li
                                    key={`${game.id}:${ply}:${move}`}
                                    className="rounded-md border border-border px-3 py-2"
                                >
                                    {ply}. {move}
                                </li>
                            );
                        })}
                    </ol>
                </section>

                <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
                    <div className="mb-3 flex items-center justify-between gap-3">
                        <h2 className="text-lg font-semibold text-foreground">KIF テキスト</h2>
                        <button
                            type="button"
                            onClick={() => void navigator.clipboard.writeText(game.kifuText)}
                            className="rounded-md border border-input px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/50"
                        >
                            コピー
                        </button>
                    </div>
                    <pre className="overflow-x-auto rounded-md bg-muted/40 p-4 text-xs text-foreground">
                        {game.kifuText}
                    </pre>
                </section>
            </main>
        </>
    );
}
