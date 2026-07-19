import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchRshogiPlayerDetail = vi.fn();
const navigate = vi.fn();

vi.mock("@shogi/match-client", () => ({ fetchRshogiPlayerDetail }));
let routePlayerId = "p_one";
vi.mock("@tanstack/react-router", () => ({
    getRouteApi: () => ({ useParams: () => ({ playerId: routePlayerId }) }),
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
        routePlayerId = "p_one";
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 404 }));
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

    it("レーティング、対局履歴、ページ移動を表示する", async () => {
        render(<RshogiPlayerDetailPage />);
        expect(await screen.findByRole("heading", { name: "銀将" })).toBeTruthy();
        expect(screen.getByText("RATING RECORD")).toBeTruthy();
        expect(screen.getByRole("link", { name: "← レーティングへ戻る" })).toBeTruthy();
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

    it("公開実験がある場合は nnue-lab へのリンクを表示する", async () => {
        vi.mocked(fetch).mockResolvedValueOnce({
            status: 200,
            json: () =>
                Promise.resolve({
                    tenant_slug: "public-team",
                    experiment_id: "exp-42",
                    experiment_name: "HalfKA 実験",
                }),
        } as Response);

        render(<RshogiPlayerDetailPage />);

        const link = await screen.findByRole("link", { name: /nnue-lab で実験を見る/ });
        expect(link.getAttribute("href")).toBe(
            "https://nnue-lab.sh11235.com/t/public-team/experiments/exp-42",
        );
        expect(link.getAttribute("target")).toBe("_blank");
        expect(link.getAttribute("rel")).toBe("noreferrer");
        expect(screen.getByText("HalfKA 実験")).toBeTruthy();
    });

    it("公開実験がない場合は nnue-lab の表示を追加しない", async () => {
        render(<RshogiPlayerDetailPage />);

        await waitFor(() => expect(fetch).toHaveBeenCalled());
        expect(screen.queryByRole("link", { name: /nnue-lab で実験を見る/ })).toBeNull();
    });

    it("player 遷移時は新詳細の取得完了前に旧 nnue-lab リンクを消す", async () => {
        vi.mocked(fetch).mockResolvedValueOnce({
            status: 200,
            json: () =>
                Promise.resolve({
                    tenant_slug: "public-team",
                    experiment_id: "exp-42",
                    experiment_name: "HalfKA 実験",
                }),
        } as Response);

        const { rerender } = render(<RshogiPlayerDetailPage />);
        await screen.findByRole("link", { name: /nnue-lab で実験を見る/ });

        // 次 player の詳細取得を未解決のまま保留し、遷移直後の表示を検証する
        fetchRshogiPlayerDetail.mockImplementation(() => new Promise(() => {}));
        routePlayerId = "p_two";
        rerender(<RshogiPlayerDetailPage />);

        await waitFor(() =>
            expect(screen.queryByRole("link", { name: /nnue-lab で実験を見る/ })).toBeNull(),
        );
        expect(screen.queryByText("銀将")).toBeNull();
    });

    it("読み込んだ詳細の canonical playerId で公開実験を検索する", async () => {
        fetchRshogiPlayerDetail.mockResolvedValueOnce({
            ...detail,
            player: { ...detail.player, playerId: "canonical/player" },
        });

        render(<RshogiPlayerDetailPage />);

        await waitFor(() =>
            expect(fetch).toHaveBeenCalledWith(
                "https://nnue-lab.sh11235.com/api/public/csa-players/canonical%2Fplayer",
                expect.objectContaining({ signal: expect.any(AbortSignal) }),
            ),
        );
    });
});
