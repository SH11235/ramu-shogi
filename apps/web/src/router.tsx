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
import AuthPage from "./pages/auth/AuthPage";
import GameDetailPage from "./pages/games/GameDetailPage";
import GamesPage from "./pages/games/GamesPage";
import PublicGamesPage from "./pages/games/PublicGamesPage";
import LandingPage from "./pages/LandingPage";
import NnueFilesPage from "./pages/nnue/NnueFilesPage";
import CreateRoomPage from "./pages/online/CreateRoomPage";
import OnlinePage from "./pages/online/OnlinePage";
import PrivacyPage from "./pages/privacy/PrivacyPage";
import RshogiLiveGamesPage from "./pages/rshogi-viewer/RshogiLiveGamesPage";
import RshogiViewerListPage from "./pages/rshogi-viewer/RshogiViewerListPage";
import RshogiViewerLivePage from "./pages/rshogi-viewer/RshogiViewerLivePage";
import RshogiViewerPage from "./pages/rshogi-viewer/RshogiViewerPage";
import { handleLoaderResponse } from "./router-loader-utils";

const rootRoute = createRootRoute({
    component: AppProviders,
});

const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: LandingPage,
});

function PlayPendingComponent() {
    return (
        <div className="mx-auto flex max-w-[480px] flex-col gap-4 px-4 py-10">
            <p className="text-muted-foreground">対局盤を読み込み中...</p>
        </div>
    );
}

// 遅延ロードするページ共通の pending 表示。ShogiMatch / engine-wasm を含む重量級
// ページ (対局・検討・オンライン対局・公開棋譜閲覧) はチャンク分割し、エントリ
// (トップや一覧ページ) の初期ロードに載せない。
function PagePendingComponent() {
    return (
        <div className="mx-auto flex max-w-[480px] flex-col gap-4 px-4 py-10">
            <p className="text-muted-foreground">読み込み中...</p>
        </div>
    );
}

// 対局盤。以前は `/` に置いていたが、トップは迎える面(LandingPage)に譲り、
// 盤そのものは `/play` へ移設した。App は起動時に sessionStorage `ramu_review_kifu`
// を読んで検討を復元する処理を持つ(書き込み側は現状 repo 内に無く、外部/将来の導線用)
// ため、その読み取りごと App が /play へ移動している。
// App のモジュールグラフは engine-wasm(モジュールレベルで panelEngine を生成) と
// ShogiMatch 一式を含み重いので、lazyRouteComponent で /play チャンクに分離し、
// トップ(/)の初期ロードに載せない。
const playRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/play",
    component: lazyRouteComponent(() => import("./App")),
    pendingComponent: PlayPendingComponent,
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
    component: GamesPage,
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
    component: GameDetailPage,
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
    pendingComponent: PagePendingComponent,
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
    component: PublicGamesPage,
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
    pendingComponent: PagePendingComponent,
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
    component: NnueFilesPage,
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
    component: PrivacyPage,
});

const rshogiViewerListRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/rshogi-viewer",
    component: RshogiViewerListPage,
});

// 進行中対局一覧 (静的 path)。単局 `/rshogi-viewer/live/$gameId` とはセグメント数が
// 異なるため衝突しない。単局 `/rshogi-viewer/$gameId` より前に登録して、`live` を
// gameId として誤解決しないようにする。
const rshogiViewerLiveListRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/rshogi-viewer/live",
    component: RshogiLiveGamesPage,
});

// `/rshogi-viewer/live/$gameId` は単局 `/rshogi-viewer/$gameId` よりも前に
// 登録する必要がある (TanStack Router は登録順で path 解決する)。
const rshogiViewerLiveRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/rshogi-viewer/live/$gameId",
    component: RshogiViewerLivePage,
});

const rshogiViewerRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/rshogi-viewer/$gameId",
    component: RshogiViewerPage,
});

const createRoomRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/online/create",
    component: CreateRoomPage,
});

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
    pendingComponent: PagePendingComponent,
    errorComponent: RoomErrorComponent,
    validateSearch: (search: Record<string, unknown>) => ({
        name: typeof search.name === "string" ? search.name : undefined,
        seat: typeof search.seat === "string" ? search.seat : undefined,
        mode: typeof search.mode === "string" ? search.mode : undefined,
    }),
});

const routeTree = rootRoute.addChildren([
    indexRoute,
    playRoute,
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

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
    interface Register {
        router: typeof router;
    }
}
