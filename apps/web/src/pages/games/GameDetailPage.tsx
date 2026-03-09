import type {
    GameRecordDetail,
    GameRecordVisibility,
    GetGameResponse,
    UpdateGameVisibilityResponse,
} from "@shogi/api-contract";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
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

export default function GameDetailPage(): ReactElement {
    const { gameId } = useParams({ from: "/games/$gameId" });
    const navigate = useNavigate();
    const [game, setGame] = useState<GameRecordDetail | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isUpdatingVisibility, setIsUpdatingVisibility] = useState(false);
    const [status, setStatus] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;

        void fetch(`/api/games/${gameId}`, {
            credentials: "same-origin",
        })
            .then(async (response) => {
                if (response.status === 401) {
                    if (!cancelled) {
                        void navigate({ to: "/auth" });
                    }
                    return;
                }

                if (response.status === 404) {
                    throw new Error("棋譜が見つかりません");
                }

                if (!response.ok) {
                    throw new Error(await parseApiError(response));
                }

                const payload = (await response.json()) as GetGameResponse;
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
    }, [gameId, navigate]);

    async function handleUpdateVisibility(visibility: GameRecordVisibility): Promise<void> {
        if (!game || isUpdatingVisibility) return;

        setIsUpdatingVisibility(true);
        setStatus(null);
        setError(null);

        try {
            const response = await fetch(`/api/games/${game.id}/visibility`, {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                },
                credentials: "same-origin",
                body: JSON.stringify({ visibility }),
            });

            if (!response.ok) {
                throw new Error(await parseApiError(response));
            }

            const payload = (await response.json()) as UpdateGameVisibilityResponse;
            setGame((prev) => (prev ? { ...prev, ...payload.game } : prev));
            setStatus("公開設定を更新しました。");
        } catch (nextError) {
            setError(
                nextError instanceof Error ? nextError.message : "公開設定の更新に失敗しました",
            );
        } finally {
            setIsUpdatingVisibility(false);
        }
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
                {isLoading && <p className="text-sm text-muted-foreground">読み込み中...</p>}

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
                                        {formatResult(game)}
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
                                    <h2 className="text-lg font-semibold text-foreground">
                                        公開設定
                                    </h2>
                                    <p className="text-sm text-muted-foreground">
                                        public / unlisted
                                        はメール確認済みアカウントのみ変更できます。
                                    </p>
                                </div>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {(["private", "unlisted", "public"] as const).map((visibility) => (
                                    <button
                                        key={visibility}
                                        type="button"
                                        onClick={() => void handleUpdateVisibility(visibility)}
                                        disabled={
                                            isUpdatingVisibility || game.visibility === visibility
                                        }
                                        className="rounded-md border border-input px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/50 disabled:pointer-events-none disabled:opacity-50"
                                    >
                                        {visibility}
                                    </button>
                                ))}
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
                            <div className="mb-3 flex items-center justify-between gap-3">
                                <h2 className="text-lg font-semibold text-foreground">
                                    KIF テキスト
                                </h2>
                                <button
                                    type="button"
                                    onClick={() =>
                                        void navigator.clipboard.writeText(game.kifuText)
                                    }
                                    className="rounded-md border border-input px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/50"
                                >
                                    コピー
                                </button>
                            </div>
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
