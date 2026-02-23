import { createRootRoute, createRoute, createRouter, Outlet } from "@tanstack/react-router";
import App from "./App";
import OnlinePage from "./pages/online/OnlinePage";
import RoomPage from "./pages/online/RoomPage";

const rootRoute = createRootRoute({
    component: Outlet,
});

const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: App,
});

const onlineRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/online",
    component: OnlinePage,
});

const roomRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/online/$roomId",
    component: RoomPage,
});

const routeTree = rootRoute.addChildren([indexRoute, onlineRoute, roomRoute]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
    interface Register {
        router: typeof router;
    }
}
