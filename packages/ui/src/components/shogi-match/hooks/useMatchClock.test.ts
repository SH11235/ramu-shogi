import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ENGINE_SEARCH_LIMITS } from "../utils/searchLimits";
import type { ClockSettings } from "./useClockManager";
import { useMatchClock } from "./useMatchClock";

const HUMANS = { sente: { role: "human" }, gote: { role: "human" } } as const;

// 毎回のレンダーで中身が同じ別のオブジェクトを渡し、メモ化されない場合を再現する。
const settingsOf = (mainMs: number): ClockSettings => ({
    sente: { mainMs, byoyomiMs: 10_000, incrementMs: 0, enabled: true },
    gote: { mainMs, byoyomiMs: 10_000, incrementMs: 0, enabled: true },
});

interface Props {
    mainMs: number;
    isMatchRunning: boolean;
    isPaused: boolean;
}

const renderClock = (initial: Props) =>
    renderHook(
        ({ mainMs, isMatchRunning, isPaused }: Props) =>
            useMatchClock({
                isPlayScreen: false,
                sides: { sente: { ...HUMANS.sente }, gote: { ...HUMANS.gote } },
                timeSettings: settingsOf(mainMs),
                engineSearchLimits: { ...DEFAULT_ENGINE_SEARCH_LIMITS },
                totalMoves: 0,
                isMatchRunning,
                isPaused,
                matchEndedRef: { current: false },
                endMatchRef: { current: null },
                setMessage: () => {},
            }),
        { initialProps: initial },
    );

describe("useMatchClock", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("一時停止中は、中身が同じ設定で描き直しても時計を戻さない", () => {
        const { result, rerender } = renderClock({
            mainMs: 600_000,
            isMatchRunning: true,
            isPaused: false,
        });
        act(() => {
            result.current.startTicking("sente");
        });
        act(() => {
            vi.advanceTimersByTime(3_000);
        });
        rerender({ mainMs: 600_000, isMatchRunning: false, isPaused: true });
        rerender({ mainMs: 600_000, isMatchRunning: false, isPaused: true });
        rerender({ mainMs: 600_000, isMatchRunning: false, isPaused: true });

        expect(result.current.clocks.sente.mainMs).toBeLessThan(600_000);
    });

    it("一時停止中に時間設定を変えたら、新しい設定に合わせ直す", () => {
        const { result, rerender } = renderClock({
            mainMs: 600_000,
            isMatchRunning: true,
            isPaused: false,
        });
        act(() => {
            result.current.startTicking("sente");
        });
        act(() => {
            vi.advanceTimersByTime(3_000);
        });
        rerender({ mainMs: 600_000, isMatchRunning: false, isPaused: true });
        rerender({ mainMs: 300_000, isMatchRunning: false, isPaused: true });

        expect(result.current.clocks.sente.mainMs).toBe(300_000);
    });
});
