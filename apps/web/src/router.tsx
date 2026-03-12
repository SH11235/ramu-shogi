import type {
    GameRecordDetail,
    GameRecordSummary,
    GetGameResponse,
    GetPublicGameResponse,
    ListAnalysisSnapshotsResponse,
    ListGamesResponse,
    RoomInfo,
} from "@shogi/api-contract";
import { createRootRoute, createRoute, createRouter, useNavigate } from "@tanstack/react-router";
import App from "./App";
import { AppProviders } from "./AppProviders";
import AuthPage from "./pages/auth/AuthPage";
import GameDetailPage from "./pages/games/GameDetailPage";
import GameReviewPage from "./pages/games/GameReviewPage";
import GamesPage from "./pages/games/GamesPage";
import PublicGamePage from "./pages/games/PublicGamePage";
import NnueFilesPage from "./pages/nnue/NnueFilesPage";
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

interface GamesRouteLoaderData {
    needsAuth: boolean;
    games: GameRecordSummary[];
}

async function fetchGamesLoaderData(): Promise<GamesRouteLoaderData> {
    const response = await fetch("/api/games", {
        credentials: "same-origin",
    });

    if (response.status === 401) {
        return {
            needsAuth: true,
            games: [],
        };
    }

    if (!response.ok) {
        throw new Error("棋譜一覧の取得に失敗しました");
    }

    const payload = (await response.json()) as ListGamesResponse;
    return {
        needsAuth: false,
        games: payload.games,
    };
}

const gamesRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/games",
    component: GamesPage,
    loader: fetchGamesLoaderData,
});

const gameDetailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/games/$gameId",
    component: GameDetailPage,
    loader: async ({ params: { gameId } }) => {
        const response = await fetch(`/api/games/${gameId}`, {
            credentials: "same-origin",
        });

        if (response.status === 401) {
            throw new Error("ログインが必要です");
        }
        if (response.status === 404) {
            throw new Error("棋譜が見つかりません");
        }
        if (!response.ok) {
            throw new Error("棋譜の取得に失敗しました");
        }

        const payload = (await response.json()) as GetGameResponse;
        return payload.game satisfies GameRecordDetail;
    },
});

const gameReviewRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/games/$gameId/review",
    component: GameReviewPage,
    loader: async ({ params: { gameId } }) => {
        const [gameResponse, snapshotsResponse] = await Promise.all([
            fetch(`/api/games/${gameId}`, {
                credentials: "same-origin",
            }),
            fetch(`/api/games/${gameId}/analysis-snapshots`, {
                credentials: "same-origin",
            }),
        ]);

        if (gameResponse.status === 401 || snapshotsResponse.status === 401) {
            throw new Error("ログインが必要です");
        }
        if (gameResponse.status === 404) {
            throw new Error("棋譜が見つかりません");
        }
        if (!gameResponse.ok || !snapshotsResponse.ok) {
            throw new Error("検討データの取得に失敗しました");
        }

        const gamePayload = (await gameResponse.json()) as GetGameResponse;
        const snapshotsPayload = (await snapshotsResponse.json()) as ListAnalysisSnapshotsResponse;

        return {
            game: gamePayload.game,
            snapshots: snapshotsPayload.snapshots,
        };
    },
});

const publicGameRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/public/games/$publicId",
    component: PublicGamePage,
    loader: async ({ params: { publicId } }) => {
        const response = await fetch(`/api/public/games/${publicId}`, {
            credentials: "same-origin",
        });

        if (response.status === 404) {
            throw new Error("棋譜が見つかりません");
        }
        if (!response.ok) {
            throw new Error("棋譜の取得に失敗しました");
        }

        const payload = (await response.json()) as GetPublicGameResponse;
        return payload.game satisfies GameRecordDetail;
    },
});

const nnueFilesRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/nnue",
    component: NnueFilesPage,
    loader: async () => {
        const response = await fetch("/api/nnue/files", {
            credentials: "same-origin",
        });

        if (response.status === 401) {
            return {
                needsAuth: true,
                files: [],
            };
        }
        if (!response.ok) {
            throw new Error("NNUE 一覧の取得に失敗しました");
        }

        return {
            needsAuth: false,
            files: (await response.json()).files,
        };
    },
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
    gameReviewRoute,
    publicGameRoute,
    nnueFilesRoute,
    createRoomRoute,
    roomRoute,
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
    interface Register {
        router: typeof router;
    }
}
