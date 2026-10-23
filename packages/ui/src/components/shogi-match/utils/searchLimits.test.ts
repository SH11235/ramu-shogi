import { describe, expect, it } from "vitest";
import type { ClockSettings } from "../hooks/useClockManager";
import {
    clockSettingsForLimits,
    formatNodeCount,
    formatSearchLimit,
    normalizeEngineSearchLimits,
    SEARCH_DEPTH_MAX,
} from "./searchLimits";

describe("normalizeEngineSearchLimits", () => {
    it("壊れた値・範囲外の値は時計どおりに戻し、上限は丸める", () => {
        expect(
            normalizeEngineSearchLimits({
                sente: { kind: "nodes", nodes: 0 },
                gote: { kind: "depth", depth: 999.7 },
            }),
        ).toEqual({ sente: { kind: "clock" }, gote: { kind: "depth", depth: SEARCH_DEPTH_MAX } });
        expect(normalizeEngineSearchLimits("x")).toEqual({
            sente: { kind: "clock" },
            gote: { kind: "clock" },
        });
    });
});

describe("clockSettingsForLimits", () => {
    const clock = { mainMs: 0, byoyomiMs: 10_000, incrementMs: 0, enabled: true };
    const settings: ClockSettings = { sente: { ...clock }, gote: { ...clock } };

    it("ノード数で読む AI の側だけ時計を止め、人の側は止めない", () => {
        const result = clockSettingsForLimits(
            settings,
            { sente: { role: "human" }, gote: { role: "engine", engineId: "wasm" } },
            { sente: { kind: "nodes", nodes: 1000 }, gote: { kind: "nodes", nodes: 1000 } },
        );
        expect(result.sente.enabled).toBe(true);
        expect(result.gote).toEqual({ ...clock, enabled: false });
    });

    it("時計どおりなら同じ設定をそのまま返す", () => {
        const result = clockSettingsForLimits(
            settings,
            { sente: { role: "human" }, gote: { role: "engine", engineId: "wasm" } },
            { sente: { kind: "clock" }, gote: { kind: "clock" } },
        );
        expect(result).toBe(settings);
    });
});

describe("formatSearchLimit", () => {
    it.each([
        [999, "999"],
        [12_345, "1.2万"],
        [1_000_000, "100万"],
        [340_000_000, "3.4億"],
    ])("%d 局面は %s", (nodes, text) => {
        expect(formatNodeCount(nodes)).toBe(text);
    });

    it("時計どおりは null、深さは「深さ N」", () => {
        expect(formatSearchLimit({ kind: "clock" })).toBeNull();
        expect(formatSearchLimit({ kind: "depth", depth: 12 })).toBe("深さ 12");
        expect(formatSearchLimit({ kind: "nodes", nodes: 1_000_000 })).toBe("100万局面");
    });
});
