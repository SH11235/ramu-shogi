import type { GameRecordSummary, GetGameResponse, ListGamesResponse } from "@shogi/api-contract";
import { cn } from "@shogi/design-system";
import { fetchRshogiGame } from "@shogi/match-client";
import { cardVariants } from "@shogi/ui/components/card";
import {
    RshogiCsaGameBrowser,
    type RshogiGameBrowserSearch,
} from "@shogi/ui/components/rshogi-csa-game-browser";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import type { KeyboardEvent, ReactElement } from "react";
import { useEffect, useRef, useState } from "react";
import { AuthRequiredCard } from "../../components/AuthRequiredCard";
import { HeaderNav } from "../../components/HeaderNav";
import { PageContainer } from "../../components/PageContainer";
import { PageHeader } from "../../components/PageHeader";
import { PageHeading } from "../../components/PageHeading";
import { useOpenStudy } from "../../hooks/useOpenStudy";
import {
    canOpenGameRecordAsStudy,
    openStudyFromGameRecord,
    openStudyFromRshogiGame,
} from "../../lib/studyEntry";
import { GameRecordSummaryContent } from "../games/GameRecordSummaryContent";

const routeApi = getRouteApi("/studies/new");

/** どこの棋譜から選ぶか。`rshogi` は観戦・公開の棋譜、`games` は自分の対局。 */
export type NewStudySource = "rshogi" | "games";

const SOURCES: { id: NewStudySource; label: string }[] = [
    { id: "rshogi", label: "観戦・公開の棋譜" },
    { id: "games", label: "自分の対局" },
];

const resolveRshogiApiBaseUrl = (): string | undefined => {
    const raw = import.meta.env.VITE_RSHOGI_API_BASE as string | undefined;
    return raw?.trim() || undefined;
};

/**
 * 研究ノートにする棋譜を選ぶ画面。選んだ棋譜は、棋譜を見る画面を経ずにそのまま研究ノートで開く
 * （同じ棋譜のノートがあればそれを開く）。研究ノートの一覧の「ほかの棋譜から作る」から来る。
 */
export default function NewStudyFromGamePage(): ReactElement {
    const { from } = routeApi.useSearch();
    const source: NewStudySource = from === "games" ? "games" : "rshogi";
    const navigate = useNavigate();
    const { openStudy, isBusy, error } = useOpenStudy();
    // 絞り込みは、この画面の中だけで持つ（URL に置くのは、どちらの棋譜から選ぶかだけ）。
    const [rshogiSearch, setRshogiSearch] = useState<RshogiGameBrowserSearch>({});
    const rshogiApiBaseUrl = resolveRshogiApiBaseUrl();

    const openRshogiGame = (gameId: string): void => {
        void openStudy(async () =>
            openStudyFromRshogiGame(await fetchRshogiGame(gameId, { baseUrl: rshogiApiBaseUrl })),
        );
    };
    const openOwnGame = (gameId: string): void => {
        void openStudy(async () => {
            const response = await fetch(`/api/games/${encodeURIComponent(gameId)}`, {
                credentials: "same-origin",
            });
            if (response.status === 401) {
                throw new Error("ログインが切れました。ログインし直してください");
            }
            if (!response.ok) throw new Error("棋譜を読み込めませんでした");
            const { game } = (await response.json()) as GetGameResponse;
            if (!canOpenGameRecordAsStudy(game)) {
                throw new Error("この対局は研究ノートにできません（指し手が無い、など）");
            }
            return openStudyFromGameRecord(game);
        });
    };

    const selectSource = (id: NewStudySource) => {
        void navigate({
            to: "/studies/new",
            search: id === "games" ? { from: "games" } : {},
            replace: true,
        });
        document.getElementById(`new-study-tab-${id}`)?.focus();
    };
    const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
        const index = SOURCES.findIndex((item) => item.id === source);
        const next =
            event.key === "ArrowRight"
                ? (index + 1) % SOURCES.length
                : event.key === "ArrowLeft"
                  ? (index - 1 + SOURCES.length) % SOURCES.length
                  : event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? SOURCES.length - 1
                      : -1;
        if (next < 0) return;
        event.preventDefault();
        selectSource(SOURCES[next].id);
    };

    return (
        <>
            <PageHeader
                items={[
                    { label: "ラム将棋", to: "/" },
                    { label: "研究ノート", to: "/studies" },
                    { label: "棋譜から作る" },
                ]}
                right={<HeaderNav />}
            />
            <PageContainer>
                <PageHeading
                    title="研究ノートにする棋譜を選ぶ"
                    description="選ぶと、そのまま研究ノートで開きます。"
                />

                <div
                    role="tablist"
                    aria-label="棋譜の種類"
                    className="grid grid-cols-2 gap-1 rounded-lg border border-wafuu-border bg-wafuu-washi-warm p-1 sm:max-w-md"
                >
                    {SOURCES.map((item) => (
                        <button
                            key={item.id}
                            id={`new-study-tab-${item.id}`}
                            type="button"
                            role="tab"
                            aria-selected={source === item.id}
                            aria-controls="new-study-tabpanel"
                            tabIndex={source === item.id ? 0 : -1}
                            onClick={() => selectSource(item.id)}
                            onKeyDown={handleTabKeyDown}
                            className={cn(
                                "h-10 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                source === item.id
                                    ? "bg-card text-wafuu-shu shadow-sm"
                                    : "text-wafuu-sumi-light hover:text-wafuu-sumi",
                            )}
                        >
                            {item.label}
                        </button>
                    ))}
                </div>

                {/* 用意している間と失敗したときの知らせ。一覧の上に場所を取らないよう、画面の上に重ねる。 */}
                {(isBusy || error) && (
                    <div className="pointer-events-none fixed inset-x-0 top-14 z-40 flex justify-center px-3">
                        {isBusy ? (
                            <output
                                aria-live="polite"
                                className="rounded-lg border border-wafuu-border bg-card px-4 py-2 text-sm text-wafuu-sumi shadow-lg"
                            >
                                研究ノートを用意しています…
                            </output>
                        ) : (
                            <p
                                role="alert"
                                className="rounded-lg border border-status-warning-border bg-status-warning-bg px-4 py-2 text-sm text-status-warning shadow-lg"
                            >
                                {error}
                            </p>
                        )}
                    </div>
                )}

                <div
                    id="new-study-tabpanel"
                    role="tabpanel"
                    aria-labelledby={`new-study-tab-${source}`}
                    inert={isBusy}
                    className={cn(isBusy && "opacity-60")}
                >
                    {source === "rshogi" ? (
                        <RshogiCsaGameBrowser
                            apiBaseUrl={rshogiApiBaseUrl}
                            search={rshogiSearch}
                            onSearchChange={setRshogiSearch}
                            onSelectGame={openRshogiGame}
                        />
                    ) : (
                        <OwnGamesPicker onSelectGame={openOwnGame} />
                    )}
                </div>
            </PageContainer>
        </>
    );
}

type OwnGamesState =
    | { status: "loading" }
    | { status: "needsAuth" }
    | { status: "error" }
    | { status: "ready"; games: GameRecordSummary[]; nextCursor: string | null };

const fetchOwnGames = async (cursor: string | null, signal?: AbortSignal) => {
    const query = cursor ? `?${new URLSearchParams({ cursor }).toString()}` : "";
    const response = await fetch(`/api/games${query}`, { credentials: "same-origin", signal });
    if (response.status === 401) return "needsAuth" as const;
    if (!response.ok) throw new Error("棋譜一覧の取得に失敗しました");
    return (await response.json()) as ListGamesResponse;
};

/** 自分の対局の一覧。押すと、その対局を研究ノートで開く。 */
function OwnGamesPicker({
    onSelectGame,
}: {
    onSelectGame: (gameId: string) => void;
}): ReactElement {
    const [state, setState] = useState<OwnGamesState>({ status: "loading" });
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [loadMoreFailed, setLoadMoreFailed] = useState(false);
    // 画面を離れたら、続きの取得も止める。
    const loadMoreControllerRef = useRef<AbortController | null>(null);
    useEffect(() => () => loadMoreControllerRef.current?.abort(), []);

    useEffect(() => {
        const controller = new AbortController();
        fetchOwnGames(null, controller.signal)
            .then((result) => {
                if (controller.signal.aborted) return;
                setState(
                    result === "needsAuth"
                        ? { status: "needsAuth" }
                        : { status: "ready", games: result.games, nextCursor: result.nextCursor },
                );
            })
            .catch(() => {
                if (!controller.signal.aborted) setState({ status: "error" });
            });
        return () => controller.abort();
    }, []);

    const loadMore = async (): Promise<void> => {
        if (state.status !== "ready" || !state.nextCursor || isLoadingMore) return;
        setIsLoadingMore(true);
        setLoadMoreFailed(false);
        const controller = new AbortController();
        loadMoreControllerRef.current = controller;
        try {
            const result = await fetchOwnGames(state.nextCursor, controller.signal);
            setState((current) =>
                result === "needsAuth"
                    ? { status: "needsAuth" }
                    : current.status === "ready"
                      ? {
                            status: "ready",
                            games: [...current.games, ...result.games],
                            nextCursor: result.nextCursor,
                        }
                      : current,
            );
        } catch {
            // 続きだけが取れなかったときは、表示できている対局を残して、押し直せるようにする。
            if (!controller.signal.aborted) setLoadMoreFailed(true);
        } finally {
            if (!controller.signal.aborted) setIsLoadingMore(false);
        }
    };

    if (state.status === "loading") {
        return <p className="text-sm text-muted-foreground">読み込み中…</p>;
    }
    if (state.status === "needsAuth") {
        return (
            <AuthRequiredCard
                title="ログインすると、自分の対局から研究ノートを作れます"
                details={[
                    "保存済みのオンライン対局を選んで、そのまま研究ノートで振り返れます。",
                    "別の端末から同じアカウントでログインしても、同じノートを開けます。",
                ]}
                nextPath="/studies/new?from=games"
                loginLabel="Googleでログインして対局を選ぶ"
            />
        );
    }
    if (state.status === "error") {
        return (
            <p role="alert" className="text-sm text-destructive">
                棋譜一覧を読み込めませんでした。時間をおいて再度お試しください。
            </p>
        );
    }
    if (state.games.length === 0) {
        return <p className="text-sm text-muted-foreground">まだ保存済みの対局はありません。</p>;
    }
    return (
        <div className="flex flex-col gap-4">
            <ul className="grid gap-3">
                {state.games.map((game) => (
                    <li
                        key={game.id}
                        className={cn(
                            cardVariants({ elevation: "raised", interactive: true }),
                            "relative p-5",
                        )}
                    >
                        <GameRecordSummaryContent game={game} />
                        {/* 見出しを含む中身はボタンの中に置けないので、カード全体を覆うボタンにする。 */}
                        <button
                            type="button"
                            onClick={() => onSelectGame(game.id)}
                            className="absolute inset-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                            <span className="sr-only">
                                {game.participants
                                    .map((participant) => participant.displayNameSnapshot)
                                    .join(" 対 ")}
                                を研究ノートで開く
                            </span>
                        </button>
                    </li>
                ))}
            </ul>
            {state.nextCursor && (
                <div className="flex flex-col items-center gap-2">
                    {loadMoreFailed && (
                        <p role="alert" className="text-sm text-destructive">
                            続きを読み込めませんでした。もう一度お試しください。
                        </p>
                    )}
                    <button
                        type="button"
                        onClick={() => void loadMore()}
                        disabled={isLoadingMore}
                        className="rounded-md border border-input px-6 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/50 disabled:pointer-events-none disabled:opacity-50"
                    >
                        {isLoadingMore ? "読み込み中…" : "もっと見る"}
                    </button>
                </div>
            )}
        </div>
    );
}
