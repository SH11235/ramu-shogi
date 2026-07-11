import { describe, expect, it } from "vitest";
import { exportToRshogiJsonl } from "./jsonlExport";

const meta = {
    timestamp: new Date("2026-01-02T03:04:05.000Z"),
    output: "game.jsonl",
    startSfen: "startpos",
    maxMoves: 256,
    byoyomiMs: 1000,
    mainTimeMs: 0,
    threads: 2,
    hashMb: 64,
    labels: { sente: "engine", gote: "human" },
} as const;

describe("exportToRshogiJsonl", () => {
    it("meta、move、result を互換キーで出力する", () => {
        const lines = exportToRshogiJsonl(
            [
                {
                    moveUsi: "7g7f",
                    sfenBefore: "sfen-0",
                    sideToMove: "sente" as const,
                    elapsedMs: 120,
                    searchStats: {
                        scoreCp: 30,
                        depth: 12,
                        nodes: 500,
                        pv: ["7g7f"],
                        thinkLimitMs: 1000,
                        engineId: "engine",
                    },
                },
            ],
            { ...meta, result: { outcome: "black_win", reason: "resignation", winner: "sente" } },
        )
            .split("\n")
            .map((line) => JSON.parse(line));
        expect(lines[0].settings.btime).toBeUndefined();
        expect(lines[0].start_positions).toEqual(["position startpos"]);
        expect(lines[1]).toMatchObject({
            ply: 1,
            side_to_move: "b",
            eval: { score_cp: 30, depth: 12 },
        });
        expect(lines[2]).toMatchObject({ outcome: "black_win", plies: 1, winner: "engine" });
    });

    it("探索値のない人間の手では eval キーを省略する", () => {
        const line = exportToRshogiJsonl(
            [
                {
                    moveUsi: "7g7f",
                    sfenBefore: "sfen-0",
                    sideToMove: "sente" as const,
                    elapsedMs: 20,
                },
            ],
            meta,
        )
            .split("\n")
            .map((entry) => JSON.parse(entry))[1];
        expect(line.eval).toBeUndefined();
    });
});
