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
    exportGameKif,
    exportGameRecordKif,
    type GameState,
    gameReducer,
    makeInitialGameState,
    resolveStartSfen,
    restorePosition,
    snapshotAtGameStart,
} from "./online-game-state";
import { parseKif } from "./shogi-match/utils/kifParser";

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
    return gameReducer(makeInitialGameState(snapshot, null, "s"), {
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

    it("snapshot の消費時間を各手に付け、指し手と数が合わなければ付けない", async () => {
        const timed = await restoredState({
            ...makeSnapshot(MOVES),
            moveElapsedMs: [1_000, 2_500, 0],
        });
        expect(timed.usiMoveLog).toEqual([
            { usi: "7g7f", elapsedMs: 1_000 },
            { usi: "3c3d", elapsedMs: 2_500 },
            { usi: "8h2b+", elapsedMs: 0 },
        ]);

        const atLimit = await restoredState({
            ...makeSnapshot(MOVES),
            moveElapsedMs: [2_592_000_000, 0, 0],
        });
        expect(atLimit.usiMoveLog[0]).toEqual({ usi: "7g7f", elapsedMs: 2_592_000_000 });

        for (const moveElapsedMs of [
            [1_000, 2_500],
            [1_000, Number.NaN, 0],
            [1e308, 0, 1e308],
            [1_000, 2.5, 0],
            [2_592_000_001, 0, 0],
        ]) {
            const untimed = await restoredState({ ...makeSnapshot(MOVES), moveElapsedMs });
            expect(untimed.usiMoveLog).toEqual(MOVES.map((usi) => ({ usi })));
        }
    });

    it("指し手のイベントが持つ消費時間を使い、無いか壊れていれば残り時間の差分で代える", async () => {
        const restored = await restoredState(makeSnapshot(MOVES));
        const move = (elapsedMs?: number) =>
            gameReducer(restored, {
                type: "move",
                usi: "3a2b",
                turn: "b",
                clock: { ...CLOCK, w: { remainMs: 600_000 } },
                passRights: null,
                elapsedMs,
            }).usiMoveLog[3];

        expect(move(31_000)).toEqual({ usi: "3a2b", elapsedMs: 31_000 });
        expect(move(undefined)).toEqual({ usi: "3a2b", elapsedMs: 0 });
        expect(move(1e308)).toEqual({ usi: "3a2b", elapsedMs: 0 });
    });

    it("再同期では snapshot の消費時間を手元で測った時間より優先する", async () => {
        const moved = gameReducer(await restoredState(makeSnapshot(MOVES)), {
            type: "move",
            usi: "3a2b",
            turn: "b",
            clock: { ...CLOCK, w: { remainMs: 590_000 } },
            passRights: null,
        });

        const resynced = gameReducer(moved, {
            type: "resync",
            ...(await restorePosition({
                ...makeSnapshot([...MOVES, "3a2b"]),
                moveElapsedMs: [1_000, 2_000, 3_000, 9_000],
            })),
            turn: "b",
            clock: CLOCK,
            passRights: null,
        });

        expect(resynced.usiMoveLog.map((entry) => entry.elapsedMs)).toEqual([
            1_000, 2_000, 3_000, 9_000,
        ]);
    });

    it("再同期の snapshot が持つ待ったの申請と残り回数で置き換え、持たなければ今の状態を保つ", async () => {
        const restored = await restoredState(makeSnapshot(MOVES));
        const requested = gameReducer(
            gameReducer(restored, { type: "takeback_requested", seat: "w", ply: 3 }),
            { type: "analysis_used", isMySeat: true, seat: "b", analysisRemaining: 2, ply: 3 },
        );
        const position = await restorePosition(makeSnapshot(MOVES));
        const resync = {
            type: "resync" as const,
            ...position,
            turn: "w" as const,
            clock: CLOCK,
            passRights: null,
        };

        const fromOldServer = gameReducer(requested, resync);
        expect(fromOldServer.pendingTakeback).toEqual({ seat: "w", ply: 3 });
        expect(fromOldServer.myAnalysisRemaining).toBe(2);

        const cleared = gameReducer(requested, {
            ...resync,
            pendingTakeback: null,
            myAnalysisRemaining: 1,
        });
        expect(cleared.pendingTakeback).toBeNull();
        expect(cleared.myAnalysisRemaining).toBe(1);

        const pending = gameReducer(restored, {
            ...resync,
            pendingTakeback: { seat: "b", ply: 3 },
            myAnalysisRemaining: null,
        });
        expect(pending.pendingTakeback).toEqual({ seat: "b", ply: 3 });
        expect(pending.myAnalysisRemaining).toBeNull();
    });

    it("再同期の snapshot が持つ解析の使用記録で置き換え、持たなければ今の記録を保つ", async () => {
        const restored = await restoredState(makeSnapshot(MOVES));
        const used = gameReducer(restored, {
            type: "analysis_used",
            isMySeat: true,
            seat: "b",
            analysisRemaining: 2,
            ply: 1,
        });
        const resync = {
            type: "resync" as const,
            ...(await restorePosition(makeSnapshot(MOVES))),
            turn: "w" as const,
            clock: CLOCK,
            passRights: null,
        };

        expect(gameReducer(used, resync).analysisLog).toEqual([{ seat: "b", ply: 1 }]);
        expect(
            gameReducer(used, {
                ...resync,
                analysisLog: [
                    { seat: "b", ply: 1 },
                    { seat: "w", ply: 2 },
                ],
            }).analysisLog,
        ).toEqual([
            { seat: "b", ply: 1 },
            { seat: "w", ply: 2 },
        ]);
        expect(gameReducer(used, { ...resync, analysisLog: [] }).analysisLog).toEqual([]);
    });
});

describe("KIF の終局", () => {
    const NAMES = { b: "Alice", w: "Bob" };

    /** どの開始局面も、平手の配置で後手の番として解釈する局面サービス */
    function useGoteToMoveService(): void {
        setPositionServiceFactory(() => ({
            getInitialBoard: async () => createInitialPositionState(),
            parseSfen: async () => ({ ...createInitialPositionState(), turn: "gote" }),
            boardToSfen: async () => "",
            getLegalMoves: async () => [],
            replayMovesStrict: async () => {
                throw new Error("not used");
            },
        }));
    }

    /** 平手から指した後の対局画面の状態。指し手の後は手番の側が指す番 */
    function finishedState(moves: string[], gameResult: GameState["gameResult"]) {
        const positionHistory = moves.map((_, i) => positionAfter(moves.slice(0, i + 1)));
        positionHistory.unshift(createInitialPositionState());
        return { usiMoveLog: moves.map((usi) => ({ usi })), positionHistory, gameResult };
    }

    /** 指し手の行より後ろ（終局語・「まで」の行・コメント・末尾の改行） */
    const endingLines = (kif: string, moveCount: number) => {
        const lines = kif.split("\n");
        return lines.slice(lines.findIndex((line) => line.startsWith("手数----")) + 1 + moveCount);
    };

    it.each([
        // 2 手の後は先手の番
        { moves: 2, winner: "w", reason: "resign", lines: ["   3 投了", "まで2手で後手の勝ち"] },
        { moves: 2, winner: "w", reason: "checkmate", lines: ["   3 詰み", "まで2手で後手の勝ち"] },
        {
            moves: 2,
            winner: "w",
            reason: "timeout",
            lines: ["   3 切れ負け", "まで2手で時間切れにより後手の勝ち"],
        },
        {
            moves: 2,
            winner: "w",
            reason: "illegal_move",
            lines: ["   3 反則負け", "まで2手で先手の反則負け"],
        },
        {
            moves: 1,
            winner: "w",
            reason: "illegal_move",
            lines: ["   2 反則勝ち", "まで1手で先手の反則負け"],
        },
        { moves: 1, winner: "b", reason: "resign", lines: ["   2 投了", "まで1手で先手の勝ち"] },
        // 手番でない側の投了・切断負けには終局語が無い
        { moves: 2, winner: "b", reason: "resign", lines: ["まで2手で先手の勝ち"] },
        { moves: 1, winner: "w", reason: "disconnect", lines: ["まで1手で後手の勝ち", "*切断"] },
        { moves: 2, winner: null, reason: "sennichite", lines: ["   3 千日手", "まで2手で千日手"] },
    ] as const)("$reason で $winner が勝った $moves 手の対局に、終局語と「まで」の行を書く", ({
        moves,
        winner,
        reason,
        lines,
    }) => {
        const state = finishedState(["7g7f", "3c3d"].slice(0, moves), { winner, reason });

        expect(endingLines(exportGameKif(state, "startpos", NAMES), moves)).toEqual([...lines, ""]);
    });

    it("終局のコメントは読み込むときに指し手にならない", () => {
        const state = finishedState(["7g7f"], { winner: "w", reason: "disconnect" });

        expect(parseKif(exportGameKif(state, "startpos", NAMES)).moves).toEqual(["7g7f"]);
    });

    it("指し手の無いまま終わった対局にも、開始局面と終局の行を書く", () => {
        const kif = exportGameKif(
            finishedState([], { winner: "w", reason: "resign" }),
            "startpos",
            NAMES,
        );

        expect(endingLines(kif, 0)).toEqual(["   1 投了", "まで0手で後手の勝ち", ""]);
    });

    it("指し手も終局の結果も無ければ空文字を返す", () => {
        expect(exportGameKif(finishedState([], null), "startpos", NAMES)).toBe("");
    });

    it("対局中は終局の行を書かない", () => {
        const kif = exportGameKif(finishedState(["7g7f"], null), "startpos", NAMES);

        expect(kif).not.toContain("まで");
    });

    it("駒落ちは上手（後手）から指すので、上手が 1 手指した後の投了は下手（先手）の負け", async () => {
        const handicap = "lnsgkgsnl/1r7/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1";
        useGoteToMoveService();

        const kif = await exportGameRecordKif(
            { initialSfen: handicap, moves: ["3c3d"], result: { winner: "w", reason: "resign" } },
            NAMES,
        );

        expect(endingLines(kif ?? "", 1)).toEqual(["   2 投了", "まで1手で後手の勝ち", ""]);
    });

    it.each([
        "lnsgkgsnl/1r7/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL  w  -  1",
        "lnsgkgsnl/1r7/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL\tw\t-\t1",
        " lnsgkgsnl/1r7/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1",
    ])("開始局面の区切りが空白 1 つでなくても手番を読む: %j", async (initialSfen) => {
        useGoteToMoveService();

        const kif = await exportGameRecordKif(
            { initialSfen, moves: ["3c3d"], result: { winner: "w", reason: "resign" } },
            NAMES,
        );

        expect(endingLines(kif ?? "", 1)).toEqual(["   2 投了", "まで1手で後手の勝ち", ""]);
    });

    it("保存された消費時間を各手と指した側の累計に書き、指し手と数が合わなければ書かない", async () => {
        useFakePositionService([]);
        const moves = ["7g7f", "3c3d", "2g2f"];
        const timedLines = async (moveElapsedMs: unknown) =>
            (await exportGameRecordKif({ initialSfen: "startpos", moves, moveElapsedMs }, NAMES))
                ?.split("\n")
                .filter((line) => /^ +\d+ /.test(line));

        expect(await timedLines([65_000, 3_000, 1_500])).toEqual([
            "   1 ７六歩(77)   ( 1:05/00:01:05)",
            "   2 ３四歩(33)   ( 0:03/00:00:03)",
            "   3 ２六歩(27)   ( 0:01/00:01:06)",
        ]);
        for (const broken of [
            [65_000, 3_000],
            ["65000", 3_000, 1_500],
            { 0: 1 },
            [1e308, 0, 1e308],
            [65_000, 3_000.5, 1_500],
        ]) {
            expect(
                (await timedLines(broken))?.every((line) => line.includes("( 0:00/00:00:00)")),
            ).toBe(true);
        }
    });

    it("パスも 1 手として、パスの前後で指した側ごとの累計を続ける", async () => {
        useFakePositionService([]);

        const kif = await exportGameRecordKif(
            {
                initialSfen: "startpos",
                moves: ["7g7f", "pass", "2g2f", "3c3d"],
                moveElapsedMs: [65_000, 3_000, 1_500, 7_000],
            },
            NAMES,
        );

        expect(kif?.split("\n").filter((line) => /^ +\d+ /.test(line))).toEqual([
            "   1 ７六歩(77)   ( 1:05/00:01:05)",
            "   2 パス     ( 0:03/00:00:03)",
            "   3 ２六歩(27)   ( 0:01/00:01:06)",
            "   4 ３四歩(33)   ( 0:07/00:00:10)",
        ]);
    });

    it("千日手以外の引き分けは中断と書く", async () => {
        useFakePositionService([]);

        const kif = await exportGameRecordKif(
            {
                initialSfen: "startpos",
                moves: ["7g7f"],
                result: { winner: null, reason: "aborted" },
            },
            NAMES,
        );

        expect(endingLines(kif ?? "", 1)).toEqual(["   2 中断", "まで1手で中断", ""]);
    });

    it("指し手の無い保存された棋譜も、終局の後の改行は指し手がある場合と同じ", async () => {
        useFakePositionService([]);

        const kif = await exportGameRecordKif(
            { initialSfen: "startpos", moves: [], result: { winner: "w", reason: "resign" } },
            NAMES,
        );

        expect(endingLines(kif ?? "", 0)).toEqual(["   1 投了", "まで0手で後手の勝ち", ""]);
    });

    it("保存された棋譜の結果が無ければ終局の行を書かない", async () => {
        useFakePositionService([]);

        const kif = await exportGameRecordKif(
            { initialSfen: "startpos", moves: ["7g7f"], result: null },
            NAMES,
        );

        expect(kif).not.toContain("まで");
    });
});

describe("makeInitialGameState", () => {
    const LIMITED = { mode: "limited" as const, limitCount: 3 };

    it("snapshot が持つ待ったの申請と自分の席の残り回数から始める", () => {
        const snapshot: SnapshotPayload = {
            ...makeSnapshot([]),
            pendingTakeback: { seat: "w", ply: 4 },
            analysisRemaining: { b: 1, w: null },
        };

        expect(makeInitialGameState(snapshot, LIMITED, "b")).toMatchObject({
            pendingTakeback: { seat: "w", ply: 4 },
            myAnalysisRemaining: 1,
        });
        expect(makeInitialGameState(snapshot, null, "w").myAnalysisRemaining).toBeNull();
        expect(makeInitialGameState(snapshot, null, "s").myAnalysisRemaining).toBeNull();
    });

    it("snapshot が持つ解析の使用記録から始める", () => {
        const snapshot: SnapshotPayload = {
            ...makeSnapshot([]),
            analysisLog: [{ seat: "w", ply: 0 }],
        };
        expect(makeInitialGameState(snapshot, null, "b").analysisLog).toEqual([
            { seat: "w", ply: 0 },
        ]);
        expect(makeInitialGameState(makeSnapshot([]), null, "b").analysisLog).toEqual([]);
    });

    it("snapshot に無ければ、申請なし・設定の上限回数から始める", () => {
        expect(makeInitialGameState(makeSnapshot([]), LIMITED, "b")).toMatchObject({
            pendingTakeback: null,
            myAnalysisRemaining: 3,
        });
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

    // 空白の読み方と手数の補い方はサーバーの解釈を再現しないので、空白 1 つ区切りの 4 フィールド
    // 以外は組み立てない
    it.each([
        ["知らないプリセット名", "handicap:unknown"],
        ["空文字", ""],
        ["盤面だけ", "4k4/9/9/9/9/9/9/9/4K4"],
        ["手番が b / w でない", "4k4/9/9/9/9/9/9/9/4K4 x - 1"],
        ["先頭に空白", " 4k4/9/9/9/9/9/9/9/4K4 w - 1"],
        ["末尾に空白", "4k4/9/9/9/9/9/9/9/4K4 w - 1 "],
        ["手番の前に空白が 2 つ", "4k4/9/9/9/9/9/9/9/4K4  w - 1"],
        ["持ち駒の前に空白が 2 つ", "4k4/9/9/9/9/9/9/9/4K4 w  - 1"],
        ["タブ区切り", "4k4/9/9/9/9/9/9/9/4K4\tw\t-\t1"],
        ["全角空白区切り", "4k4/9/9/9/9/9/9/9/4K4\u3000w - 1"],
        ["末尾に改行", "4k4/9/9/9/9/9/9/9/4K4 w - 1\n"],
        ["手数を省いた 3 フィールド", "4k4/9/9/9/9/9/9/9/4K4 w -"],
        ["5 フィールド", "4k4/9/9/9/9/9/9/9/4K4 w - 1 extra"],
    ])("%s の開始局面は組み立てず null を返す", (_name, startSfen) => {
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
