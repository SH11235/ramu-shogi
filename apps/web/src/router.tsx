import type { RoomInfo } from "@shogi/api-contract";
import { createRootRoute, createRoute, createRouter, useNavigate } from "@tanstack/react-router";
import App from "./App";
import { AppProviders } from "./AppProviders";
import AuthPage from "./pages/auth/AuthPage";
import GameDetailPage from "./pages/games/GameDetailPage";
import GamesPage from "./pages/games/GamesPage";
import PublicGamePage from "./pages/games/PublicGamePage";
import CreateRoomPage from "./pages/online/CreateRoomPage";
import OnlinePage from "./pages/online/OnlinePage";
import RoomPage from "./pages/online/RoomPage";

const rootRoute = createRootRoute({
    component: AppProviders,
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

const authRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/auth",
    component: AuthPage,
});

const gamesRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/games",
    component: GamesPage,
});

const gameDetailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/games/$gameId",
    component: GameDetailPage,
});

const publicGameRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/public/games/$publicId",
    component: PublicGamePage,
});

const createRoomRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/online/create",
    component: CreateRoomPage,
});

function RoomPendingComponent() {
    return (
        <div className="mx-auto flex max-w-[480px] flex-col gap-4 px-4 py-10">
            <p className="text-muted-foreground">読み込み中...</p>
        </div>
    );
}

function RoomErrorComponent({ error }: { error: Error }) {
    const navigate = useNavigate();
    return (
        <div className="mx-auto flex max-w-[480px] flex-col gap-4 px-4 py-10">
            <p className="text-destructive">{error.message}</p>
            <button
                type="button"
                onClick={() => void navigate({ to: "/online", search: undefined })}
                className="text-sm text-muted-foreground hover:text-foreground"
            >
                ← オンライン対局に戻る
            </button>
        </div>
    );
}

const roomRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/online/$roomId",
    component: RoomPage,
    loader: async ({ params: { roomId } }) => {
        const res = await fetch(`/api/rooms/${roomId}`);
        if (res.status === 404) throw new Error("ルームが見つかりません");
        if (!res.ok) throw new Error("ルーム情報の取得に失敗しました");
        return res.json() as Promise<RoomInfo>;
    },
    pendingComponent: RoomPendingComponent,
    errorComponent: RoomErrorComponent,
    validateSearch: (search: Record<string, unknown>) => ({
        name: typeof search.name === "string" ? search.name : undefined,
        seat: typeof search.seat === "string" ? search.seat : undefined,
        mode: typeof search.mode === "string" ? search.mode : undefined,
    }),
});

const routeTree = rootRoute.addChildren([
    indexRoute,
    onlineRoute,
    authRoute,
    gamesRoute,
    gameDetailRoute,
    publicGameRoute,
    createRoomRoute,
    roomRoute,
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
    interface Register {
        router: typeof router;
    }
}
