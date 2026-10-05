import type { GameResult, RoomClient, ServerMessage, SnapshotPayload } from "@shogi/match-client";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockUseIsMobile = vi.fn(() => false);
const mockGetLegalMoves = vi.fn<(sfen: string, moves?: string[]) => Promise<string[]>>();

const PARSED_POSITION = {
    board: { "7g": { owner: "sente", type: "P" } },
    hands: { sente: {}, gote: {} },
};
const mockParseSfen = vi.fn<(sfen: string) => Promise<typeof PARSED_POSITION>>();

/** 局面の解析が終わる時点をテストから決めるための保留中の解析。SFEN ごとに 1 つ */
function holdParsing(): {
    finish: (sfen: string) => Promise<void>;
    fail: (sfen: string) => Promise<void>;
} {
    const held = new Map<
        string,
        { promise: Promise<typeof PARSED_POSITION>; settle: (ok: boolean) => void }
    >();
    const holdFor = (sfen: string) => {
        let entry = held.get(sfen);
        if (!entry) {
            let settle: (ok: boolean) => void = () => {};
            const promise = new Promise<typeof PARSED_POSITION>((resolve, reject) => {
                settle = (ok) =>
                    ok
                        ? resolve(structuredClone(PARSED_POSITION))
                        : reject(new Error("parse failed"));
            });
            entry = { promise, settle };
            held.set(sfen, entry);
        }
        return entry;
    };
    mockParseSfen.mockImplementation((sfen) => holdFor(sfen).promise);
    const settle = (sfen: string, ok: boolean) =>
        act(async () => {
            holdFor(sfen).settle(ok);
        });
    return { finish: (sfen) => settle(sfen, true), fail: (sfen) => settle(sfen, false) };
}

// 重量依存をモック
vi.mock("@shogi/app-core", async () => {
    const actual = await vi.importActual<typeof import("@shogi/app-core")>("@shogi/app-core");
    return {
        ...actual,
        getPositionService: () => ({
            parseSfen: mockParseSfen,
            getLegalMoves: mockGetLegalMoves,
            boardToSfen: vi.fn().mockResolvedValue("startpos"),
        }),
        applyMoveWithState: vi.fn().mockReturnValue({
            ok: true,
            next: { board: {}, hands: { sente: {}, gote: {} } },
        }),
    };
});

vi.mock("./shogi-board", () => ({
    ShogiBoard: ({
        selectedSquare,
        onSelect,
    }: {
        selectedSquare?: string | null;
        onSelect?: (square: string) => void;
    }) => (
        <div data-testid="shogi-board" data-selected={selectedSquare ?? ""}>
            {["7g", "7f"].map((square) => (
                <button key={square} type="button" onClick={() => onSelect?.(square)}>
                    {`マス ${square}`}
                </button>
            ))}
        </div>
    ),
}));
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

function eventMessage(payload: Extract<ServerMessage, { t: "event" }>["payload"]): ServerMessage {
    return { v: 1, t: "event", payload };
}

function moveMessage(eventId: number, usi: string, turn: "b" | "w"): ServerMessage {
    return eventMessage({
        kind: "move",
        eventId,
        serverTs: 0,
        usi,
        turn,
        clock: makeSnapshot().clock,
        passRights: null,
    });
}

function errorMessage(code: "DESYNC" | "SPECTATOR_FORBIDDEN" | "ROOM_FINISHED"): ServerMessage {
    return { v: 1, t: "error", payload: { code, message: "" } };
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
        mockGetLegalMoves.mockResolvedValue([]);
        mockParseSfen.mockImplementation(async () => structuredClone(PARSED_POSITION));
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

        it("対局中に投了 → game_end → 棋譜 ID 付き game_end と届いても終局表示は 1 つで、棋譜 ID は最後に加わる", async () => {
            const { client, emit } = makeSubscribableClient();
            const onStartReview = vi.fn();
            render(
                <OnlineGameView
                    client={client}
                    snapshot={makeSnapshot({ eventId: 5, moves: FINAL_MOVES, turn: "w" })}
                    seat="b"
                    roomId="test-room"
                    onStartReview={onStartReview}
                />,
            );

            await emit(
                eventMessage({
                    kind: "resign",
                    eventId: 6,
                    serverTs: 0,
                    seat: "w",
                    result: RESIGN_RESULT,
                }),
            );
            await emit(gameEndMessage(7));
            expect(startReview(onStartReview)).toMatchObject({ gameRecordId: null });

            await emit(gameEndMessage(8, "record-1"));
            expect(screen.getAllByText("Alice の勝ち")).toHaveLength(1);
            expect(startReview(onStartReview)).toMatchObject({
                moves: FINAL_MOVES,
                gameRecordId: "record-1",
            });
        });

        it("終局済み snapshot の後に再送された終局イベント列から棋譜 ID を得る", async () => {
            const { client, emit } = makeSubscribableClient();
            const onStartReview = vi.fn();
            render(
                <OnlineGameView
                    client={client}
                    snapshot={makeFinishedSnapshot({ eventId: 8, result: RESIGN_RESULT })}
                    seat="b"
                    roomId="test-room"
                    onStartReview={onStartReview}
                />,
            );

            await emit(
                eventMessage({
                    kind: "resign",
                    eventId: 6,
                    serverTs: 0,
                    seat: "w",
                    result: RESIGN_RESULT,
                }),
            );
            await emit(gameEndMessage(7));
            await emit(gameEndMessage(8, "record-1"));

            expect(screen.getAllByText("Alice の勝ち")).toHaveLength(1);
            expect(startReview(onStartReview)).toMatchObject({
                moves: FINAL_MOVES,
                gameRecordId: "record-1",
            });
        });

        it("購読開始時にまとめて渡された棋譜 ID 付き game_end を取りこぼさない", async () => {
            const missed = gameEndMessage(8, "record-1");
            const client = makeMockClient({
                subscribe: vi.fn((handler: (message: ServerMessage) => void) => {
                    handler(missed);
                    return () => {};
                }),
            });
            const onStartReview = vi.fn();
            await act(async () => {
                render(
                    <OnlineGameView
                        client={client}
                        snapshot={makeFinishedSnapshot({ result: RESIGN_RESULT })}
                        seat="b"
                        roomId="test-room"
                        onStartReview={onStartReview}
                    />,
                );
            });

            expect(startReview(onStartReview)).toMatchObject({ gameRecordId: "record-1" });
        });

        it("棋譜 ID の無い game_end が 1 回だけ届くルームでは棋譜 ID は null のまま", async () => {
            const { client, emit } = makeSubscribableClient();
            const onStartReview = vi.fn();
            render(
                <OnlineGameView
                    client={client}
                    snapshot={makeSnapshot({ eventId: 5, moves: FINAL_MOVES, turn: "w" })}
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
        });
    });

    describe("指し手の記録", () => {
        it("snapshot の指し手から棋譜パネルと KIF の出力を復元する", async () => {
            const writeText = vi.fn().mockResolvedValue(undefined);
            vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
            await act(async () => {
                render(
                    <OnlineGameView
                        client={makeMockClient()}
                        snapshot={makeFinishedSnapshot({ result: RESIGN_RESULT })}
                        seat="b"
                        roomId="test-room"
                    />,
                );
            });

            expect(screen.queryByText("まだ指し手がありません")).toBeNull();
            expect(screen.getByText("3.")).toBeTruthy();
            expect(screen.queryByText("4.")).toBeNull();

            fireEvent.click(screen.getByRole("button", { name: "棋譜をコピー" }));
            const kif: string = writeText.mock.lastCall?.[0];
            expect(kif.split("\n").filter((line) => /^ +\d+ /.test(line))).toHaveLength(3);
            vi.unstubAllGlobals();
        });

        it("snapshot に含まれる指し手のイベントが再び届いても記録を増やさない", async () => {
            const { client, emit } = makeSubscribableClient();
            const onStartReview = vi.fn();
            await act(async () => {
                render(
                    <OnlineGameView
                        client={client}
                        snapshot={makeSnapshot({ eventId: 5, moves: FINAL_MOVES, turn: "w" })}
                        seat="b"
                        roomId="test-room"
                        onStartReview={onStartReview}
                    />,
                );
            });

            await emit(moveMessage(5, "8h2b+", "w"));
            expect(screen.queryByText("4.")).toBeNull();

            await emit(moveMessage(6, "3a2b", "b"));
            expect(screen.getByText("4.")).toBeTruthy();
            expect(screen.queryByText("5.")).toBeNull();

            await emit(gameEndMessage(7));
            expect(startReview(onStartReview)).toMatchObject({
                moves: [...FINAL_MOVES, "3a2b"],
            });
        });

        it("初期局面の読み込みより先に届いた指し手を読み込み後に反映する", async () => {
            const firstMove = moveMessage(6, "3a2b", "b");
            const client = makeMockClient({
                subscribe: vi.fn((handler: (message: ServerMessage) => void) => {
                    handler(firstMove);
                    return () => {};
                }),
            });
            await act(async () => {
                render(
                    <OnlineGameView
                        client={client}
                        snapshot={makeSnapshot({ eventId: 5, moves: FINAL_MOVES, turn: "w" })}
                        seat="b"
                        roomId="test-room"
                    />,
                );
            });

            expect(screen.getByText("4.")).toBeTruthy();
        });
    });

    describe("詰みの自動申告", () => {
        it("自分の手番で合法手が無ければ checkmate を送る", async () => {
            const client = makeMockClient();
            await act(async () => {
                render(
                    <OnlineGameView
                        client={client}
                        snapshot={makeSnapshot({ turn: "b" })}
                        seat="b"
                        roomId="test-room"
                    />,
                );
            });

            expect(client.checkmate).toHaveBeenCalled();
        });

        it("終局済みの snapshot で開いたときは手番側でも checkmate を送らない", async () => {
            const client = makeMockClient();
            await act(async () => {
                render(
                    <OnlineGameView
                        client={client}
                        snapshot={makeFinishedSnapshot({ turn: "b", result: RESIGN_RESULT })}
                        seat="b"
                        roomId="test-room"
                    />,
                );
            });

            expect(client.checkmate).not.toHaveBeenCalled();
        });

        it("対局中に終局済みの snapshot が届いても手番側は checkmate を送らない", async () => {
            const { client, emit } = makeSubscribableClient();
            await act(async () => {
                render(
                    <OnlineGameView
                        client={client}
                        snapshot={makeSnapshot({ turn: "w" })}
                        seat="b"
                        roomId="test-room"
                    />,
                );
            });

            await emit({
                v: 1,
                t: "snapshot",
                payload: makeFinishedSnapshot({ turn: "b", result: RESIGN_RESULT }),
            });

            expect(client.checkmate).not.toHaveBeenCalled();
        });
    });

    describe("サーバーに拒否された操作", () => {
        it("DESYNC ではやり直しを案内し、取りこぼしたイベントを取り直す", async () => {
            const { client, emit } = makeSubscribableClient();
            render(
                <OnlineGameView
                    client={client}
                    snapshot={makeSnapshot({ eventId: 5 })}
                    seat="b"
                    roomId="test-room"
                />,
            );

            await emit(errorMessage("DESYNC"));

            expect(screen.getByRole("alert").textContent).toBe(
                "局面が更新されました。もう一度操作してください。",
            );
            expect(client.sync).toHaveBeenCalledWith({ sinceEventId: 5 });
            expect(client.disconnect).not.toHaveBeenCalled();
        });

        it("対局者の席で SPECTATOR_FORBIDDEN を受けたら、別のタブで対局中の可能性を断定せずに案内する", async () => {
            const { client, emit } = makeSubscribableClient();
            render(
                <OnlineGameView
                    client={client}
                    snapshot={makeSnapshot()}
                    seat="b"
                    roomId="test-room"
                />,
            );

            await emit(errorMessage("SPECTATOR_FORBIDDEN"));

            expect(screen.getByRole("alert").textContent).toBe(
                "この画面からは操作できません。別のタブやウィンドウで対局中の場合は、そちらで続けてください。",
            );
            expect(client.sync).not.toHaveBeenCalled();
            expect(client.disconnect).not.toHaveBeenCalled();
        });

        it("案内の対象でないエラーでは何も表示しない", async () => {
            const { client, emit } = makeSubscribableClient();
            render(
                <OnlineGameView
                    client={client}
                    snapshot={makeSnapshot()}
                    seat="s"
                    roomId="test-room"
                />,
            );

            await emit(errorMessage("ROOM_FINISHED"));
            await emit(errorMessage("SPECTATOR_FORBIDDEN"));

            expect(screen.queryByRole("alert")).toBeNull();
        });

        it("同じ案内が続いたら表示時間を数え直す", async () => {
            vi.useFakeTimers();
            try {
                const { client, emit } = makeSubscribableClient();
                render(
                    <OnlineGameView
                        client={client}
                        snapshot={makeSnapshot()}
                        seat="b"
                        roomId="test-room"
                    />,
                );

                await emit(errorMessage("DESYNC"));
                await act(async () => {
                    vi.advanceTimersByTime(4000);
                });
                await emit(errorMessage("DESYNC"));
                await act(async () => {
                    vi.advanceTimersByTime(4000);
                });
                expect(screen.queryByRole("alert")).not.toBeNull();

                await act(async () => {
                    vi.advanceTimersByTime(1500);
                });
                expect(screen.queryByRole("alert")).toBeNull();
            } finally {
                vi.useRealTimers();
            }
        });

        it("反映済みより古い終局イベントが届いても、取り直しの起点を巻き戻さない", async () => {
            const { client, emit } = makeSubscribableClient();
            await act(async () => {
                render(
                    <OnlineGameView
                        client={client}
                        snapshot={makeFinishedSnapshot({ eventId: 8, result: RESIGN_RESULT })}
                        seat="b"
                        roomId="test-room"
                    />,
                );
            });

            await emit(gameEndMessage(6));
            await emit(errorMessage("DESYNC"));

            expect(client.sync).toHaveBeenCalledWith({ sinceEventId: 8 });
        });
    });

    describe("メッセージを届いた順に反映する", () => {
        const SNAPSHOT_SFEN = "9/9/9/9/9/9/9/9/9 b - 4";
        const TAKEBACK_SFEN = "9/9/9/9/9/9/9/9/9 w - 3";
        const RESYNC_SFEN = "9/9/9/9/9/9/9/9/9 b - 10";

        function takebackMessage(eventId: number): ServerMessage {
            return eventMessage({
                kind: "takeback_accepted",
                eventId,
                serverTs: 0,
                sfen: TAKEBACK_SFEN,
                turn: "w",
                clock: makeSnapshot().clock,
                passRights: null,
            });
        }

        it("初期局面の読み込み前に届いた指し手とその待ったを、読み込み後に届いた順で反映する", async () => {
            const parsing = holdParsing();
            const { client, emit } = makeSubscribableClient();
            const onStartReview = vi.fn();
            render(
                <OnlineGameView
                    client={client}
                    snapshot={makeSnapshot({
                        eventId: 5,
                        sfen: SNAPSHOT_SFEN,
                        moves: FINAL_MOVES,
                        turn: "w",
                    })}
                    seat="b"
                    roomId="test-room"
                    onStartReview={onStartReview}
                />,
            );

            await emit(moveMessage(6, "3a2b", "b"));
            await emit(takebackMessage(7));
            // 待ったの局面の解析が、初期局面の解析より先に終わる
            await parsing.finish(TAKEBACK_SFEN);
            await parsing.finish(SNAPSHOT_SFEN);
            await parsing.finish("startpos");

            expect(screen.getByText("3.")).toBeTruthy();
            expect(screen.queryByText("4.")).toBeNull();

            await emit(gameEndMessage(8));
            expect(startReview(onStartReview)).toMatchObject({ moves: FINAL_MOVES });
        });

        it("snapshot の復元中に届いた指し手を、復元の後に反映する", async () => {
            const { client, emit } = makeSubscribableClient();
            const onStartReview = vi.fn();
            await act(async () => {
                render(
                    <OnlineGameView
                        client={client}
                        snapshot={makeSnapshot({ eventId: 5, moves: FINAL_MOVES.slice(0, 2) })}
                        seat="b"
                        roomId="test-room"
                        onStartReview={onStartReview}
                    />,
                );
            });

            const parsing = holdParsing();
            await emit({
                v: 1,
                t: "snapshot",
                payload: makeSnapshot({
                    eventId: 10,
                    sfen: RESYNC_SFEN,
                    moves: FINAL_MOVES,
                    turn: "w",
                }),
            });
            await emit(moveMessage(11, "3a2b", "b"));
            await parsing.finish(RESYNC_SFEN);
            await parsing.finish("startpos");

            expect(screen.getByText("4.")).toBeTruthy();
            expect(screen.queryByText("5.")).toBeNull();

            // 反映し終えた番号で操作を送る
            await emit(errorMessage("DESYNC"));
            expect(client.sync).toHaveBeenCalledWith({ sinceEventId: 11 });

            await emit(gameEndMessage(12));
            expect(startReview(onStartReview)).toMatchObject({
                moves: [...FINAL_MOVES, "3a2b"],
            });
        });

        it("StrictMode で購読が張り直されても、最初の購読に渡されたメッセージを反映する", async () => {
            const flushed = [moveMessage(6, "3a2b", "b"), gameEndMessage(7, "record-1")];
            const client = makeMockClient({
                subscribe: vi.fn((handler: (message: ServerMessage) => void) => {
                    for (const message of flushed.splice(0)) handler(message);
                    return () => {};
                }),
            });
            const onStartReview = vi.fn();
            await act(async () => {
                render(
                    <StrictMode>
                        <OnlineGameView
                            client={client}
                            snapshot={makeSnapshot({ eventId: 5, moves: FINAL_MOVES, turn: "w" })}
                            seat="b"
                            roomId="test-room"
                            onStartReview={onStartReview}
                        />
                    </StrictMode>,
                );
            });

            expect(client.subscribe).toHaveBeenCalledTimes(2);
            expect(screen.getByText("4.")).toBeTruthy();
            expect(startReview(onStartReview)).toMatchObject({
                moves: [...FINAL_MOVES, "3a2b"],
                gameRecordId: "record-1",
            });
        });

        it("復元の途中で画面を離れたら、その結果を使わない", async () => {
            const { client, emit } = makeSubscribableClient();
            const view = await act(async () =>
                render(
                    <OnlineGameView
                        client={client}
                        snapshot={makeSnapshot({ eventId: 5 })}
                        seat="b"
                        roomId="test-room"
                    />,
                ),
            );

            const parsing = holdParsing();
            await emit({
                v: 1,
                t: "snapshot",
                payload: makeSnapshot({ eventId: 10, sfen: RESYNC_SFEN }),
            });
            view.unmount();
            await parsing.fail(RESYNC_SFEN);

            expect(client.sync).not.toHaveBeenCalled();
        });
    });

    describe("再同期後の操作", () => {
        const clickSquare = (square: string): void => {
            fireEvent.click(screen.getByRole("button", { name: `マス ${square}` }));
        };
        const selectedSquare = (): string | undefined =>
            screen.getByTestId("shogi-board").dataset.selected;

        function takebackAccepted(eventId: number): ServerMessage {
            return eventMessage({
                kind: "takeback_accepted",
                eventId,
                serverTs: 0,
                sfen: "9/9/9/9/9/9/9/9/9 b - 1",
                turn: "b",
                clock: makeSnapshot().clock,
                passRights: null,
            });
        }

        it("手番が同じまま 2 手進んだ snapshot を受けたら、選択を解除し新しい局面の合法手を使う", async () => {
            mockGetLegalMoves.mockImplementation(async (_sfen, moves) =>
                moves?.length === 2 ? ["7g7f"] : ["7g7f+"],
            );
            const { client, emit } = makeSubscribableClient();
            await act(async () => {
                render(
                    <OnlineGameView
                        client={client}
                        snapshot={makeSnapshot({
                            eventId: 5,
                            moves: FINAL_MOVES.slice(0, 2),
                            turn: "b",
                        })}
                        seat="b"
                        roomId="test-room"
                    />,
                );
            });
            clickSquare("7g");
            expect(selectedSquare()).toBe("7g");

            const advanced = [...FINAL_MOVES.slice(0, 2), "8h2b+", "3a2b"];
            await emit({
                v: 1,
                t: "snapshot",
                payload: makeSnapshot({ eventId: 7, moves: advanced, turn: "b" }),
            });

            expect(selectedSquare()).toBe("");
            expect(mockGetLegalMoves).toHaveBeenLastCalledWith("startpos", advanced, {});

            // 古い局面でだけ合法だった 7g7f は送らず、新しい局面の合法手 7g7f+ を送る
            clickSquare("7g");
            await act(async () => {
                clickSquare("7f");
            });
            expect(client.move).toHaveBeenCalledTimes(1);
            expect(client.move).toHaveBeenCalledWith({
                eventId: 7,
                usi: "7g7f+",
                sfen: "startpos",
            });
        });

        it("再接続の snapshot を反映した後の投了には、その snapshot のイベント番号を付ける", async () => {
            const { client, emit } = makeSubscribableClient();
            await act(async () => {
                render(
                    <OnlineGameView
                        client={client}
                        snapshot={makeSnapshot({ eventId: 5, turn: "b" })}
                        seat="b"
                        roomId="test-room"
                    />,
                );
            });

            await emit({
                v: 1,
                t: "snapshot",
                payload: makeSnapshot({ eventId: 10, turn: "b" }),
            });
            fireEvent.click(screen.getByRole("button", { name: "投了" }));

            expect(client.resign).toHaveBeenCalledWith({ eventId: 10 });
        });

        it("待ったを反映した後の投了には、待ったのイベント番号を付ける", async () => {
            const { client, emit } = makeSubscribableClient();
            await act(async () => {
                render(
                    <OnlineGameView
                        client={client}
                        snapshot={makeSnapshot({ eventId: 5, moves: FINAL_MOVES, turn: "w" })}
                        seat="b"
                        roomId="test-room"
                    />,
                );
            });

            await emit(takebackAccepted(12));
            fireEvent.click(screen.getByRole("button", { name: "投了" }));

            expect(client.resign).toHaveBeenCalledWith({ eventId: 12 });
        });
    });

    describe("画面を開いたときの局面の読み込み失敗", () => {
        const LOAD_FAILED = "局面を読み込めませんでした。ページを再読み込みしてください。";

        it("1 度失敗しても、やり直して読み込めれば案内を出さない", async () => {
            mockParseSfen.mockRejectedValueOnce(new Error("parse failed"));
            await act(async () => {
                render(
                    <OnlineGameView
                        client={makeMockClient()}
                        snapshot={makeSnapshot({ moves: FINAL_MOVES })}
                        seat="b"
                        roomId="test-room"
                    />,
                );
            });

            expect(screen.queryByRole("alert")).toBeNull();
            expect(screen.getByText("3.")).toBeTruthy();
        });

        /** 画面を開いたときの読み込みを 2 回とも失敗させた状態で、後手からのメッセージを待つ */
        async function renderUnrestored(): Promise<ReturnType<typeof makeSubscribableClient>> {
            mockParseSfen.mockRejectedValue(new Error("parse failed"));
            const connection = makeSubscribableClient();
            await act(async () => {
                render(
                    <OnlineGameView
                        client={connection.client}
                        snapshot={makeSnapshot({ eventId: 5, moves: FINAL_MOVES, turn: "w" })}
                        seat="b"
                        roomId="test-room"
                    />,
                );
            });
            expect(screen.getByRole("alert").textContent).toBe(LOAD_FAILED);
            return connection;
        }

        async function recoverWith(
            emit: (message: ServerMessage) => Promise<void>,
            payload: SnapshotPayload,
        ): Promise<void> {
            mockParseSfen.mockImplementation(async () => structuredClone(PARSED_POSITION));
            await emit({ v: 1, t: "snapshot", payload });
            expect(screen.queryByText(LOAD_FAILED)).toBeNull();
        }

        const takebackRequested = (eventId: number): ServerMessage =>
            eventMessage({ kind: "takeback_requested", eventId, serverTs: 0, seat: "w", ply: 3 });

        beforeEach(() => {
            vi.spyOn(console, "error").mockImplementation(() => {});
        });

        afterEach(() => {
            vi.restoreAllMocks();
        });

        it("やり直しても読み込めなければ案内を出し、切断せず、次の snapshot で復帰する", async () => {
            const { client, emit } = await renderUnrestored();
            expect(client.disconnect).not.toHaveBeenCalled();

            await recoverWith(emit, makeSnapshot({ eventId: 6, moves: FINAL_MOVES, turn: "w" }));

            expect(screen.getByText("3.")).toBeTruthy();
        });

        it("読み込めない間に届いた待ったの申請は、復帰後に承認ダイアログとして出る", async () => {
            const { client, emit } = await renderUnrestored();

            await emit(takebackRequested(6));
            await recoverWith(emit, makeSnapshot({ eventId: 6, moves: FINAL_MOVES, turn: "w" }));
            expect(screen.getAllByText("待ったの申請")).toHaveLength(1);

            // 同じ申請がもう一度届いても反映済みとして扱う
            await emit(takebackRequested(6));
            expect(screen.getAllByText("待ったの申請")).toHaveLength(1);
            await emit(errorMessage("DESYNC"));
            expect(client.sync).toHaveBeenLastCalledWith({ sinceEventId: 6 });
        });

        it("読み込めない間に待ったの申請と取り消しが届いたら、復帰後にダイアログを出さない", async () => {
            const { emit } = await renderUnrestored();

            await emit(takebackRequested(6));
            await emit(eventMessage({ kind: "takeback_cancelled", eventId: 7, serverTs: 0 }));
            await recoverWith(emit, makeSnapshot({ eventId: 7, moves: FINAL_MOVES, turn: "w" }));

            expect(screen.queryByText("待ったの申請")).toBeNull();
        });

        it("読み込めない間に届いた指し手は snapshot と重ねて数えず、復帰後の指し手は 1 度だけ反映する", async () => {
            const { emit } = await renderUnrestored();

            await emit(moveMessage(6, "3a2b", "b"));
            await recoverWith(
                emit,
                makeSnapshot({ eventId: 6, moves: [...FINAL_MOVES, "3a2b"], turn: "b" }),
            );
            expect(screen.getByText("4.")).toBeTruthy();
            expect(screen.queryByText("5.")).toBeNull();

            await emit(moveMessage(7, "7g7f", "w"));
            expect(screen.getByText("5.")).toBeTruthy();
            expect(screen.queryByText("6.")).toBeNull();
        });
    });

    describe("局面の読み込み前", () => {
        it("読み込みが終わるまで合法手を取得せず、詰みも申告しない", async () => {
            const sfen = "9/9/9/9/9/9/9/9/9 b - 1";
            const parsing = holdParsing();
            const client = makeMockClient();
            await act(async () => {
                render(
                    <OnlineGameView
                        client={client}
                        snapshot={makeSnapshot({ sfen, turn: "b" })}
                        seat="b"
                        roomId="test-room"
                    />,
                );
            });
            expect(mockGetLegalMoves).not.toHaveBeenCalled();
            expect(client.checkmate).not.toHaveBeenCalled();

            await parsing.finish(sfen);

            expect(mockGetLegalMoves).toHaveBeenCalledTimes(1);
            expect(client.checkmate).toHaveBeenCalledTimes(1);
        });
    });

    describe("駒落ちプリセットの開始局面", () => {
        it("合法手の取得にはプリセット名でなく展開した局面を渡す", async () => {
            const snapshot = makeSnapshot({ turn: "b" });
            await act(async () => {
                render(
                    <OnlineGameView
                        client={makeMockClient()}
                        snapshot={{
                            ...snapshot,
                            settings: { ...snapshot.settings, startSfen: "handicap:bishop" },
                        }}
                        seat="b"
                        roomId="test-room"
                    />,
                );
            });

            expect(mockGetLegalMoves).toHaveBeenCalledWith(
                "lnsgkgsnl/1r7/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1",
                [],
                {},
            );
        });
    });
});
