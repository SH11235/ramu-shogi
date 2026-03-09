import type { GameRecordDetail, GetPublicGameResponse } from "@shogi/api-contract";
import { Link, useParams } from "@tanstack/react-router";
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

function formatResult(game: GameRecordDetail): string {
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

export default function PublicGamePage(): ReactElement {
    const { publicId } = useParams({ from: "/public/games/$publicId" });
    const [game, setGame] = useState<GameRecordDetail | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;

        void fetch(`/api/public/games/${publicId}`, {
            credentials: "same-origin",
        })
            .then(async (response) => {
                if (response.status === 404) {
                    throw new Error("棋譜が見つかりません");
                }
                if (!response.ok) {
                    throw new Error(await parseApiError(response));
                }

                const payload = (await response.json()) as GetPublicGameResponse;
                if (cancelled) return;
                setGame(payload.game);
                setError(null);
                setIsLoading(false);
            })
            .catch((nextError: unknown) => {
                if (cancelled) return;
                setError(
                    nextError instanceof Error ? nextError.message : "棋譜の取得に失敗しました",
                );
                setIsLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [publicId]);

    return (
        <>
            <PageHeader
                items={[{ label: "ラム将棋", to: "/" }, { label: "公開棋譜" }]}
                right={
                    <Link
                        to="/games"
                        className="rounded-md border border-border px-3 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                    >
                        棋譜一覧
                    </Link>
                }
            />
            <main className="mx-auto flex max-w-[960px] flex-col gap-6 px-4 py-8">
                {isLoading && <p className="text-sm text-muted-foreground">読み込み中...</p>}

                {error && (
                    <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                        {error}
                    </div>
                )}

                {game && (
                    <>
                        <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
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
                                    <h1 className="text-2xl font-bold text-foreground">
                                        {game.participants
                                            .map((participant) => participant.displayNameSnapshot)
                                            .join(" vs ")}
                                    </h1>
                                    <p className="text-sm text-muted-foreground">
                                        {formatResult(game)}
                                    </p>
                                </div>
                            </div>
                        </section>

                        <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
                            <h2 className="mb-3 text-lg font-semibold text-foreground">指し手</h2>
                            <ol className="grid gap-2 text-sm text-foreground">
                                {game.moves.map((move, index) => (
                                    <li
                                        key={`${game.id}:${move}:${index}`}
                                        className="rounded-md border border-border px-3 py-2"
                                    >
                                        {index + 1}. {move}
                                    </li>
                                ))}
                            </ol>
                        </section>

                        <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
                            <h2 className="mb-3 text-lg font-semibold text-foreground">
                                KIF テキスト
                            </h2>
                            <pre className="overflow-x-auto rounded-md bg-muted/40 p-4 text-xs text-foreground">
                                {game.kifuText}
                            </pre>
                        </section>
                    </>
                )}
            </main>
        </>
    );
}
