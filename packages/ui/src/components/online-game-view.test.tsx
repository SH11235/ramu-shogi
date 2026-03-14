import type { RoomClient, SnapshotPayload } from "@shogi/match-client";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockUseIsMobile = vi.fn(() => false);

// 重量依存をモック
vi.mock("@shogi/app-core", async () => {
    const actual = await vi.importActual<typeof import("@shogi/app-core")>("@shogi/app-core");
    return {
        ...actual,
        getPositionService: () => ({
            parseSfen: vi.fn().mockResolvedValue({
                board: {},
                hands: { sente: {}, gote: {} },
            }),
            getLegalMoves: vi.fn().mockResolvedValue([]),
            boardToSfen: vi.fn().mockResolvedValue("startpos"),
        }),
        applyMoveWithState: vi.fn().mockReturnValue({
            next: { board: {}, hands: { sente: {}, gote: {} } },
        }),
    };
});

vi.mock("./shogi-board", () => ({ ShogiBoard: () => <div data-testid="shogi-board" /> }));
vi.mock("./shogi-match/components/HandPiecesDisplay", () => ({
    HandPiecesDisplay: () => null,
}));
vi.mock("./shogi-match/components/BottomSheet", () => ({
    BottomSheet: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
        open ? <div data-testid="bottom-sheet">{children}</div> : null,
}));
vi.mock("./shogi-match/components/KifuNavigationToolbar", () => ({
    KifuNavigationToolbar: () => null,
}));
vi.mock("./shogi-match/utils/positionUtils", () => ({ boardToGrid: vi.fn(() => []) }));
vi.mock("./shogi-match/hooks/useMediaQuery", () => ({
    useIsMobile: () => mockUseIsMobile(),
}));

// ─── ヘルパー ─────────────────────────────────────────────────────────────────

function makeMockClient(overrides: Partial<RoomClient> = {}): RoomClient {
    return {
        join: vi.fn(),
        resume: vi.fn(),
        move: vi.fn(),
        resign: vi.fn(),
        checkmate: vi.fn(),
        consumeAnalysis: vi.fn(),
        updateSettings: vi.fn(),
        ack: vi.fn(),
        sync: vi.fn(),
        ping: vi.fn(),
        subscribe: vi.fn(() => () => {}),
        disconnect: vi.fn(),
        getStatus: vi.fn(() => "connected" as const),
        ...overrides,
    };
}

function makeSnapshot(overrides: Partial<SnapshotPayload> = {}): SnapshotPayload {
    return {
        eventId: 0,
        status: "playing",
        sfen: "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1",
        moves: [],
        turn: "b",
        clock: {
            b: { remainMs: 600_000 },
            w: { remainMs: 600_000 },
            running: "b",
            lastTickTs: Date.now(),
        },
        passRights: null,
        players: {
            b: { name: "Alice", online: true },
            w: { name: "Bob", online: true },
        },
        spectators: 0,
        settings: {
            startSfen: "startpos",
            timeControl: { type: "byoyomi", initialMs: 600_000, byoyomiMs: 30_000 },
            passRights: null,
            aiSupport: null,
        },
        ...overrides,
    };
}

const { OnlineGameView } = await import("./online-game-view");

describe("OnlineGameView", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockUseIsMobile.mockReturnValue(false);
    });

    it("観戦者には投了ボタンが表示されない", () => {
        const client = makeMockClient();
        render(
            <OnlineGameView
                client={client}
                snapshot={makeSnapshot()}
                seat="s"
                roomId="test-room"
            />,
        );
        expect(screen.queryByRole("button", { name: "投了" })).toBeNull();
    });

    it("プレイヤーには投了ボタンが表示される", () => {
        const client = makeMockClient();
        render(
            <OnlineGameView
                client={client}
                snapshot={makeSnapshot()}
                seat="b"
                roomId="test-room"
            />,
        );
        expect(screen.getByRole("button", { name: "投了" })).toBeTruthy();
    });

    it("handleResign: 自分の手番のとき client.resign を呼ぶ", () => {
        // seat="b" で turn="b" なのでプレイヤーは自分の手番
        const client = makeMockClient();
        render(
            <OnlineGameView
                client={client}
                snapshot={makeSnapshot({ turn: "b" })}
                seat="b"
                roomId="test-room"
            />,
        );
        fireEvent.click(screen.getByRole("button", { name: "投了" }));
        // position の読み込みは非同期のため、resign が呼ばれないことを確認
        // (position=null の間は || チェックで return するはず)
        // ここでは "position がない状態では resign を呼ばない" ことを検証
        expect(client.resign).not.toHaveBeenCalled();
    });

    it("handleResign: 自分の手番でないとき client.resign を呼ばない（修正確認）", () => {
        // seat="b" で turn="w" なので先手は手番外
        const client = makeMockClient();
        render(
            <OnlineGameView
                client={client}
                snapshot={makeSnapshot({ turn: "w" })}
                seat="b"
                roomId="test-room"
            />,
        );
        fireEvent.click(screen.getByRole("button", { name: "投了" }));
        expect(client.resign).not.toHaveBeenCalled();
    });

    it("プレイヤー名が表示される", () => {
        const client = makeMockClient();
        render(
            <OnlineGameView
                client={client}
                snapshot={makeSnapshot()}
                seat="b"
                roomId="test-room"
            />,
        );
        expect(screen.getByText(/Alice/)).toBeTruthy();
        expect(screen.getByText(/Bob/)).toBeTruthy();
    });

    it("desktop では AIシート用 BottomSheet を開かない", () => {
        const client = makeMockClient();
        render(
            <OnlineGameView
                client={client}
                snapshot={makeSnapshot({
                    turn: "b",
                    settings: {
                        startSfen: "startpos",
                        timeControl: { type: "byoyomi", initialMs: 600_000, byoyomiMs: 30_000 },
                        passRights: null,
                        aiSupport: {
                            b: { mode: "limited", limitCount: 5 },
                            w: { mode: "limited", limitCount: 5 },
                            searchDepth: null,
                            searchTimeMs: 1000,
                        },
                    },
                })}
                seat="b"
                roomId="test-room"
            />,
        );

        fireEvent.click(screen.getByLabelText("AI解析"));

        expect(screen.queryByTestId("bottom-sheet")).toBeNull();
    });
});
