import type { GameRecordSummary } from "@shogi/api-contract";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const useLoaderData = vi.fn();

vi.mock("@tanstack/react-router", () => ({
    getRouteApi: () => ({ useLoaderData }),
    Link: ({ children }: { children: ReactNode }) => <a href="/games/example">{children}</a>,
}));

vi.mock("../../components/AuthRequiredCard", () => ({
    AuthRequiredCard: () => <div>認証が必要です</div>,
}));
vi.mock("../../components/HeaderNav", () => ({ HeaderNav: () => null }));
vi.mock("../../components/PageHeader", () => ({ PageHeader: () => null }));
vi.mock("../../components/PageContainer", () => ({
    PageContainer: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock("../../components/PageHeading", () => ({
    PageHeading: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../components/Section", () => ({
    Section: ({ children }: { children: ReactNode }) => <section>{children}</section>,
}));

const { default: GamesPage } = await import("./GamesPage");

function game(id: string, displayName: string): GameRecordSummary {
    return {
        id,
        roomId: null,
        publicId: null,
        source: "online_room",
        visibility: "private",
        status: "finished",
        result: null,
        finishedAt: null,
        createdAt: "2026-07-21T00:00:00.000Z",
        participants: [{ seat: "b", userId: null, displayNameSnapshot: displayName }],
    };
}

describe("GamesPage keyset pagination", () => {
    let loaderData: {
        needsAuth: boolean;
        games: GameRecordSummary[];
        nextCursor: string | null;
    };

    beforeEach(() => {
        vi.restoreAllMocks();
        useLoaderData.mockReset();
        loaderData = {
            needsAuth: false,
            games: [game("game-1", "先手1")],
            nextCursor: "opaque+/cursor=",
        };
        useLoaderData.mockImplementation(() => loaderData);
    });

    it("nextCursorで次ページを取得し、既存一覧へ追記する", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValue(
            new Response(JSON.stringify({ games: [game("game-2", "先手2")], nextCursor: null }), {
                status: 200,
                headers: { "content-type": "application/json" },
            }),
        );

        render(<GamesPage />);
        fireEvent.click(screen.getByRole("button", { name: "もっと見る" }));

        await screen.findByText("先手2");
        expect(globalThis.fetch).toHaveBeenCalledWith("/api/games?cursor=opaque%2B%2Fcursor%3D", {
            credentials: "same-origin",
            signal: expect.any(AbortSignal),
        });
        expect(screen.getByText("先手1")).toBeTruthy();
        expect(screen.getByText("2件を表示中")).toBeTruthy();
        expect(screen.queryByRole("button", { name: "もっと見る" })).toBeNull();
    });

    it("追加取得に失敗した場合は再試行可能なエラーを表示する", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 503 }));

        render(<GamesPage />);
        fireEvent.click(screen.getByRole("button", { name: "もっと見る" }));

        expect((await screen.findByRole("alert")).textContent).toBe(
            "棋譜の追加取得に失敗しました。時間をおいて再度お試しください。",
        );
        await waitFor(() =>
            expect(
                (screen.getByRole("button", { name: "もっと見る" }) as HTMLButtonElement).disabled,
            ).toBe(false),
        );
    });

    it("追加取得中にsessionが切れた場合は認証要求表示へ戻す", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 401 }));

        render(<GamesPage />);
        fireEvent.click(screen.getByRole("button", { name: "もっと見る" }));

        await waitFor(() => expect(screen.queryByText("先手1")).toBeNull());
        expect(screen.getByText("認証が必要です")).toBeTruthy();
        expect(screen.queryByRole("alert")).toBeNull();
        expect(screen.queryByRole("button", { name: "もっと見る" })).toBeNull();
        expect(screen.queryByText("0件を表示中")).toBeNull();
    });

    it("loader再検証時に一覧を置換し、古い追加取得結果を混ぜない", async () => {
        let resolveRequest: ((response: Response) => void) | undefined;
        const pendingRequest = new Promise<Response>((resolve) => {
            resolveRequest = resolve;
        });
        vi.spyOn(globalThis, "fetch").mockReturnValue(pendingRequest);

        const { rerender } = render(<GamesPage />);
        fireEvent.click(screen.getByRole("button", { name: "もっと見る" }));

        loaderData = {
            needsAuth: false,
            games: [game("game-new", "再検証後")],
            nextCursor: null,
        };
        rerender(<GamesPage />);

        await screen.findByText("再検証後");
        expect(screen.queryByText("先手1")).toBeNull();
        expect(screen.queryByRole("button", { name: "もっと見る" })).toBeNull();

        resolveRequest?.(
            new Response(
                JSON.stringify({ games: [game("game-stale", "古い追加結果")], nextCursor: null }),
                { status: 200, headers: { "content-type": "application/json" } },
            ),
        );

        await waitFor(() => expect(screen.queryByText("古い追加結果")).toBeNull());
        expect(screen.getByText("1件を表示中")).toBeTruthy();
    });

    it("追加取得中にunmountした場合はrequestをabortする", () => {
        vi.spyOn(globalThis, "fetch").mockReturnValue(new Promise<Response>(() => {}));

        const { unmount } = render(<GamesPage />);
        fireEvent.click(screen.getByRole("button", { name: "もっと見る" }));
        const requestInit = vi.mocked(globalThis.fetch).mock.calls[0]?.[1];
        const signal = requestInit?.signal;
        expect(signal?.aborted).toBe(false);

        unmount();

        expect(signal?.aborted).toBe(true);
    });
});
