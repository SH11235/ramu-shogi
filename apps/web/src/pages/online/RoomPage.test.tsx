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
    subscribeStatus: vi.fn(() => () => {}),
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

    /** サーバー側から接続が切れた */
    drop(): void {
        this.readyState = 3;
        for (const listener of this.listeners.close ?? []) listener({});
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

let currentSession: { authenticated: true; user: { displayName: string } } | null = null;
vi.mock("../../hooks/useAuthSession", () => ({
    useAuthSession: () => ({
        session: currentSession,
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
const { readPlayHandoff } = await import("../../lib/playHandoff");

describe("RoomPage", () => {
    beforeEach(() => {
        mockNavigate.mockClear();
        mockClient.disconnect.mockClear();
        mockSubscribe.mockClear();
        vi.unstubAllGlobals();
        currentRoomId = "test-room";
        currentSession = null;
        sockets = null;
        localStorage.clear();
        sessionStorage.clear();
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
            stubGameRecordFetch(() => Promise.resolve({ ok: false, status: 404 }));
        });

        /** 棋譜のページを開けるか確かめる `/api/games/:id` の応答を差し替える */
        function stubGameRecordFetch(
            respond: () => Promise<Pick<Response, "ok" | "status">>,
        ): ReturnType<typeof vi.fn> {
            const fetchMock = vi.fn((url: string, _init?: RequestInit) => {
                if (!url.startsWith("/api/games/")) throw new Error(`unexpected fetch: ${url}`);
                return respond();
            });
            vi.stubGlobal("fetch", fetchMock);
            return fetchMock;
        }

        async function clickStartReview(): Promise<void> {
            await act(async () => {
                fireEvent.click(screen.getByRole("button", { name: "棋譜を検討する" }));
            });
        }

        function finishedSnapshot(overrides: Partial<SnapshotPayload> = {}): ServerMessage {
            return {
                v: 1,
                t: "snapshot",
                payload: makeSnapshot({
                    eventId: 8,
                    status: "finished",
                    result: { winner: "b", reason: "resign" },
                    gameRecordId: "record-1",
                    ...overrides,
                }),
            };
        }

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
            const fetchMock = stubGameRecordFetch(() => Promise.resolve({ ok: true, status: 200 }));
            await clickStartReview();

            expect(fetchMock).toHaveBeenCalledWith("/api/games/record-1", {
                credentials: "same-origin",
                signal: expect.any(AbortSignal),
            });
            expect(mockNavigate).toHaveBeenCalledWith({
                to: "/games/$gameId",
                params: { gameId: "record-1" },
            });
            expect(localStorage.getItem("ramu_resume_token_test-room")).toBeNull();
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

            const fetchMock = stubGameRecordFetch(() => Promise.resolve({ ok: true, status: 200 }));
            await clickStartReview();

            expect(fetchMock).toHaveBeenCalledWith("/api/games/record-1", {
                credentials: "same-origin",
                signal: expect.any(AbortSignal),
            });
            expect(mockNavigate).toHaveBeenCalledWith({
                to: "/games/$gameId",
                params: { gameId: "record-1" },
            });
            expect(localStorage.getItem("ramu_resume_token_test-room")).toBeNull();
        });

        it("棋譜 ID を得られなかった対局は、手元の棋譜を検討画面で開く", async () => {
            const fetchMock = stubGameRecordFetch(() => Promise.resolve({ ok: true, status: 200 }));
            render(<RoomPage />);
            await deliverOnOpen("test-room", [{ v: 1, t: "snapshot", payload: makeSnapshot() }]);
            await act(async () => {
                socketFor("test-room").receive(gameEnd(6, "w"));
            });

            expect(screen.getAllByText("Bob の勝ち")).toHaveLength(1);
            await clickStartReview();

            expect(fetchMock).not.toHaveBeenCalled();
            expect(mockNavigate).toHaveBeenCalledWith({ to: "/play" });
            expect(readPlayHandoff()).toEqual({ sfen: "startpos", moves: MOVES });
            expect(localStorage.getItem("ramu_resume_token_test-room")).toBeNull();
        });

        it.each([
            ["セッションが切れていた（401）", () => Promise.resolve({ ok: false, status: 401 })],
            [
                "参加したときと別のアカウント（404）",
                () => Promise.resolve({ ok: false, status: 404 }),
            ],
            ["通信に失敗した", () => Promise.reject(new TypeError("network"))],
        ] as const)("棋譜のページを開けない対局者は、手元の棋譜を駒落ちの開始局面ごと検討画面で開く: %s", async (_label, respond) => {
            // 画面にはログイン中と出ていても、サーバーが棋譜を見せるとは限らない
            currentSession = { authenticated: true, user: { displayName: "Alice" } };
            stubGameRecordFetch(respond);
            render(<RoomPage />);
            await deliverOnOpen("test-room", [
                finishedSnapshot({
                    settings: {
                        ...(ROOM_INFO.settings as SnapshotPayload["settings"]),
                        startSfen: "handicap:bishop",
                    },
                }),
            ]);

            await clickStartReview();

            expect(mockNavigate).toHaveBeenCalledTimes(1);
            expect(mockNavigate).toHaveBeenCalledWith({ to: "/play" });
            expect(readPlayHandoff()).toEqual({
                sfen: "lnsgkgsnl/1r7/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1",
                moves: MOVES,
            });
            expect(localStorage.getItem("ramu_resume_token_test-room")).toBeNull();
        });

        it("観戦者は、棋譜のページを確かめずに手元の棋譜を検討画面で開く", async () => {
            const fetchMock = stubGameRecordFetch(() => Promise.resolve({ ok: true, status: 200 }));
            localStorage.clear();
            render(<RoomPage />);
            fireEvent.change(screen.getByLabelText(/名前/), { target: { value: "Carol" } });
            await act(async () => {
                fireEvent.click(screen.getByRole("button", { name: "観戦者として参加する" }));
            });
            await deliverOnOpen("test-room", [
                {
                    v: 1,
                    t: "joined",
                    payload: { roomId: "test-room", seat: "s", youAre: "spectator" },
                },
                finishedSnapshot(),
            ]);

            await clickStartReview();

            expect(fetchMock).not.toHaveBeenCalled();
            expect(mockNavigate).toHaveBeenCalledWith({ to: "/play" });
            expect(readPlayHandoff()).toEqual({ sfen: "startpos", moves: MOVES });
        });

        it("確かめている間に何度押しても、遷移は 1 回だけ", async () => {
            let respond: (response: Pick<Response, "ok" | "status">) => void = () => {};
            const fetchMock = stubGameRecordFetch(
                () =>
                    new Promise((resolve) => {
                        respond = resolve;
                    }),
            );
            render(<RoomPage />);
            await deliverOnOpen("test-room", [finishedSnapshot()]);

            await clickStartReview();
            await clickStartReview();
            await act(async () => {
                respond({ ok: true, status: 200 });
            });

            expect(fetchMock).toHaveBeenCalledTimes(1);
            expect(mockNavigate).toHaveBeenCalledTimes(1);
            expect(mockNavigate).toHaveBeenCalledWith({
                to: "/games/$gameId",
                params: { gameId: "record-1" },
            });
        });

        it.each([
            ["画面を閉じた", ({ unmount }: { unmount: () => void }) => unmount()],
            [
                "別のルームへ移った",
                ({ rerender }: { rerender: (ui: ReactNode) => void }) => {
                    currentRoomId = "room-b";
                    rerender(<RoomPage />);
                },
            ],
        ] as const)("確かめている間に%sら、応答が来ても遷移せず、引き継ぎも席の記憶の削除もしない", async (_label, leave) => {
            let respond: (response: Pick<Response, "ok" | "status">) => void = () => {};
            const fetchMock = stubGameRecordFetch(
                () =>
                    new Promise((resolve) => {
                        respond = resolve;
                    }),
            );
            const view = render(<RoomPage />);
            await deliverOnOpen("test-room", [finishedSnapshot()]);

            await clickStartReview();
            const { signal } = fetchMock.mock.calls[0][1] as RequestInit;
            await act(async () => {
                leave(view);
            });
            expect(signal?.aborted).toBe(true);
            await act(async () => {
                respond({ ok: true, status: 200 });
            });

            expect(mockNavigate).not.toHaveBeenCalled();
            expect(readPlayHandoff()).toBeUndefined();
            expect(localStorage.getItem("ramu_resume_token_test-room")).toBe("token-test-room");
        });

        it("確かめている間に「トップへ戻る」を押したら、応答が来てもトップへの遷移だけにする", async () => {
            let respond: (response: Pick<Response, "ok" | "status">) => void = () => {};
            stubGameRecordFetch(
                () =>
                    new Promise((resolve) => {
                        respond = resolve;
                    }),
            );
            render(<RoomPage />);
            await deliverOnOpen("test-room", [finishedSnapshot()]);

            await clickStartReview();
            fireEvent.click(screen.getByRole("button", { name: "トップへ戻る" }));
            await act(async () => {
                respond({ ok: false, status: 401 });
            });

            expect(mockNavigate).toHaveBeenCalledTimes(1);
            expect(mockNavigate).toHaveBeenCalledWith({ to: "/" });
            expect(readPlayHandoff()).toBeUndefined();
        });

        it("局面を引き継げなかったら、遷移せず席の記憶も残す", async () => {
            stubGameRecordFetch(() => Promise.resolve({ ok: false, status: 401 }));
            const alert = vi.fn();
            vi.stubGlobal("alert", alert);
            render(<RoomPage />);
            await deliverOnOpen("test-room", [finishedSnapshot()]);

            const setItem = vi.spyOn(window.sessionStorage, "setItem").mockImplementation(() => {
                throw new Error("QuotaExceededError");
            });
            try {
                await clickStartReview();
            } finally {
                setItem.mockRestore();
            }

            expect(alert).toHaveBeenCalledTimes(1);
            expect(mockNavigate).not.toHaveBeenCalled();
            expect(localStorage.getItem("ramu_resume_token_test-room")).toBe("token-test-room");
            expect(localStorage.getItem("ramu_seat_test-room")).toBe("b");
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
            stubGameRecordFetch(() => Promise.resolve({ ok: true, status: 200 }));
            await clickStartReview();

            expect(mockNavigate).toHaveBeenCalledWith({
                to: "/games/$gameId",
                params: { gameId: "record-b" },
            });
        });

        describe("対局中の接続", () => {
            const RECONNECTING_TEXT = "再接続中...";
            const PLAYER_LOST_TEXT = "接続が切れました。再読み込みすると元の席に戻れます";
            const SPECTATOR_LOST_TEXT = "接続が切れました。再読み込みしてください";
            const REJECTED_TEXT = "セッションが切れました。再読み込みして、再度参加してください";

            const parseSfen = vi.fn<(sfen: string) => Promise<PositionState>>();
            const boardToSfen = vi.fn<() => Promise<string>>();

            beforeEach(() => {
                parseSfen.mockReset();
                parseSfen.mockImplementation(async () => createInitialPositionState());
                boardToSfen.mockReset();
                boardToSfen.mockResolvedValue("sfen after move");
                setPositionServiceFactory(() => ({
                    getInitialBoard: async () => createInitialPositionState(),
                    parseSfen,
                    boardToSfen,
                    getLegalMoves: async () => ["1g1f"],
                    replayMovesStrict: async () => {
                        throw new Error("not used");
                    },
                }));
            });

            async function openGame(): Promise<FakeSocket> {
                render(<RoomPage />);
                await deliverOnOpen("test-room", [
                    { v: 1, t: "snapshot", payload: makeSnapshot() },
                ]);
                expect(screen.getByRole("button", { name: /^1g / })).toBeTruthy();
                return socketFor("test-room");
            }

            /** 観戦者として参加し、対局中のルームを開く */
            async function watchGame(): Promise<FakeSocket> {
                localStorage.clear();
                render(<RoomPage />);
                fireEvent.change(screen.getByLabelText(/名前/), { target: { value: "Carol" } });
                await act(async () => {
                    fireEvent.click(screen.getByRole("button", { name: "観戦者として参加する" }));
                });
                await deliverOnOpen("test-room", [
                    {
                        v: 1,
                        t: "joined",
                        payload: { roomId: "test-room", seat: "s", youAre: "spectator" },
                    },
                    { v: 1, t: "snapshot", payload: makeSnapshot() },
                ]);
                expect(screen.getByRole("button", { name: /^1g / })).toBeTruthy();
                return socketFor("test-room");
            }

            async function withFakeTimers(run: () => Promise<void>): Promise<void> {
                vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
                try {
                    await run();
                } finally {
                    vi.useRealTimers();
                }
            }

            /** 切断され、1 回目の再接続で WebSocket が開くまで */
            async function reconnect(dropped: FakeSocket): Promise<FakeSocket> {
                await withFakeTimers(async () => {
                    await act(async () => {
                        dropped.drop();
                    });
                    expect(screen.getByRole("status").textContent).toBe(RECONNECTING_TEXT);
                    await act(async () => {
                        vi.advanceTimersByTime(1_000);
                    });
                });
                const socket = socketFor("test-room");
                expect(socket).not.toBe(dropped);
                await act(async () => {
                    socket.open();
                });
                return socket;
            }

            /** 切断から、RoomClient が再接続を 5 回試みて諦めるまで */
            async function exhaustReconnects(first: FakeSocket): Promise<void> {
                let socket = first;
                await withFakeTimers(async () => {
                    for (const delayMs of [1_000, 2_000, 4_000, 8_000, 16_000]) {
                        const dropped = socket;
                        await act(async () => {
                            dropped.drop();
                        });
                        expect(screen.getByRole("status").textContent).toBe(RECONNECTING_TEXT);
                        await act(async () => {
                            vi.advanceTimersByTime(delayMs);
                        });
                        socket = socketFor("test-room");
                        expect(socket).not.toBe(dropped);
                    }
                    const lastAttempt = socket;
                    await act(async () => {
                        lastAttempt.drop();
                    });
                });
                expect(sockets).toHaveLength(6);
            }

            async function tryToMove(): Promise<void> {
                await act(async () => {
                    fireEvent.click(screen.getByRole("button", { name: /^1g / }));
                });
                await act(async () => {
                    fireEvent.click(screen.getByRole("button", { name: /^1f / }));
                });
            }

            function resignButton(): HTMLButtonElement {
                return screen.getByRole("button", { name: "投了" }) as HTMLButtonElement;
            }

            function sentMoves(): unknown[] {
                return (sockets ?? []).flatMap((socket) =>
                    socket.sent.filter((message) => message.t === "move"),
                );
            }

            function snapshotMessage(overrides: Partial<SnapshotPayload> = {}): ServerMessage {
                return { v: 1, t: "snapshot", payload: makeSnapshot(overrides) };
            }

            function takebackRequested(eventId: number): ServerMessage {
                return {
                    v: 1,
                    t: "event",
                    payload: {
                        kind: "takeback_requested",
                        eventId,
                        serverTs: 0,
                        seat: "w",
                        ply: 2,
                    },
                };
            }

            it("再接続を諦めたら、盤面を残したまま再読み込みを案内し、着手も投了も送ろうとしない", async () => {
                const reload = vi.fn();
                vi.stubGlobal("location", { ...window.location, reload });
                const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
                try {
                    await exhaustReconnects(await openGame());

                    expect(screen.getByRole("alert").textContent).toContain(PLAYER_LOST_TEXT);
                    expect(screen.queryByRole("status")).toBeNull();
                    expect(screen.getByRole("button", { name: /^7g 先手の歩/ })).toBeTruthy();
                    expect(resignButton().disabled).toBe(true);

                    await tryToMove();
                    fireEvent.click(resignButton());
                    expect(
                        warn.mock.calls.filter(([text]) =>
                            String(text).startsWith("[RoomClient] Cannot send"),
                        ),
                    ).toEqual([]);

                    fireEvent.click(screen.getByRole("button", { name: "再読み込み" }));
                    expect(reload).toHaveBeenCalledTimes(1);
                } finally {
                    warn.mockRestore();
                }
            });

            it("WebSocket が開き直しても、席へ戻った結果の snapshot が届くまでは操作を受け付けない", async () => {
                const socket = await reconnect(await openGame());

                expect(socket.sent.filter((message) => message.t === "resume")).toEqual([
                    expect.objectContaining({
                        payload: { resumeToken: "token-test-room", lastEventId: 0 },
                    }),
                ]);
                expect(screen.getByRole("status").textContent).toBe(RECONNECTING_TEXT);
                expect(resignButton().disabled).toBe(true);
                await tryToMove();
                expect(sentMoves()).toEqual([]);
            });

            it("再接続後の snapshot を反映し終えるまでは操作を受け付けず、反映し終えたら指せる", async () => {
                const socket = await reconnect(await openGame());
                let finishParsing: () => void = () => {};
                parseSfen.mockImplementationOnce(
                    () =>
                        new Promise((resolve) => {
                            finishParsing = () => resolve(createInitialPositionState());
                        }),
                );

                await act(async () => {
                    socket.receive(snapshotMessage({ eventId: 6 }));
                });
                expect(screen.getByRole("status").textContent).toBe(RECONNECTING_TEXT);
                expect(resignButton().disabled).toBe(true);

                await act(async () => {
                    finishParsing();
                });
                expect(screen.queryByRole("status")).toBeNull();
                expect(screen.queryByRole("alert")).toBeNull();
                await tryToMove();
                expect(sentMoves()).toEqual([
                    expect.objectContaining({
                        payload: { eventId: 6, usi: "1g1f", sfen: "sfen after move" },
                    }),
                ]);
            });

            it("再接続後にサーバーが席への復帰を拒んだら、再度参加するよう案内し、操作を受け付けない", async () => {
                const socket = await reconnect(await openGame());

                await act(async () => {
                    socket.receive({
                        v: 1,
                        t: "error",
                        payload: { code: "INVALID_TOKEN", message: "" },
                    });
                });

                expect(screen.getByRole("alert").textContent).toContain(REJECTED_TEXT);
                expect(screen.queryByRole("status")).toBeNull();
                expect(resignButton().disabled).toBe(true);
                await tryToMove();
                expect(sentMoves()).toEqual([]);
            });

            it("待ったの申請は、再接続して同期し終えるまで隠し、同期し終えたら再び出す", async () => {
                const first = await openGame();
                await act(async () => {
                    first.receive(takebackRequested(6));
                });
                expect(screen.getByText("待ったの申請")).toBeTruthy();

                const socket = await reconnect(first);
                expect(screen.queryByText("待ったの申請")).toBeNull();

                await act(async () => {
                    socket.receive(snapshotMessage({ eventId: 6 }));
                });
                expect(screen.getByText("待ったの申請")).toBeTruthy();
            });

            it("指し手の局面を変換している間に切断されたら、変換が終わっても送らない", async () => {
                const first = await openGame();
                let finishConverting: () => void = () => {};
                boardToSfen.mockImplementationOnce(
                    () =>
                        new Promise((resolve) => {
                            finishConverting = () => resolve("sfen after move");
                        }),
                );
                await tryToMove();

                await withFakeTimers(async () => {
                    await act(async () => {
                        first.drop();
                    });
                });
                const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
                try {
                    await act(async () => {
                        finishConverting();
                    });
                    expect(
                        warn.mock.calls.filter(([text]) =>
                            String(text).startsWith("[RoomClient] Cannot send"),
                        ),
                    ).toEqual([]);
                } finally {
                    warn.mockRestore();
                }

                expect(sentMoves()).toEqual([]);
                expect(screen.getByRole("alert").textContent).toBe(
                    "指し手を送れませんでした。もう一度操作してください。",
                );
            });

            it("指し手の局面を変換している間に再接続して同期し終えても、変換が終わった古い指し手は送らない", async () => {
                const first = await openGame();
                let finishConverting: () => void = () => {};
                boardToSfen.mockImplementationOnce(
                    () =>
                        new Promise((resolve) => {
                            finishConverting = () => resolve("sfen after move");
                        }),
                );
                await tryToMove();

                const socket = await reconnect(first);
                await act(async () => {
                    socket.receive(snapshotMessage({ eventId: 9 }));
                });
                expect(screen.queryByRole("status")).toBeNull();
                await act(async () => {
                    finishConverting();
                });

                expect(sentMoves()).toEqual([]);
                expect(screen.getByRole("alert").textContent).toBe(
                    "指し手を送れませんでした。もう一度操作してください。",
                );
            });

            it("観戦者は、再接続すると参加し直し、その snapshot を反映し終えたら元に戻る", async () => {
                const socket = await reconnect(await watchGame());

                expect(socket.sent.map((message) => message.t)).toEqual(["join"]);
                expect(screen.getByRole("status").textContent).toBe(RECONNECTING_TEXT);
                await act(async () => {
                    socket.receive(snapshotMessage({ eventId: 6 }));
                });
                expect(screen.queryByRole("status")).toBeNull();
                expect(screen.queryByRole("alert")).toBeNull();
            });

            function fullSnapshotRequests(socket: FakeSocket): unknown[] {
                return socket.sent.filter(
                    (message) =>
                        message.t === "resume" &&
                        (message.payload as { lastEventId: number }).lastEventId === 0,
                );
            }

            it("再接続後の snapshot を解釈できなければ snapshot を求め直し、次の snapshot で元に戻る", async () => {
                const socket = await reconnect(await openGame());
                expect(fullSnapshotRequests(socket)).toHaveLength(1);
                const error = vi.spyOn(console, "error").mockImplementation(() => {});
                parseSfen.mockRejectedValueOnce(new Error("parse failed"));
                try {
                    await act(async () => {
                        socket.receive(snapshotMessage({ eventId: 6 }));
                    });
                } finally {
                    error.mockRestore();
                }
                expect(fullSnapshotRequests(socket)).toHaveLength(2);
                expect(screen.getByRole("status").textContent).toBe(RECONNECTING_TEXT);

                await act(async () => {
                    socket.receive(snapshotMessage({ eventId: 6 }));
                });
                expect(screen.queryByRole("status")).toBeNull();
                expect(resignButton().disabled).toBe(false);
            });

            it("再接続後の snapshot が届かなければ 15 秒ごとに 2 回まで求め直し、それでも届かなければ再読み込みを案内する", async () => {
                const first = await openGame();
                await withFakeTimers(async () => {
                    await act(async () => {
                        first.drop();
                    });
                    await act(async () => {
                        vi.advanceTimersByTime(1_000);
                    });
                    const socket = socketFor("test-room");
                    await act(async () => {
                        socket.open();
                    });
                    expect(fullSnapshotRequests(socket)).toHaveLength(1);
                    for (const requests of [2, 3]) {
                        await act(async () => {
                            vi.advanceTimersByTime(15_000);
                        });
                        expect(fullSnapshotRequests(socket)).toHaveLength(requests);
                        expect(screen.getByRole("status").textContent).toBe(RECONNECTING_TEXT);
                    }
                    await act(async () => {
                        vi.advanceTimersByTime(15_000);
                    });
                    expect(fullSnapshotRequests(socket)).toHaveLength(3);
                });

                expect(screen.getByRole("alert").textContent).toContain(PLAYER_LOST_TEXT);
                expect(screen.queryByRole("status")).toBeNull();
                expect(resignButton().disabled).toBe(true);
            });

            it("同期を待つ間に席と関係の無いエラーが返っても、復帰を拒まれたとは扱わず、snapshot で元に戻る", async () => {
                const socket = await reconnect(await openGame());

                await act(async () => {
                    socket.receive({
                        v: 1,
                        t: "error",
                        payload: { code: "RATE_LIMITED", message: "" },
                    });
                });
                expect(screen.queryByText(REJECTED_TEXT)).toBeNull();
                expect(screen.getByRole("status").textContent).toBe(RECONNECTING_TEXT);

                await act(async () => {
                    socket.receive(snapshotMessage({ eventId: 6 }));
                });
                expect(screen.queryByRole("status")).toBeNull();
                expect(resignButton().disabled).toBe(false);
            });

            it("前の再接続で届いた snapshot を反映し終えても、今の再接続の snapshot を待ち続ける", async () => {
                const firstReconnect = await reconnect(await openGame());
                let finishParsing: () => void = () => {};
                parseSfen.mockImplementationOnce(
                    () =>
                        new Promise((resolve) => {
                            finishParsing = () => resolve(createInitialPositionState());
                        }),
                );
                await act(async () => {
                    firstReconnect.receive(snapshotMessage({ eventId: 6 }));
                });

                const socket = await reconnect(firstReconnect);
                await act(async () => {
                    finishParsing();
                });
                expect(screen.getByRole("status").textContent).toBe(RECONNECTING_TEXT);
                expect(resignButton().disabled).toBe(true);

                await act(async () => {
                    socket.receive(snapshotMessage({ eventId: 7 }));
                });
                expect(screen.queryByRole("status")).toBeNull();
            });

            it("復帰を拒まれた後に切断・再接続しても、再度参加する案内のまま変えない", async () => {
                const socket = await reconnect(await openGame());
                await act(async () => {
                    socket.receive({
                        v: 1,
                        t: "error",
                        payload: { code: "INVALID_TOKEN", message: "" },
                    });
                });
                expect(screen.getByRole("alert").textContent).toContain(REJECTED_TEXT);

                await withFakeTimers(async () => {
                    await act(async () => {
                        socket.drop();
                    });
                    expect(screen.getByRole("alert").textContent).toContain(REJECTED_TEXT);
                    expect(screen.queryByRole("status")).toBeNull();
                    await act(async () => {
                        vi.advanceTimersByTime(1_000);
                    });
                });
                await act(async () => {
                    socketFor("test-room").open();
                });

                expect(screen.getByRole("alert").textContent).toContain(REJECTED_TEXT);
                expect(screen.queryByRole("status")).toBeNull();
                expect(resignButton().disabled).toBe(true);
            });

            it("指し手の局面を変換している間に局面を変えないイベントが届いても、その指し手を最新のイベント番号で送る", async () => {
                const socket = await openGame();
                let finishConverting: () => void = () => {};
                boardToSfen.mockImplementationOnce(
                    () =>
                        new Promise((resolve) => {
                            finishConverting = () => resolve("sfen after move");
                        }),
                );
                await tryToMove();

                await act(async () => {
                    socket.receive({
                        v: 1,
                        t: "event",
                        payload: { kind: "player_online", eventId: 6, serverTs: 0, seat: "w" },
                    });
                });
                await act(async () => {
                    finishConverting();
                });

                expect(sentMoves()).toEqual([
                    expect.objectContaining({
                        payload: { eventId: 6, usi: "1g1f", sfen: "sfen after move" },
                    }),
                ]);
            });

            it("観戦者は、参加し直した snapshot を解釈できなければ参加し直す", async () => {
                const socket = await reconnect(await watchGame());
                const error = vi.spyOn(console, "error").mockImplementation(() => {});
                parseSfen.mockRejectedValueOnce(new Error("parse failed"));
                try {
                    await act(async () => {
                        socket.receive(snapshotMessage({ eventId: 6 }));
                    });
                } finally {
                    error.mockRestore();
                }

                expect(socket.sent.map((message) => message.t)).toEqual(["join", "join"]);
                await act(async () => {
                    socket.receive(snapshotMessage({ eventId: 6 }));
                });
                expect(screen.queryByRole("status")).toBeNull();
            });

            it("観戦者が参加し直そうとして、切断中に終局していたら、すぐに終局を知らせてトップへ戻る導線を出す", async () => {
                const socket = await reconnect(await watchGame());

                await act(async () => {
                    socket.receive({
                        v: 1,
                        t: "error",
                        payload: { code: "ROOM_FINISHED", message: "" },
                    });
                });

                expect(screen.getByRole("alert").textContent).toContain(
                    "接続が切れている間に、この対局は終了しました",
                );
                expect(screen.queryByRole("status")).toBeNull();
                expect(screen.queryByRole("button", { name: "再読み込み" })).toBeNull();
                fireEvent.click(screen.getByRole("button", { name: "トップへ戻る" }));
                expect(mockNavigate).toHaveBeenCalledWith({ to: "/" });
            });

            /** 指し手の局面を変換している間に message が届き、変換が終わった後に送られた指し手 */
            async function movesSentAfter(message: ServerMessage): Promise<unknown[]> {
                const socket = await openGame();
                let finishConverting: () => void = () => {};
                boardToSfen.mockImplementationOnce(
                    () =>
                        new Promise((resolve) => {
                            finishConverting = () => resolve("sfen after move");
                        }),
                );
                await tryToMove();
                await act(async () => {
                    socket.receive(message);
                });
                await act(async () => {
                    finishConverting();
                });
                return sentMoves();
            }

            function eventMessage(
                payload: Extract<ServerMessage, { t: "event" }>["payload"],
            ): ServerMessage {
                return { v: 1, t: "event", payload };
            }

            it.each([
                [
                    "待ったの承認",
                    eventMessage({
                        kind: "takeback_accepted",
                        eventId: 6,
                        serverTs: 0,
                        sfen: "startpos",
                        turn: "b",
                        clock: makeSnapshot().clock,
                        passRights: null,
                    }),
                ],
                [
                    "指し手",
                    eventMessage({
                        kind: "move",
                        eventId: 6,
                        serverTs: 0,
                        usi: "3c3d",
                        turn: "b",
                        clock: makeSnapshot().clock,
                        passRights: null,
                    }),
                ],
                ["snapshot", snapshotMessage({ eventId: 6 })],
            ])("指し手の局面を変換している間に%sが届いたら、その指し手は送らない", async (_, message) => {
                expect(await movesSentAfter(message)).toEqual([]);
                expect(screen.getByRole("alert").textContent).toBe(
                    "局面が更新されました。もう一度操作してください。",
                );
            });

            it("指し手の局面を変換している間に待ったの取り消しが届いても、その指し手は送る", async () => {
                expect(
                    await movesSentAfter(
                        eventMessage({ kind: "takeback_cancelled", eventId: 6, serverTs: 0 }),
                    ),
                ).toEqual([
                    expect.objectContaining({
                        payload: { eventId: 6, usi: "1g1f", sfen: "sfen after move" },
                    }),
                ]);
            });

            it("2 回目の切断でも、snapshot の要求を 2 回まで送り直せる", async () => {
                const first = await openGame();
                await withFakeTimers(async () => {
                    await act(async () => {
                        first.drop();
                    });
                    await act(async () => {
                        vi.advanceTimersByTime(1_000);
                    });
                    const firstReconnect = socketFor("test-room");
                    await act(async () => {
                        firstReconnect.open();
                    });
                    await act(async () => {
                        vi.advanceTimersByTime(30_000);
                    });
                    expect(fullSnapshotRequests(firstReconnect)).toHaveLength(3);
                    await act(async () => {
                        firstReconnect.receive(snapshotMessage({ eventId: 6 }));
                    });
                    expect(screen.queryByRole("status")).toBeNull();

                    await act(async () => {
                        firstReconnect.drop();
                    });
                    await act(async () => {
                        vi.advanceTimersByTime(1_000);
                    });
                    const socket = socketFor("test-room");
                    await act(async () => {
                        socket.open();
                    });
                    await act(async () => {
                        vi.advanceTimersByTime(30_000);
                    });
                    expect(fullSnapshotRequests(socket)).toHaveLength(3);
                    expect(screen.getByRole("status").textContent).toBe(RECONNECTING_TEXT);
                });
            });

            it("同期し終えた後は、snapshot の要求を送り直さない", async () => {
                const first = await openGame();
                let socket: FakeSocket = first;
                await withFakeTimers(async () => {
                    await act(async () => {
                        first.drop();
                    });
                    await act(async () => {
                        vi.advanceTimersByTime(1_000);
                    });
                    socket = socketFor("test-room");
                    await act(async () => {
                        socket.open();
                    });
                    await act(async () => {
                        socket.receive(snapshotMessage({ eventId: 6 }));
                    });
                    await act(async () => {
                        vi.advanceTimersByTime(60_000);
                    });
                    expect(fullSnapshotRequests(socket)).toHaveLength(1);
                    expect(screen.queryByRole("alert")).toBeNull();
                });
            });

            it("snapshot が届かず再読み込みを案内した後でも、再接続すれば同期をやり直して元に戻る", async () => {
                const first = await openGame();
                let socket: FakeSocket = first;
                await withFakeTimers(async () => {
                    await act(async () => {
                        first.drop();
                    });
                    await act(async () => {
                        vi.advanceTimersByTime(1_000);
                    });
                    socket = socketFor("test-room");
                    await act(async () => {
                        socket.open();
                    });
                    await act(async () => {
                        vi.advanceTimersByTime(45_000);
                    });
                    expect(screen.getByRole("alert").textContent).toContain(PLAYER_LOST_TEXT);

                    await act(async () => {
                        socket.drop();
                    });
                    expect(screen.getByRole("status").textContent).toBe(RECONNECTING_TEXT);
                    await act(async () => {
                        vi.advanceTimersByTime(1_000);
                    });
                });
                socket = socketFor("test-room");
                await act(async () => {
                    socket.open();
                });
                expect(fullSnapshotRequests(socket)).toHaveLength(1);
                await act(async () => {
                    socket.receive(snapshotMessage({ eventId: 6 }));
                });
                expect(screen.queryByRole("status")).toBeNull();
                expect(screen.queryByRole("alert")).toBeNull();
                expect(resignButton().disabled).toBe(false);
            });

            it("観戦者には、席へ戻れるとは案内しない", async () => {
                await exhaustReconnects(await watchGame());

                expect(screen.getByRole("alert").textContent).toContain(SPECTATOR_LOST_TEXT);
                expect(screen.queryByText(PLAYER_LOST_TEXT)).toBeNull();
                expect(screen.getByRole("button", { name: "再読み込み" })).toBeTruthy();
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

        // backend の RoomDO は、対局開始時は snapshot を送らず、
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

        it("SFEN 直接入力に切り替えただけでは、対局設定の開始局面は送った局面のまま入力待ちと出す", async () => {
            const socket = await joinAndWait("b");
            const settingsRow = (): string =>
                screen.getByText("開始局面", { selector: "span" }).parentElement
                    ?.textContent as string;
            const chooseStart = (label: string): void => {
                fireEvent.keyDown(screen.getByRole("combobox", { name: "開始局面を選択" }), {
                    key: "ArrowDown",
                });
                fireEvent.keyDown(screen.getByRole("option", { name: label }), { key: "Enter" });
            };

            chooseStart("角落ち");
            chooseStart("SFEN 直接入力");
            expect(settingsRow()).toBe("開始局面角落ち（SFEN 入力待ち）");

            fireEvent.change(screen.getByPlaceholderText(/^例: lnsgkgsnl/), {
                target: { value: "4k4/9/9/9/9/9/9/9/4K4 b - 1" },
            });
            expect(settingsRow()).toBe("開始局面カスタム局面");
            expect(
                socket.sent
                    .filter((message) => message.t === "update_settings")
                    .map((message) => message.payload),
            ).toEqual([
                { startSfen: "handicap:bishop" },
                { startSfen: "4k4/9/9/9/9/9/9/9/4K4 b - 1" },
            ]);
        });

        it("SFEN 入力待ちの間に相手が開始局面を変更したら、その局面を出して入力待ちを外す", async () => {
            const socket = await joinAndWait("b");
            const settingsRow = (): string =>
                screen.getByText("開始局面", { selector: "span" }).parentElement
                    ?.textContent as string;
            fireEvent.keyDown(screen.getByRole("combobox", { name: "開始局面を選択" }), {
                key: "ArrowDown",
            });
            fireEvent.keyDown(screen.getByRole("option", { name: "SFEN 直接入力" }), {
                key: "Enter",
            });
            expect(settingsRow()).toBe("開始局面平手（SFEN 入力待ち）");

            await receive(socket, [settingsUpdated(1, "handicap:rook")]);

            expect(settingsRow()).toBe("開始局面飛車落ち");
        });

        it("開始局面を変更した後に届いた待機中の snapshot の開始局面を、対局設定に出す", async () => {
            const socket = await joinAndWait("b");
            const settingsRow = (): string =>
                screen.getByText("開始局面", { selector: "span" }).parentElement
                    ?.textContent as string;
            fireEvent.keyDown(screen.getByRole("combobox", { name: "開始局面を選択" }), {
                key: "ArrowDown",
            });
            fireEvent.keyDown(screen.getByRole("option", { name: "角落ち" }), { key: "Enter" });
            expect(settingsRow()).toBe("開始局面角落ち");

            const waiting = makeSnapshot({
                eventId: 2,
                status: "waiting",
                sfen: "lnsgkgsnl/7b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1",
                moves: [],
                turn: "w",
                players: { b: { name: "Alice", online: true }, w: null },
            });
            await receive(socket, [
                {
                    v: 1,
                    t: "snapshot",
                    payload: {
                        ...waiting,
                        settings: { ...waiting.settings, startSfen: "handicap:rook" },
                    },
                },
            ]);

            expect(settingsRow()).toBe("開始局面飛車落ち");
            expect(screen.getByRole("combobox", { name: "開始局面を選択" }).textContent).toBe(
                "飛車落ち",
            );
        });

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

        it("開始局面を解釈できず snapshot を待つ間に切断されても、再接続後の snapshot から開き、その間の指し手を 1 度だけ反映する", async () => {
            // 手数を省いた SFEN は、backend の RoomDO が 1 手目として補って対局を始める
            const startSfen = "lnsgkgsnl/1r7/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w -";
            const firstSocket = await joinAndWait("b");
            await receive(firstSocket, [settingsUpdated(1, startSfen), gameStart(2, startSfen)]);
            expect(firstSocket.sent.filter((message) => message.t === "resume")).toEqual([
                expect.objectContaining({ payload: { resumeToken: "token", lastEventId: 0 } }),
            ]);
            expect(screen.getByText("接続しました。対局開始を待っています...")).toBeTruthy();

            // snapshot が届く前に切断され、その間に相手が初手を指した
            vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
            try {
                await act(async () => {
                    firstSocket.drop();
                    vi.advanceTimersByTime(1_000);
                });
            } finally {
                vi.useRealTimers();
            }
            const socket = socketFor("test-room");
            expect(socket).not.toBe(firstSocket);
            // 席へ戻る resume は lastEventId 0 なので、切断中の指し手は snapshot に含まれて返る
            await deliverOnOpen("test-room", [
                {
                    v: 1,
                    t: "snapshot",
                    payload: makeSnapshot({
                        eventId: 3,
                        sfen: "lnsgkgsnl/1r7/pppppp1pp/6p2/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 2",
                        moves: ["3c3d"],
                        turn: "b",
                        settings: { ...SETTINGS, startSfen },
                    }),
                },
            ]);

            expect(socket.sent.filter((message) => message.t === "resume")).toEqual([
                expect.objectContaining({ payload: { resumeToken: "token", lastEventId: 0 } }),
            ]);
            expect(squareLabel("2b")).toBe("2b 空マス");
            expect(squareLabel("3d")).toMatch(/^3d 後手の歩/);
            expect(squareLabel("3c")).toBe("3c 空マス");
            expect(getLegalMoves).toHaveBeenCalledTimes(1);
            expect(getLegalMoves).toHaveBeenCalledWith(startSfen, ["3c3d"], {});
        });

        describe("待機中の接続の失敗", () => {
            const WAITING_TEXT = "接続しました。対局開始を待っています...";
            const LOST_TEXT = "接続が切れました。再読み込みすると元の席に戻れます";
            const UNKNOWN_PRESET = "handicap:unknown";

            /** 席を持ったまま切れた対局者には、参加フォームでなく再読み込みの案内だけを出す */
            function expectReloadGuidanceOnly(): void {
                expect(screen.getByRole("alert").textContent).toContain(LOST_TEXT);
                expect(screen.getByRole("button", { name: "再読み込み" })).toBeTruthy();
                expect(screen.queryByText(WAITING_TEXT)).toBeNull();
                expect(
                    screen.queryByRole("button", { name: /参加する|満席です|接続中/ }),
                ).toBeNull();
                expect(screen.queryByLabelText(/名前/)).toBeNull();
                expect(screen.queryByText("● オンライン")).toBeNull();
                expect(screen.queryByRole("button", { name: /^5e / })).toBeNull();
            }

            it("開始局面を解釈できない対局開始の後、15 秒待っても snapshot が届かなければ、再読み込みを案内する", async () => {
                const socket = await joinAndWait("b");
                vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
                try {
                    await receive(socket, [gameStart(1, UNKNOWN_PRESET)]);
                    expect(screen.getByText(WAITING_TEXT)).toBeTruthy();

                    await act(async () => {
                        vi.advanceTimersByTime(14_999);
                    });
                    expect(screen.getByText(WAITING_TEXT)).toBeTruthy();
                    await act(async () => {
                        vi.advanceTimersByTime(1);
                    });
                } finally {
                    vi.useRealTimers();
                }

                expectReloadGuidanceOnly();
            });

            it("開始局面を解釈できない対局開始の後、snapshot の代わりにエラーが返ったら、再読み込みを案内する", async () => {
                const socket = await joinAndWait("b");
                await receive(socket, [gameStart(1, UNKNOWN_PRESET)]);
                expect(screen.getByText(WAITING_TEXT)).toBeTruthy();

                await receive(socket, [
                    { v: 1, t: "error", payload: { code: "UNKNOWN", message: "" } },
                ]);

                expectReloadGuidanceOnly();
            });

            it("開始局面を解釈できない対局開始の後、snapshot の代わりに INVALID_TOKEN が返ったら、席を捨てて参加フォームへ戻す", async () => {
                const socket = await joinAndWait("b");
                await receive(socket, [gameStart(1, UNKNOWN_PRESET)]);
                expect(localStorage.getItem("ramu_resume_token_test-room")).toBe("token");

                await receive(socket, [
                    { v: 1, t: "error", payload: { code: "INVALID_TOKEN", message: "" } },
                ]);

                expect(
                    screen.getByText("セッションが切れました。再度参加してください"),
                ).toBeTruthy();
                expect(screen.getByLabelText(/名前/)).toBeTruthy();
                expect(screen.queryByRole("button", { name: "再読み込み" })).toBeNull();
                expect(localStorage.getItem("ramu_resume_token_test-room")).toBeNull();
            });

            it("相手を待つ間にエラーが返ったら、再読み込みを案内し、ボタンで再読み込みする", async () => {
                const reload = vi.fn();
                vi.stubGlobal("location", { ...window.location, reload });
                const socket = await joinAndWait("b");

                await receive(socket, [
                    { v: 1, t: "error", payload: { code: "UNKNOWN", message: "" } },
                ]);

                expectReloadGuidanceOnly();
                fireEvent.click(screen.getByRole("button", { name: "再読み込み" }));
                expect(reload).toHaveBeenCalledTimes(1);
            });

            it("相手を待つ間に接続が切れ、再接続を 5 回試みてもつながらなければ、再読み込みを案内する", async () => {
                let socket = await joinAndWait("b");
                vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
                try {
                    for (const delayMs of [1_000, 2_000, 4_000, 8_000, 16_000]) {
                        const dropped = socket;
                        await act(async () => {
                            dropped.drop();
                        });
                        expect(screen.getByText(WAITING_TEXT)).toBeTruthy();
                        await act(async () => {
                            vi.advanceTimersByTime(delayMs);
                        });
                        socket = socketFor("test-room");
                        expect(socket).not.toBe(dropped);
                    }
                    const lastAttempt = socket;
                    await act(async () => {
                        lastAttempt.drop();
                    });
                } finally {
                    vi.useRealTimers();
                }

                expectReloadGuidanceOnly();
                expect(sockets).toHaveLength(6);
            });

            it("参加できなかったときは、エラーを表示した参加フォームをそのまま操作できる", async () => {
                render(<RoomPage />);
                fireEvent.change(screen.getByLabelText(/名前/), { target: { value: "Alice" } });
                await act(async () => {
                    fireEvent.click(screen.getByRole("button", { name: "先手として参加する" }));
                });
                await deliverOnOpen("test-room", [
                    { v: 1, t: "error", payload: { code: "ROOM_FULL", message: "" } },
                ]);

                expect(screen.getByText("この席はすでに埋まっています")).toBeTruthy();
                expect(screen.queryByText(LOST_TEXT)).toBeNull();
                expect((screen.getByLabelText(/名前/) as HTMLInputElement).disabled).toBe(false);
                for (const name of [
                    "先手として参加する",
                    "後手として参加する",
                    "観戦者として参加する",
                ]) {
                    const button = screen.getByRole("button", { name }) as HTMLButtonElement;
                    expect(button.disabled).toBe(false);
                }
            });
        });

        describe("待機中に再読み込みした対局者", () => {
            // 再読み込み後は保存済みのトークンで resume する。lastEventId 0 の resume には、
            // backend の RoomDO は snapshot を返す
            async function reloadAndWait(startSfen: string): Promise<FakeSocket> {
                rememberSeat("test-room");
                render(<RoomPage />);
                await deliverOnOpen("test-room", [
                    {
                        v: 1,
                        t: "snapshot",
                        payload: makeSnapshot({
                            eventId: 1,
                            status: "waiting",
                            sfen: "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1",
                            moves: [],
                            turn: "b",
                            players: { b: { name: "Alice", online: true }, w: null },
                            settings: { ...SETTINGS, startSfen },
                        }),
                    },
                ]);
                expect(screen.getByText("接続しました。対局開始を待っています...")).toBeTruthy();
                return socketFor("test-room");
            }

            it("相手が参加すると対局画面を開き、先手は平手の合法手を取得する", async () => {
                const socket = await reloadAndWait("startpos");

                await receive(socket, [gameStart(2, "startpos")]);

                expect(squareLabel("2b")).toMatch(/^2b 後手の角/);
                expect(getLegalMoves).toHaveBeenCalledWith("startpos", [], {});
            });

            it("再読み込みの前に角落ちへ変更していたら、角落ちの局面で開く", async () => {
                const socket = await reloadAndWait("handicap:bishop");

                await receive(socket, [gameStart(2, "handicap:bishop")]);

                expect(squareLabel("2b")).toBe("2b 空マス");
                expect(squareLabel("8b")).toMatch(/^8b 後手の飛/);
                expect(getLegalMoves).not.toHaveBeenCalled();
            });

            it("再読み込みの後に開始局面が変更されたら、その局面で開く", async () => {
                const socket = await reloadAndWait("startpos");

                await receive(socket, [
                    settingsUpdated(2, WHITE_TO_MOVE_SFEN),
                    gameStart(3, WHITE_TO_MOVE_SFEN),
                ]);

                expect(squareLabel("5a")).toMatch(/^5a 後手の玉/);
                expect(squareLabel("7g")).toBe("7g 空マス");
            });
        });
    });
});
