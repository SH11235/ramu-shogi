import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    registerScheduledSound,
    reserveSoundSlot,
    resetSoundScheduleForTest,
} from "./soundSchedule";

beforeEach(resetSoundScheduleForTest);

describe("reserveSoundSlot", () => {
    it("plays at once when the previous sound is old enough", () => {
        expect(reserveSoundSlot(1)).toBe(1);
        expect(reserveSoundSlot(2)).toBe(2);
    });

    it("delays a sound that follows too closely", () => {
        expect(reserveSoundSlot(1)).toBe(1);
        expect(reserveSoundSlot(1.05)).toBeCloseTo(1.18);
    });

    it("forgets the clock of a recreated AudioContext", () => {
        expect(reserveSoundSlot(50)).toBe(50);
        expect(reserveSoundSlot(0.1)).toBe(0.1);
    });

    it("keeps only the last of a burst of instant moves", () => {
        const now = 1;
        expect(reserveSoundSlot(now)).toBe(1);
        const cancelSecond = vi.fn();
        const second = reserveSoundSlot(now + 0.02);
        registerScheduledSound(second, now + 0.02, cancelSecond);
        const third = reserveSoundSlot(now + 0.04);
        expect(cancelSecond).toHaveBeenCalledTimes(1);
        expect(third).toBe(second);
        registerScheduledSound(third, now + 0.04, vi.fn());
        expect(reserveSoundSlot(now + 0.5)).toBe(now + 0.5);
    });

    it("does not cancel a sound that already started", () => {
        const cancel = vi.fn();
        const when = reserveSoundSlot(1);
        registerScheduledSound(when, 1, cancel);
        reserveSoundSlot(1.05);
        expect(cancel).not.toHaveBeenCalled();
    });
});
