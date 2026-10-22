import { describe, expect, it } from "vitest";
import type { ClockSettings } from "../hooks/useClockManager";
import { formatTimeRule, normalizeTimeSettings } from "./timeSettings";

const DEFAULTS: ClockSettings = {
    sente: { mainMs: 0, byoyomiMs: 10_000, incrementMs: 0, enabled: false },
    gote: { mainMs: 0, byoyomiMs: 3_000, incrementMs: 0, enabled: true },
};

describe("normalizeTimeSettings", () => {
    it("加算の項目が無い保存値は、加算なしとして読む", () => {
        const saved = {
            sente: { mainMs: 600_000, byoyomiMs: 30_000, enabled: true },
            gote: { mainMs: 0, byoyomiMs: 3_000, enabled: true },
        } as unknown as ClockSettings;
        const result = normalizeTimeSettings(saved, DEFAULTS);
        expect(result.sente.incrementMs).toBe(0);
        expect(result.gote.incrementMs).toBe(0);
        expect(result.sente.mainMs).toBe(600_000);
    });

    it("加算を保存した値はそのまま読む", () => {
        const saved: ClockSettings = {
            sente: { mainMs: 60_000, byoyomiMs: 0, incrementMs: 1_000, enabled: true },
            gote: { mainMs: 180_000, byoyomiMs: 0, incrementMs: 2_000, enabled: true },
        };
        expect(normalizeTimeSettings(saved, DEFAULTS)).toEqual(saved);
    });
});

describe("formatTimeRule", () => {
    const clock = (mainMs: number, byoyomiMs: number, incrementMs = 0) => ({
        mainMs,
        byoyomiMs,
        incrementMs,
    });

    it("秒読みと加算を書き分ける（+ は加算だけ）", () => {
        expect(formatTimeRule(clock(600_000, 30_000))).toBe("10分 秒読み30秒");
        expect(formatTimeRule(clock(300_000, 0, 10_000))).toBe("5分 +10秒");
    });

    it("持ち時間なしの秒読みは、AI の考慮時間なら「1手◯秒」", () => {
        expect(formatTimeRule(clock(0, 30_000))).toBe("秒読み30秒");
        expect(formatTimeRule(clock(0, 3_000), { perMove: true })).toBe("1手3秒");
    });

    it("秒読みも加算もなければ切れ負け、時間を決めていなければ空", () => {
        expect(formatTimeRule(clock(600_000, 0))).toBe("10分 切れ負け");
        expect(formatTimeRule(clock(0, 0))).toBe("");
    });
});
