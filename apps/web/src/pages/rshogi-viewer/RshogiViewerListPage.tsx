import type {
    FetchRshogiGameSearchOptions,
    RshogiGameResultKind,
    RshogiGameSearchPage,
    RshogiGameSummary,
} from "@shogi/match-client";
import { fetchRshogiGameList, fetchRshogiGameSearch } from "@shogi/match-client";
import { Input } from "@shogi/ui/components/input";
import { RshogiCsaGameList } from "@shogi/ui/components/rshogi-csa-game-list";
import { Link, useNavigate } from "@tanstack/react-router";
import { type FormEvent, type ReactElement, useEffect, useRef, useState } from "react";
import { HeaderNav } from "../../components/HeaderNav";
import { PageContainer } from "../../components/PageContainer";
import { PageHeader } from "../../components/PageHeader";
import { PageHeading } from "../../components/PageHeading";
import { StatusBanner } from "../../components/StatusBanner";

const PAGE_LIMIT = 50;
const SEARCH_PAGE_SIZE = 20;

interface SearchFormValues {
    name: string;
    result: "" | RshogiGameResultKind;
    from: string;
    to: string;
    source: string;
}

const EMPTY_SEARCH_FORM: SearchFormValues = {
    name: "",
    result: "",
    from: "",
    to: "",
    source: "",
};

const RESULT_OPTIONS: { value: RshogiGameResultKind; label: string }[] = [
    { value: "resignation", label: "投了" },
    { value: "time_expired", label: "時間切れ" },
    { value: "draw", label: "千日手" },
    { value: "jishogi", label: "入玉勝ち" },
    { value: "oute_sennichite", label: "連続王手千日手" },
    { value: "abort", label: "中断" },
    { value: "max_moves", label: "最大手数" },
    { value: "abnormal", label: "異常終了" },
];

const hasSearchCondition = (values: SearchFormValues): boolean =>
    Object.values(values).some((value) => value.trim().length > 0);

const dateStartMs = (value: string): number | undefined => {
    if (!value) return undefined;
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? undefined : date.getTime();
};

const dateEndMs = (value: string): number | undefined => {
    if (!value) return undefined;
    const [year, month, day] = value.split("-").map(Number);
    const nextDay = new Date(year, month - 1, day + 1);
    return Number.isNaN(nextDay.getTime()) ? undefined : nextDay.getTime() - 1;
};

const toSearchOptions = (values: SearchFormValues): FetchRshogiGameSearchOptions => ({
    name: values.name.trim() || undefined,
    result: values.result || undefined,
    source: values.source.trim() || undefined,
    from: dateStartMs(values.from),
    to: dateEndMs(values.to),
});

const resolveApiBaseUrl = (): string | undefined => {
    const raw = import.meta.env.VITE_RSHOGI_API_BASE as string | undefined;
    return raw?.trim() || undefined;
};

export default function RshogiViewerListPage(): ReactElement {
    const navigate = useNavigate();
    const apiBaseUrl = resolveApiBaseUrl();

    const [games, setGames] = useState<RshogiGameSummary[]>([]);
    const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [searchForm, setSearchForm] = useState<SearchFormValues>(EMPTY_SEARCH_FORM);
    const [appliedSearch, setAppliedSearch] = useState<FetchRshogiGameSearchOptions | null>(null);
    const [searchPage, setSearchPage] = useState<RshogiGameSearchPage | null>(null);
    const [isSearchLoading, setIsSearchLoading] = useState(false);
    const searchControllerRef = useRef<AbortController | null>(null);

    // 初回ロード
    useEffect(() => {
        const controller = new AbortController();
        setIsLoading(true);
        setErrorMessage(null);
        void (async () => {
            try {
                const page = await fetchRshogiGameList({
                    baseUrl: apiBaseUrl,
                    limit: PAGE_LIMIT,
                    signal: controller.signal,
                });
                if (controller.signal.aborted) return;
                setGames(page.games);
                setNextCursor(page.nextCursor);
            } catch (error) {
                if (controller.signal.aborted) return;
                setErrorMessage(
                    error instanceof Error
                        ? error.message
                        : `棋譜一覧の取得に失敗しました: ${String(error)}`,
                );
            } finally {
                if (!controller.signal.aborted) setIsLoading(false);
            }
        })();
        return () => {
            controller.abort();
            searchControllerRef.current?.abort();
        };
    }, [apiBaseUrl]);

    const handleLoadMore = async (): Promise<void> => {
        if (!nextCursor || isLoading) return;
        setIsLoading(true);
        setErrorMessage(null);
        try {
            const page = await fetchRshogiGameList({
                baseUrl: apiBaseUrl,
                cursor: nextCursor,
                limit: PAGE_LIMIT,
            });
            // append (新→旧で連結)
            setGames((prev) => [...prev, ...page.games]);
            setNextCursor(page.nextCursor);
        } catch (error) {
            setErrorMessage(
                error instanceof Error
                    ? error.message
                    : `棋譜一覧の取得に失敗しました: ${String(error)}`,
            );
        } finally {
            setIsLoading(false);
        }
    };

    const handleSelect = (gameId: string): void => {
        void navigate({ to: "/rshogi-viewer/$gameId", params: { gameId } });
    };

    const runSearch = async (
        conditions: FetchRshogiGameSearchOptions,
        page: number,
    ): Promise<void> => {
        searchControllerRef.current?.abort();
        const controller = new AbortController();
        searchControllerRef.current = controller;
        setIsSearchLoading(true);
        setErrorMessage(null);
        try {
            const result = await fetchRshogiGameSearch({
                ...conditions,
                baseUrl: apiBaseUrl,
                page,
                pageSize: SEARCH_PAGE_SIZE,
                signal: controller.signal,
            });
            if (!controller.signal.aborted) setSearchPage(result);
        } catch (error) {
            if (controller.signal.aborted) return;
            setErrorMessage(
                error instanceof Error ? error.message : `棋譜検索に失敗しました: ${String(error)}`,
            );
        } finally {
            if (!controller.signal.aborted) setIsSearchLoading(false);
        }
    };

    const handleSearch = (event: FormEvent<HTMLFormElement>): void => {
        event.preventDefault();
        if (!hasSearchCondition(searchForm)) return;
        const conditions = toSearchOptions(searchForm);
        setAppliedSearch(conditions);
        setSearchPage(null);
        void runSearch(conditions, 1);
    };

    const handleClear = (): void => {
        searchControllerRef.current?.abort();
        searchControllerRef.current = null;
        setSearchForm(EMPTY_SEARCH_FORM);
        setAppliedSearch(null);
        setSearchPage(null);
        setIsSearchLoading(false);
        setErrorMessage(null);
    };

    const handleSearchPage = (page: number): void => {
        if (!appliedSearch || isSearchLoading) return;
        void runSearch(appliedSearch, page);
    };

    const isSearchMode = appliedSearch !== null;
    const displayedGames = isSearchMode ? (searchPage?.games ?? []) : games;
    const rangeStart =
        searchPage && searchPage.totalCount > 0
            ? (searchPage.page - 1) * searchPage.pageSize + 1
            : 0;
    const rangeEnd = searchPage
        ? Math.min(searchPage.page * searchPage.pageSize, searchPage.totalCount)
        : 0;

    return (
        <>
            <PageHeader
                items={[{ label: "ラム将棋", to: "/" }, { label: "rshogi viewer" }]}
                right={<HeaderNav />}
            />
            <PageContainer>
                <PageHeading
                    title="rshogi 棋譜一覧"
                    description="rshogi CSA サーバで終局した棋譜を新着順で表示します。クリックすると個別の viewer に遷移します。"
                >
                    <Link
                        to="/rshogi-viewer/live"
                        className="text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                    >
                        進行中の対局一覧へ →
                    </Link>
                </PageHeading>

                <form
                    onSubmit={handleSearch}
                    className="mb-4 rounded-lg border border-wafuu-border bg-wafuu-washi-warm p-4"
                    aria-label="棋譜検索"
                >
                    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
                        <label
                            htmlFor="rshogi-search-name"
                            className="flex flex-col gap-1 text-sm text-wafuu-sumi"
                        >
                            選手名
                            <Input
                                id="rshogi-search-name"
                                value={searchForm.name}
                                onChange={(event) =>
                                    setSearchForm({ ...searchForm, name: event.target.value })
                                }
                                placeholder="先手または後手"
                            />
                        </label>
                        <label
                            htmlFor="rshogi-search-result"
                            className="flex flex-col gap-1 text-sm text-wafuu-sumi"
                        >
                            結果
                            <select
                                id="rshogi-search-result"
                                value={searchForm.result}
                                onChange={(event) =>
                                    setSearchForm({
                                        ...searchForm,
                                        result: event.target.value as SearchFormValues["result"],
                                    })
                                }
                                className="h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground"
                            >
                                <option value="">すべて</option>
                                {RESULT_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>
                                        {option.label}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label
                            htmlFor="rshogi-search-from"
                            className="flex flex-col gap-1 text-sm text-wafuu-sumi"
                        >
                            終了日（開始）
                            <Input
                                id="rshogi-search-from"
                                type="date"
                                value={searchForm.from}
                                onChange={(event) =>
                                    setSearchForm({ ...searchForm, from: event.target.value })
                                }
                            />
                        </label>
                        <label
                            htmlFor="rshogi-search-to"
                            className="flex flex-col gap-1 text-sm text-wafuu-sumi"
                        >
                            終了日（終了）
                            <Input
                                id="rshogi-search-to"
                                type="date"
                                value={searchForm.to}
                                min={searchForm.from || undefined}
                                onChange={(event) =>
                                    setSearchForm({ ...searchForm, to: event.target.value })
                                }
                            />
                        </label>
                        <label
                            htmlFor="rshogi-search-source"
                            className="flex flex-col gap-1 text-sm text-wafuu-sumi"
                        >
                            source
                            <select
                                id="rshogi-search-source"
                                value={searchForm.source}
                                onChange={(event) =>
                                    setSearchForm({ ...searchForm, source: event.target.value })
                                }
                                className="h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground"
                            >
                                <option value="">すべて</option>
                                <option value="kifu">kifu</option>
                                <option value="floodgate">floodgate</option>
                            </select>
                        </label>
                    </div>
                    <div className="mt-3 flex flex-wrap justify-end gap-2">
                        <button
                            type="button"
                            onClick={handleClear}
                            disabled={!hasSearchCondition(searchForm) && !isSearchMode}
                            className="rounded-md border border-wafuu-border px-4 py-2 text-sm text-wafuu-sumi disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            クリア
                        </button>
                        <button
                            type="submit"
                            disabled={!hasSearchCondition(searchForm) || isSearchLoading}
                            className="rounded-md bg-wafuu-shu px-4 py-2 text-sm text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {isSearchLoading ? "検索中..." : "検索"}
                        </button>
                    </div>
                </form>

                {errorMessage && <StatusBanner variant="error">{errorMessage}</StatusBanner>}

                <RshogiCsaGameList
                    games={displayedGames}
                    onSelect={handleSelect}
                    onLoadMore={isSearchMode ? undefined : () => void handleLoadMore()}
                    isLoading={isSearchMode ? isSearchLoading : isLoading}
                    hasMore={!isSearchMode && nextCursor !== undefined}
                    emptyMessage={isSearchMode ? "検索条件に一致する棋譜はありません。" : undefined}
                />

                {isSearchMode && searchPage && (
                    <nav
                        className="mt-4 flex flex-wrap items-center justify-between gap-3"
                        aria-label="検索結果のページネーション"
                    >
                        <span className="text-sm text-muted-foreground">
                            {searchPage.totalCount}件中 {rangeStart}-{rangeEnd}件
                        </span>
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={() => handleSearchPage(searchPage.page - 1)}
                                disabled={searchPage.page <= 1 || isSearchLoading}
                                className="rounded-md border border-wafuu-border px-4 py-1.5 text-sm text-wafuu-sumi disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                前へ
                            </button>
                            <button
                                type="button"
                                onClick={() => handleSearchPage(searchPage.page + 1)}
                                disabled={rangeEnd >= searchPage.totalCount || isSearchLoading}
                                className="rounded-md border border-wafuu-border px-4 py-1.5 text-sm text-wafuu-sumi disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                次へ
                            </button>
                        </div>
                    </nav>
                )}
            </PageContainer>
        </>
    );
}
