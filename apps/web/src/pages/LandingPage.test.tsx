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
const ensureStudySession = vi.fn(async (..._args: unknown[]) => {});

const authListeners = new Set<() => void>();
function setAuthState(next: typeof authState) {
    authState = next;
    for (const listener of authListeners) listener();
}
vi.mock("../hooks/useAuthSession", async () => {
    const { useSyncExternalStore } = await import("react");
    const subscribe = (listener: () => void) => {
        authListeners.add(listener);
        return () => authListeners.delete(listener);
    };
    return { useAuthSession: () => useSyncExternalStore(subscribe, () => authState) };
});
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

    it("作れなかったら知らせ、もう一度押すと作り直して移る", async () => {
        createStudyFromKifuSource
            .mockRejectedValueOnce(new Error("保存できません"))
            .mockResolvedValueOnce({ studyId: "s2" });
        const router = await renderLanding();
        await act(async () => {
            fireEvent.click(startButton());
        });
        expect(screen.getByRole("alert").textContent).toContain("保存できません");
        await act(async () => {
            fireEvent.click(startButton());
        });
        expect(createStudyFromKifuSource).toHaveBeenCalledTimes(2);
        await waitFor(() => expect(router.state.location.pathname).toBe("/studies/s2"));
    });

    it("ログイン状態の確認中に押すと、分かってから作る", async () => {
        createStudyFromKifuSource.mockResolvedValue({ studyId: "s1" });
        authState = { session: null, isLoadingSession: true, sessionError: null } as never;
        await renderLanding();
        await act(async () => {
            fireEvent.click(startButton());
        });
        expect(createStudyFromKifuSource).not.toHaveBeenCalled();
        expect((startButton() as HTMLButtonElement).disabled).toBe(true);
        act(() =>
            setAuthState({
                session: { authenticated: false },
                isLoadingSession: false,
                sessionError: null,
            }),
        );
        await waitFor(() => expect(createStudyFromKifuSource).toHaveBeenCalledTimes(1));
    });

    it("ログイン状態の確認が返らなくても、待ちすぎずに作る", async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        try {
            createStudyFromKifuSource.mockResolvedValue({ studyId: "s1" });
            authState = { session: null, isLoadingSession: true, sessionError: null } as never;
            await renderLanding();
            await act(async () => {
                fireEvent.click(startButton());
            });
            expect(createStudyFromKifuSource).not.toHaveBeenCalled();
            await act(async () => {
                vi.advanceTimersByTime(5000);
            });
            await waitFor(() => expect(createStudyFromKifuSource).toHaveBeenCalledTimes(1));
            // 誰がログインしているか分からないので、持ち主を匿名にしてから作る。
            expect(ensureStudySession).toHaveBeenCalledWith(null);
            expect(ensureStudySession.mock.invocationCallOrder[0]).toBeLessThan(
                createStudyFromKifuSource.mock.invocationCallOrder[0],
            );
        } finally {
            vi.useRealTimers();
        }
    });

    it("できることに研究ノートの入口を置く", async () => {
        await renderLanding();
        const link = screen.getByRole("link", { name: /研究ノート/ });
        expect(link.getAttribute("href")).toBe("/studies");
    });
});
