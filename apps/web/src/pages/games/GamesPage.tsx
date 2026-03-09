import type { GameRecordSummary, ListGamesResponse } from "@shogi/api-contract";
import { Link } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { useEffect, useState } from "react";
import { PageHeader } from "../../components/PageHeader";
import { parseApiError } from "../../hooks/useAuthSession";

const RESULT_REASON_LABELS: Record<string, string> = {
    resign: "投了",
    timeout: "時間切れ",
    sennichite: "千日手",
    disconnect: "切断",
    checkmate: "詰み",
    illegal_move: "反則",
};

function formatGameResult(game: GameRecordSummary): string {
    if (!game.result) return "結果不明";
    const reason = RESULT_REASON_LABELS[game.result.reason] ?? game.result.reason;
    if (!game.result.winner) {
        return `引き分け (${reason})`;
    }

    const winner = game.participants.find(
        (participant) => participant.seat === game.result?.winner,
    );
    return `${winner?.displayNameSnapshot ?? (game.result.winner === "b" ? "先手" : "後手")} 勝ち (${reason})`;
}

function formatFinishedAt(finishedAt: string | null): string {
    if (!finishedAt) return "未完了";
    return new Date(finishedAt).toLocaleString("ja-JP");
}

export default function GamesPage(): ReactElement {
    const [games, setGames] = useState<GameRecordSummary[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [needsAuth, setNeedsAuth] = useState(false);

    useEffect(() => {
        let cancelled = false;

        void fetch("/api/games", {
            credentials: "same-origin",
        })
            .then(async (response) => {
                if (response.status === 401) {
                    if (!cancelled) {
                        setNeedsAuth(true);
                        setGames([]);
                        setError(null);
                        setIsLoading(false);
                    }
                    return;
                }

                if (!response.ok) {
                    throw new Error(await parseApiError(response));
                }

                const payload = (await response.json()) as ListGamesResponse;
                if (cancelled) return;
                setNeedsAuth(false);
                setGames(payload.games);
                setError(null);
                setIsLoading(false);
            })
            .catch((nextError: unknown) => {
                if (cancelled) return;
                setError(
                    nextError instanceof Error ? nextError.message : "棋譜一覧の取得に失敗しました",
                );
                setIsLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, []);

    return (
        <>
            <PageHeader
                items={[{ label: "ラム将棋", to: "/" }, { label: "棋譜一覧" }]}
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
                <div className="flex flex-col gap-2">
                    <h1 className="text-2xl font-bold text-foreground">棋譜一覧</h1>
                    <p className="text-sm text-muted-foreground">
                        保存済みのオンライン対局を確認できます。
                    </p>
                </div>

                {isLoading && <p className="text-sm text-muted-foreground">読み込み中...</p>}

                {needsAuth && (
                    <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
                        <p className="text-sm text-muted-foreground">
                            棋譜一覧の表示にはログインが必要です。
                        </p>
                    </div>
                )}

                {error && (
                    <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                        {error}
                    </div>
                )}

                {!isLoading && !needsAuth && !error && games.length === 0 && (
                    <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
                        <p className="text-sm text-muted-foreground">
                            まだ保存済みの棋譜はありません。
                        </p>
                    </div>
                )}

                {!isLoading && !needsAuth && games.length > 0 && (
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
