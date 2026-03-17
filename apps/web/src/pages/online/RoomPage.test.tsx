import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// @shogi/engine-wasm のモック（useOnlineAnalysis が利用するため）
vi.mock("@shogi/engine-wasm", () => ({
    createWasmEngineClient: () => ({
        init: vi.fn().mockResolvedValue(undefined),
        setOption: vi.fn().mockResolvedValue(undefined),
        subscribe: vi.fn().mockReturnValue(() => {}),
        loadPosition: vi.fn().mockResolvedValue(undefined),
        search: vi.fn().mockResolvedValue({ cancel: vi.fn().mockResolvedValue(undefined) }),
        dispose: vi.fn().mockResolvedValue(undefined),
    }),
}));

// @tanstack/react-router のモック
const mockNavigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
    Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
    useNavigate: () => mockNavigate,
    useLocation: () => ({ pathname: "/online/test-room" }),
    useParams: () => ({ roomId: "test-room" }),
    // loader data は routeApi.useLoaderData() 経由で提供される
    getRouteApi: (_path: string) => ({
        useLoaderData: () => ROOM_INFO,
    }),
}));

// @shogi/match-client のモック
const mockSubscribe = vi.fn(() => () => {});
const mockClient = {
    join: vi.fn(),
    resume: vi.fn(),
    move: vi.fn(),
    resign: vi.fn(),
    consumeAnalysis: vi.fn(),
    ack: vi.fn(),
    sync: vi.fn(),
    ping: vi.fn(),
    subscribe: mockSubscribe,
    disconnect: vi.fn(),
    getStatus: vi.fn(() => "connected" as const),
};
vi.mock("@shogi/match-client", async () => {
    const actual =
        await vi.importActual<typeof import("@shogi/match-client")>("@shogi/match-client");
    return {
        ...actual,
        createRoomClient: vi.fn(() => mockClient),
    };
});

vi.mock("../../hooks/useAuthSession", () => ({
    useAuthSession: () => ({
        session: null,
    }),
    syncProfileDisplayNameIfNeeded: vi.fn().mockResolvedValue(undefined),
}));

const ROOM_INFO = {
    roomId: "test-room",
    status: "waiting",
    players: { b: null, w: null },
    spectators: 0,
    settings: {
        startSfen: "startpos",
        timeControl: { type: "byoyomi", initialMs: 600_000, byoyomiMs: 30_000 },
        passRights: null,
        aiSupport: null,
        takeback: false,
    },
};

const { default: RoomPage } = await import("./RoomPage");

describe("RoomPage", () => {
    beforeEach(() => {
        mockNavigate.mockClear();
        mockClient.disconnect.mockClear();
        mockSubscribe.mockClear();
        vi.unstubAllGlobals();
    });

    // ローディング中・エラー表示は TanStack Router の pendingComponent / errorComponent に移動済み
    // → router.tsx レベルでテスト対象

    it("ルーム情報の読み込み後、参加フォームを表示する", async () => {
        render(<RoomPage />);
        await waitFor(() => {
            expect(screen.getByRole("heading", { name: "対局ルーム" })).toBeTruthy();
            expect(screen.getByRole("heading", { name: "参加する" })).toBeTruthy();
        });
    });

    it("招待リンクが表示される", async () => {
        render(<RoomPage />);
        await waitFor(() => {
            expect(screen.getByText("招待リンク")).toBeTruthy();
        });
    });
});
