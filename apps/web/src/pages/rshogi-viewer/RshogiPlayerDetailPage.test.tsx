import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchRshogiPlayerDetail = vi.fn();
const navigate = vi.fn();

vi.mock("@shogi/match-client", () => ({ fetchRshogiPlayerDetail }));
vi.mock("@tanstack/react-router", () => ({
    getRouteApi: () => ({ useParams: () => ({ playerId: "p_one" }) }),
    Link: ({ children }: { children: ReactNode }) => <a href="/players">{children}</a>,
    useNavigate: () => navigate,
}));
vi.mock("@shogi/ui/components/rshogi-csa-game-list", () => ({
    RshogiCsaGameList: ({
        games,
        onSelect,
    }: {
        games: { gameId: string }[];
        onSelect: (gameId: string) => void;
    }) => (
        <button type="button" onClick={() => onSelect(games[0].gameId)}>
            {games[0].gameId}
        </button>
    ),
}));
vi.mock("../../components/HeaderNav", () => ({ HeaderNav: () => null }));
vi.mock("../../components/PageHeader", () => ({ PageHeader: () => null }));
vi.mock("../../components/PageContainer", () => ({
    PageContainer: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock("../../components/StatusBanner", () => ({
    StatusBanner: ({ children }: { children: ReactNode }) => <div role="alert">{children}</div>,
}));

const detail = {
    player: {
        playerId: "p_one",
        displayName: "銀将",
        rating: 1612,
        games: 21,
        wins: 12,
        losses: 7,
        draws: 2,
        lastPlayedAtMs: 1_777_392_877_244,
        legacy: false,
    },
    games: [{ gameId: "game-1" }],
    page: 1,
    pageSize: 20,
    totalCount: 21,
};

const { default: RshogiPlayerDetailPage } = await import("./RshogiPlayerDetailPage");

describe("RshogiPlayerDetailPage", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        fetchRshogiPlayerDetail.mockImplementation(
            (_playerId: string, options: { page?: number }) => {
                const page = options.page ?? 1;
                return Promise.resolve({
                    ...detail,
                    games: [{ gameId: `game-${page}` }],
                    page,
                });
            },
        );
    });

    it("選手成績、対局履歴、ページ移動を表示する", async () => {
        render(<RshogiPlayerDetailPage />);
        expect(await screen.findByRole("heading", { name: "銀将" })).toBeTruthy();
        expect(screen.getByText("1,612")).toBeTruthy();
        expect(screen.getByText("全 21 局")).toBeTruthy();
        expect(fetchRshogiPlayerDetail).toHaveBeenCalledWith(
            "p_one",
            expect.objectContaining({ page: 1, pageSize: 20 }),
        );

        fireEvent.click(screen.getByRole("button", { name: "game-1" }));
        expect(navigate).toHaveBeenCalledWith({
            to: "/rshogi-viewer/$gameId",
            params: { gameId: "game-1" },
        });

        fireEvent.click(screen.getByRole("button", { name: "古い対局 →" }));
        await waitFor(() =>
            expect(fetchRshogiPlayerDetail).toHaveBeenLastCalledWith(
                "p_one",
                expect.objectContaining({ page: 2, pageSize: 20 }),
            ),
        );
        expect(await screen.findByRole("button", { name: "game-2" })).toBeTruthy();
        expect(screen.getByText("2 / 2")).toBeTruthy();
    });

    it("次ページの取得失敗時は成功済みページを表示して再試行できる", async () => {
        render(<RshogiPlayerDetailPage />);
        await screen.findByRole("button", { name: "game-1" });

        fetchRshogiPlayerDetail.mockRejectedValueOnce(new Error("page unavailable"));
        fireEvent.click(screen.getByRole("button", { name: "古い対局 →" }));

        expect((await screen.findByRole("alert")).textContent).toContain("page unavailable");
        expect(screen.getByRole("button", { name: "game-1" })).toBeTruthy();
        expect(screen.getByText("1 / 2")).toBeTruthy();

        fireEvent.click(screen.getByRole("button", { name: "古い対局 →" }));
        expect(await screen.findByRole("button", { name: "game-2" })).toBeTruthy();
        expect(screen.getByText("2 / 2")).toBeTruthy();
    });

    it("取得失敗を表示する", async () => {
        fetchRshogiPlayerDetail.mockRejectedValueOnce(new Error("player unavailable"));
        render(<RshogiPlayerDetailPage />);
        expect((await screen.findByRole("alert")).textContent).toContain("player unavailable");
    });
});
