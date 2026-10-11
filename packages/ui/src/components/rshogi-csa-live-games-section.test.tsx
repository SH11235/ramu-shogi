import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchRshogiLiveGameList = vi.fn();

vi.mock("@shogi/match-client", () => ({
    fetchRshogiLiveGameList,
}));

const { RshogiCsaLiveGamesSection } = await import("./rshogi-csa-live-games-section");

const LIVE_GAME = {
    gameId: "live-1",
    senteName: "alice",
    goteName: "bob",
    source: "kifu",
};

describe("RshogiCsaLiveGamesSection", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("進行中の対局があれば見出しつきで一覧を出し、クリックで gameId を返す", async () => {
        fetchRshogiLiveGameList.mockResolvedValue({ liveGames: [LIVE_GAME] });
        const onSelectGame = vi.fn();

        render(
            <RshogiCsaLiveGamesSection apiBaseUrl="https://x.test" onSelectGame={onSelectGame} />,
        );

        expect(await screen.findByRole("heading", { name: "進行中の対局" })).toBeTruthy();
        expect(screen.getByText("rshogi サーバー")).toBeTruthy();
        const row = screen.getByText("☗ alice vs ☖ bob").closest("button");
        if (row) fireEvent.click(row);
        expect(onSelectGame).toHaveBeenCalledWith("live-1");
        expect(fetchRshogiLiveGameList).toHaveBeenCalledWith(
            expect.objectContaining({ baseUrl: "https://x.test" }),
        );
    });

    it("0 件ならセクションごと描画しない", async () => {
        fetchRshogiLiveGameList.mockResolvedValue({ liveGames: [] });

        const { container } = render(<RshogiCsaLiveGamesSection onSelectGame={vi.fn()} />);

        await waitFor(() => expect(fetchRshogiLiveGameList).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(container.innerHTML).toBe(""));
        expect(screen.queryByRole("heading", { name: "進行中の対局" })).toBeNull();
    });

    it("取得に失敗しても何も描画せず、例外も出さない", async () => {
        fetchRshogiLiveGameList.mockRejectedValue(new Error("live API down"));

        const { container } = render(<RshogiCsaLiveGamesSection onSelectGame={vi.fn()} />);

        await waitFor(() => expect(fetchRshogiLiveGameList).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(container.innerHTML).toBe(""));
        expect(screen.queryByText("live API down")).toBeNull();
    });

    it("更新ボタンで先頭ページを取り直す", async () => {
        fetchRshogiLiveGameList.mockResolvedValue({ liveGames: [LIVE_GAME] });

        render(<RshogiCsaLiveGamesSection onSelectGame={vi.fn()} />);
        const refresh = await screen.findByRole("button", { name: "更新" });
        fireEvent.click(refresh);

        await waitFor(() => expect(fetchRshogiLiveGameList).toHaveBeenCalledTimes(2));
    });
});
