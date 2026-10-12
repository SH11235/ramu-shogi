import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchRshogiGameList = vi.fn();
const fetchRshogiGameSearch = vi.fn();
const fetchRshogiGameEvents = vi.fn();
const fetchRshogiLiveGameList = vi.fn();
const navigate = vi.fn();
let currentSearch: Record<string, unknown> = {};

vi.mock("@shogi/match-client", () => ({
    fetchRshogiGameList,
    fetchRshogiGameSearch,
    fetchRshogiGameEvents,
    fetchRshogiLiveGameList,
}));

vi.mock("@tanstack/react-router", () => ({
    Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
    useNavigate: () => navigate,
    getRouteApi: () => ({ useSearch: () => currentSearch }),
}));

vi.mock("../../components/HeaderNav", () => ({ HeaderNav: () => null }));
vi.mock("../../components/PageHeader", () => ({
    PageHeader: ({ items }: { items: { label: string; to?: string }[] }) => (
        <nav aria-label="パンくず">{items.map((item) => item.label).join(" / ")}</nav>
    ),
}));
vi.mock("../../components/PageContainer", () => ({
    PageContainer: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock("../../components/PageHeading", () => ({
    PageHeading: ({ title, children }: { title: string; children: ReactNode }) => (
        <div>
            <h1>{title}</h1>
            {children}
        </div>
    ),
}));

const { default: RshogiViewerListPage } = await import("./RshogiViewerListPage");

const game = (gameId: string, extra: Record<string, unknown> = {}) => ({
    gameId,
    senteName: `${gameId}-sente`,
    goteName: `${gameId}-gote`,
    ...extra,
});

describe("RshogiViewerListPage", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        currentSearch = {};
        fetchRshogiGameList.mockResolvedValue({
            games: [game("recent-1", { source: "upload", event: "WCSC36" })],
        });
        fetchRshogiGameSearch.mockResolvedValue({
            games: [game("search-1", { source: "wdoor" })],
            page: 1,
            pageSize: 20,
            totalCount: 1,
        });
        fetchRshogiGameEvents.mockResolvedValue([{ event: "WCSC36", source: "upload", games: 3 }]);
        fetchRshogiLiveGameList.mockResolvedValue({
            liveGames: [game("live-1", { source: "kifu" })],
        });
    });

    it("進行中の対局と終局済みの棋譜を 1 ページに出し、それぞれのページへ遷移する", async () => {
        render(<RshogiViewerListPage />);

        expect(await screen.findByRole("heading", { name: "進行中の対局" })).toBeTruthy();
        expect(screen.getByRole("heading", { name: "終局済みの棋譜" })).toBeTruthy();
        expect(fetchRshogiLiveGameList).toHaveBeenCalledWith(
            expect.objectContaining({ baseUrl: "https://example.test/rshogi" }),
        );

        const liveRow = screen.getByText("☗ live-1-sente vs ☖ live-1-gote").closest("button");
        if (liveRow) fireEvent.click(liveRow);
        expect(navigate).toHaveBeenCalledWith({
            to: "/rshogi-viewer/live/$gameId",
            params: { gameId: "live-1" },
        });

        const row = (await screen.findByText("☗ recent-1-sente vs ☖ recent-1-gote")).closest(
            "button",
        );
        if (row) fireEvent.click(row);
        expect(navigate).toHaveBeenCalledWith({
            to: "/rshogi-viewer/$gameId",
            params: { gameId: "recent-1" },
        });
    });

    it("進行中一覧ページへのリンクは無く、一覧の上に説明文やレーティングへのリンクを置かない", async () => {
        render(<RshogiViewerListPage />);
        await screen.findByText("☗ recent-1-sente vs ☖ recent-1-gote");

        // 見出しは読み上げ用にだけ残す。レーティングへはメニューから行く。
        expect(screen.getByRole("heading", { level: 1 }).className).toContain("sr-only");
        expect(screen.queryByRole("link", { name: /レーティング/ })).toBeNull();
        const hrefs = screen.queryAllByRole("link").map((link) => link.getAttribute("href"));
        expect(hrefs).not.toContain("/rshogi-viewer/live");
        expect(screen.getByRole("navigation", { name: "パンくず" }).textContent).toBe(
            "ラム将棋 / rshogi viewer",
        );
    });

    it("検索条件を URL のクエリへ反映する", async () => {
        render(<RshogiViewerListPage />);
        await screen.findByText("☗ recent-1-sente vs ☖ recent-1-gote");

        fireEvent.change(screen.getByLabelText("対局場所"), { target: { value: "floodgate" } });
        fireEvent.click(screen.getByRole("button", { name: "検索" }));

        expect(navigate).toHaveBeenCalledWith({
            to: "/rshogi-viewer",
            search: { venue: "floodgate" },
        });
    });

    it("イベントタグを押すと ?event=<名前> へ遷移する", async () => {
        render(<RshogiViewerListPage />);

        fireEvent.click(
            await screen.findByRole("button", { name: "イベント「WCSC36」で絞り込む" }),
        );

        expect(navigate).toHaveBeenCalledWith({
            to: "/rshogi-viewer",
            search: { event: "WCSC36" },
        });
    });

    it("URL のクエリにある条件で検索し、同じ絞り込みを再現する", async () => {
        currentSearch = { event: "WCSC36", venue: "other" };

        render(<RshogiViewerListPage />);

        await waitFor(() => expect(fetchRshogiGameSearch).toHaveBeenCalledTimes(1));
        expect(fetchRshogiGameSearch).toHaveBeenCalledWith(
            expect.objectContaining({ event: "WCSC36", source: ["upload"], page: 1 }),
        );
        expect(await screen.findByText("☗ search-1-sente vs ☖ search-1-gote")).toBeTruthy();
        expect((screen.getByLabelText("対局場所") as HTMLSelectElement).value).toBe("other");
        await waitFor(() =>
            expect((screen.getByLabelText("イベント") as HTMLSelectElement).value).toBe("WCSC36"),
        );
    });

    it("クエリに不正な値が混ざっていても無視して、有効な条件だけで検索する", async () => {
        // TanStack Router は validateSearch が返さなかったキーも素通しで渡してくるので、
        // 画面側でも有効な条件だけを使う。
        currentSearch = { event: "WCSC36", venue: "wdoor", result: "bogus", from: "yesterday" };

        render(<RshogiViewerListPage />);

        await waitFor(() => expect(fetchRshogiGameSearch).toHaveBeenCalledTimes(1));
        expect(fetchRshogiGameSearch).toHaveBeenCalledWith(
            expect.objectContaining({
                event: "WCSC36",
                source: undefined,
                result: undefined,
                from: undefined,
            }),
        );
        expect((screen.getByLabelText("対局場所") as HTMLSelectElement).value).toBe("");
    });

    it("クリアでクエリを空にする", async () => {
        currentSearch = { event: "WCSC36" };
        render(<RshogiViewerListPage />);
        await screen.findByText("☗ search-1-sente vs ☖ search-1-gote");

        fireEvent.click(screen.getByRole("button", { name: "クリア" }));

        expect(navigate).toHaveBeenCalledWith({ to: "/rshogi-viewer", search: {} });
    });
});
