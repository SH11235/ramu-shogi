import type { RshogiPlayerSummary } from "@shogi/match-client";
import { fetchRshogiPlayerList } from "@shogi/match-client";
import { Link } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { useEffect, useState } from "react";
import { HeaderNav } from "../../components/HeaderNav";
import { PageContainer } from "../../components/PageContainer";
import { PageHeader } from "../../components/PageHeader";
import { StatusBanner } from "../../components/StatusBanner";

const resolveApiBaseUrl = (): string | undefined => {
    const raw = import.meta.env.VITE_RSHOGI_API_BASE as string | undefined;
    return raw?.trim() || undefined;
};

const formatRate = (rating: number): string => Math.round(rating).toLocaleString("ja-JP");

const winRate = (player: RshogiPlayerSummary): string => {
    if (player.games === 0) return "—";
    return `${((player.wins / player.games) * 100).toFixed(1)}%`;
};

const lastPlayed = (value: number | undefined): string => {
    if (value === undefined) return "対局記録なし";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "日時不明";
    return new Intl.DateTimeFormat("ja-JP", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    }).format(date);
};

export default function RshogiPlayerRankingPage(): ReactElement {
    const apiBaseUrl = resolveApiBaseUrl();
    const [players, setPlayers] = useState<RshogiPlayerSummary[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    useEffect(() => {
        const controller = new AbortController();
        setIsLoading(true);
        setErrorMessage(null);
        void fetchRshogiPlayerList({ baseUrl: apiBaseUrl, signal: controller.signal })
            .then((response) => {
                if (!controller.signal.aborted) setPlayers(response.players);
            })
            .catch((error: unknown) => {
                if (!controller.signal.aborted) {
                    setErrorMessage(
                        error instanceof Error
                            ? error.message
                            : `ランキングの取得に失敗しました: ${String(error)}`,
                    );
                }
            })
            .finally(() => {
                if (!controller.signal.aborted) setIsLoading(false);
            });
        return () => controller.abort();
    }, [apiBaseUrl]);

    const totals = {
        players: players.length,
        games: Math.round(players.reduce((sum, player) => sum + player.games, 0) / 2),
        leader: players[0],
    };

    return (
        <>
            <PageHeader
                items={[
                    { label: "ラム将棋", to: "/" },
                    { label: "rshogi viewer", to: "/rshogi-viewer" },
                    { label: "選手番付" },
                ]}
                right={<HeaderNav />}
            />
            <PageContainer width="wide" className="gap-5">
                <section className="relative overflow-hidden rounded-2xl bg-wafuu-sumi px-5 py-7 text-wafuu-washi-warm shadow-lg sm:px-8 sm:py-9">
                    <div
                        className="pointer-events-none absolute -right-10 -top-20 h-64 w-64 rounded-full border-[44px] border-wafuu-shu/20"
                        aria-hidden="true"
                    />
                    <div className="relative grid gap-7 lg:grid-cols-[1fr_auto] lg:items-end">
                        <div className="flex flex-col gap-3">
                            <p className="text-xs font-semibold tracking-[0.28em] text-wafuu-kincha">
                                RSHOGI PLAYER RATING
                            </p>
                            <h1 className="font-serif text-3xl font-bold tracking-tight sm:text-4xl">
                                選手番付
                            </h1>
                            <p className="max-w-2xl text-sm leading-7 text-wafuu-washi-warm/75">
                                終局順に Elo を更新した、CSA
                                サーバの選手ランキングです。勝敗だけでなく、対戦相手の強さも評点に反映します。
                            </p>
                        </div>
                        <Link
                            to="/rshogi-viewer"
                            className="w-fit border-b border-wafuu-kincha pb-1 text-sm text-wafuu-washi-warm transition-colors hover:text-wafuu-kincha"
                        >
                            棋譜一覧を見る ↗
                        </Link>
                    </div>
                </section>

                {errorMessage && <StatusBanner variant="error">{errorMessage}</StatusBanner>}

                <section
                    className="grid grid-cols-3 overflow-hidden rounded-xl border border-wafuu-border bg-wafuu-washi-warm"
                    aria-label="番付概要"
                >
                    <div className="flex flex-col gap-1 border-r border-wafuu-border px-3 py-4 text-center sm:px-6">
                        <span className="text-[10px] tracking-widest text-muted-foreground sm:text-xs">
                            登録選手
                        </span>
                        <strong className="font-serif text-xl text-wafuu-sumi sm:text-2xl">
                            {totals.players}
                        </strong>
                    </div>
                    <div className="flex flex-col gap-1 border-r border-wafuu-border px-3 py-4 text-center sm:px-6">
                        <span className="text-[10px] tracking-widest text-muted-foreground sm:text-xs">
                            集計対局
                        </span>
                        <strong className="font-serif text-xl text-wafuu-sumi sm:text-2xl">
                            {totals.games}
                        </strong>
                    </div>
                    <div className="flex min-w-0 flex-col gap-1 px-3 py-4 text-center sm:px-6">
                        <span className="text-[10px] tracking-widest text-muted-foreground sm:text-xs">
                            首位
                        </span>
                        <strong className="truncate font-serif text-base text-wafuu-shu sm:text-xl">
                            {totals.leader?.displayName ?? "—"}
                        </strong>
                    </div>
                </section>

                <section className="overflow-hidden rounded-xl border border-wafuu-border bg-wafuu-washi-warm">
                    <div className="grid grid-cols-[3rem_minmax(0,1fr)_5rem] items-center border-b border-wafuu-border bg-wafuu-kincha/10 px-3 py-2 text-[11px] font-semibold tracking-widest text-muted-foreground sm:grid-cols-[4rem_minmax(0,1fr)_7rem_9rem_8rem] sm:px-5">
                        <span>順位</span>
                        <span>選手</span>
                        <span className="text-right">RATING</span>
                        <span className="hidden text-right sm:block">勝–敗–分</span>
                        <span className="hidden text-right sm:block">勝率</span>
                    </div>
                    {isLoading && (
                        <div
                            className="px-5 py-12 text-center text-sm text-muted-foreground"
                            aria-live="polite"
                        >
                            番付を編成中…
                        </div>
                    )}
                    {!isLoading && players.length === 0 && !errorMessage && (
                        <div className="px-5 py-12 text-center text-sm text-muted-foreground">
                            集計できる終局済対局がまだありません。
                        </div>
                    )}
                    {!isLoading && players.length > 0 && (
                        <ol aria-label="選手ランキング" className="divide-y divide-wafuu-border">
                            {players.map((player, index) => (
                                <li key={player.playerId}>
                                    <Link
                                        to="/rshogi-viewer/players/$playerId"
                                        params={{ playerId: player.playerId }}
                                        className="group grid grid-cols-[3rem_minmax(0,1fr)_5rem] items-center px-3 py-3 transition-colors hover:bg-wafuu-kincha/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-wafuu-shu sm:grid-cols-[4rem_minmax(0,1fr)_7rem_9rem_8rem] sm:px-5 sm:py-4"
                                    >
                                        <span
                                            className={
                                                index < 3
                                                    ? "font-serif text-2xl font-bold text-wafuu-shu"
                                                    : "font-mono text-sm text-muted-foreground"
                                            }
                                        >
                                            {String(index + 1).padStart(2, "0")}
                                        </span>
                                        <span className="min-w-0">
                                            <span className="flex items-center gap-2">
                                                <strong className="truncate font-serif text-base text-wafuu-sumi group-hover:text-wafuu-shu sm:text-lg">
                                                    {player.displayName}
                                                </strong>
                                                {player.legacy && (
                                                    <span className="shrink-0 rounded-sm border border-wafuu-border px-1.5 py-0.5 text-[9px] tracking-wider text-muted-foreground">
                                                        LEGACY
                                                    </span>
                                                )}
                                            </span>
                                            <span className="mt-0.5 block text-[11px] text-muted-foreground sm:text-xs">
                                                {player.games}局 · 最終{" "}
                                                {lastPlayed(player.lastPlayedAtMs)}
                                            </span>
                                        </span>
                                        <strong className="text-right font-mono text-lg tabular-nums text-wafuu-sumi sm:text-xl">
                                            {formatRate(player.rating)}
                                        </strong>
                                        <span className="hidden text-right font-mono text-sm tabular-nums text-muted-foreground sm:block">
                                            {player.wins}–{player.losses}–{player.draws}
                                        </span>
                                        <span className="hidden text-right font-mono text-sm tabular-nums text-muted-foreground sm:block">
                                            {winRate(player)}
                                        </span>
                                    </Link>
                                </li>
                            ))}
                        </ol>
                    )}
                </section>

                <p className="text-xs leading-6 text-muted-foreground">
                    Elo は初期値 1500、K=32、引分 0.5 で算出。同一 ID
                    同士の対局は集計対象外です。LEGACY
                    は識別情報導入前の棋譜を選手名だけでまとめた記録です。
                </p>
            </PageContainer>
        </>
    );
}
