import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import NewStudyFromGamePage from "./NewStudyFromGamePage";

let search: { from?: "games" } = {};
const navigate = vi.fn();
const fetchRshogiGame = vi.fn();
const openStudyFromRshogiGame = vi.fn();
const openStudyFromGameRecord = vi.fn();

vi.mock("@tanstack/react-router", () => ({
    getRouteApi: () => ({ useSearch: () => search }),
    useNavigate: () => navigate,
}));
vi.mock("@shogi/match-client", () => ({
    fetchRshogiGame: (...args: unknown[]) => fetchRshogiGame(...args),
}));
vi.mock("@shogi/ui/components/rshogi-csa-game-browser", () => ({
    RshogiCsaGameBrowser: ({
        onSelectGame,
        onSelectLiveGame,
    }: {
        onSelectGame: (id: string) => void;
        onSelectLiveGame?: unknown;
    }) => (
        <div>
            {onSelectLiveGame !== undefined && <p>進行中の対局</p>}
            <button type="button" onClick={() => onSelectGame("wdoor-1")}>
                RAMU vs Panda
            </button>
        </div>
    ),
}));
vi.mock("../../lib/studyEntry", () => ({
    canOpenGameRecordAsStudy: () => true,
    openStudyFromRshogiGame: (...args: unknown[]) => openStudyFromRshogiGame(...args),
    openStudyFromGameRecord: (...args: unknown[]) => openStudyFromGameRecord(...args),
}));
vi.mock("../../hooks/useAuthSession", () => ({
    useAuthSession: () => ({ session: null, isLoadingSession: false, sessionError: null }),
}));
vi.mock("../../components/HeaderNav", () => ({ HeaderNav: () => null }));
vi.mock("../../components/PageHeader", () => ({ PageHeader: () => null }));
vi.mock("../../components/AuthRequiredCard", () => ({
    AuthRequiredCard: ({ title, nextPath }: { title: string; nextPath: string }) => (
        <section aria-label="ログインが必要">
            <p>{title}</p>
            <p>{nextPath}</p>
        </section>
    ),
}));

const jsonResponse = (status: number, body: unknown): Response =>
    ({ status, ok: status >= 200 && status < 300, json: async () => body }) as Response;

describe("NewStudyFromGamePage", () => {
    beforeEach(() => {
        search = {};
        navigate.mockResolvedValue(undefined);
    });
    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
        navigate.mockReset();
        fetchRshogiGame.mockReset();
        openStudyFromRshogiGame.mockReset();
        openStudyFromGameRecord.mockReset();
    });

    it("観戦・公開の棋譜は、選ぶと棋譜を読んでそのまま研究ノートで開く（進行中の対局は出さない）", async () => {
        const game = { meta: { gameId: "wdoor-1" }, csa: "V2" };
        fetchRshogiGame.mockResolvedValue(game);
        openStudyFromRshogiGame.mockResolvedValue({ studyId: "study-1" });
        render(<NewStudyFromGamePage />);

        expect(screen.queryByText("進行中の対局")).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "RAMU vs Panda" }));

        await waitFor(() =>
            expect(navigate).toHaveBeenCalledWith({
                to: "/studies/$studyId",
                params: { studyId: "study-1" },
            }),
        );
        expect(fetchRshogiGame.mock.calls[0][0]).toBe("wdoor-1");
        expect(openStudyFromRshogiGame).toHaveBeenCalledWith(game);
    });

    it("自分の対局は、選ぶと対局の詳細を読んでそのまま研究ノートで開く", async () => {
        search = { from: "games" };
        const detail = { id: "g-1", moves: ["7g7f"], initialSfen: "startpos" };
        vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
            String(input) === "/api/games"
                ? jsonResponse(200, {
                      games: [
                          {
                              id: "g-1",
                              visibility: "private",
                              source: "online_room",
                              participants: [
                                  { seat: "sente", displayNameSnapshot: "あなた" },
                                  { seat: "gote", displayNameSnapshot: "相手" },
                              ],
                              result: null,
                              finishedAt: null,
                              createdAt: "2026-10-01T00:00:00Z",
                          },
                      ],
                      nextCursor: null,
                  })
                : jsonResponse(200, { game: detail }),
        );
        openStudyFromGameRecord.mockResolvedValue({ studyId: "study-2" });
        render(<NewStudyFromGamePage />);

        fireEvent.click(
            await screen.findByRole("button", { name: "あなた 対 相手を研究ノートで開く" }),
        );

        await waitFor(() =>
            expect(navigate).toHaveBeenCalledWith({
                to: "/studies/$studyId",
                params: { studyId: "study-2" },
            }),
        );
        expect(openStudyFromGameRecord).toHaveBeenCalledWith(detail);
    });

    it("自分の対局の続きを読めなかったときは、表示済みの対局を残して押し直せるようにする", async () => {
        search = { from: "games" };
        const summary = {
            id: "g-1",
            visibility: "private",
            source: "online_room",
            participants: [
                { seat: "sente", displayNameSnapshot: "あなた" },
                { seat: "gote", displayNameSnapshot: "相手" },
            ],
            result: null,
            finishedAt: null,
            createdAt: "2026-10-01T00:00:00Z",
        };
        vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
            String(input) === "/api/games"
                ? jsonResponse(200, { games: [summary], nextCursor: "c-2" })
                : jsonResponse(500, {}),
        );
        render(<NewStudyFromGamePage />);

        fireEvent.click(await screen.findByRole("button", { name: "もっと見る" }));

        expect((await screen.findByRole("alert")).textContent).toContain(
            "続きを読み込めませんでした",
        );
        expect(
            screen.getByRole("button", { name: "あなた 対 相手を研究ノートで開く" }),
        ).toBeTruthy();
        expect(screen.getByRole("button", { name: "もっと見る" })).toBeTruthy();
    });

    it("自分の対局は、ログインしていなければログインを案内し、戻り先をこの画面にする", async () => {
        search = { from: "games" };
        vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(401, {}));
        render(<NewStudyFromGamePage />);

        const card = await screen.findByRole("region", { name: "ログインが必要" });
        expect(card.textContent).toContain("/studies/new?from=games");
    });

    it("タブを切り替えると、URL に選んだ棋譜の種類を残す", () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(401, {}));
        render(<NewStudyFromGamePage />);

        fireEvent.click(screen.getByRole("tab", { name: "自分の対局" }));
        expect(navigate).toHaveBeenCalledWith({
            to: "/studies/new",
            search: { from: "games" },
            replace: true,
        });
    });
});
