import { STUDY_HIRATE_SFEN } from "@shogi/app-core";
import {
    createMemoryHistory,
    createRootRoute,
    createRoute,
    createRouter,
    Outlet,
    RouterProvider,
} from "@tanstack/react-router";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import LandingPage from "./LandingPage";

const openStudy = vi.fn(async (prepare: () => Promise<{ studyId: string }>) => {
    await prepare();
});
const createStudyFromKifuSource = vi.fn(async () => ({ studyId: "s1" }));

vi.mock("../hooks/useOpenStudy", () => ({
    useOpenStudy: () => ({ openStudy, isBusy: false, error: null }),
}));
vi.mock("../lib/studyEntry", () => ({
    createStudyFromKifuSource: (...args: unknown[]) => createStudyFromKifuSource(...args),
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
            ...["/play", "/online", "/rshogi-viewer", "/studies"].map((path) =>
                createRoute({ getParentRoute: () => rootRoute, path, component: page }),
            ),
        ]),
        history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    await act(async () => {
        render(<RouterProvider router={router} />);
        await router.load();
    });
}

describe("LandingPage", () => {
    afterEach(() => {
        openStudy.mockClear();
        createStudyFromKifuSource.mockClear();
    });

    it("盤で検討するを押すと、平手の盤の研究ノートを作って開く", async () => {
        await renderLanding();
        await act(async () => {
            fireEvent.click(screen.getByRole("button", { name: "盤で検討する" }));
        });
        expect(openStudy).toHaveBeenCalledTimes(1);
        expect(createStudyFromKifuSource).toHaveBeenCalledWith({
            kind: "moves",
            startSfen: STUDY_HIRATE_SFEN,
            moves: [],
        });
    });

    it("できることに研究ノートの入口を置く", async () => {
        await renderLanding();
        const link = screen.getByRole("link", { name: /研究ノート/ });
        expect(link.getAttribute("href")).toBe("/studies");
    });
});
