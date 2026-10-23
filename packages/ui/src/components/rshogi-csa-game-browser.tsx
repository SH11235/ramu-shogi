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
import { findRshogiEventMeta, RshogiEventMetaLine } from "./rshogi-csa-event-meta";
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

/**
 * 同じイベント名が複数の `source` にまたがる場合は件数を足して 1 つの選択肢にする。
 * メタデータがあるイベントは正式名称をラベルにする（値はタグのまま）。
 */
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
        label: `${findRshogiEventMeta(events, event)?.title ?? event}（${games}局）`,
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
    /** 進行中の対局を選んだとき。省くと、進行中の対局の欄を出さない（終局済みの棋譜だけを選ぶ画面）。 */
    onSelectLiveGame?: (gameId: string) => void;
}

/** 「詳細条件」に入る欄 (イベント・結果・終了日) のうち、値が入っている数。 */
function countDetailConditions(search: RshogiGameBrowserSearch): number {
    return [search.event, search.result, search.from, search.to].filter(
        (value) => value !== undefined && value !== "",
    ).length;
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
    /** イベント・結果・終了日の欄を開いているか。条件が入っている間は開いて始める。 */
    const [isDetailOpen, setIsDetailOpen] = useState<boolean>(
        () => countDetailConditions(search) > 0,
    );
    /** 終了日の範囲が逆のまま検索を押したか。押すまでは、入力の途中でメッセージを出さない。 */
    const [showDateRangeError, setShowDateRangeError] = useState(false);
    const searchControllerRef = useRef<AbortController | null>(null);
    const loadMoreControllerRef = useRef<AbortController | null>(null);
    /** 新着順の一覧をどの接続先について取得済みか。 */
    const recentListRef = useRef<{ baseUrl: string | undefined; done: boolean }>({
        baseUrl: undefined,
        done: false,
    });

    // 条件の中身が同じなら、呼び出し側がオブジェクトを作り直しても検索し直さない。
    const appliedSearch = normalizeRshogiGameBrowserSearch({ ...search });
    const searchKey = JSON.stringify(appliedSearch);
    const isSearchMode = hasSearchCondition(appliedSearch);

    // 新着順の一覧。検索モードのあいだは使わないので取得しない (検索結果の画面に、裏で
    // 走った新着一覧の取得失敗が出ることも無くなる)。検索をやめたときに未取得なら取得する。
    useEffect(() => {
        if (isSearchMode) return;
        const loaded = recentListRef.current;
        if (loaded.done && loaded.baseUrl === apiBaseUrl) return;
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
                recentListRef.current = { baseUrl: apiBaseUrl, done: true };
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
            // 検索モードに入った・接続先が変わった・画面を離れたときは、進行中の取得
            // (追加読み込みを含む) を捨てて、後から届いた結果やエラーで状態を上書きしない。
            controller.abort();
            loadMoreControllerRef.current?.abort();
            loadMoreControllerRef.current = null;
        };
    }, [apiBaseUrl, isSearchMode]);

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
        // リンクやイベントタグで詳細条件が入ったら、何で絞っているかが見えるように開く。
        if (countDetailConditions(conditions) > 0) setIsDetailOpen(true);
        setSearchPage(null);
        if (hasSearchCondition(conditions)) {
            void runSearch(conditions, 1);
        } else {
            setIsSearchLoading(false);
            // 検索をやめたら、検索のエラーを新着順の一覧に持ち越さない。
            setErrorMessage(null);
        }
        return () => {
            searchControllerRef.current?.abort();
            searchControllerRef.current = null;
        };
    }, [searchKey, apiBaseUrl]);

    const handleLoadMore = async (): Promise<void> => {
        if (!nextCursor || isLoading || isSearchMode) return;
        const controller = new AbortController();
        loadMoreControllerRef.current = controller;
        setIsLoading(true);
        setErrorMessage(null);
        try {
            const page = await fetchRshogiGameList({
                baseUrl: apiBaseUrl,
                cursor: nextCursor,
                limit: PAGE_LIMIT,
                signal: controller.signal,
            });
            if (controller.signal.aborted) return;
            // append (新→旧で連結)
            setGames((prev) => [...prev, ...page.games]);
            setNextCursor(page.nextCursor);
        } catch (error) {
            if (controller.signal.aborted) return;
            setErrorMessage(describeError(error, "棋譜一覧の取得に失敗しました"));
        } finally {
            if (!controller.signal.aborted) setIsLoading(false);
            if (loadMoreControllerRef.current === controller) loadMoreControllerRef.current = null;
        }
    };

    const formSearch = normalizeRshogiGameBrowserSearch({ ...searchForm });
    const formHasCondition = hasSearchCondition(formSearch);

    // 終了日の範囲が逆（開始 > 終了）。日付は YYYY-MM-DD なので文字列のまま比べられる。
    const isDateRangeReversed =
        searchForm.from !== "" && searchForm.to !== "" && searchForm.from > searchForm.to;

    const handleSearch = (event: FormEvent<HTMLFormElement>): void => {
        event.preventDefault();
        if (isDateRangeReversed) {
            // 詳細条件を畳んだままだと、どの欄が悪いのか分からない。開いて欄のそばに理由を出す。
            setIsDetailOpen(true);
            setShowDateRangeError(true);
            return;
        }
        if (!formHasCondition) return;
        if (JSON.stringify(formSearch) === searchKey) {
            // 条件が同じままの再検索 (エラー後のやり直しなど)。
            void runSearch(formSearch, 1);
            return;
        }
        onSearchChange(formSearch);
    };

    // 範囲を直したら、検索を押し直さなくてもメッセージは消える。
    const dateRangeErrorVisible = showDateRangeError && isDateRangeReversed;

    const handleClear = (): void => {
        setSearchForm(toFormValues({}));
        setShowDateRangeError(false);
        setErrorMessage(null);
        if (isSearchMode) onSearchChange({});
    };

    const handleSelectEvent = (event: string): void => {
        // タグは「そのイベントの一覧へ飛ぶ」操作。入力中・適用中の他の条件 (対局場所・名前・
        // 結果・日付) は引き継がず、イベントだけの絞り込みにする。条件を重ねたいときは
        // フォームでイベントを選んで検索する。
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
    const detailCount = countDetailConditions(formSearch);
    // イベントで絞り込んでいるときに一覧の上へ出す、そのイベントの正式名称とリンク。
    const appliedEventMeta = findRshogiEventMeta(events, appliedSearch.event);

    return (
        <div className="flex flex-col gap-4">
            {onSelectLiveGame && (
                <RshogiCsaLiveGamesSection
                    apiBaseUrl={apiBaseUrl}
                    onSelectGame={onSelectLiveGame}
                />
            )}

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

                {/*
                    ブラウザの標準の入力検証は使わない (noValidate)。詳細条件を畳んでいると、
                    非表示の欄の検証に失敗しても何も表示されず、検索できない理由が分からない。
                    検証は handleSearch で行う。
                */}
                <form
                    onSubmit={handleSearch}
                    noValidate
                    className="flex flex-col gap-2"
                    aria-label="棋譜検索"
                >
                    <div className="flex flex-wrap items-center gap-2">
                        <NativeSelect
                            aria-label="対局場所"
                            value={searchForm.venue}
                            onChange={(event) =>
                                setSearchForm({
                                    ...searchForm,
                                    venue: event.target.value as SearchFormValues["venue"],
                                })
                            }
                            className="h-9 w-auto text-sm"
                        >
                            <option value="">対局場所: すべて</option>
                            {RSHOGI_VENUE_FILTERS.map((filter) => (
                                <option key={filter.kind} value={filter.kind}>
                                    {filter.label}
                                </option>
                            ))}
                        </NativeSelect>
                        <Input
                            aria-label="名前"
                            value={searchForm.name}
                            maxLength={MAX_TEXT_LENGTH}
                            onChange={(event) =>
                                setSearchForm({ ...searchForm, name: event.target.value })
                            }
                            placeholder="対局者名"
                            className="h-9 min-w-32 flex-1 text-sm sm:max-w-64"
                        />
                        <button
                            type="button"
                            onClick={() => setIsDetailOpen(!isDetailOpen)}
                            aria-expanded={isDetailOpen}
                            aria-controls="rshogi-search-detail"
                            className="h-9 rounded-md border border-wafuu-border px-3 text-sm text-wafuu-sumi"
                        >
                            詳細条件
                            {detailCount > 0 ? `（${detailCount}）` : ""}
                            <span aria-hidden="true">{isDetailOpen ? " ▴" : " ▾"}</span>
                        </button>
                        <button
                            type="submit"
                            disabled={!formHasCondition || isSearchLoading}
                            className="h-9 rounded-md bg-wafuu-shu px-4 text-sm text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {isSearchLoading ? "検索中..." : "検索"}
                        </button>
                        {(formHasCondition || isSearchMode) && (
                            <button
                                type="button"
                                onClick={handleClear}
                                className="h-9 rounded-md px-2 text-sm text-muted-foreground underline-offset-2 hover:underline"
                            >
                                クリア
                            </button>
                        )}
                    </div>
                    <div
                        id="rshogi-search-detail"
                        hidden={!isDetailOpen}
                        className={
                            isDetailOpen
                                ? "grid gap-2 rounded-lg border border-wafuu-border bg-wafuu-washi-warm p-3 sm:grid-cols-2 lg:grid-cols-4"
                                : undefined
                        }
                    >
                        <label
                            htmlFor="rshogi-search-event"
                            className="flex flex-col gap-1 text-xs text-wafuu-sumi"
                        >
                            イベント
                            <NativeSelect
                                id="rshogi-search-event"
                                value={searchForm.event}
                                onChange={(event) =>
                                    setSearchForm({ ...searchForm, event: event.target.value })
                                }
                                className="h-9 text-sm"
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
                            htmlFor="rshogi-search-result"
                            className="flex flex-col gap-1 text-xs text-wafuu-sumi"
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
                                className="h-9 text-sm"
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
                            className="flex flex-col gap-1 text-xs text-wafuu-sumi"
                        >
                            終了日（開始）
                            <Input
                                id="rshogi-search-from"
                                type="date"
                                value={searchForm.from}
                                onChange={(event) =>
                                    setSearchForm({ ...searchForm, from: event.target.value })
                                }
                                className="h-9 text-sm"
                            />
                        </label>
                        <label
                            htmlFor="rshogi-search-to"
                            className="flex flex-col gap-1 text-xs text-wafuu-sumi"
                        >
                            終了日（終了）
                            <Input
                                id="rshogi-search-to"
                                type="date"
                                value={searchForm.to}
                                min={searchForm.from || undefined}
                                aria-invalid={dateRangeErrorVisible || undefined}
                                aria-describedby={
                                    dateRangeErrorVisible ? "rshogi-search-date-error" : undefined
                                }
                                onChange={(event) =>
                                    setSearchForm({ ...searchForm, to: event.target.value })
                                }
                                className="h-9 text-sm"
                            />
                        </label>
                        {dateRangeErrorVisible && (
                            <p
                                id="rshogi-search-date-error"
                                role="alert"
                                className="col-span-full text-xs text-destructive"
                            >
                                終了日の範囲が逆です。
                            </p>
                        )}
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

                {appliedEventMeta && <RshogiEventMetaLine meta={appliedEventMeta} />}

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
