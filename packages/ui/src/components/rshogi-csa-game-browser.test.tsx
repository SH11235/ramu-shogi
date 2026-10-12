import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { type ReactElement, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RshogiGameBrowserSearch } from "./rshogi-csa-game-browser";

const fetchRshogiGameList = vi.fn();
const fetchRshogiGameSearch = vi.fn();
const fetchRshogiGameEvents = vi.fn();
const fetchRshogiLiveGameList = vi.fn();

vi.mock("@shogi/match-client", () => ({
    fetchRshogiGameList,
    fetchRshogiGameSearch,
    fetchRshogiGameEvents,
    fetchRshogiLiveGameList,
}));

const { RshogiCsaGameBrowser, normalizeRshogiGameBrowserSearch } = await import(
    "./rshogi-csa-game-browser"
);

const game = (gameId: string, extra: Record<string, unknown> = {}) => ({
    gameId,
    senteName: `${gameId}-sente`,
    goteName: `${gameId}-gote`,
    ...extra,
});

const onSelectGame = vi.fn();
const onSelectLiveGame = vi.fn();
const onSearchChange = vi.fn();

/** Web の URL クエリ / Desktop の state と同じく、条件を保持して渡し直す呼び出し側。 */
function Harness({ initial = {} }: { initial?: RshogiGameBrowserSearch }): ReactElement {
    const [search, setSearch] = useState<RshogiGameBrowserSearch>(initial);
    return (
        <RshogiCsaGameBrowser
            apiBaseUrl="https://example.test/rshogi"
            search={search}
            onSearchChange={(next) => {
                onSearchChange(next);
                setSearch(next);
            }}
            onSelectGame={onSelectGame}
            onSelectLiveGame={onSelectLiveGame}
        />
    );
}

const gameIds = (): string[] =>
    within(screen.getByRole("list", { name: "rshogi 棋譜一覧" }))
        .getAllByRole("listitem")
        .map((item) => item.querySelector(".font-mono")?.textContent ?? "");

describe("RshogiCsaGameBrowser", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        fetchRshogiGameList.mockResolvedValue({
            games: [game("recent-1", { source: "kifu" })],
            nextCursor: "cursor-2",
        });
        fetchRshogiGameSearch.mockResolvedValue({
            games: [game("search-1", { source: "wdoor", event: "floodgate-300-10F" })],
            page: 1,
            pageSize: 20,
            totalCount: 23,
        });
        fetchRshogiGameEvents.mockResolvedValue([
            { event: "WCSC36", source: "upload", games: 120 },
            { event: "floodgate-300-10F", source: "wdoor", games: 40 },
            { event: "floodgate-300-10F", source: "upload", games: 2 },
        ]);
        fetchRshogiLiveGameList.mockResolvedValue({ liveGames: [] });
    });

    describe("進行中の対局と終局済み一覧の統合", () => {
        it("進行中の対局を終局済み一覧の上に出し、それぞれ別の遷移先へ渡す", async () => {
            fetchRshogiLiveGameList.mockResolvedValue({
                liveGames: [game("live-1", { source: "kifu" })],
            });

            render(<Harness />);

            const liveHeading = await screen.findByRole("heading", { name: "進行中の対局" });
            const finishedHeading = screen.getByRole("heading", { name: "終局済みの棋譜" });
            expect(
                liveHeading.compareDocumentPosition(finishedHeading) &
                    Node.DOCUMENT_POSITION_FOLLOWING,
            ).toBeTruthy();

            const liveRow = screen.getByText("☗ live-1-sente vs ☖ live-1-gote").closest("button");
            if (liveRow) fireEvent.click(liveRow);
            expect(onSelectLiveGame).toHaveBeenCalledWith("live-1");
            expect(onSelectGame).not.toHaveBeenCalled();

            const row = (await screen.findByText("☗ recent-1-sente vs ☖ recent-1-gote")).closest(
                "button",
            );
            if (row) fireEvent.click(row);
            expect(onSelectGame).toHaveBeenCalledWith("recent-1");
        });

        it("進行中の対局が 0 件ならセクションを出さず、終局済み一覧はそのまま出す", async () => {
            render(<Harness />);

            await screen.findByText("☗ recent-1-sente vs ☖ recent-1-gote");
            expect(screen.queryByRole("heading", { name: "進行中の対局" })).toBeNull();
            expect(screen.getByRole("heading", { name: "終局済みの棋譜" })).toBeTruthy();
        });

        it("進行中一覧の取得に失敗しても終局済み一覧は表示し、エラーも出さない", async () => {
            fetchRshogiLiveGameList.mockRejectedValue(new Error("live API down"));

            render(<Harness />);

            await screen.findByText("☗ recent-1-sente vs ☖ recent-1-gote");
            expect(screen.queryByRole("heading", { name: "進行中の対局" })).toBeNull();
            expect(screen.queryByText("live API down")).toBeNull();
            expect(screen.queryByRole("alert")).toBeNull();
        });
    });

    describe("対局場所フィルタ", () => {
        it("選択肢は「すべて / rshogi サーバー / Floodgate / その他」", async () => {
            render(<Harness />);
            await screen.findByText("もっと読み込む");

            const select = screen.getByLabelText("対局場所") as HTMLSelectElement;
            expect([...select.options].map((option) => option.textContent)).toEqual([
                "対局場所: すべて",
                "rshogi サーバー",
                "Floodgate",
                "その他",
            ]);
        });

        it.each([
            ["rshogi", ["kifu", "floodgate"]],
            ["floodgate", ["wdoor"]],
            ["other", ["upload"]],
        ])("対局場所 %s を選ぶと検索 API に source=%j を渡す", async (venue, sources) => {
            render(<Harness />);
            await screen.findByText("もっと読み込む");

            fireEvent.change(screen.getByLabelText("対局場所"), { target: { value: venue } });
            fireEvent.click(screen.getByRole("button", { name: "検索" }));

            await waitFor(() => expect(fetchRshogiGameSearch).toHaveBeenCalledTimes(1));
            expect(fetchRshogiGameSearch).toHaveBeenCalledWith(
                expect.objectContaining({ source: sources, page: 1, pageSize: 20 }),
            );
            expect(onSearchChange).toHaveBeenCalledWith({ venue });
        });
    });

    describe("イベントタグ", () => {
        it("イベントの選択肢を件数つきで出し、同名のイベントは件数を合算する", async () => {
            render(<Harness />);

            await waitFor(() => {
                const select = screen.getByLabelText("イベント") as HTMLSelectElement;
                expect([...select.options].map((option) => option.textContent)).toEqual([
                    "すべて",
                    "WCSC36（120局）",
                    "floodgate-300-10F（42局）",
                ]);
            });
        });

        it("イベントを選んで検索すると event を完全一致で渡す", async () => {
            render(<Harness />);
            await screen.findByText("WCSC36（120局）");

            fireEvent.change(screen.getByLabelText("イベント"), { target: { value: "WCSC36" } });
            fireEvent.click(screen.getByRole("button", { name: "検索" }));

            await waitFor(() => expect(fetchRshogiGameSearch).toHaveBeenCalledTimes(1));
            expect(fetchRshogiGameSearch).toHaveBeenCalledWith(
                expect.objectContaining({ event: "WCSC36", source: undefined }),
            );
            expect(onSearchChange).toHaveBeenCalledWith({ event: "WCSC36" });
        });

        it("カードのタグを押すとそのイベントで絞り込み、単局ページへは進まない", async () => {
            fetchRshogiGameList.mockResolvedValue({
                games: [game("tagged-1", { source: "upload", event: "WCSC36" })],
            });
            render(<Harness />);

            const tag = await screen.findByRole("button", {
                name: "イベント「WCSC36」で絞り込む",
            });
            fireEvent.click(tag);

            expect(onSearchChange).toHaveBeenCalledWith({ event: "WCSC36" });
            expect(onSelectGame).not.toHaveBeenCalled();
            await waitFor(() =>
                expect(fetchRshogiGameSearch).toHaveBeenCalledWith(
                    expect.objectContaining({ event: "WCSC36" }),
                ),
            );
            expect((screen.getByLabelText("イベント") as HTMLSelectElement).value).toBe("WCSC36");
        });

        it("イベント一覧の取得に失敗しても一覧と検索は使える", async () => {
            fetchRshogiGameEvents.mockRejectedValue(new Error("events API down"));

            render(<Harness initial={{ event: "WCSC36" }} />);

            await screen.findByText("23件中 1-20件");
            expect(screen.queryByText("events API down")).toBeNull();
            expect(screen.queryByRole("alert")).toBeNull();
            // 一覧に無いイベントでも、今の条件は選択肢として見える。
            const select = screen.getByLabelText("イベント") as HTMLSelectElement;
            expect(select.value).toBe("WCSC36");
            expect(fetchRshogiGameSearch).toHaveBeenCalledWith(
                expect.objectContaining({ event: "WCSC36" }),
            );
        });
    });

    describe("大会（イベント）のメタデータ", () => {
        const WCSC_META = {
            title: "第36回世界コンピュータ将棋選手権",
            organizer: "コンピュータ将棋協会",
            officialUrl: "https://example.org/wcsc36/",
            kifuSourceUrl: "https://example.org/wcsc36/kifu/",
            termsNote: "対局プログラム名と対局日時、大会名を明記",
        };
        const eventsWithMeta = [
            { event: "WCSC36", source: "upload", games: 120, meta: WCSC_META },
            { event: "floodgate-300-10F", source: "wdoor", games: 40 },
            { event: "floodgate-300-10F", source: "upload", games: 2 },
        ];
        const metaLine = () => screen.queryByTestId("rshogi-event-meta-line");

        it("イベントで絞り込んでいるとき、一覧の上に正式名称（主催）・公式ページ・棋譜の出典を 1 行で出す", async () => {
            fetchRshogiGameEvents.mockResolvedValue(eventsWithMeta);

            render(<Harness initial={{ event: "WCSC36" }} />);

            await screen.findByText("23件中 1-20件");
            const line = await screen.findByTestId("rshogi-event-meta-line");
            expect(line.textContent).toBe(
                "第36回世界コンピュータ将棋選手権（コンピュータ将棋協会）・大会の公式ページ ↗（新しいタブで開く）・棋譜の出典 ↗（新しいタブで開く）",
            );
            const official = within(line).getByRole("link", {
                name: /^大会の公式ページ\s*（新しいタブで開く）$/,
            });
            expect(official.getAttribute("href")).toBe(WCSC_META.officialUrl);
            expect(official.getAttribute("target")).toBe("_blank");
            expect(official.getAttribute("rel")).toBe("noopener noreferrer");
            const kifuSource = within(line).getByRole("link", {
                name: /^棋譜の出典\s*（新しいタブで開く）$/,
            });
            expect(kifuSource.getAttribute("href")).toBe(WCSC_META.kifuSourceUrl);
            expect(kifuSource.getAttribute("rel")).toBe("noopener noreferrer");
            // 一覧の上に置く
            const list = screen.getByRole("list", { name: "rshogi 棋譜一覧" });
            expect(
                line.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING,
            ).toBeTruthy();
            // 利用条件のメモは出さない
            expect(screen.queryByText(/大会名を明記/)).toBeNull();
        });

        it("イベント情報の行は見出し扱いで、背景や枠の付いたカードにしない", async () => {
            fetchRshogiGameEvents.mockResolvedValue(eventsWithMeta);

            render(<Harness initial={{ event: "WCSC36" }} />);

            const line = await screen.findByTestId("rshogi-event-meta-line");
            expect(line.className).not.toMatch(/(^|\s)(bg-|border|rounded|shadow)/);
        });

        it("イベントで絞り込んでいないとき・メタの無いイベントで絞り込んだときは、行を出さない", async () => {
            fetchRshogiGameEvents.mockResolvedValue(eventsWithMeta);

            const first = render(<Harness />);
            await screen.findByText("☗ recent-1-sente vs ☖ recent-1-gote");
            await waitFor(() => expect(fetchRshogiGameEvents).toHaveBeenCalled());
            expect(metaLine()).toBeNull();
            first.unmount();

            render(<Harness initial={{ event: "floodgate-300-10F" }} />);
            await screen.findByText("23件中 1-20件");
            await screen.findByRole("option", { name: /第36回世界コンピュータ将棋選手権/ });
            expect(metaLine()).toBeNull();
        });

        it("メタに対応していない古いサーバーでは、これまでと同じ表示になる", async () => {
            render(<Harness initial={{ event: "WCSC36" }} />);

            await screen.findByText("23件中 1-20件");
            await screen.findByRole("option", { name: "WCSC36（120局）" });
            expect(metaLine()).toBeNull();
            expect(screen.queryByRole("link")).toBeNull();
        });

        it("イベント一覧の取得に失敗したときは、行を出さず、一覧はそのまま使える", async () => {
            fetchRshogiGameEvents.mockRejectedValue(new Error("events API down"));

            render(<Harness initial={{ event: "WCSC36" }} />);

            await screen.findByText("23件中 1-20件");
            expect(metaLine()).toBeNull();
            expect(screen.queryByRole("alert")).toBeNull();
        });

        it("詳細条件のイベントの選択肢は正式名称をラベルにし、値はタグのままにする", async () => {
            fetchRshogiGameEvents.mockResolvedValue(eventsWithMeta);

            render(<Harness initial={{ event: "WCSC36" }} />);

            const option = (await screen.findByRole("option", {
                name: "第36回世界コンピュータ将棋選手権（120局）",
            })) as HTMLOptionElement;
            expect(option.value).toBe("WCSC36");
            // メタの無いイベントはタグのまま
            const plain = screen.getByRole("option", {
                name: "floodgate-300-10F（42局）",
            }) as HTMLOptionElement;
            expect(plain.value).toBe("floodgate-300-10F");
        });

        it("カードのイベントタグは短いタグのままにする", async () => {
            fetchRshogiGameEvents.mockResolvedValue(eventsWithMeta);
            fetchRshogiGameSearch.mockResolvedValue({
                games: [game("search-1", { source: "upload", event: "WCSC36" })],
                page: 1,
                pageSize: 20,
                totalCount: 1,
            });

            render(<Harness initial={{ event: "WCSC36" }} />);

            await screen.findByTestId("rshogi-event-meta-line");
            const list = screen.getByRole("list", { name: "rshogi 棋譜一覧" });
            expect(
                within(list).getByRole("button", { name: "イベント「WCSC36」で絞り込む" })
                    .textContent,
            ).toBe("WCSC36");
            expect(within(list).queryByText(/第36回/)).toBeNull();
        });
    });

    describe("外から渡された条件 (URL のクエリなど)", () => {
        it("最初から条件があれば検索結果を出し、フォームにも反映する", async () => {
            render(<Harness initial={{ venue: "floodgate", event: "floodgate-300-10F" }} />);

            await screen.findByText("23件中 1-20件");
            expect(fetchRshogiGameSearch).toHaveBeenCalledWith(
                expect.objectContaining({
                    source: ["wdoor"],
                    event: "floodgate-300-10F",
                    page: 1,
                }),
            );
            expect((screen.getByLabelText("対局場所") as HTMLSelectElement).value).toBe(
                "floodgate",
            );
            expect(gameIds()).toEqual(["search-1"]);
            expect(screen.queryByText("もっと読み込む")).toBeNull();
        });

        it("日付の条件は終了日の範囲 (ms) に直して渡す", async () => {
            render(<Harness initial={{ from: "2026-10-01", to: "2026-10-02" }} />);

            await waitFor(() => expect(fetchRshogiGameSearch).toHaveBeenCalledTimes(1));
            expect(fetchRshogiGameSearch).toHaveBeenCalledWith(
                expect.objectContaining({
                    from: new Date(2026, 9, 1).getTime(),
                    to: new Date(2026, 9, 3).getTime() - 1,
                }),
            );
        });
    });

    describe("終了日の範囲が逆のとき", () => {
        const fillReversedRange = () => {
            fireEvent.change(screen.getByLabelText("終了日（開始）"), {
                target: { value: "2026-10-05" },
            });
            fireEvent.change(screen.getByLabelText("終了日（終了）"), {
                target: { value: "2026-10-01" },
            });
        };
        const detailToggle = () => screen.getByRole("button", { name: /詳細条件/ });
        const detailPanel = () => document.getElementById("rshogi-search-detail") as HTMLElement;

        it("詳細条件を畳んだまま検索を押すと、検索せずに詳細条件を開いて理由を出す", async () => {
            render(<Harness />);
            await screen.findByText("もっと読み込む");

            fireEvent.click(detailToggle());
            fillReversedRange();
            fireEvent.click(detailToggle());
            expect(detailPanel().hidden).toBe(true);
            expect(screen.queryByText("終了日の範囲が逆です。")).toBeNull();

            fireEvent.click(screen.getByRole("button", { name: "検索" }));

            expect(detailPanel().hidden).toBe(false);
            expect(detailToggle().getAttribute("aria-expanded")).toBe("true");
            const alert = within(detailPanel()).getByRole("alert");
            expect(alert.textContent).toBe("終了日の範囲が逆です。");
            const to = screen.getByLabelText("終了日（終了）");
            expect(to.getAttribute("aria-invalid")).toBe("true");
            expect(to.getAttribute("aria-describedby")).toBe(alert.id);
            expect(onSearchChange).not.toHaveBeenCalled();
            expect(fetchRshogiGameSearch).not.toHaveBeenCalled();
        });

        it("ブラウザの標準の入力検証には任せない（非表示の欄で黙って止まらないように）", async () => {
            render(<Harness />);
            await screen.findByText("もっと読み込む");

            expect(screen.getByRole("form", { name: "棋譜検索" }).hasAttribute("novalidate")).toBe(
                true,
            );
        });

        it("範囲を直すとメッセージが消え、検索できる", async () => {
            render(<Harness />);
            await screen.findByText("もっと読み込む");
            fireEvent.click(detailToggle());
            fillReversedRange();
            fireEvent.click(screen.getByRole("button", { name: "検索" }));
            expect(screen.getByText("終了日の範囲が逆です。")).toBeTruthy();

            fireEvent.change(screen.getByLabelText("終了日（終了）"), {
                target: { value: "2026-10-06" },
            });
            expect(screen.queryByText("終了日の範囲が逆です。")).toBeNull();

            fireEvent.click(screen.getByRole("button", { name: "検索" }));
            expect(onSearchChange).toHaveBeenCalledWith(
                expect.objectContaining({ from: "2026-10-05", to: "2026-10-06" }),
            );
        });
    });

    describe("新着順の一覧と検索の切り分け", () => {
        it("検索条件つきで開いたときは新着順の一覧を取得しない", async () => {
            render(<Harness initial={{ event: "WCSC36" }} />);

            await screen.findByText("23件中 1-20件");
            expect(fetchRshogiGameSearch).toHaveBeenCalledTimes(1);
            expect(fetchRshogiGameList).not.toHaveBeenCalled();
        });

        it("検索をやめたときに、未取得なら新着順の一覧を取得する", async () => {
            render(<Harness initial={{ event: "WCSC36" }} />);
            await screen.findByText("23件中 1-20件");

            fireEvent.click(screen.getByRole("button", { name: "クリア" }));

            await waitFor(() => expect(fetchRshogiGameList).toHaveBeenCalledTimes(1));
            await waitFor(() => expect(gameIds()).toEqual(["recent-1"]));
            expect(screen.getByText("もっと読み込む")).toBeTruthy();
        });

        it("取得済みの新着順の一覧は、検索から戻っても取り直さない", async () => {
            render(<Harness />);
            await screen.findByText("もっと読み込む");

            fireEvent.change(screen.getByLabelText("名前"), { target: { value: "RAMU" } });
            fireEvent.click(screen.getByRole("button", { name: "検索" }));
            await screen.findByText("23件中 1-20件");
            fireEvent.click(screen.getByRole("button", { name: "クリア" }));

            await waitFor(() => expect(gameIds()).toEqual(["recent-1"]));
            expect(fetchRshogiGameList).toHaveBeenCalledTimes(1);
        });

        it("検索に入った後で新着順の一覧の取得が失敗しても、検索結果にエラーを出さない", async () => {
            let rejectRecent: (error: Error) => void = () => {};
            fetchRshogiGameList.mockImplementation(
                () =>
                    new Promise((_resolve, reject) => {
                        rejectRecent = reject;
                    }),
            );
            render(<Harness />);
            await waitFor(() => expect(fetchRshogiGameList).toHaveBeenCalledTimes(1));
            const recentSignal = fetchRshogiGameList.mock.calls[0]?.[0]?.signal as AbortSignal;

            // 新着順の一覧が返る前に検索する。
            fireEvent.change(screen.getByLabelText("名前"), { target: { value: "RAMU" } });
            fireEvent.click(screen.getByRole("button", { name: "検索" }));
            await screen.findByText("23件中 1-20件");
            expect(recentSignal.aborted).toBe(true);

            await act(async () => {
                rejectRecent(new Error("新着一覧の取得に失敗"));
                await Promise.resolve();
            });

            expect(screen.queryByRole("alert")).toBeNull();
            expect(screen.queryByText("新着一覧の取得に失敗")).toBeNull();
            expect(gameIds()).toEqual(["search-1"]);
        });

        it("検索に入った後で届いた新着順の一覧が、検索結果を上書きしない", async () => {
            let resolveRecent: (page: unknown) => void = () => {};
            fetchRshogiGameList.mockImplementation(
                () =>
                    new Promise((resolve) => {
                        resolveRecent = resolve;
                    }),
            );
            render(<Harness />);
            await waitFor(() => expect(fetchRshogiGameList).toHaveBeenCalledTimes(1));

            fireEvent.change(screen.getByLabelText("名前"), { target: { value: "RAMU" } });
            fireEvent.click(screen.getByRole("button", { name: "検索" }));
            await screen.findByText("23件中 1-20件");

            await act(async () => {
                resolveRecent({ games: [game("late-recent")], nextCursor: "cursor-9" });
                await Promise.resolve();
            });

            expect(gameIds()).toEqual(["search-1"]);
            expect(screen.queryByText("もっと読み込む")).toBeNull();
        });

        it("検索のエラーを、検索をやめた後の新着順の一覧に持ち越さない", async () => {
            fetchRshogiGameSearch.mockRejectedValueOnce(new Error("検索に失敗"));
            render(<Harness />);
            await screen.findByText("もっと読み込む");

            fireEvent.change(screen.getByLabelText("名前"), { target: { value: "RAMU" } });
            fireEvent.click(screen.getByRole("button", { name: "検索" }));
            expect((await screen.findByRole("alert")).textContent).toBe("検索に失敗");

            fireEvent.click(screen.getByRole("button", { name: "クリア" }));

            await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
            expect(gameIds()).toEqual(["recent-1"]);
        });
    });

    describe("検索とページ送り", () => {
        it("条件入力と検索実行で検索結果とページ番号方式へ切り替える", async () => {
            render(<Harness />);
            await screen.findByText("もっと読み込む");

            fireEvent.change(screen.getByLabelText("名前"), { target: { value: "RAMU" } });
            fireEvent.click(screen.getByRole("button", { name: "検索" }));

            await waitFor(() => expect(fetchRshogiGameSearch).toHaveBeenCalledTimes(1));
            expect(fetchRshogiGameSearch).toHaveBeenCalledWith(
                expect.objectContaining({
                    baseUrl: "https://example.test/rshogi",
                    name: "RAMU",
                    page: 1,
                    pageSize: 20,
                }),
            );
            expect(await screen.findByText("23件中 1-20件")).toBeTruthy();
            expect(gameIds()).toEqual(["search-1"]);
            expect(screen.queryByText("もっと読み込む")).toBeNull();
        });

        it("検索リクエストが失敗した場合にエラーを表示する", async () => {
            fetchRshogiGameSearch.mockRejectedValueOnce(new Error("ネットワークエラー"));

            render(<Harness />);
            await screen.findByText("もっと読み込む");

            fireEvent.change(screen.getByLabelText("名前"), { target: { value: "RAMU" } });
            fireEvent.click(screen.getByRole("button", { name: "検索" }));

            expect((await screen.findByRole("alert")).textContent).toBe("ネットワークエラー");
        });

        it("入力中の条件と実行済み条件を分離して次ページと前ページを取得する", async () => {
            fetchRshogiGameSearch
                .mockResolvedValueOnce({
                    games: [game("search-1")],
                    page: 1,
                    pageSize: 20,
                    totalCount: 23,
                })
                .mockResolvedValueOnce({
                    games: [game("search-2")],
                    page: 2,
                    pageSize: 20,
                    totalCount: 23,
                })
                .mockResolvedValueOnce({
                    games: [game("search-1-returned")],
                    page: 1,
                    pageSize: 20,
                    totalCount: 23,
                });

            render(<Harness />);
            await screen.findByText("もっと読み込む");

            fireEvent.change(screen.getByLabelText("名前"), { target: { value: "RAMU" } });
            fireEvent.click(screen.getByRole("button", { name: "検索" }));
            await screen.findByText("23件中 1-20件");

            fireEvent.change(screen.getByLabelText("名前"), { target: { value: "OTHER" } });
            fireEvent.click(screen.getByRole("button", { name: "次へ" }));

            await waitFor(() => expect(fetchRshogiGameSearch).toHaveBeenCalledTimes(2));
            expect(fetchRshogiGameSearch).toHaveBeenNthCalledWith(
                2,
                expect.objectContaining({ name: "RAMU", page: 2, pageSize: 20 }),
            );
            expect(await screen.findByText("23件中 21-23件")).toBeTruthy();
            expect(gameIds()).toEqual(["search-2"]);

            fireEvent.click(screen.getByRole("button", { name: "前へ" }));

            await waitFor(() => expect(fetchRshogiGameSearch).toHaveBeenCalledTimes(3));
            expect(fetchRshogiGameSearch).toHaveBeenNthCalledWith(
                3,
                expect.objectContaining({ name: "RAMU", page: 1, pageSize: 20 }),
            );
            expect(await screen.findByText("23件中 1-20件")).toBeTruthy();
            expect(gameIds()).toEqual(["search-1-returned"]);
            expect((screen.getByLabelText("名前") as HTMLInputElement).value).toBe("OTHER");
        });

        it("クリアで検索条件とページ送りを消し、新着順の一覧へ戻る", async () => {
            render(<Harness />);
            await screen.findByText("もっと読み込む");
            fireEvent.change(screen.getByLabelText("名前"), { target: { value: "RAMU" } });
            fireEvent.click(screen.getByRole("button", { name: "検索" }));
            await screen.findByText("23件中 1-20件");

            fireEvent.click(screen.getByRole("button", { name: "クリア" }));

            expect(onSearchChange).toHaveBeenLastCalledWith({});
            await waitFor(() =>
                expect((screen.getByLabelText("名前") as HTMLInputElement).value).toBe(""),
            );
            expect(screen.queryByText("23件中 1-20件")).toBeNull();
            expect(screen.getByText("もっと読み込む")).toBeTruthy();
            expect(gameIds()).toEqual(["recent-1"]);
        });

        it("もっと読み込むで次のカーソルを取得して末尾に足す", async () => {
            render(<Harness />);
            fireEvent.click(await screen.findByText("もっと読み込む"));

            await waitFor(() =>
                expect(fetchRshogiGameList).toHaveBeenLastCalledWith(
                    expect.objectContaining({ cursor: "cursor-2" }),
                ),
            );
        });
    });
});

describe("normalizeRshogiGameBrowserSearch", () => {
    it("有効な条件だけを残す", () => {
        expect(
            normalizeRshogiGameBrowserSearch({
                venue: "floodgate",
                event: " WCSC36 ",
                name: "RAMU",
                result: "resignation",
                from: "2026-10-01",
                to: "2026-10-09",
                page: 3,
                unknown: "x",
            }),
        ).toEqual({
            venue: "floodgate",
            event: "WCSC36",
            name: "RAMU",
            result: "resignation",
            from: "2026-10-01",
            to: "2026-10-09",
        });
    });

    it("不正な値は無視する", () => {
        expect(
            normalizeRshogiGameBrowserSearch({
                venue: "wdoor",
                event: "",
                name: { nested: true },
                result: "WIN_BLACK",
                from: "2026/10/01",
                to: "2026-13-40",
            }),
        ).toEqual({});
        expect(normalizeRshogiGameBrowserSearch({ event: "x".repeat(201) })).toEqual({});
        expect(normalizeRshogiGameBrowserSearch({})).toEqual({});
    });

    it("数値として届いたイベント名・名前は文字列に直す", () => {
        expect(normalizeRshogiGameBrowserSearch({ event: 2026, name: 7 })).toEqual({
            event: "2026",
            name: "7",
        });
    });
});
