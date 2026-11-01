import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UsageClient } from "../platform/usage";
import { useUsageTracking } from "./useUsageTracking";

const routerState = {
    resolvedLocation: { href: "/games/aaa" } as { href: string } | undefined,
    matches: [{ routeId: "__root__" }, { routeId: "/games/$gameId" }],
};
const listeners: (() => void)[] = [];
let authState = { session: { authenticated: true }, isLoadingSession: false };

vi.mock("@tanstack/react-router", () => ({
    useRouter: () => ({
        state: routerState,
        subscribe: (_event: string, listener: () => void) => {
            listeners.push(listener);
            return () => listeners.splice(listeners.indexOf(listener), 1);
        },
    }),
}));

vi.mock("./useAuthSession", () => ({
    useAuthSession: () => authState,
}));

function fakeClient() {
    const calls: string[] = [];
    const client = {
        setLoggedIn: (value: boolean) => calls.push(`loggedIn:${value}`),
        trackPageView: (route: string, href: string) => calls.push(`${route} ${href}`),
    } as unknown as UsageClient;
    return { client, calls };
}

describe("useUsageTracking", () => {
    beforeEach(() => {
        listeners.length = 0;
        routerState.resolvedLocation = { href: "/games/aaa" };
        authState = { session: { authenticated: true }, isLoadingSession: false };
    });

    it("ログイン状態を渡してから、いまのページと以後の移動を送る", () => {
        const { client, calls } = fakeClient();
        renderHook(() => useUsageTracking(client));
        routerState.resolvedLocation = { href: "/games/bbb" };
        for (const listener of listeners) listener();
        expect(calls).toEqual([
            "loggedIn:true",
            "/games/$gameId /games/aaa",
            "/games/$gameId /games/bbb",
        ]);
    });

    it("セッションを読み込んでいる間は送らない", () => {
        authState = { session: { authenticated: true }, isLoadingSession: true };
        const { client, calls } = fakeClient();
        renderHook(() => useUsageTracking(client));
        expect(calls).toEqual(["loggedIn:true"]);
        expect(listeners).toHaveLength(0);
    });

    it("外したら移動を拾わない", () => {
        const { client } = fakeClient();
        const { unmount } = renderHook(() => useUsageTracking(client));
        unmount();
        expect(listeners).toHaveLength(0);
    });
});
