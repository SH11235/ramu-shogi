import type { RoomSettings, ServerMessage } from "@shogi/match-client";
import { renderHook } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRoomConnection } from "./useRoomConnection";

const mockCreateRoomClient = vi.fn();
const mockGetStoredResumeToken = vi.fn();
const mockGetStoredSeat = vi.fn();
const mockStoreSeat = vi.fn();

vi.mock("@shogi/match-client", () => ({
    createRoomClient: (...args: Parameters<typeof mockCreateRoomClient>) =>
        mockCreateRoomClient(...args),
    getStoredResumeToken: (...args: Parameters<typeof mockGetStoredResumeToken>) =>
        mockGetStoredResumeToken(...args),
    getStoredSeat: (...args: Parameters<typeof mockGetStoredSeat>) => mockGetStoredSeat(...args),
    storeSeat: (...args: Parameters<typeof mockStoreSeat>) => mockStoreSeat(...args),
}));

function createMockClient() {
    let handler: ((message: unknown) => void) | null = null;

    return {
        client: {
            join: vi.fn(),
            resume: vi.fn(),
            move: vi.fn(),
            resign: vi.fn(),
            consumeAnalysis: vi.fn(),
            updateSettings: vi.fn(),
            ack: vi.fn(),
            sync: vi.fn(),
            ping: vi.fn(),
            disconnect: vi.fn(),
            getStatus: vi.fn().mockReturnValue("connecting"),
            subscribe: vi.fn((nextHandler: (message: unknown) => void) => {
                handler = nextHandler;
                return () => {
                    handler = null;
                };
            }),
        },
        emit(message: unknown) {
            handler?.(message);
        },
    };
}

const STARTPOS_SFEN = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1";
const BISHOP_HANDICAP_SFEN = "lnsgkgsnl/1r7/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1";
const WHITE_TO_MOVE_SFEN = "4k4/9/4p4/9/9/9/4P4/9/4K4 w - 1";

const SETTINGS: RoomSettings = {
    startSfen: "startpos",
    timeControl: { type: "byoyomi", initialMs: 600_000, byoyomiMs: 30_000 },
    passRights: null,
    aiSupport: null,
    takeback: false,
};

/** 1 人目が参加した直後に届く、平手の待機中 snapshot */
function waitingSnapshot(seat: "b" | "w" | "s"): ServerMessage {
    const me = { name: "Alice", online: true };
    return {
        v: 1,
        t: "snapshot",
        payload: {
            eventId: 0,
            status: "waiting",
            sfen: STARTPOS_SFEN,
            moves: [],
            turn: "b",
            clock: {
                b: { remainMs: 600_000 },
                w: { remainMs: 600_000 },
                running: null,
                lastTickTs: 1_000,
            },
            passRights: null,
            players: { b: seat === "b" ? me : null, w: seat === "w" ? me : null },
            spectators: seat === "s" ? 1 : 0,
            settings: SETTINGS,
        },
    };
}

function settingsUpdated(eventId: number, startSfen: string): ServerMessage {
    return {
        v: 1,
        t: "event",
        payload: { kind: "settings_updated", eventId, serverTs: 2_000, settings: { startSfen } },
    };
}

function gameStart(eventId: number, settings: Partial<RoomSettings> = {}): ServerMessage {
    return {
        v: 1,
        t: "event",
        payload: {
            kind: "game_start",
            eventId,
            serverTs: 5_000,
            settings: { ...SETTINGS, ...settings },
            players: { b: { name: "Alice", online: true }, w: { name: "Bob", online: true } },
        },
    };
}

describe("useRoomConnection", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        mockCreateRoomClient.mockReset();
        mockGetStoredResumeToken.mockReset();
        mockGetStoredSeat.mockReset();
        mockStoreSeat.mockReset();
        mockGetStoredResumeToken.mockReturnValue(null);
        mockGetStoredSeat.mockReturnValue(null);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("handleJoin は open イベント後に join を送る", () => {
        const connection = createMockClient();
        let onOpen: ((event: { reconnect: boolean }) => void) | undefined;

        mockCreateRoomClient.mockImplementation((options) => {
            onOpen = options.onOpen;
            return connection.client;
        });

        const { result } = renderHook(() =>
            useRoomConnection({
                roomId: "room-1",
                initialName: "Alice",
            }),
        );

        act(() => {
            result.current.handleJoin("b");
        });

        expect(connection.client.join).not.toHaveBeenCalled();

        act(() => {
            onOpen?.({ reconnect: false });
        });

        expect(connection.client.join).toHaveBeenCalledWith({
            seat: "b",
            name: "Alice",
        });
    });

    it("resume 自動接続は open イベント後に resume を送る", () => {
        const connection = createMockClient();
        let onOpen: ((event: { reconnect: boolean }) => void) | undefined;

        mockGetStoredResumeToken.mockReturnValue("resume-token");
        mockGetStoredSeat.mockReturnValue("w");
        mockCreateRoomClient.mockImplementation((options) => {
            onOpen = options.onOpen;
            return connection.client;
        });

        renderHook(() =>
            useRoomConnection({
                roomId: "room-2",
                initialName: "Bob",
            }),
        );

        expect(connection.client.resume).not.toHaveBeenCalled();

        act(() => {
            onOpen?.({ reconnect: false });
        });

        expect(connection.client.resume).toHaveBeenCalledWith({
            resumeToken: "resume-token",
            lastEventId: 0,
        });
    });

    it("resume で終局済みルームの snapshot を受けると result と gameRecordId を保ったまま対局画面へ進む", () => {
        const connection = createMockClient();
        mockGetStoredResumeToken.mockReturnValue("resume-token");
        mockGetStoredSeat.mockReturnValue("b");
        mockCreateRoomClient.mockReturnValue(connection.client);

        const { result } = renderHook(() => useRoomConnection({ roomId: "room-3" }));

        act(() => {
            connection.emit({
                v: 1,
                t: "snapshot",
                payload: {
                    eventId: 7,
                    status: "finished",
                    result: { winner: "b", reason: "resign" },
                    gameRecordId: "record-1",
                },
            });
        });

        expect(result.current.gamePhase).toBe("playing");
        expect(result.current.snapshot).toMatchObject({
            eventId: 7,
            result: { winner: "b", reason: "resign" },
            gameRecordId: "record-1",
        });
    });

    it("roomId が変わると前のルームの接続を切り、snapshot と対局フェーズを持ち越さない", () => {
        const roomA = createMockClient();
        const roomB = createMockClient();
        mockGetStoredResumeToken.mockImplementation((roomId: string) =>
            roomId === "room-a" ? "token-a" : null,
        );
        mockGetStoredSeat.mockImplementation((roomId: string) =>
            roomId === "room-a" ? "b" : null,
        );
        mockCreateRoomClient.mockReturnValueOnce(roomA.client).mockReturnValue(roomB.client);

        const { result, rerender } = renderHook(({ roomId }) => useRoomConnection({ roomId }), {
            initialProps: { roomId: "room-a" },
        });
        act(() => {
            roomA.emit({
                v: 1,
                t: "snapshot",
                payload: { eventId: 7, status: "finished" },
            });
        });
        expect(result.current.gamePhase).toBe("playing");

        rerender({ roomId: "room-b" });

        expect(roomA.client.disconnect).toHaveBeenCalled();
        expect(result.current).toMatchObject({
            snapshot: null,
            joined: false,
            gamePhase: "waiting",
            client: null,
            isJoining: false,
            joinError: null,
        });
    });

    describe("待機中の参加者が対局開始を迎える", () => {
        /** 平手のルームに参加し、相手を待っている状態にする */
        function joinAndWait(seat: "b" | "w" | "s") {
            const connection = createMockClient();
            let onOpen: ((event: { reconnect: boolean }) => void) | undefined;
            mockCreateRoomClient.mockImplementation((options) => {
                onOpen = options.onOpen;
                return connection.client;
            });
            mockGetStoredResumeToken.mockReturnValue(null);
            const { result } = renderHook(() =>
                useRoomConnection({ roomId: "room-1", initialName: "Alice" }),
            );
            act(() => {
                result.current.handleJoin(seat);
            });
            act(() => {
                onOpen?.({ reconnect: false });
                connection.emit({
                    v: 1,
                    t: "joined",
                    payload:
                        seat === "s"
                            ? { roomId: "room-1", seat, youAre: "spectator" }
                            : { roomId: "room-1", seat, resumeToken: "token-1", youAre: "player" },
                });
                connection.emit(waitingSnapshot(seat));
            });
            expect(result.current.gamePhase).toBe("waiting");
            return {
                connection,
                result,
                /** RoomClient が接続し直した。resumed は RoomClient が resume を送ったかどうか */
                reopen: (resumed: boolean) => act(() => onOpen?.({ reconnect: resumed })),
            };
        }

        it("開始局面が変更されなければ、平手の先手番で対局画面を開く", () => {
            const { connection, result } = joinAndWait("b");

            act(() => {
                connection.emit(gameStart(1));
            });

            expect(result.current.gamePhase).toBe("playing");
            expect(result.current.snapshot).toEqual({
                eventId: 1,
                status: "playing",
                sfen: STARTPOS_SFEN,
                moves: [],
                turn: "b",
                clock: {
                    b: { remainMs: 600_000 },
                    w: { remainMs: 600_000 },
                    running: "b",
                    lastTickTs: 5_000,
                },
                passRights: null,
                players: {
                    b: { name: "Alice", online: true },
                    w: { name: "Bob", online: true },
                },
                spectators: 0,
                settings: SETTINGS,
            });
        });

        it("待機中に角落ちへ変更されたら、角落ちの局面・上手の手番・変更後の設定で開く", () => {
            const { connection, result } = joinAndWait("b");

            act(() => {
                connection.emit(settingsUpdated(1, "handicap:bishop"));
                connection.emit(gameStart(2, { startSfen: "handicap:bishop" }));
            });

            expect(result.current.gamePhase).toBe("playing");
            expect(result.current.snapshot).toMatchObject({
                eventId: 2,
                sfen: BISHOP_HANDICAP_SFEN,
                turn: "w",
                clock: { running: "w", lastTickTs: 5_000 },
                settings: { startSfen: "handicap:bishop" },
            });
        });

        it("待機中に後手番の SFEN へ変更されたら、その局面と後手番で開く", () => {
            const { connection, result } = joinAndWait("w");

            act(() => {
                connection.emit(settingsUpdated(1, WHITE_TO_MOVE_SFEN));
                connection.emit(gameStart(2, { startSfen: WHITE_TO_MOVE_SFEN }));
            });

            expect(result.current.snapshot).toMatchObject({
                sfen: WHITE_TO_MOVE_SFEN,
                turn: "w",
                settings: { startSfen: WHITE_TO_MOVE_SFEN },
            });
        });

        it("開始局面が何度も変更されたら、最後の変更で開く", () => {
            const { connection, result } = joinAndWait("b");

            act(() => {
                connection.emit(settingsUpdated(1, "handicap:rook"));
                connection.emit(settingsUpdated(2, WHITE_TO_MOVE_SFEN));
                connection.emit(settingsUpdated(3, "handicap:bishop"));
                connection.emit(gameStart(4, { startSfen: "handicap:bishop" }));
            });

            expect(result.current.localStartSfen).toBe("handicap:bishop");
            expect(result.current.snapshot).toMatchObject({
                eventId: 4,
                sfen: BISHOP_HANDICAP_SFEN,
                turn: "w",
                settings: { startSfen: "handicap:bishop" },
            });
        });

        it("自分で開始局面を変更した直後に対局が始まっても、サーバーが対局に使う局面で開く", () => {
            const { connection, result } = joinAndWait("b");

            act(() => {
                result.current.handleUpdateStartSfen("handicap:rook");
            });
            expect(connection.client.updateSettings).toHaveBeenCalledWith({
                startSfen: "handicap:rook",
            });
            // 変更がサーバーに届く前に相手が参加し、平手のまま対局が始まった
            act(() => {
                connection.emit(gameStart(1));
            });

            expect(result.current.snapshot).toMatchObject({
                sfen: STARTPOS_SFEN,
                turn: "b",
                settings: { startSfen: "startpos" },
            });
        });

        it("持ち時間・パス権・AI サポート・待ったの設定は game_start のものを使う", () => {
            const { connection, result } = joinAndWait("b");
            const settings: RoomSettings = {
                startSfen: "handicap:bishop",
                timeControl: { type: "fischer", initialMs: 300_000, fischerIncrementMs: 5_000 },
                passRights: { initialCount: 2 },
                aiSupport: {
                    b: { mode: "limited", limitCount: 3 },
                    w: { mode: "unlimited", limitCount: null },
                    searchDepth: null,
                    searchTimeMs: 1_000,
                },
                takeback: true,
            };

            act(() => {
                connection.emit(gameStart(1, settings));
            });

            expect(result.current.snapshot).toMatchObject({
                clock: {
                    b: { remainMs: 300_000 },
                    w: { remainMs: 300_000 },
                    running: "w",
                    lastTickTs: 5_000,
                },
                passRights: { b: 2, w: 2 },
                settings,
            });
        });

        it("開始局面を解釈できる対局開始の後に接続し直しても、snapshot は求めない", () => {
            const { connection, reopen } = joinAndWait("b");
            mockGetStoredResumeToken.mockReturnValue("token-1");
            act(() => {
                connection.emit(gameStart(1));
            });

            reopen(true);

            expect(connection.client.resume).not.toHaveBeenCalled();
        });

        it("対局開始の後は購読をやめ、続くメッセージを対局画面に残す", () => {
            const { connection, result } = joinAndWait("b");

            act(() => {
                connection.emit(gameStart(1));
                connection.emit(settingsUpdated(2, "handicap:rook"));
            });

            expect(result.current.localStartSfen).toBeNull();
            expect(result.current.snapshot).toMatchObject({ eventId: 1, sfen: STARTPOS_SFEN });
        });

        describe("game_start の開始局面を解釈できないとき", () => {
            const UNKNOWN_PRESET = { startSfen: "handicap:unknown" };
            const playingSnapshot: ServerMessage = {
                v: 1,
                t: "snapshot",
                payload: {
                    eventId: 3,
                    status: "playing",
                    sfen: "4k4/9/9/9/9/9/9/9/4K4 w - 1",
                    moves: [],
                    turn: "w",
                    clock: {
                        b: { remainMs: 600_000 },
                        w: { remainMs: 600_000 },
                        running: "w",
                        lastTickTs: 5_000,
                    },
                    passRights: null,
                    players: {
                        b: { name: "Alice", online: true },
                        w: { name: "Bob", online: true },
                    },
                    spectators: 2,
                    settings: { ...SETTINGS, ...UNKNOWN_PRESET },
                },
            };

            it("対局者は古い局面で開かず、resume で取り直した snapshot から開く", () => {
                const { connection, result } = joinAndWait("b");
                mockGetStoredResumeToken.mockReturnValue("token-1");

                act(() => {
                    connection.emit(settingsUpdated(1, UNKNOWN_PRESET.startSfen));
                    connection.emit(gameStart(2, UNKNOWN_PRESET));
                });

                expect(result.current.gamePhase).toBe("waiting");
                expect(connection.client.resume).toHaveBeenCalledWith({
                    resumeToken: "token-1",
                    lastEventId: 0,
                });

                act(() => {
                    connection.emit(playingSnapshot);
                });

                expect(result.current.gamePhase).toBe("playing");
                expect(result.current.snapshot).toEqual(playingSnapshot.payload);
            });

            it("観戦者は参加し直して取り直した snapshot から開く", () => {
                const { connection, result } = joinAndWait("s");
                connection.client.join.mockClear();

                act(() => {
                    connection.emit(gameStart(2, UNKNOWN_PRESET));
                });

                expect(result.current.gamePhase).toBe("waiting");
                expect(connection.client.join).toHaveBeenCalledWith({ seat: "s", name: "Alice" });
                expect(connection.client.resume).not.toHaveBeenCalled();

                act(() => {
                    connection.emit(playingSnapshot);
                });

                expect(result.current.gamePhase).toBe("playing");
                expect(result.current.snapshot).toEqual(playingSnapshot.payload);
            });

            it("snapshot を待つ間に接続し直したら、対局者は差分でなく snapshot を求め直す", () => {
                const { connection, result, reopen } = joinAndWait("b");
                mockGetStoredResumeToken.mockReturnValue("token-1");
                act(() => {
                    connection.emit(gameStart(2, UNKNOWN_PRESET));
                });
                expect(connection.client.resume).toHaveBeenCalledTimes(1);

                reopen(true);

                expect(connection.client.resume).toHaveBeenCalledTimes(2);
                expect(connection.client.resume).toHaveBeenLastCalledWith({
                    resumeToken: "token-1",
                    lastEventId: 0,
                });

                // 差分として届く指し手では開かず、snapshot が届いてから開く
                act(() => {
                    connection.emit({
                        v: 1,
                        t: "event",
                        payload: {
                            kind: "move",
                            eventId: 3,
                            serverTs: 6_000,
                            usi: "5a5b",
                            turn: "b",
                            clock: playingSnapshot.payload.clock,
                            passRights: null,
                        },
                    });
                });
                expect(result.current.gamePhase).toBe("waiting");
                act(() => {
                    connection.emit(playingSnapshot);
                });
                expect(result.current.gamePhase).toBe("playing");
                expect(result.current.snapshot).toEqual(playingSnapshot.payload);
            });

            it("snapshot を待つ間に接続し直したら、観戦者は参加し直す", () => {
                const { connection, reopen } = joinAndWait("s");
                connection.client.join.mockClear();
                act(() => {
                    connection.emit(gameStart(2, UNKNOWN_PRESET));
                });
                expect(connection.client.join).toHaveBeenCalledTimes(1);

                // 観戦者は resume できないので、RoomClient は新規の接続として開く
                reopen(false);

                expect(connection.client.join).toHaveBeenCalledTimes(2);
                expect(connection.client.join).toHaveBeenLastCalledWith({
                    seat: "s",
                    name: "Alice",
                });
            });

            it("snapshot から盤面を開いた後の再接続では、snapshot を求め直さない", () => {
                const { connection, reopen } = joinAndWait("b");
                mockGetStoredResumeToken.mockReturnValue("token-1");
                act(() => {
                    connection.emit(gameStart(2, UNKNOWN_PRESET));
                    connection.emit(playingSnapshot);
                });
                expect(connection.client.resume).toHaveBeenCalledTimes(1);

                reopen(true);

                expect(connection.client.resume).toHaveBeenCalledTimes(1);
            });

            it("snapshot が届かないまま時間が過ぎたら、盤面を開かずに再読み込みを案内する", () => {
                const { connection, result, reopen } = joinAndWait("b");
                mockGetStoredResumeToken.mockReturnValue("token-1");
                act(() => {
                    connection.emit(gameStart(2, UNKNOWN_PRESET));
                });

                act(() => {
                    vi.advanceTimersByTime(10_000);
                });
                // 接続し直しても、待つ時間は延びない
                reopen(true);
                expect(result.current.joinError).toBeNull();
                act(() => {
                    vi.advanceTimersByTime(5_000);
                });

                expect(result.current.gamePhase).toBe("waiting");
                expect(result.current.joinError).toBe(
                    "同期エラーが発生しました。ページを再読み込みしてください",
                );
                expect(connection.client.disconnect).toHaveBeenCalled();
            });

            it("時間内に snapshot が届けば、その後に時間が過ぎても案内を出さない", () => {
                const { connection, result } = joinAndWait("b");
                mockGetStoredResumeToken.mockReturnValue("token-1");
                act(() => {
                    connection.emit(gameStart(2, UNKNOWN_PRESET));
                    connection.emit(playingSnapshot);
                });

                act(() => {
                    vi.advanceTimersByTime(60_000);
                });

                expect(result.current.gamePhase).toBe("playing");
                expect(result.current.joinError).toBeNull();
                expect(connection.client.disconnect).not.toHaveBeenCalled();
            });

            it("取り直す手段が無ければ、盤面を開かずに再読み込みを案内する", () => {
                const { connection, result } = joinAndWait("b");

                act(() => {
                    connection.emit(gameStart(2, UNKNOWN_PRESET));
                });

                expect(result.current.gamePhase).toBe("waiting");
                expect(result.current.joinError).toBe(
                    "同期エラーが発生しました。ページを再読み込みしてください",
                );
                expect(connection.client.disconnect).toHaveBeenCalled();
            });
        });
    });

    describe("待機中に再読み込みした対局者が対局開始を迎える", () => {
        /** 保存済みの席とトークンで復帰し、待機中の snapshot を受け取った状態にする */
        function resumeAndWait(seat: "b" | "w", startSfen = "startpos") {
            const connection = createMockClient();
            let onOpen: ((event: { reconnect: boolean }) => void) | undefined;
            mockGetStoredResumeToken.mockReturnValue("token-1");
            mockGetStoredSeat.mockReturnValue(seat);
            mockCreateRoomClient.mockImplementation((options) => {
                onOpen = options.onOpen;
                return connection.client;
            });
            const { result } = renderHook(() => useRoomConnection({ roomId: "room-1" }));
            const waiting = waitingSnapshot(seat);
            if (waiting.t !== "snapshot") throw new Error("unreachable");
            act(() => {
                onOpen?.({ reconnect: false });
                connection.emit({
                    ...waiting,
                    payload: {
                        ...waiting.payload,
                        eventId: 1,
                        settings: { ...SETTINGS, startSfen },
                    },
                });
            });
            expect(result.current).toMatchObject({ joined: true, gamePhase: "waiting" });
            return { connection, result };
        }

        it("相手が参加して game_start が届いたら、対局画面を開く", () => {
            const { connection, result } = resumeAndWait("b");

            act(() => {
                connection.emit(gameStart(2));
            });

            expect(result.current.gamePhase).toBe("playing");
            expect(result.current.snapshot).toMatchObject({
                eventId: 2,
                status: "playing",
                sfen: STARTPOS_SFEN,
                turn: "b",
                clock: { running: "b", lastTickTs: 5_000 },
                players: { b: { name: "Alice" }, w: { name: "Bob" } },
            });
        });

        it("再読み込みの前に変更した開始局面で開く", () => {
            const { connection, result } = resumeAndWait("b", "handicap:bishop");

            act(() => {
                connection.emit(gameStart(2, { startSfen: "handicap:bishop" }));
            });

            expect(result.current.snapshot).toMatchObject({
                sfen: BISHOP_HANDICAP_SFEN,
                turn: "w",
                settings: { startSfen: "handicap:bishop" },
            });
        });

        it("再読み込みの後に変更された開始局面を待機画面に反映し、その局面で開く", () => {
            const { connection, result } = resumeAndWait("w");

            act(() => {
                connection.emit(settingsUpdated(2, WHITE_TO_MOVE_SFEN));
            });
            expect(result.current.localStartSfen).toBe(WHITE_TO_MOVE_SFEN);
            act(() => {
                connection.emit(gameStart(3, { startSfen: WHITE_TO_MOVE_SFEN }));
            });

            expect(result.current.gamePhase).toBe("playing");
            expect(result.current.snapshot).toMatchObject({
                eventId: 3,
                sfen: WHITE_TO_MOVE_SFEN,
                turn: "w",
            });
        });

        it("開始局面を解釈できない game_start では、resume で snapshot を取り直す", () => {
            const { connection, result } = resumeAndWait("b");
            connection.client.resume.mockClear();

            act(() => {
                connection.emit(gameStart(2, { startSfen: "handicap:unknown" }));
            });

            expect(result.current.gamePhase).toBe("waiting");
            expect(connection.client.resume).toHaveBeenCalledWith({
                resumeToken: "token-1",
                lastEventId: 0,
            });
        });

        it("サーバーがエラーを返したら、参加し直しを案内する", () => {
            const { connection, result } = resumeAndWait("b");

            act(() => {
                connection.emit({
                    v: 1,
                    t: "error",
                    payload: { code: "INVALID_TOKEN", message: "" },
                });
            });

            expect(result.current.joinError).toBe("セッションが切れました。再度参加してください。");
        });
    });
});
