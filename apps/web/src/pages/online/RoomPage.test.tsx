import {
    createInitialPositionState,
    getAllSquares,
    type PieceType,
    type PositionState,
    setPositionServiceFactory,
} from "@shogi/app-core";
import type {
    RoomClientOptions,
    RoomSettings,
    ServerMessage,
    SnapshotPayload,
} from "@shogi/match-client";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
let currentRoomId = "test-room";
vi.mock("@tanstack/react-router", () => ({
    Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
    useNavigate: () => mockNavigate,
    useLocation: () => ({ pathname: "/online/test-room" }),
    useParams: () => ({ roomId: currentRoomId }),
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
    realCreateRoomClient = actual.createRoomClient;
    return {
        ...actual,
        createRoomClient: vi.fn((options: RoomClientOptions) =>
            sockets ? actual.createRoomClient(options, openFakeSocket) : mockClient,
        ),
    };
});

// ─── 実物の RoomClient を偽の WebSocket につなぐ ──────────────────────────────

let realCreateRoomClient: typeof import("@shogi/match-client").createRoomClient | undefined;

class FakeSocket {
    readyState = 1;
    readonly sent: Array<{ t: string; payload: unknown }> = [];
    private listeners: Record<string, ((event: { data?: string }) => void)[]> = {};

    constructor(readonly url: string) {}

    addEventListener(type: string, listener: (event: { data?: string }) => void): void {
        this.listeners[type] = [...(this.listeners[type] ?? []), listener];
    }

    send(data: string): void {
        this.sent.push(JSON.parse(data));
    }

    close(): void {
        this.readyState = 3;
    }

    open(): void {
        for (const listener of this.listeners.open ?? []) listener({});
    }

    receive(message: ServerMessage): void {
        for (const listener of this.listeners.message ?? []) {
            listener({ data: JSON.stringify(message) });
        }
    }
}

/** null の間は createRoomClient が mockClient を返す */
let sockets: FakeSocket[] | null = null;

function openFakeSocket(url: string): WebSocket {
    const socket = new FakeSocket(url);
    sockets?.push(socket);
    return socket as unknown as WebSocket;
}

function socketFor(roomId: string): FakeSocket {
    const socket = sockets
        ?.filter((candidate) => candidate.url.includes(`/rooms/${roomId}/`))
        .at(-1);
    if (!socket) throw new Error(`no socket for ${roomId}`);
    return socket;
}

function rememberSeat(roomId: string): void {
    localStorage.setItem(`ramu_resume_token_${roomId}`, `token-${roomId}`);
    localStorage.setItem(`ramu_seat_${roomId}`, "b");
}

const MOVES = ["7g7f", "3c3d"];

function makeSnapshot(overrides: Partial<SnapshotPayload> = {}): SnapshotPayload {
    return {
        eventId: 5,
        status: "playing",
        sfen: "lnsgkgsnl/1r5b1/pppppp1pp/6p2/9/2P6/PP1PPPPPP/1B5R1/LNSGKGSNL b - 3",
        moves: MOVES,
        turn: "b",
        clock: {
            b: { remainMs: 600_000 },
            w: { remainMs: 600_000 },
            running: "b",
            lastTickTs: Date.now(),
        },
        passRights: null,
        players: { b: { name: "Alice", online: true }, w: { name: "Bob", online: true } },
        spectators: 0,
        settings: ROOM_INFO.settings as SnapshotPayload["settings"],
        ...overrides,
    };
}

function gameEnd(eventId: number, winner: "b" | "w", gameRecordId?: string): ServerMessage {
    return {
        v: 1,
        t: "event",
        payload: {
            kind: "game_end",
            eventId,
            serverTs: 0,
            result: { winner, reason: "resign" },
            kifu: "",
            ...(gameRecordId ? { gameRecordId } : {}),
        },
    };
}

/** 1 回の act にまとめ、対局画面が購読を始める前にすべて届いた状況を作る */
async function deliverOnOpen(roomId: string, messages: ServerMessage[]): Promise<void> {
    await act(async () => {
        const socket = socketFor(roomId);
        socket.open();
        for (const message of messages) socket.receive(message);
    });
}

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
        currentRoomId = "test-room";
        sockets = null;
        localStorage.clear();
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

    describe("対局画面への復帰", () => {
        beforeEach(() => {
            expect(realCreateRoomClient).toBeDefined();
            sockets = [];
            vi.stubGlobal("WebSocket", FakeSocket);
            Object.assign(FakeSocket, { OPEN: 1 });
            setPositionServiceFactory(() => ({
                getInitialBoard: async () => createInitialPositionState(),
                parseSfen: async () => createInitialPositionState(),
                boardToSfen: async () => "startpos",
                getLegalMoves: async () => ["1g1f"],
                replayMovesStrict: async () => {
                    throw new Error("not used");
                },
            }));
            rememberSeat("test-room");
        });

        it("終局直後の再読み込みで、購読開始前に届いた棋譜 ID 付き game_end から検討画面へ進める", async () => {
            render(<RoomPage />);
            await deliverOnOpen("test-room", [
                {
                    v: 1,
                    t: "snapshot",
                    payload: makeSnapshot({
                        eventId: 7,
                        status: "finished",
                        result: { winner: "b", reason: "resign" },
                    }),
                },
                gameEnd(8, "b", "record-1"),
            ]);

            expect(screen.getAllByText("Alice の勝ち")).toHaveLength(1);
            fireEvent.click(screen.getByRole("button", { name: "棋譜を検討する" }));

            expect(mockNavigate).toHaveBeenCalledWith({
                to: "/games/$gameId/review",
                params: { gameId: "record-1" },
            });
        });

        it("snapshot の棋譜 ID だけでも検討画面へ進める", async () => {
            render(<RoomPage />);
            await deliverOnOpen("test-room", [
                {
                    v: 1,
                    t: "snapshot",
                    payload: makeSnapshot({
                        eventId: 8,
                        status: "finished",
                        result: { winner: "b", reason: "resign" },
                        gameRecordId: "record-1",
                    }),
                },
            ]);

            fireEvent.click(screen.getByRole("button", { name: "棋譜を検討する" }));

            expect(mockNavigate).toHaveBeenCalledWith({
                to: "/games/$gameId/review",
                params: { gameId: "record-1" },
            });
        });

        it("棋譜 ID を得られなかった対局は検討の入口へ進む", async () => {
            render(<RoomPage />);
            await deliverOnOpen("test-room", [{ v: 1, t: "snapshot", payload: makeSnapshot() }]);
            await act(async () => {
                socketFor("test-room").receive(gameEnd(6, "w"));
            });

            expect(screen.getAllByText("Bob の勝ち")).toHaveLength(1);
            fireEvent.click(screen.getByRole("button", { name: "棋譜を検討する" }));

            expect(mockNavigate).toHaveBeenCalledWith({ to: "/play" });
        });

        it("結果を持たない終局済み snapshot だけでは終局表示を出さない", async () => {
            render(<RoomPage />);
            await deliverOnOpen("test-room", [
                {
                    v: 1,
                    t: "snapshot",
                    payload: makeSnapshot({ eventId: 7, status: "finished" }),
                },
            ]);

            expect(screen.getAllByText(/Alice/).length).toBeGreaterThan(0);
            expect(screen.queryByText("Alice の勝ち")).toBeNull();
            expect(screen.queryByRole("button", { name: "棋譜を検討する" })).toBeNull();
        });

        it("別のルームへ移ると前のルームの結果を持ち越さず、移動先の結果を表示する", async () => {
            rememberSeat("room-b");
            const { rerender } = render(<RoomPage />);
            await deliverOnOpen("test-room", [
                {
                    v: 1,
                    t: "snapshot",
                    payload: makeSnapshot({
                        eventId: 8,
                        status: "finished",
                        result: { winner: "b", reason: "resign" },
                        gameRecordId: "record-a",
                    }),
                },
            ]);
            expect(screen.getAllByText("Alice の勝ち")).toHaveLength(1);

            currentRoomId = "room-b";
            rerender(<RoomPage />);
            await deliverOnOpen("room-b", [{ v: 1, t: "snapshot", payload: makeSnapshot() }]);
            expect(screen.queryByText("Alice の勝ち")).toBeNull();

            await act(async () => {
                socketFor("room-b").receive(gameEnd(6, "w", "record-b"));
            });
            expect(screen.getAllByText("Bob の勝ち")).toHaveLength(1);
            fireEvent.click(screen.getByRole("button", { name: "棋譜を検討する" }));

            expect(mockNavigate).toHaveBeenCalledWith({
                to: "/games/$gameId/review",
                params: { gameId: "record-b" },
            });
        });
    });

    describe("待機中の参加者の対局開始", () => {
        const BISHOP_HANDICAP_SFEN =
            "lnsgkgsnl/1r7/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1";
        const WHITE_TO_MOVE_SFEN = "4k4/9/4p4/9/9/9/4P4/9/4K4 w - 1";
        const SETTINGS = ROOM_INFO.settings as RoomSettings;

        /** 成駒と持ち駒の無い SFEN を盤面にする */
        function positionFromSfen(sfen: string): PositionState {
            const [rows, turn] = sfen.split(" ");
            const position = createInitialPositionState();
            for (const square of getAllSquares()) position.board[square] = null;
            rows.split("/").forEach((row, rankIndex) => {
                let file = 9;
                for (const char of row) {
                    if (/\d/.test(char)) {
                        file -= Number(char);
                        continue;
                    }
                    const square = getAllSquares().find(
                        (id) => id === `${file}${"abcdefghi"[rankIndex]}`,
                    );
                    if (!square) throw new Error(`bad square in ${sfen}`);
                    position.board[square] = {
                        owner: char === char.toUpperCase() ? "sente" : "gote",
                        type: char.toUpperCase() as PieceType,
                    };
                    file -= 1;
                }
            });
            return { ...position, turn: turn === "w" ? "gote" : "sente" };
        }

        const getLegalMoves = vi.fn<(sfen: string, moves?: string[]) => Promise<string[]>>();

        beforeEach(() => {
            sockets = [];
            vi.stubGlobal("WebSocket", FakeSocket);
            Object.assign(FakeSocket, { OPEN: 1 });
            getLegalMoves.mockReset();
            getLegalMoves.mockResolvedValue(["3c3d", "7g7f"]);
            setPositionServiceFactory(() => ({
                getInitialBoard: async () => createInitialPositionState(),
                parseSfen: async (sfen) => positionFromSfen(sfen),
                boardToSfen: async () => "sfen after move",
                getLegalMoves,
                replayMovesStrict: async () => {
                    throw new Error("not used");
                },
            }));
        });

        function eventMessage(
            payload: Extract<ServerMessage, { t: "event" }>["payload"],
        ): ServerMessage {
            return { v: 1, t: "event", payload };
        }

        function settingsUpdated(eventId: number, startSfen: string): ServerMessage {
            return eventMessage({
                kind: "settings_updated",
                eventId,
                serverTs: 0,
                settings: { startSfen },
            });
        }

        // legacy / backend どちらの RoomDO も、対局開始時は snapshot を送らず、
        // 設定の全体と対局者名を持つ game_start だけを送る
        function gameStart(eventId: number, startSfen: string): ServerMessage {
            return eventMessage({
                kind: "game_start",
                eventId,
                serverTs: Date.now(),
                settings: { ...SETTINGS, startSfen },
                players: { b: { name: "Alice", online: true }, w: { name: "Bob", online: true } },
            });
        }

        /** 平手のルームに 1 人目として参加し、待機画面で相手を待つ */
        async function joinAndWait(seat: "b" | "w"): Promise<FakeSocket> {
            render(<RoomPage />);
            fireEvent.change(screen.getByLabelText(/名前/), { target: { value: "Alice" } });
            await act(async () => {
                fireEvent.click(
                    screen.getByRole("button", {
                        name: seat === "b" ? "先手として参加する" : "後手として参加する",
                    }),
                );
            });
            const me = { name: "Alice", online: true };
            await deliverOnOpen("test-room", [
                {
                    v: 1,
                    t: "joined",
                    payload: { roomId: "test-room", seat, resumeToken: "token", youAre: "player" },
                },
                {
                    v: 1,
                    t: "snapshot",
                    payload: makeSnapshot({
                        eventId: 0,
                        status: "waiting",
                        sfen: "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1",
                        moves: [],
                        turn: "b",
                        players: { b: seat === "b" ? me : null, w: seat === "w" ? me : null },
                    }),
                },
            ]);
            expect(screen.getByText("接続しました。対局開始を待っています...")).toBeTruthy();
            return socketFor("test-room");
        }

        async function receive(socket: FakeSocket, messages: ServerMessage[]): Promise<void> {
            await act(async () => {
                for (const message of messages) socket.receive(message);
            });
        }

        function squareLabel(id: string): string {
            return screen
                .getByRole("button", { name: new RegExp(`^${id} `) })
                .getAttribute("aria-label") as string;
        }

        it("開始局面が変更されなければ、平手の先手番で始まり、先手は平手の合法手を取得する", async () => {
            const socket = await joinAndWait("b");

            await receive(socket, [gameStart(1, "startpos")]);

            expect(squareLabel("2b")).toMatch(/^2b 後手の角/);
            expect(squareLabel("7g")).toMatch(/^7g 先手の歩/);
            expect(getLegalMoves).toHaveBeenCalledWith("startpos", [], {});
        });

        it("先手が待機中に角落ちへ変更すると、先手の盤面も角落ちで始まり、上手の手番になる", async () => {
            const socket = await joinAndWait("b");

            await receive(socket, [
                settingsUpdated(1, "handicap:bishop"),
                gameStart(2, "handicap:bishop"),
            ]);

            expect(squareLabel("2b")).toBe("2b 空マス");
            expect(squareLabel("8b")).toMatch(/^8b 後手の飛/);
            expect(getLegalMoves).not.toHaveBeenCalled();
        });

        it("後手が待機中に角落ちへ変更すると、後手は角落ちの局面から最初の手を指せる", async () => {
            const socket = await joinAndWait("w");

            await receive(socket, [
                settingsUpdated(1, "handicap:bishop"),
                gameStart(2, "handicap:bishop"),
            ]);

            expect(squareLabel("2b")).toBe("2b 空マス");
            expect(getLegalMoves).toHaveBeenCalledTimes(1);
            expect(getLegalMoves).toHaveBeenCalledWith(BISHOP_HANDICAP_SFEN, [], {});

            await act(async () => {
                fireEvent.click(screen.getByRole("button", { name: /^3c / }));
            });
            await act(async () => {
                fireEvent.click(screen.getByRole("button", { name: /^3d / }));
            });

            expect(socket.sent.filter((message) => message.t === "move")).toEqual([
                expect.objectContaining({
                    payload: { eventId: 2, usi: "3c3d", sfen: "sfen after move" },
                }),
            ]);
        });

        it("待機中に後手番の SFEN へ変更すると、その局面で始まり、後手がその局面の合法手を取得する", async () => {
            const socket = await joinAndWait("w");

            await receive(socket, [
                settingsUpdated(1, WHITE_TO_MOVE_SFEN),
                gameStart(2, WHITE_TO_MOVE_SFEN),
            ]);

            expect(squareLabel("5a")).toMatch(/^5a 後手の玉/);
            expect(squareLabel("7g")).toBe("7g 空マス");
            expect(getLegalMoves).toHaveBeenCalledTimes(1);
            expect(getLegalMoves).toHaveBeenCalledWith(WHITE_TO_MOVE_SFEN, [], {});
        });

        it("開始局面が何度も変更されたら、最後の変更の局面で始まる", async () => {
            const socket = await joinAndWait("w");

            await receive(socket, [settingsUpdated(1, "handicap:rook")]);
            await receive(socket, [settingsUpdated(2, WHITE_TO_MOVE_SFEN)]);
            await receive(socket, [
                settingsUpdated(3, "handicap:bishop"),
                gameStart(4, "handicap:bishop"),
            ]);

            expect(squareLabel("2b")).toBe("2b 空マス");
            expect(squareLabel("8b")).toMatch(/^8b 後手の飛/);
            expect(getLegalMoves).toHaveBeenCalledTimes(1);
            expect(getLegalMoves).toHaveBeenCalledWith(BISHOP_HANDICAP_SFEN, [], {});
        });

        it("対局開始と同時に届いた相手の初手を、変更後の開始局面に重ねて反映する", async () => {
            const socket = await joinAndWait("b");

            await receive(socket, [
                settingsUpdated(1, "handicap:bishop"),
                gameStart(2, "handicap:bishop"),
                eventMessage({
                    kind: "move",
                    eventId: 3,
                    serverTs: 0,
                    usi: "3c3d",
                    turn: "b",
                    clock: makeSnapshot().clock,
                    passRights: null,
                }),
            ]);

            expect(squareLabel("2b")).toBe("2b 空マス");
            expect(squareLabel("3d")).toMatch(/^3d 後手の歩/);
            expect(squareLabel("3c")).toBe("3c 空マス");
            expect(getLegalMoves).toHaveBeenLastCalledWith(BISHOP_HANDICAP_SFEN, ["3c3d"], {});
        });
    });
});
