import { STUDY_HIRATE_SFEN } from "@shogi/app-core";
import {
    createMemoryHistory,
    createRootRoute,
    createRoute,
    createRouter,
    Outlet,
    RouterProvider,
} from "@tanstack/react-router";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import LandingPage from "./LandingPage";

let authState = { session: { authenticated: false }, isLoadingSession: false, sessionError: null };
const createStudyFromKifuSource = vi.fn();
const ensureStudySession = vi.fn(async () => {});

vi.mock("../hooks/useAuthSession", () => ({ useAuthSession: () => authState }));
vi.mock("../lib/studyEntry", () => ({
    createStudyFromKifuSource: (...args: unknown[]) => createStudyFromKifuSource(...args),
}));
vi.mock("../lib/studySync", () => ({
    ensureStudySession: (...args: unknown[]) => ensureStudySession(...args),
}));
vi.mock("../components/HeaderNav", () => ({ HeaderNav: () => null }));
vi.mock("../components/HeroBoard", () => ({ HeroBoard: () => null }));
vi.mock("../components/PageHeader", () => ({ PageHeader: () => null }));

async function renderLanding() {
    const rootRoute = createRootRoute({ component: () => <Outlet /> });
    const page = () => null;
    const router = createRouter({
        routeTree: rootRoute.addChildren([
            createRoute({ getParentRoute: () => rootRoute, path: "/", component: LandingPage }),
            ...["/play", "/online", "/rshogi-viewer", "/studies", "/studies/$studyId"].map((path) =>
                createRoute({ getParentRoute: () => rootRoute, path, component: page }),
            ),
        ]),
        history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    await act(async () => {
        render(<RouterProvider router={router} />);
        await router.load();
    });
    return router;
}

const startButton = () => screen.getByRole("button", { name: /盤で検討する|用意しています/ });

describe("LandingPage", () => {
    afterEach(() => {
        authState = {
            session: { authenticated: false },
            isLoadingSession: false,
            sessionError: null,
        };
        createStudyFromKifuSource.mockReset();
        ensureStudySession.mockClear();
    });

    it("盤で検討するを押すと、平手の盤の研究ノートを作ってその画面へ移る", async () => {
        createStudyFromKifuSource.mockResolvedValue({ studyId: "s1" });
        const router = await renderLanding();
        await act(async () => {
            fireEvent.click(startButton());
        });
        expect(createStudyFromKifuSource).toHaveBeenCalledWith({
            kind: "moves",
            startSfen: STUDY_HIRATE_SFEN,
            moves: [],
        });
        await waitFor(() => expect(router.state.location.pathname).toBe("/studies/s1"));
    });

    it("用意している間は押せず、続けて押しても 1 つしか作らない", async () => {
        let finish: (value: { studyId: string }) => void = () => {};
        createStudyFromKifuSource.mockReturnValue(
            new Promise((resolve) => {
                finish = resolve;
            }),
        );
        await renderLanding();
        await act(async () => {
            fireEvent.click(startButton());
        });
        expect((startButton() as HTMLButtonElement).disabled).toBe(true);
        fireEvent.click(startButton());
        expect(createStudyFromKifuSource).toHaveBeenCalledTimes(1);
        await act(async () => finish({ studyId: "s1" }));
    });

    it("作れなかったら知らせ、もう一度押せる", async () => {
        createStudyFromKifuSource.mockRejectedValueOnce(new Error("保存できません"));
        await renderLanding();
        await act(async () => {
            fireEvent.click(startButton());
        });
        expect(screen.getByRole("alert").textContent).toContain("保存できません");
        expect((startButton() as HTMLButtonElement).disabled).toBe(false);
    });

    it("ログイン状態が分かるまでは押せない", async () => {
        authState = { session: null, isLoadingSession: true, sessionError: null } as never;
        await renderLanding();
        expect((startButton() as HTMLButtonElement).disabled).toBe(true);
    });

    it("できることに研究ノートの入口を置く", async () => {
        await renderLanding();
        const link = screen.getByRole("link", { name: /研究ノート/ });
        expect(link.getAttribute("href")).toBe("/studies");
    });
});
