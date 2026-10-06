import {
    applyMoveWithState,
    createInitialPositionState,
    type PositionState,
    setPositionServiceFactory,
} from "@shogi/app-core";
import type { GameStartEvent, RoomSettings, SnapshotPayload } from "@shogi/match-client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    createSerialQueue,
    type GameState,
    gameReducer,
    makeInitialGameState,
    resolveStartSfen,
    restorePosition,
    snapshotAtGameStart,
} from "./online-game-state";

const CLOCK = {
    b: { remainMs: 600_000 },
    w: { remainMs: 600_000 },
    running: "b" as const,
    lastTickTs: 0,
};

function makeSnapshot(moves: string[], startSfen = "startpos"): SnapshotPayload {
    return {
        eventId: 5,
        status: "playing",
        sfen: `current after ${moves.length}`,
        moves,
        turn: moves.length % 2 === 0 ? "b" : "w",
        clock: CLOCK,
        passRights: null,
        players: { b: { name: "Alice", online: true }, w: { name: "Bob", online: true } },
        spectators: 0,
        settings: {
            startSfen,
            timeControl: { type: "byoyomi", initialMs: 600_000, byoyomiMs: 30_000 },
            passRights: null,
            aiSupport: null,
            takeback: true,
        },
    };
}

function positionAfter(moves: string[]): PositionState {
    return moves.reduce(
        (position, usi) => applyMoveWithState(position, usi).next,
        createInitialPositionState(),
    );
}

/** 平手の開始局面と「current after N」だけを解釈する局面サービス */
function useFakePositionService(played: string[]): void {
    setPositionServiceFactory(() => ({
        getInitialBoard: async () => createInitialPositionState(),
        parseSfen: async (sfen) => {
            if (sfen === "startpos") return createInitialPositionState();
            const count = /^current after (\d+)$/.exec(sfen)?.[1];
            if (count === undefined) throw new Error(`unparseable: ${sfen}`);
            return positionAfter(played.slice(0, Number(count)));
        },
        boardToSfen: async () => "",
        getLegalMoves: async () => [],
        replayMovesStrict: async () => {
            throw new Error("not used");
        },
    }));
}

async function restoredState(snapshot: SnapshotPayload): Promise<GameState> {
    return gameReducer(makeInitialGameState(snapshot, null), {
        type: "init",
        ...(await restorePosition(snapshot)),
    });
}

describe("gameReducer", () => {
    const MOVES = ["7g7f", "3c3d", "8h2b+"];

    beforeEach(() => {
        useFakePositionService([...MOVES, "3a2b"]);
    });

    it("snapshot から復元すると、局面の履歴は指し手の記録より 1 件多い", async () => {
        const state = await restoredState(makeSnapshot(MOVES));

        expect(state.usiMoveLog.map((entry) => entry.usi)).toEqual(MOVES);
        expect(state.positionHistory).toHaveLength(4);
        expect(state.positionHistory[0]).toEqual(createInitialPositionState());
        expect(state.positionHistory[2]).toEqual(positionAfter(MOVES.slice(0, 2)));
        expect(state.positionHistory[3]).toBe(state.position);
    });

    it("再生できない指し手があれば、現局面だけを持ち記録は空にする", async () => {
        const state = await restoredState(makeSnapshot(["7g7f", "7g7f", "3c3d"]));

        expect(state.usiMoveLog).toEqual([]);
        expect(state.positionHistory).toEqual([state.position]);
    });

    it("復元後の待ったは最後の 1 手だけを取り消し、履歴の末尾を通知された局面にする", async () => {
        const restored = await restoredState(makeSnapshot(MOVES));
        const moved = gameReducer(restored, {
            type: "move",
            usi: "3a2b",
            turn: "b",
            clock: CLOCK,
            passRights: null,
        });
        expect(moved.positionHistory).toHaveLength(5);

        const notified = positionAfter(MOVES);
        const state = gameReducer(moved, {
            type: "takeback_accepted",
            position: notified,
            turn: "w",
            clock: CLOCK,
            passRights: null,
        });

        expect(state.usiMoveLog.map((entry) => entry.usi)).toEqual(MOVES);
        expect(state.positionHistory).toHaveLength(4);
        expect(state.positionHistory[3]).toBe(notified);
        expect(state.positionHistory.slice(0, 3)).toEqual(restored.positionHistory.slice(0, 3));
        expect(state.position).toBe(notified);
        expect(state.turn).toBe("w");
    });

    it("最初の 1 手を待ったで取り消すと、履歴は通知された局面だけになる", async () => {
        const restored = await restoredState(makeSnapshot(MOVES.slice(0, 1)));
        const notified = createInitialPositionState();

        const state = gameReducer(restored, {
            type: "takeback_accepted",
            position: notified,
            turn: "b",
            clock: CLOCK,
            passRights: null,
        });

        expect(state.usiMoveLog).toEqual([]);
        expect(state.positionHistory).toEqual([notified]);
    });

    it("再同期では一致する指し手の消費時間を保ち、再生できなければ記録を空にする", async () => {
        const restored = await restoredState(makeSnapshot(MOVES));
        const moved = gameReducer(restored, {
            type: "move",
            usi: "3a2b",
            turn: "b",
            clock: { ...CLOCK, w: { remainMs: 590_000 } },
            passRights: null,
        });
        expect(moved.usiMoveLog[3]).toEqual({ usi: "3a2b", elapsedMs: 10_000 });

        const resynced = gameReducer(moved, {
            type: "resync",
            ...(await restorePosition(makeSnapshot([...MOVES, "3a2b"]))),
            turn: "b",
            clock: CLOCK,
            passRights: null,
        });
        expect(resynced.usiMoveLog[3]).toEqual({ usi: "3a2b", elapsedMs: 10_000 });
        expect(resynced.positionHistory).toHaveLength(5);

        const broken = gameReducer(resynced, {
            type: "resync",
            ...(await restorePosition(makeSnapshot(["7g7f", "7g7f"]))),
            turn: "b",
            clock: CLOCK,
            passRights: null,
        });
        expect(broken.usiMoveLog).toEqual([]);
        expect(broken.positionHistory).toEqual([broken.position]);
    });
});

describe("resolveStartSfen", () => {
    it("駒落ちプリセットの名前を局面に展開し、それ以外はそのまま返す", () => {
        expect(resolveStartSfen("handicap:bishop")).toBe(
            "lnsgkgsnl/1r7/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1",
        );
        expect(resolveStartSfen("handicap:rook")).toBe(
            "lnsgkgsnl/7b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1",
        );
        expect(resolveStartSfen("handicap:rook-bishop")).toBe(
            "lnsgkgsnl/9/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1",
        );
        expect(resolveStartSfen("startpos")).toBe("startpos");
        expect(resolveStartSfen("9/9/9/9/9/9/9/9/9 b - 1")).toBe("9/9/9/9/9/9/9/9/9 b - 1");
    });
});

describe("snapshotAtGameStart", () => {
    const PLAYERS = { b: { name: "Alice", online: true }, w: { name: "Bob", online: true } };

    function gameStart(settings: Partial<RoomSettings> = {}): GameStartEvent {
        return {
            kind: "game_start",
            eventId: 3,
            serverTs: 5_000,
            settings: { ...makeSnapshot([]).settings, ...settings },
            players: PLAYERS,
        };
    }

    it("平手は初期局面・先手番で、先手の時計を対局開始の時刻から動かす", () => {
        const event = gameStart();

        expect(snapshotAtGameStart(event)).toEqual({
            eventId: 3,
            status: "playing",
            sfen: "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1",
            moves: [],
            turn: "b",
            clock: {
                b: { remainMs: 600_000 },
                w: { remainMs: 600_000 },
                running: "b",
                lastTickTs: 5_000,
            },
            passRights: null,
            players: PLAYERS,
            settings: event.settings,
        });
    });

    it.each([
        ["handicap:bishop", "lnsgkgsnl/1r7/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1"],
        ["handicap:rook", "lnsgkgsnl/7b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1"],
        ["handicap:rook-bishop", "lnsgkgsnl/9/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1"],
    ])("駒落ちプリセット %s は展開した局面・上手の手番になる", (startSfen, sfen) => {
        expect(snapshotAtGameStart(gameStart({ startSfen }))).toMatchObject({
            sfen,
            turn: "w",
            clock: { running: "w" },
            settings: { startSfen },
        });
    });

    it("SFEN の開始局面は、その局面と手番を使う", () => {
        const startSfen = "4k4/9/9/9/9/9/9/9/4K4 w 2Pb 1";

        expect(snapshotAtGameStart(gameStart({ startSfen }))).toMatchObject({
            sfen: startSfen,
            turn: "w",
        });
    });

    it("手数を省いた SFEN には 1 手目を補う", () => {
        expect(
            snapshotAtGameStart(gameStart({ startSfen: "4k4/9/9/9/9/9/9/9/4K4 b -" })),
        ).toMatchObject({ sfen: "4k4/9/9/9/9/9/9/9/4K4 b - 1", turn: "b" });
    });

    it("パス権は設定の回数を双方に配る", () => {
        expect(snapshotAtGameStart(gameStart({ passRights: { initialCount: 2 } }))).toMatchObject({
            passRights: { b: 2, w: 2 },
        });
    });

    it.each<RoomSettings["timeControl"]>([
        { type: "byoyomi", initialMs: 0, byoyomiMs: 0 },
        { type: "byoyomi", initialMs: 0 },
        { type: "fischer", initialMs: 0, fischerIncrementMs: 10_000 },
    ])("持ち時間が無制限（%o）なら時計を動かさない", (timeControl) => {
        expect(snapshotAtGameStart(gameStart({ timeControl }))?.clock.running).toBeNull();
    });

    it("持ち時間 0 でも秒読みがあれば時計を動かす", () => {
        const timeControl = { type: "byoyomi", initialMs: 0, byoyomiMs: 3_000 } as const;

        expect(snapshotAtGameStart(gameStart({ timeControl }))?.clock).toEqual({
            b: { remainMs: 0 },
            w: { remainMs: 0 },
            running: "b",
            lastTickTs: 5_000,
        });
    });

    it.each([
        "handicap:unknown",
        "",
        "4k4/9/9/9/9/9/9/9/4K4",
        "4k4/9/9/9/9/9/9/9/4K4 x - 1",
    ])("開始局面 %j を解釈できなければ null を返す", (startSfen) => {
        expect(snapshotAtGameStart(gameStart({ startSfen }))).toBeNull();
    });
});

describe("createSerialQueue", () => {
    function deferred(): { promise: Promise<void>; resolve: () => void } {
        let resolve: () => void = () => {};
        const promise = new Promise<void>((done) => {
            resolve = done;
        });
        return { promise, resolve };
    }

    it("同期で終わる処理は push の中で実行する", () => {
        const handled: number[] = [];
        const queue = createSerialQueue<number>(
            (item) => {
                handled.push(item);
            },
            () => true,
        );

        queue.push(1);
        queue.push(2);

        expect(handled).toEqual([1, 2]);
    });

    it("非同期の処理が終わるまで次へ進まず、届いた順を保つ", async () => {
        const first = deferred();
        const handled: string[] = [];
        const queue = createSerialQueue<string>(
            (item) => {
                if (item === "slow") {
                    return first.promise.then(() => {
                        handled.push(item);
                    });
                }
                handled.push(item);
            },
            () => true,
        );

        queue.push("slow");
        queue.push("fast");
        expect(handled).toEqual([]);

        first.resolve();
        await vi.waitFor(() => expect(handled).toEqual(["slow", "fast"]));
    });

    it("失敗した処理があっても次へ進む", async () => {
        const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
        const handled: number[] = [];
        const queue = createSerialQueue<number>(
            (item) => {
                if (item === 1) return Promise.reject(new Error("boom"));
                handled.push(item);
            },
            () => true,
        );

        queue.push(1);
        queue.push(2);

        await vi.waitFor(() => expect(handled).toEqual([2]));
        errorLog.mockRestore();
    });

    it("止まっている間は処理せず、resume で残りを届いた順に処理する", () => {
        let active = false;
        const handled: number[] = [];
        const queue = createSerialQueue<number>(
            (item) => {
                handled.push(item);
            },
            () => active,
        );

        queue.push(1);
        queue.push(2);
        expect(handled).toEqual([]);

        active = true;
        queue.resume();
        expect(handled).toEqual([1, 2]);
    });
});
