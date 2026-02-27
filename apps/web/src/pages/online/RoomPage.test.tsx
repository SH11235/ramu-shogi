import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// @tanstack/react-router のモック
const mockNavigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
    useNavigate: () => mockNavigate,
    useParams: () => ({ roomId: "test-room" }),
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

    it("ローディング中テキストを表示する", () => {
        vi.stubGlobal(
            "fetch",
            vi
                .fn()
                .mockReturnValue(new Promise(() => {})), // 解決しない Promise
        );
        render(<RoomPage />);
        expect(screen.getByText("読み込み中...")).toBeTruthy();
    });

    it("ルームが見つからない場合エラーを表示する", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue({
                ok: false,
                status: 404,
                json: () => Promise.resolve({ message: "Not found" }),
            }),
        );
        render(<RoomPage />);
        await waitFor(() => {
            expect(screen.getByText("ルームが見つかりません")).toBeTruthy();
        });
    });

    it("ルーム情報の読み込み後、参加フォームを表示する", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve(ROOM_INFO),
            }),
        );
        render(<RoomPage />);
        await waitFor(() => {
            expect(screen.getByText("対局ルーム")).toBeTruthy();
            expect(screen.getByText("参加する")).toBeTruthy();
        });
    });

    it("招待リンクが表示される", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve(ROOM_INFO),
            }),
        );
        render(<RoomPage />);
        await waitFor(() => {
            expect(screen.getByText("招待リンク")).toBeTruthy();
        });
    });
});
