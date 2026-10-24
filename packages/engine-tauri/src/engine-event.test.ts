import type { EngineEvent } from "@shogi/engine-client";
import { describe, expect, it } from "vitest";
import { normalizeEngineEvent } from "./engine-event";

describe("normalizeEngineEvent", () => {
    it("Desktop の探索開始の info（評価値が両方 null）から null の項目を落とす", () => {
        const payload = {
            type: "info",
            depth: 0,
            seldepth: null,
            nodes: 0,
            nps: null,
            timeMs: null,
            scoreCp: null,
            scoreMate: null,
            multipv: 1,
            pv: null,
            hashfull: null,
        } as unknown as EngineEvent;

        const event = normalizeEngineEvent(payload);

        expect(event).toEqual({ type: "info", depth: 0, nodes: 0, multipv: 1 });
        expect("scoreCp" in event).toBe(false);
        expect("scoreMate" in event).toBe(false);
    });

    it("bestmove の ponder が null なら落とす", () => {
        const payload = { type: "bestmove", move: "7g7f", ponder: null } as unknown as EngineEvent;
        expect(normalizeEngineEvent(payload)).toEqual({ type: "bestmove", move: "7g7f" });
    });

    it("0 や空の読み筋は値として残す", () => {
        const payload: EngineEvent = { type: "info", scoreCp: 0, pv: [] };
        expect(normalizeEngineEvent(payload)).toBe(payload);
    });
});
