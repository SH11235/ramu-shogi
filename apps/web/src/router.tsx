import type {
    GameRecordDetail,
    GameRecordSummary,
    GetGameResponse,
    GetPublicGameResponse,
    ListAnalysisSnapshotsResponse,
    ListGamesResponse,
    ListPublicGamesResponse,
    RoomInfo,
} from "@shogi/api-contract";
import {
    createRootRoute,
    createRoute,
    createRouter,
    lazyRouteComponent,
    redirect,
    useNavigate,
} from "@tanstack/react-router";
import { AppProviders } from "./AppProviders";
import { handleLoaderResponse } from "./router-loader-utils";

const rootRoute = createRootRoute({
    component: AppProviders,
});

const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    // ホーム (`/`) は ShogiMatch を使うため唯一 shogi-match chunk を必要とするページ。
    // eager にすると entry の静的グラフに shogi-match(~420KB) が入り全ルートで
    // modulepreload されるため、ここも lazy 化して観戦等の critical path から外す。
    component: lazyRouteComponent(() => import("./App")),
});

const onlineRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/online",
    component: lazyRouteComponent(() => import("./pages/online/OnlinePage")),
});

const authRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/auth",
    component: lazyRouteComponent(() => import("./pages/auth/AuthPage")),
});

interface GamesRouteLoaderData {
    needsAuth: boolean;
    games: GameRecordSummary[];
}

async function fetchGamesLoaderData(): Promise<GamesRouteLoaderData> {
    const response = await fetch("/api/games", {
        credentials: "same-origin",
    });

    if (
        handleLoaderResponse(response, {
            errorMessage: "棋譜一覧の取得に失敗しました",
            onUnauthorized: "return_needs_auth",
        }) === "needs_auth"
    ) {
        return {
            needsAuth: true,
            games: [],
        };
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
    component: lazyRouteComponent(() => import("./pages/games/GamesPage")),
    loader: fetchGamesLoaderData,
});

// UUID 形式 = auth 必須の `/api/games/<id>` (online_room / local_app / import)。
// 非 UUID 形式 = auth 不要の `/public/games/<id>` (csa_relay: `<room_id>-<unix_ms>`)。
// この対応関係が変わる場合 (非 UUID の auth 必須 ID が増える / UUID の public ID が
// 出る等) はルーティング戦略の見直しが必要 (issue #613)。
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const gameDetailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/games/$gameId",
    component: lazyRouteComponent(() => import("./pages/games/GameDetailPage")),
    loader: async ({ params: { gameId } }) => {
        if (!UUID_RE.test(gameId)) {
            throw redirect({
                to: "/public/games/$publicId",
                params: { publicId: gameId },
            });
        }
        const response = await fetch(`/api/games/${gameId}`, {
            credentials: "same-origin",
        });

        handleLoaderResponse(response, {
            errorMessage: "棋譜の取得に失敗しました",
            notFoundMessage: "棋譜が見つかりません",
            onUnauthorized: "redirect_to_auth",
        });

        const payload = (await response.json()) as GetGameResponse;
        return payload.game satisfies GameRecordDetail;
    },
});

const gameReviewRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/games/$gameId/review",
    component: lazyRouteComponent(() => import("./pages/games/GameReviewPage")),
    loader: async ({ params: { gameId } }) => {
        const [gameResponse, snapshotsResponse] = await Promise.all([
            fetch(`/api/games/${gameId}`, {
                credentials: "same-origin",
            }),
            fetch(`/api/games/${gameId}/analysis-snapshots`, {
                credentials: "same-origin",
            }),
        ]);

        handleLoaderResponse(gameResponse, {
            errorMessage: "検討データの取得に失敗しました",
            notFoundMessage: "棋譜が見つかりません",
            onUnauthorized: "redirect_to_auth",
        });
        handleLoaderResponse(snapshotsResponse, {
            errorMessage: "検討データの取得に失敗しました",
            onUnauthorized: "redirect_to_auth",
        });

        const gamePayload = (await gameResponse.json()) as GetGameResponse;
        const snapshotsPayload = (await snapshotsResponse.json()) as ListAnalysisSnapshotsResponse;

        return {
            game: gamePayload.game,
            snapshots: snapshotsPayload.snapshots,
        };
    },
});

const publicGamesRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/public/games",
    component: lazyRouteComponent(() => import("./pages/games/PublicGamesPage")),
    loader: async () => {
        const response = await fetch("/api/public/games");

        handleLoaderResponse(response, {
            errorMessage: "公開棋譜の取得に失敗しました",
        });

        const payload = (await response.json()) as ListPublicGamesResponse;
        return {
            games: payload.games,
            nextCursor: payload.nextCursor,
        };
    },
});

const publicGameRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/public/games/$publicId",
    component: lazyRouteComponent(() => import("./pages/games/PublicGamePage")),
    loader: async ({ params: { publicId } }) => {
        const response = await fetch(`/api/public/games/${publicId}`, {
            credentials: "same-origin",
        });

        handleLoaderResponse(response, {
            errorMessage: "棋譜の取得に失敗しました",
            notFoundMessage: "棋譜が見つかりません",
        });

        const payload = (await response.json()) as GetPublicGameResponse;
        return payload.game satisfies GameRecordDetail;
    },
});

const nnueFilesRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/nnue",
    component: lazyRouteComponent(() => import("./pages/nnue/NnueFilesPage")),
    loader: async () => {
        const response = await fetch("/api/nnue/files", {
            credentials: "same-origin",
        });

        if (
            handleLoaderResponse(response, {
                errorMessage: "NNUE 一覧の取得に失敗しました",
                onUnauthorized: "return_needs_auth",
            }) === "needs_auth"
        ) {
            return {
                needsAuth: true,
                files: [],
            };
        }

        return {
            needsAuth: false,
            files: (await response.json()).files,
        };
    },
});

const privacyRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/privacy",
    component: lazyRouteComponent(() => import("./pages/privacy/PrivacyPage")),
});

const rshogiViewerListRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/rshogi-viewer",
    component: lazyRouteComponent(() => import("./pages/rshogi-viewer/RshogiViewerListPage")),
});

// 進行中対局一覧 (静的 path)。単局 `/rshogi-viewer/live/$gameId` とはセグメント数が
// 異なるため衝突しない。単局 `/rshogi-viewer/$gameId` より前に登録して、`live` を
// gameId として誤解決しないようにする。
const rshogiViewerLiveListRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/rshogi-viewer/live",
    component: lazyRouteComponent(() => import("./pages/rshogi-viewer/RshogiLiveGamesPage")),
});

// `/rshogi-viewer/live/$gameId` は単局 `/rshogi-viewer/$gameId` よりも前に
// 登録する必要がある (TanStack Router は登録順で path 解決する)。
const rshogiViewerLiveRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/rshogi-viewer/live/$gameId",
    component: lazyRouteComponent(() => import("./pages/rshogi-viewer/RshogiViewerLivePage")),
});

const rshogiViewerRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/rshogi-viewer/$gameId",
    component: lazyRouteComponent(() => import("./pages/rshogi-viewer/RshogiViewerPage")),
});

const createRoomRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/online/create",
    component: lazyRouteComponent(() => import("./pages/online/CreateRoomPage")),
});

function DefaultPendingComponent() {
    return (
        <div className="mx-auto flex max-w-[480px] flex-col gap-4 px-4 py-10">
            <p className="text-muted-foreground">読み込み中...</p>
        </div>
    );
}

// lazy route の chunk fetch が恒久的に失敗した場合 (stale deploy の reload を
// 消化し切った後など) の共通フォールバック。未スタイルの既定 error 画面を出さず、
// 再読み込み導線を持つ最小 UI を出す。
function DefaultErrorComponent({ error }: { error: Error }) {
    return (
        <div className="mx-auto flex max-w-[480px] flex-col gap-4 px-4 py-10">
            <p className="text-destructive">
                ページの読み込みに失敗しました。ネットワークを確認して再読み込みしてください。
            </p>
            <p className="text-xs text-muted-foreground">{error.message}</p>
            <button
                type="button"
                onClick={() => window.location.reload()}
                className="self-start text-sm text-muted-foreground hover:text-foreground"
            >
                再読み込み
            </button>
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
    component: lazyRouteComponent(() => import("./pages/online/RoomPage")),
    loader: async ({ params: { roomId } }) => {
        const res = await fetch(`/api/rooms/${roomId}`);
        handleLoaderResponse(res, {
            errorMessage: "ルーム情報の取得に失敗しました",
            notFoundMessage: "ルームが見つかりません",
        });
        return res.json() as Promise<RoomInfo>;
    },
    pendingComponent: DefaultPendingComponent,
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
    privacyRoute,
    gamesRoute,
    gameDetailRoute,
    gameReviewRoute,
    publicGamesRoute,
    publicGameRoute,
    nnueFilesRoute,
    createRoomRoute,
    roomRoute,
    rshogiViewerListRoute,
    rshogiViewerLiveListRoute,
    rshogiViewerLiveRoute,
    rshogiViewerRoute,
]);

export const router = createRouter({
    routeTree,
    defaultPendingComponent: DefaultPendingComponent,
    defaultErrorComponent: DefaultErrorComponent,
});

declare module "@tanstack/react-router" {
    interface Register {
        router: typeof router;
    }
}
