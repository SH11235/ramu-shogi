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
        const report = () => {
            const location = router.state.resolvedLocation;
            const route = router.state.matches.at(-1)?.routeId;
            if (location && route) client.trackPageView(route, location.href);
        };
        report();
        return router.subscribe("onResolved", report);
    }, [client, isLoadingSession, router]);
}
