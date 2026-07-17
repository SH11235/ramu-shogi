import { render, screen } from "@testing-library/react";
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

describe("RshogiPlayerRankingPage", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        fetchRshogiPlayerList.mockResolvedValue({
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
        });
    });

    it("Elo順の番付と集計値を表示する", async () => {
        render(<RshogiPlayerRankingPage />);

        expect((await screen.findAllByText("銀将")).length).toBe(2);
        expect(screen.getByText("桂馬")).toBeTruthy();
        expect(screen.getByText("1,612")).toBeTruthy();
        expect(screen.getByText("LEGACY")).toBeTruthy();
        expect(screen.getByText("12", { selector: "section > div > strong" })).toBeTruthy();
        expect(fetchRshogiPlayerList).toHaveBeenCalledWith(
            expect.objectContaining({ baseUrl: "https://example.test/rshogi" }),
        );
    });

    it("取得失敗をエラー表示する", async () => {
        fetchRshogiPlayerList.mockRejectedValueOnce(new Error("rating unavailable"));
        render(<RshogiPlayerRankingPage />);
        expect((await screen.findByRole("alert")).textContent).toContain("rating unavailable");
    });
});
