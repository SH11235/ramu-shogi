import {
    createMemoryHistory,
    createRootRoute,
    createRoute,
    createRouter,
    Outlet,
    RouterProvider,
} from "@tanstack/react-router";
import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createUsageClient } from "../platform/usage";
import { useUsageTracking } from "./useUsageTracking";

let authState = { session: { authenticated: true }, isLoadingSession: false };

vi.mock("./useAuthSession", () => ({
    useAuthSession: () => authState,
}));

function setup() {
    const sent: Record<string, unknown>[] = [];
    const storage = new Map<string, string>();
    const client = createUsageClient({
        hostname: "ramu-shogi.sh11235.com",
        search: "",
        referrer: "",
        globalPrivacyControl: false,
        storage: {
            getItem: (key) => storage.get(key) ?? null,
            setItem: (key, value) => void storage.set(key, value),
            removeItem: (key) => void storage.delete(key),
        },
        randomUUID: () => "3f2b8c1e-4d5a-4b6c-9d7e-0123456789ab",
        send: (_path, body) => sent.push(JSON.parse(body)),
    });

    const rootRoute = createRootRoute({
        component: () => {
            useUsageTracking(client);
            return <Outlet />;
        },
    });
    const page = () => null;
    const router = createRouter({
        routeTree: rootRoute.addChildren([
            createRoute({ getParentRoute: () => rootRoute, path: "/", component: page }),
            createRoute({ getParentRoute: () => rootRoute, path: "/play", component: page }),
            createRoute({
                getParentRoute: () => rootRoute,
                path: "/games/$gameId",
                component: page,
            }),
        ]),
        history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    return { router, sent };
}

describe("useUsageTracking", () => {
    beforeEach(() => {
        authState = { session: { authenticated: true }, isLoadingSession: false };
    });

    it("最初のページと移動した先のページを、ルートの型で 1 回ずつ送る", async () => {
        const { router, sent } = setup();
        await act(async () => {
            render(<RouterProvider router={router} />);
            await router.load();
        });
        await act(() => router.navigate({ to: "/play" }));
        await act(() => router.navigate({ to: "/games/$gameId", params: { gameId: "abc" } }));
        await act(() =>
            router.navigate({ to: "/games/$gameId", params: { gameId: "abc" }, search: { q: 1 } }),
        );
        await act(() => router.navigate({ to: "/games/$gameId", params: { gameId: "xyz" } }));
        expect(sent.map((body) => (body.props as { route: string }).route)).toEqual([
            "/",
            "/play",
            "/games/$gameId",
            "/games/$gameId",
        ]);
        expect(sent.every((body) => body.loggedIn === true)).toBe(true);
    });

    it("セッションを読み込んでいる間は送らない", async () => {
        authState = { session: { authenticated: true }, isLoadingSession: true };
        const { router, sent } = setup();
        await act(async () => {
            render(<RouterProvider router={router} />);
            await router.load();
        });
        await act(() => router.navigate({ to: "/play" }));
        expect(sent).toEqual([]);
    });
});
