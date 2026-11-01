import type { NnueSelection } from "@shogi/app-core";
import { describe, expect, it } from "vitest";
import type { ClockSettings } from "./hooks/useClockManager";
import { START_POSITIONS } from "./play/startPositions";
import type { SideSetting } from "./types";
import { matchEndEvent, matchStartEvent } from "./usageEvents";

const HIRATE = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1";
const human: SideSetting = { role: "human" };
const engine: SideSetting = { role: "engine", engineId: "wasm" };
const none: NnueSelection = { presetKey: null, nnueId: null };
const clock = (overrides: Partial<ClockSettings["sente"]> = {}): ClockSettings["sente"] => ({
    mainMs: 600_000,
    byoyomiMs: 0,
    incrementMs: 0,
    enabled: true,
    ...overrides,
});

function start({
    sides = { sente: human, gote: engine },
    selections = { sente: none, gote: { presetKey: "coco", nnueId: null } },
    timeSettings = { sente: clock({ byoyomiMs: 10_000 }), gote: clock() },
    startSfen = HIRATE,
    movesBeforeStart = 0,
}: Partial<Parameters<typeof matchStartEvent>[0]> = {}) {
    return matchStartEvent({ sides, selections, timeSettings, startSfen, movesBeforeStart });
}

describe("matchStartEvent", () => {
    it("人と AI の対局は、相手の AI と人の側の持ち時間を送る", () => {
        expect(start()).toEqual({
            players: "human_ai",
            ai: "coco",
            time: "byoyomi",
            start: "even",
        });
    });

    it("人が後手なら先手の AI を送る", () => {
        expect(
            start({
                sides: { sente: engine, gote: human },
                selections: { sente: { presetKey: null, nnueId: "user-file" }, gote: none },
            }).ai,
        ).toBe("custom");
    });

    it("AI どうしは先手の AI、人どうしは AI を送らない", () => {
        expect(
            start({
                sides: { sente: engine, gote: engine },
                selections: { sente: none, gote: none },
            }),
        ).toMatchObject({ players: "ai_ai", ai: "material" });
        expect(start({ sides: { sente: human, gote: human } })).not.toHaveProperty("ai");
    });

    it.each([
        [clock({ enabled: false }), "none"],
        [clock({ incrementMs: 5_000 }), "fischer"],
        [clock(), "sudden"],
    ] as const)("持ち時間の種類: %o → %s", (sente, time) => {
        expect(start({ timeSettings: { sente, gote: clock() } }).time).toBe(time);
    });

    it("駒落ちと、局面の指定・途中からの開始を分ける", () => {
        const handicap = START_POSITIONS[0];
        if (!handicap) throw new Error("駒落ちの開始局面が無い");
        expect(start({ startSfen: handicap.sfen }).start).toBe("handicap");
        expect(start({ startSfen: "4k4/9/9/9/9/9/9/9/4K4 b - 1" }).start).toBe("position");
        expect(start({ movesBeforeStart: 3 }).start).toBe("position");
    });
});

describe("matchEndEvent", () => {
    it("人と AI の対局は人から見た勝ち負け", () => {
        const sides = { sente: human, gote: engine };
        expect(
            matchEndEvent(
                { winner: "gote", reason: { kind: "resignation", loser: "sente" }, totalMoves: 80 },
                sides,
            ),
        ).toEqual({ result: "loss", reason: "resignation", plies: 80 });
        expect(
            matchEndEvent(
                { winner: "sente", reason: { kind: "checkmate", loser: "gote" }, totalMoves: 91 },
                sides,
            ).result,
        ).toBe("win");
    });

    it("それ以外は勝った側", () => {
        expect(
            matchEndEvent(
                {
                    winner: "gote",
                    reason: { kind: "time_expired", loser: "sente" },
                    totalMoves: 40,
                },
                { sente: engine, gote: engine },
            ).result,
        ).toBe("gote_win");
    });
});
