import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchRshogiGameList = vi.fn();
const fetchRshogiGameSearch = vi.fn();
const navigate = vi.fn();

vi.mock("@shogi/match-client", () => ({
    fetchRshogiGameList,
    fetchRshogiGameSearch,
}));

vi.mock("@tanstack/react-router", () => ({
    Link: ({ children }: { children: ReactNode }) => <a href="/live">{children}</a>,
    useNavigate: () => navigate,
}));

vi.mock("@shogi/ui/components/rshogi-csa-game-list", () => ({
    RshogiCsaGameList: ({
        games,
        onLoadMore,
        hasMore,
    }: {
        games: { gameId: string }[];
        onLoadMore?: () => void;
        hasMore?: boolean;
    }) => (
        <div>
            <span data-testid="game-ids">{games.map((game) => game.gameId).join(",")}</span>
            {hasMore && onLoadMore && (
                <button type="button" onClick={onLoadMore}>
                    もっと読み込む
                </button>
            )}
        </div>
    ),
}));

vi.mock("../../components/HeaderNav", () => ({ HeaderNav: () => null }));
vi.mock("../../components/PageHeader", () => ({ PageHeader: () => null }));
vi.mock("../../components/PageContainer", () => ({
    PageContainer: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock("../../components/PageHeading", () => ({
    PageHeading: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../components/StatusBanner", () => ({
    StatusBanner: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

const { default: RshogiViewerListPage } = await import("./RshogiViewerListPage");

describe("RshogiViewerListPage search", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        fetchRshogiGameList.mockResolvedValue({
            games: [{ gameId: "recent-1" }],
            nextCursor: "cursor-2",
        });
        fetchRshogiGameSearch.mockResolvedValue({
            games: [{ gameId: "search-1" }],
            page: 1,
            pageSize: 20,
            totalCount: 23,
        });
    });

    it("条件入力と検索実行で検索結果とページ番号方式へ切り替える", async () => {
        render(<RshogiViewerListPage />);
        await screen.findByText("もっと読み込む");

        fireEvent.change(screen.getByLabelText("選手名"), { target: { value: "RAMU" } });
        fireEvent.click(screen.getByRole("button", { name: "検索" }));

        await waitFor(() => expect(fetchRshogiGameSearch).toHaveBeenCalledTimes(1));
        expect(fetchRshogiGameSearch).toHaveBeenCalledWith(
            expect.objectContaining({ name: "RAMU", page: 1, pageSize: 20 }),
        );
        expect(await screen.findByText("23件中 1-20件")).toBeTruthy();
        expect(screen.getByTestId("game-ids").textContent).toBe("search-1");
        expect(screen.queryByText("もっと読み込む")).toBeNull();
        expect(screen.getByRole("button", { name: "前へ" })).toBeTruthy();
        expect(screen.getByRole("button", { name: "次へ" })).toBeTruthy();
    });

    it("検索リクエストが失敗した場合にエラーバナーを表示する", async () => {
        fetchRshogiGameSearch.mockRejectedValueOnce(new Error("ネットワークエラー"));

        render(<RshogiViewerListPage />);
        await screen.findByText("もっと読み込む");

        fireEvent.change(screen.getByLabelText("選手名"), { target: { value: "RAMU" } });
        fireEvent.click(screen.getByRole("button", { name: "検索" }));

        expect(await screen.findByText("ネットワークエラー")).toBeTruthy();
    });

    it("入力中の条件と実行済み条件を分離して次ページと前ページを取得する", async () => {
        fetchRshogiGameSearch
            .mockResolvedValueOnce({
                games: [{ gameId: "search-1" }],
                page: 1,
                pageSize: 20,
                totalCount: 23,
            })
            .mockResolvedValueOnce({
                games: [{ gameId: "search-2" }],
                page: 2,
                pageSize: 20,
                totalCount: 23,
            })
            .mockResolvedValueOnce({
                games: [{ gameId: "search-1-returned" }],
                page: 1,
                pageSize: 20,
                totalCount: 23,
            });

        render(<RshogiViewerListPage />);
        await screen.findByText("もっと読み込む");

        fireEvent.change(screen.getByLabelText("選手名"), { target: { value: "RAMU" } });
        fireEvent.click(screen.getByRole("button", { name: "検索" }));
        await screen.findByText("23件中 1-20件");

        fireEvent.change(screen.getByLabelText("選手名"), { target: { value: "OTHER" } });
        fireEvent.click(screen.getByRole("button", { name: "次へ" }));

        await waitFor(() => expect(fetchRshogiGameSearch).toHaveBeenCalledTimes(2));
        expect(fetchRshogiGameSearch).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({ name: "RAMU", page: 2, pageSize: 20 }),
        );
        expect(await screen.findByText("23件中 21-23件")).toBeTruthy();
        expect(screen.getByTestId("game-ids").textContent).toBe("search-2");

        fireEvent.click(screen.getByRole("button", { name: "前へ" }));

        await waitFor(() => expect(fetchRshogiGameSearch).toHaveBeenCalledTimes(3));
        expect(fetchRshogiGameSearch).toHaveBeenNthCalledWith(
            3,
            expect.objectContaining({ name: "RAMU", page: 1, pageSize: 20 }),
        );
        expect(await screen.findByText("23件中 1-20件")).toBeTruthy();
        expect(screen.getByTestId("game-ids").textContent).toBe("search-1-returned");
        expect((screen.getByLabelText("選手名") as HTMLInputElement).value).toBe("OTHER");
    });

    it("クリアで検索条件とpaginationを消し、cursor一覧へ戻る", async () => {
        render(<RshogiViewerListPage />);
        await screen.findByText("もっと読み込む");
        fireEvent.change(screen.getByLabelText("選手名"), { target: { value: "RAMU" } });
        fireEvent.click(screen.getByRole("button", { name: "検索" }));
        await screen.findByText("23件中 1-20件");

        fireEvent.click(screen.getByRole("button", { name: "クリア" }));

        expect((screen.getByLabelText("選手名") as HTMLInputElement).value).toBe("");
        expect(screen.queryByText("23件中 1-20件")).toBeNull();
        expect(screen.getByText("もっと読み込む")).toBeTruthy();
        expect(screen.getByTestId("game-ids").textContent).toBe("recent-1");
    });
});
