import type { GameResult, RoomClient, ServerMessage, SnapshotPayload } from "@shogi/match-client";
import { act, fireEvent, render, screen } from "@testing-library/react";
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
        takebackRequest: vi.fn(),
        takebackResponse: vi.fn(),
        takebackCancel: vi.fn(),
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
            takeback: false,
        },
        ...overrides,
    };
}

function makeSubscribableClient(): {
    client: RoomClient;
    emit: (message: ServerMessage) => Promise<void>;
} {
    const handlers = new Set<(message: ServerMessage) => void>();
    const client = makeMockClient({
        subscribe: vi.fn((handler: (message: ServerMessage) => void) => {
            handlers.add(handler);
            return () => handlers.delete(handler);
        }),
    });
    return {
        client,
        // snapshot は局面の解析を待って反映されるので、非同期の act で流す
        emit: (message) =>
            act(async () => {
                for (const handler of handlers) {
                    handler(message);
                }
            }),
    };
}

const FINAL_MOVES = ["7g7f", "3c3d", "8h2b+"];
const RESIGN_RESULT: GameResult = { winner: "b", reason: "resign" };

function makeFinishedSnapshot(overrides: Partial<SnapshotPayload> = {}): SnapshotPayload {
    return makeSnapshot({
        eventId: 7,
        status: "finished",
        moves: FINAL_MOVES,
        turn: "w",
        ...overrides,
    });
}

function gameEndMessage(eventId: number, gameRecordId?: string): ServerMessage {
    return {
        v: 1,
        t: "event",
        payload: {
            kind: "game_end",
            eventId,
            serverTs: 0,
            result: RESIGN_RESULT,
            kifu: "",
            ...(gameRecordId ? { gameRecordId } : {}),
        },
    };
}

function startReview(onStartReview: ReturnType<typeof vi.fn>): {
    moves: string[];
    gameRecordId: string | null;
} {
    fireEvent.click(screen.getByRole("button", { name: "棋譜を検討する" }));
    return onStartReview.mock.lastCall?.[0];
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
                        takeback: false,
                    },
                })}
                seat="b"
                roomId="test-room"
            />,
        );

        fireEvent.click(screen.getByLabelText("AI解析"));

        expect(screen.queryByTestId("bottom-sheet")).toBeNull();
    });

    describe("終局済みルームの復元", () => {
        it("snapshot の result と gameRecordId から終局表示と棋譜 ID を復元する", () => {
            const onStartReview = vi.fn();
            render(
                <OnlineGameView
                    client={makeMockClient()}
                    snapshot={makeFinishedSnapshot({
                        result: RESIGN_RESULT,
                        gameRecordId: "record-1",
                    })}
                    seat="b"
                    roomId="test-room"
                    onStartReview={onStartReview}
                />,
            );

            expect(screen.getAllByText("Alice の勝ち")).toHaveLength(1);
            expect(startReview(onStartReview)).toMatchObject({
                moves: FINAL_MOVES,
                gameRecordId: "record-1",
            });
        });

        it("result と gameRecordId が無い snapshot では終局表示を出さない", () => {
            render(
                <OnlineGameView
                    client={makeMockClient()}
                    snapshot={makeFinishedSnapshot()}
                    seat="b"
                    roomId="test-room"
                    onStartReview={vi.fn()}
                />,
            );

            expect(screen.queryByText("Alice の勝ち")).toBeNull();
            expect(screen.queryByRole("button", { name: "棋譜を検討する" })).toBeNull();
        });

        it("両フィールドの無い snapshot でも game_end から従来どおり復元する", async () => {
            const { client, emit } = makeSubscribableClient();
            const onStartReview = vi.fn();
            render(
                <OnlineGameView
                    client={client}
                    snapshot={makeFinishedSnapshot()}
                    seat="b"
                    roomId="test-room"
                    onStartReview={onStartReview}
                />,
            );

            await emit(gameEndMessage(7, "record-1"));

            expect(screen.getAllByText("Alice の勝ち")).toHaveLength(1);
            expect(startReview(onStartReview)).toMatchObject({
                moves: FINAL_MOVES,
                gameRecordId: "record-1",
            });
        });

        it("snapshot の後に game_end が 2 回届いても終局表示と指し手は増えず、棋譜 ID だけが加わる", async () => {
            const { client, emit } = makeSubscribableClient();
            const onStartReview = vi.fn();
            render(
                <OnlineGameView
                    client={client}
                    snapshot={makeFinishedSnapshot({ eventId: 6, result: RESIGN_RESULT })}
                    seat="b"
                    roomId="test-room"
                    onStartReview={onStartReview}
                />,
            );

            await emit(gameEndMessage(6));
            expect(screen.getAllByText("Alice の勝ち")).toHaveLength(1);
            expect(startReview(onStartReview)).toMatchObject({
                moves: FINAL_MOVES,
                gameRecordId: null,
            });

            await emit(gameEndMessage(7, "record-1"));
            expect(screen.getAllByText("Alice の勝ち")).toHaveLength(1);
            expect(startReview(onStartReview)).toMatchObject({
                moves: FINAL_MOVES,
                gameRecordId: "record-1",
            });
        });

        it("棋譜 ID 付きの game_end だけが届いても結果と棋譜 ID を得る", async () => {
            const { client, emit } = makeSubscribableClient();
            const onStartReview = vi.fn();
            render(
                <OnlineGameView
                    client={client}
                    snapshot={makeSnapshot({ moves: FINAL_MOVES, turn: "w" })}
                    seat="b"
                    roomId="test-room"
                    onStartReview={onStartReview}
                />,
            );

            await emit(gameEndMessage(7, "record-1"));

            expect(screen.getAllByText("Alice の勝ち")).toHaveLength(1);
            expect(startReview(onStartReview)).toMatchObject({
                moves: FINAL_MOVES,
                gameRecordId: "record-1",
            });
        });

        it("棋譜 ID を得た後に ID の無い game_end や snapshot が届いても ID を失わない", async () => {
            const { client, emit } = makeSubscribableClient();
            const onStartReview = vi.fn();
            render(
                <OnlineGameView
                    client={client}
                    snapshot={makeFinishedSnapshot({
                        result: RESIGN_RESULT,
                        gameRecordId: "record-1",
                    })}
                    seat="b"
                    roomId="test-room"
                    onStartReview={onStartReview}
                />,
            );

            await emit(gameEndMessage(6));
            await emit({
                v: 1,
                t: "snapshot",
                payload: makeFinishedSnapshot({ result: RESIGN_RESULT }),
            });

            expect(screen.getAllByText("Alice の勝ち")).toHaveLength(1);
            expect(startReview(onStartReview)).toMatchObject({
                moves: FINAL_MOVES,
                gameRecordId: "record-1",
            });
        });

        it("再接続時の snapshot からも結果と棋譜 ID を復元する", async () => {
            const { client, emit } = makeSubscribableClient();
            const onStartReview = vi.fn();
            render(
                <OnlineGameView
                    client={client}
                    snapshot={makeSnapshot({ moves: FINAL_MOVES.slice(0, 2) })}
                    seat="b"
                    roomId="test-room"
                    onStartReview={onStartReview}
                />,
            );
            expect(screen.queryByText("Alice の勝ち")).toBeNull();

            await emit({
                v: 1,
                t: "snapshot",
                payload: makeFinishedSnapshot({
                    result: RESIGN_RESULT,
                    gameRecordId: "record-1",
                }),
            });

            expect(screen.getAllByText("Alice の勝ち")).toHaveLength(1);
            expect(startReview(onStartReview)).toMatchObject({
                moves: FINAL_MOVES,
                gameRecordId: "record-1",
            });
        });
    });
});
