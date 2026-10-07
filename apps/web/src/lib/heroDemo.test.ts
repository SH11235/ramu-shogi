import { applyMoveWithState, createInitialPositionState } from "@shogi/app-core";
import { describe, expect, it } from "vitest";
import { DEMO_MOVES, RAM_LINES } from "./heroDemo";

describe("heroDemo", () => {
    it("台詞は初期局面 + 各手の直後で、局面数と一致する", () => {
        expect(RAM_LINES.length).toBe(DEMO_MOVES.length + 1);
    });

    it("手順はすべて平手から連続して指せる", () => {
        let state = createInitialPositionState();
        for (const move of DEMO_MOVES) {
            const result = applyMoveWithState(state, move);
            expect(result.ok, move).toBe(true);
            state = result.next;
        }
    });
});
