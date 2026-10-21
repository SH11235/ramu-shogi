import { applyMoveWithState, parseStudySfen } from "@shogi/app-core";
import { describe, expect, it } from "vitest";
import { isCpuLosing, moveSoundScene } from "./moveSoundScene";

function sceneOf(sfen: string, move: string) {
    const before = parseStudySfen(sfen);
    const applied = applyMoveWithState(before, move);
    if (!applied.ok) throw new Error(applied.error);
    return moveSoundScene(before, move, applied.next);
}

describe("moveSoundScene", () => {
    it("classifies a quiet move", () => {
        expect(sceneOf("4k4/9/9/9/9/9/9/R8/4K4 b - 1", "9h9g")).toBe("move");
    });

    it("classifies a promotion without capture", () => {
        expect(sceneOf("4k4/9/9/9/9/9/9/R8/4K4 b - 1", "9h9c+")).toBe("promote");
    });

    it("prefers capture over promotion", () => {
        expect(sceneOf("4k4/9/p8/9/9/9/9/R8/4K4 b - 1", "9h9c+")).toBe("capture");
    });

    it("classifies a capture", () => {
        expect(sceneOf("4k4/9/9/9/3p5/9/9/3R5/4K4 b - 1", "6h6e")).toBe("capture");
    });

    it("prefers check over capture, including drops", () => {
        expect(sceneOf("4k4/9/9/9/4p4/9/9/4R4/4K4 b - 1", "5h5e")).toBe("check");
        expect(sceneOf("4k4/9/9/9/9/9/9/9/4K4 b G 1", "G*5b")).toBe("check");
    });
});

describe("isCpuLosing", () => {
    it("uses the engine's own score", () => {
        expect(isCpuLosing(undefined)).toBe(false);
        expect(isCpuLosing({ scoreCp: -999 })).toBe(false);
        expect(isCpuLosing({ scoreCp: -1000 })).toBe(true);
        expect(isCpuLosing({ scoreMate: -5 })).toBe(true);
        expect(isCpuLosing({ scoreMate: -0 })).toBe(true);
        expect(isCpuLosing({ scoreMate: 3, scoreCp: -2000 })).toBe(false);
    });
});
