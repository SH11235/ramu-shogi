import { useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { type UsageClient, usageClient } from "../platform/usage";
import { useAuthSession } from "./useAuthSession";

/** 表示したページを利用状況のイベントとして送る。ログイン中かどうかが分かってから送り始める */
export function useUsageTracking(client: UsageClient = usageClient): void {
    const router = useRouter();
    const { session, isLoadingSession } = useAuthSession();
    const loggedIn = session?.authenticated === true;

    useEffect(() => {
        client.setLoggedIn(loggedIn);
    }, [client, loggedIn]);

    useEffect(() => {
        if (isLoadingSession) return;
        const { resolvedLocation, location, matches } = router.state;
        const route = matches.at(-1)?.routeId;
        // 読み込みの途中なら、いまのページは読み込みが終わったときの onResolved が送る
        if (resolvedLocation && route && resolvedLocation.pathname === location.pathname) {
            client.trackPageView(route, resolvedLocation.pathname);
        }
        // onResolved の時点では resolvedLocation はまだ移動前を指すので、移動先は通知の toLocation で読む。
        // matches は通知より先に移動先へ切り替わっている
        return router.subscribe("onResolved", ({ toLocation }) => {
            const nextRoute = router.state.matches.at(-1)?.routeId;
            if (nextRoute) client.trackPageView(nextRoute, toLocation.pathname);
        });
    }, [client, isLoadingSession, router]);
}
