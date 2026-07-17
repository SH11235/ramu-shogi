import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchRshogiPlayerList = vi.fn();

vi.mock("@shogi/match-client", () => ({ fetchRshogiPlayerList }));
vi.mock("@tanstack/react-router", () => ({
    Link: ({ children }: { children: ReactNode }) => <a href="/target">{children}</a>,
}));
vi.mock("../../components/HeaderNav", () => ({ HeaderNav: () => null }));
vi.mock("../../components/PageHeader", () => ({ PageHeader: () => null }));
vi.mock("../../components/PageContainer", () => ({
    PageContainer: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock("../../components/StatusBanner", () => ({
    StatusBanner: ({ children }: { children: ReactNode }) => <div role="alert">{children}</div>,
}));

const { default: RshogiPlayerRankingPage } = await import("./RshogiPlayerRankingPage");

const rankingResponse = {
    players: [
        {
            playerId: "p_one",
            displayName: "銀将",
            rating: 1612.4,
            games: 12,
            wins: 8,
            losses: 3,
            draws: 1,
            lastPlayedAtMs: 1_777_392_877_244,
            legacy: false,
        },
        {
            playerId: "legacy_two",
            displayName: "桂馬",
            rating: 1490,
            games: 12,
            wins: 3,
            losses: 8,
            draws: 1,
            lastPlayedAtMs: 1_777_392_800_000,
            legacy: true,
        },
    ],
    page: 1,
    pageSize: 50,
    totalCount: 100,
    totalGames: 12,
    leader: {
        playerId: "p_one",
        displayName: "銀将",
        rating: 1612.4,
        games: 12,
        wins: 8,
        losses: 3,
        draws: 1,
        lastPlayedAtMs: 1_777_392_877_244,
        legacy: false,
    },
};

describe("RshogiPlayerRankingPage", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        fetchRshogiPlayerList.mockImplementation((options: { page?: number }) =>
            Promise.resolve({ ...rankingResponse, page: options.page ?? 1 }),
        );
    });

    it("Elo順の番付と集計値を表示する", async () => {
        render(<RshogiPlayerRankingPage />);

        expect((await screen.findAllByText("銀将")).length).toBe(2);
        expect(screen.getByText("桂馬")).toBeTruthy();
        expect(screen.getByText("1,612")).toBeTruthy();
        expect(screen.getByText("LEGACY")).toBeTruthy();
        expect(screen.getByText("12", { selector: "section > div > strong" })).toBeTruthy();
        expect(fetchRshogiPlayerList).toHaveBeenCalledWith(
            expect.objectContaining({
                baseUrl: "https://example.test/rshogi",
                page: 1,
                pageSize: 50,
            }),
        );
        expect(screen.getAllByText(/2026年/)).toHaveLength(2);

        fireEvent.click(screen.getByRole("button", { name: "下位 →" }));
        await waitFor(() =>
            expect(fetchRshogiPlayerList).toHaveBeenLastCalledWith(
                expect.objectContaining({ page: 2, pageSize: 50 }),
            ),
        );
        const list = screen.getByRole("list", { name: "選手ランキング" });
        await waitFor(() => expect(list.getAttribute("start")).toBe("51"));
        expect(screen.getByText("51").className).not.toContain("text-wafuu-shu");
    });

    it("下位ページの取得失敗時は成功済みページを表示して再試行できる", async () => {
        render(<RshogiPlayerRankingPage />);
        await screen.findByText("桂馬");

        fetchRshogiPlayerList.mockRejectedValueOnce(new Error("page unavailable"));
        fireEvent.click(screen.getByRole("button", { name: "下位 →" }));

        expect((await screen.findByRole("alert")).textContent).toContain("page unavailable");
        expect(screen.getByText("1 / 2")).toBeTruthy();
        expect(screen.getByRole("list", { name: "選手ランキング" }).getAttribute("start")).toBe(
            "1",
        );

        fireEvent.click(screen.getByRole("button", { name: "下位 →" }));
        await waitFor(() =>
            expect(screen.getByRole("list", { name: "選手ランキング" }).getAttribute("start")).toBe(
                "51",
            ),
        );
    });

    it("取得失敗をエラー表示する", async () => {
        fetchRshogiPlayerList.mockRejectedValueOnce(new Error("rating unavailable"));
        render(<RshogiPlayerRankingPage />);
        expect((await screen.findByRole("alert")).textContent).toContain("rating unavailable");
    });
});
