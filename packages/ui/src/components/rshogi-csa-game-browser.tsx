/**
 * rshogi viewer の一覧画面本体 (進行中の対局 + 検索フォーム + 終局済み一覧)。
 *
 * Web / Desktop 共通。絞り込み条件 (`search`) は呼び出し側が持つ:
 * Web は URL のクエリ、Desktop はコンポーネントの state に置く。
 * フォームの「検索」・イベントタグ・「クリア」は `onSearchChange` で条件を渡すだけで、
 * 実際の検索は `search` が変わったときに走る。
 */

import type {
    FetchRshogiGameSearchOptions,
    RshogiGameEventSummary,
    RshogiGameResultKind,
    RshogiGameSearchPage,
    RshogiGameSummary,
} from "@shogi/match-client";
import {
    fetchRshogiGameEvents,
    fetchRshogiGameList,
    fetchRshogiGameSearch,
} from "@shogi/match-client";
import { type FormEvent, type ReactElement, useEffect, useRef, useState } from "react";
import { Input } from "./input";
import { NativeSelect } from "./native-select";
import { RshogiCsaGameList } from "./rshogi-csa-game-list";
import { RshogiCsaLiveGamesSection } from "./rshogi-csa-live-games-section";
import { RSHOGI_VENUE_FILTERS, type RshogiVenueFilterKind } from "./rshogi-csa-venue";

const PAGE_LIMIT = 50;
const SEARCH_PAGE_SIZE = 20;
const MAX_TEXT_LENGTH = 200;

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

/** 一覧の絞り込み条件。すべて省略可で、空なら新着順の一覧を出す。 */
export interface RshogiGameBrowserSearch {
    /** 対局場所。 */
    venue?: RshogiVenueFilterKind;
    /** イベント (完全一致)。 */
    event?: string;
    /** 対局者名 (部分一致)。 */
    name?: string;
    result?: RshogiGameResultKind;
    /** 終了日の下限 (`YYYY-MM-DD`)。 */
    from?: string;
    /** 終了日の上限 (`YYYY-MM-DD`)。 */
    to?: string;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const normalizeText = (value: unknown): string | undefined => {
    // URL のクエリは `?event=2026` のように数値として解釈されて届くことがある。
    const text =
        typeof value === "string" ? value : typeof value === "number" ? String(value) : undefined;
    const trimmed = text?.trim();
    if (!trimmed || trimmed.length > MAX_TEXT_LENGTH) return undefined;
    return trimmed;
};

const normalizeDate = (value: unknown): string | undefined => {
    if (typeof value !== "string" || !DATE_PATTERN.test(value)) return undefined;
    return Number.isNaN(new Date(`${value}T00:00:00`).getTime()) ? undefined : value;
};

/**
 * 外から来た値 (URL のクエリなど) を絞り込み条件に直す。
 * 不正な値・未知のキーは捨て、有効な条件だけを持つオブジェクトを返す。
 */
export function normalizeRshogiGameBrowserSearch(
    raw: Record<string, unknown>,
): RshogiGameBrowserSearch {
    const search: RshogiGameBrowserSearch = {};
    const venue = RSHOGI_VENUE_FILTERS.find((filter) => filter.kind === raw.venue)?.kind;
    if (venue) search.venue = venue;
    const event = normalizeText(raw.event);
    if (event) search.event = event;
    const name = normalizeText(raw.name);
    if (name) search.name = name;
    const result = RESULT_OPTIONS.find((option) => option.value === raw.result)?.value;
    if (result) search.result = result;
    const from = normalizeDate(raw.from);
    if (from) search.from = from;
    const to = normalizeDate(raw.to);
    if (to) search.to = to;
    return search;
}

interface SearchFormValues {
    name: string;
    result: "" | RshogiGameResultKind;
    from: string;
    to: string;
    venue: "" | RshogiVenueFilterKind;
    event: string;
}

const toFormValues = (search: RshogiGameBrowserSearch): SearchFormValues => ({
    name: search.name ?? "",
    result: search.result ?? "",
    from: search.from ?? "",
    to: search.to ?? "",
    venue: search.venue ?? "",
    event: search.event ?? "",
});

const hasSearchCondition = (search: RshogiGameBrowserSearch): boolean =>
    Object.keys(search).length > 0;

const dateStartMs = (value: string | undefined): number | undefined => {
    if (!value) return undefined;
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? undefined : date.getTime();
};

const dateEndMs = (value: string | undefined): number | undefined => {
    if (!value) return undefined;
    const [year, month, day] = value.split("-").map(Number);
    const nextDay = new Date(year, month - 1, day + 1);
    return Number.isNaN(nextDay.getTime()) ? undefined : nextDay.getTime() - 1;
};

const toSearchOptions = (search: RshogiGameBrowserSearch): FetchRshogiGameSearchOptions => ({
    name: search.name,
    result: search.result,
    // 対局場所は検索 API の `source` (複数はカンマ区切り) に直して送る。
    source: RSHOGI_VENUE_FILTERS.find((filter) => filter.kind === search.venue)?.sources,
    event: search.event,
    from: dateStartMs(search.from),
    to: dateEndMs(search.to),
});

/** 同じイベント名が複数の `source` にまたがる場合は件数を足して 1 つの選択肢にする。 */
const toEventOptions = (
    events: RshogiGameEventSummary[],
    selected: string,
): { event: string; label: string }[] => {
    const counts = new Map<string, number>();
    for (const entry of events) {
        counts.set(entry.event, (counts.get(entry.event) ?? 0) + entry.games);
    }
    const options = [...counts.entries()].map(([event, games]) => ({
        event,
        label: `${event}（${games}局）`,
    }));
    // イベント一覧に無い値 (一覧の取得失敗時や、リンクで直接指定された場合) も選択肢に出す。
    if (selected && !counts.has(selected)) options.unshift({ event: selected, label: selected });
    return options;
};

const describeError = (error: unknown, fallback: string): string =>
    error instanceof Error ? error.message : `${fallback}: ${String(error)}`;

export interface RshogiCsaGameBrowserProps {
    /** rshogi 配信 API のベース URL。空のときはモック fixture を使う。 */
    apiBaseUrl?: string;
    /** 現在の絞り込み条件。 */
    search: RshogiGameBrowserSearch;
    /** 絞り込み条件の変更要求。呼び出し側が `search` に反映する。 */
    onSearchChange: (search: RshogiGameBrowserSearch) => void;
    /** 終局済みの対局を選んだとき。 */
    onSelectGame: (gameId: string) => void;
    /** 進行中の対局を選んだとき。 */
    onSelectLiveGame: (gameId: string) => void;
}

export function RshogiCsaGameBrowser({
    apiBaseUrl,
    search,
    onSearchChange,
    onSelectGame,
    onSelectLiveGame,
}: RshogiCsaGameBrowserProps): ReactElement {
    const [games, setGames] = useState<RshogiGameSummary[]>([]);
    const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [searchForm, setSearchForm] = useState<SearchFormValues>(() => toFormValues(search));
    const [searchPage, setSearchPage] = useState<RshogiGameSearchPage | null>(null);
    const [isSearchLoading, setIsSearchLoading] = useState(false);
    const [events, setEvents] = useState<RshogiGameEventSummary[]>([]);
    const searchControllerRef = useRef<AbortController | null>(null);

    // 条件の中身が同じなら、呼び出し側がオブジェクトを作り直しても検索し直さない。
    const appliedSearch = normalizeRshogiGameBrowserSearch({ ...search });
    const searchKey = JSON.stringify(appliedSearch);
    const isSearchMode = hasSearchCondition(appliedSearch);

    // 新着順の一覧 (初回)
    useEffect(() => {
        const controller = new AbortController();
        setIsLoading(true);
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
                setErrorMessage(describeError(error, "棋譜一覧の取得に失敗しました"));
            } finally {
                if (!controller.signal.aborted) setIsLoading(false);
            }
        })();
        return () => {
            controller.abort();
        };
    }, [apiBaseUrl]);

    // イベントの選択肢。取得に失敗しても一覧と検索はそのまま使える。
    useEffect(() => {
        const controller = new AbortController();
        void (async () => {
            try {
                const list = await fetchRshogiGameEvents({
                    baseUrl: apiBaseUrl,
                    signal: controller.signal,
                });
                if (!controller.signal.aborted) setEvents(list);
            } catch {
                if (!controller.signal.aborted) setEvents([]);
            }
        })();
        return () => {
            controller.abort();
        };
    }, [apiBaseUrl]);

    const runSearch = async (conditions: RshogiGameBrowserSearch, page: number): Promise<void> => {
        searchControllerRef.current?.abort();
        const controller = new AbortController();
        searchControllerRef.current = controller;
        setIsSearchLoading(true);
        setErrorMessage(null);
        try {
            const result = await fetchRshogiGameSearch({
                ...toSearchOptions(conditions),
                baseUrl: apiBaseUrl,
                page,
                pageSize: SEARCH_PAGE_SIZE,
                signal: controller.signal,
            });
            if (!controller.signal.aborted) setSearchPage(result);
        } catch (error) {
            if (controller.signal.aborted) return;
            setErrorMessage(describeError(error, "棋譜検索に失敗しました"));
        } finally {
            if (!controller.signal.aborted) setIsSearchLoading(false);
        }
    };

    // 絞り込み条件が変わったらフォームを合わせ、1 ページ目から検索し直す。
    // biome-ignore lint/correctness/useExhaustiveDependencies: 条件は中身 (searchKey) で比較する。runSearch は毎レンダー作り直されるので依存に入れない。
    useEffect(() => {
        const conditions = normalizeRshogiGameBrowserSearch(
            JSON.parse(searchKey) as Record<string, unknown>,
        );
        setSearchForm(toFormValues(conditions));
        setSearchPage(null);
        if (hasSearchCondition(conditions)) {
            void runSearch(conditions, 1);
        } else {
            setIsSearchLoading(false);
        }
        return () => {
            searchControllerRef.current?.abort();
            searchControllerRef.current = null;
        };
    }, [searchKey, apiBaseUrl]);

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
            setErrorMessage(describeError(error, "棋譜一覧の取得に失敗しました"));
        } finally {
            setIsLoading(false);
        }
    };

    const formSearch = normalizeRshogiGameBrowserSearch({ ...searchForm });
    const formHasCondition = hasSearchCondition(formSearch);

    const handleSearch = (event: FormEvent<HTMLFormElement>): void => {
        event.preventDefault();
        if (!formHasCondition) return;
        if (JSON.stringify(formSearch) === searchKey) {
            // 条件が同じままの再検索 (エラー後のやり直しなど)。
            void runSearch(formSearch, 1);
            return;
        }
        onSearchChange(formSearch);
    };

    const handleClear = (): void => {
        setSearchForm(toFormValues({}));
        setErrorMessage(null);
        if (isSearchMode) onSearchChange({});
    };

    const handleSelectEvent = (event: string): void => {
        onSearchChange({ event });
    };

    const handleSearchPage = (page: number): void => {
        if (!isSearchMode || isSearchLoading) return;
        void runSearch(appliedSearch, page);
    };

    const displayedGames = isSearchMode ? (searchPage?.games ?? []) : games;
    const rangeStart =
        searchPage && searchPage.totalCount > 0
            ? (searchPage.page - 1) * searchPage.pageSize + 1
            : 0;
    const rangeEnd = searchPage
        ? Math.min(searchPage.page * searchPage.pageSize, searchPage.totalCount)
        : 0;
    const eventOptions = toEventOptions(events, searchForm.event);

    return (
        <div className="flex flex-col gap-4">
            <RshogiCsaLiveGamesSection apiBaseUrl={apiBaseUrl} onSelectGame={onSelectLiveGame} />

            <section
                aria-labelledby="rshogi-finished-games-heading"
                className="flex flex-col gap-3"
            >
                <h2
                    id="rshogi-finished-games-heading"
                    className="text-base font-semibold text-wafuu-sumi"
                >
                    終局済みの棋譜
                </h2>

                <form
                    onSubmit={handleSearch}
                    className="rounded-lg border border-wafuu-border bg-wafuu-washi-warm p-4"
                    aria-label="棋譜検索"
                >
                    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                        <label
                            htmlFor="rshogi-search-venue"
                            className="flex flex-col gap-1 text-sm text-wafuu-sumi"
                        >
                            対局場所
                            <NativeSelect
                                id="rshogi-search-venue"
                                value={searchForm.venue}
                                onChange={(event) =>
                                    setSearchForm({
                                        ...searchForm,
                                        venue: event.target.value as SearchFormValues["venue"],
                                    })
                                }
                                className="h-10 text-sm"
                            >
                                <option value="">すべて</option>
                                {RSHOGI_VENUE_FILTERS.map((filter) => (
                                    <option key={filter.kind} value={filter.kind}>
                                        {filter.label}
                                    </option>
                                ))}
                            </NativeSelect>
                        </label>
                        <label
                            htmlFor="rshogi-search-event"
                            className="flex flex-col gap-1 text-sm text-wafuu-sumi"
                        >
                            イベント
                            <NativeSelect
                                id="rshogi-search-event"
                                value={searchForm.event}
                                onChange={(event) =>
                                    setSearchForm({ ...searchForm, event: event.target.value })
                                }
                                className="h-10 text-sm"
                            >
                                <option value="">すべて</option>
                                {eventOptions.map((option) => (
                                    <option key={option.event} value={option.event}>
                                        {option.label}
                                    </option>
                                ))}
                            </NativeSelect>
                        </label>
                        <label
                            htmlFor="rshogi-search-name"
                            className="flex flex-col gap-1 text-sm text-wafuu-sumi"
                        >
                            名前
                            <Input
                                id="rshogi-search-name"
                                value={searchForm.name}
                                maxLength={MAX_TEXT_LENGTH}
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
                            <NativeSelect
                                id="rshogi-search-result"
                                value={searchForm.result}
                                onChange={(event) =>
                                    setSearchForm({
                                        ...searchForm,
                                        result: event.target.value as SearchFormValues["result"],
                                    })
                                }
                                className="h-10 text-sm"
                            >
                                <option value="">すべて</option>
                                {RESULT_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>
                                        {option.label}
                                    </option>
                                ))}
                            </NativeSelect>
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
                    </div>
                    <div className="mt-3 flex flex-wrap justify-end gap-2">
                        <button
                            type="button"
                            onClick={handleClear}
                            disabled={!formHasCondition && !isSearchMode}
                            className="rounded-md border border-wafuu-border px-4 py-2 text-sm text-wafuu-sumi disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            クリア
                        </button>
                        <button
                            type="submit"
                            disabled={!formHasCondition || isSearchLoading}
                            className="rounded-md bg-wafuu-shu px-4 py-2 text-sm text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {isSearchLoading ? "検索中..." : "検索"}
                        </button>
                    </div>
                </form>

                {errorMessage && (
                    <div
                        role="alert"
                        className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
                    >
                        {errorMessage}
                    </div>
                )}

                <RshogiCsaGameList
                    games={displayedGames}
                    onSelect={onSelectGame}
                    onSelectEvent={handleSelectEvent}
                    onLoadMore={isSearchMode ? undefined : () => void handleLoadMore()}
                    isLoading={isSearchMode ? isSearchLoading : isLoading}
                    hasMore={!isSearchMode && nextCursor !== undefined}
                    emptyMessage={isSearchMode ? "検索条件に一致する棋譜はありません。" : undefined}
                />

                {isSearchMode && searchPage && (
                    <nav
                        className="flex flex-wrap items-center justify-between gap-3"
                        aria-label="検索結果のページネーション"
                    >
                        <span className="text-sm text-muted-foreground" aria-live="polite">
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
            </section>
        </div>
    );
}
