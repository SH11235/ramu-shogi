import { afterEach, describe, expect, it, vi } from "vitest";
import { yieldTask } from "./yieldTask";

afterEach(() => vi.unstubAllGlobals());

describe("yieldTask", () => {
    it("resolves through MessageChannel without a timer", async () => {
        expect(typeof globalThis.MessageChannel).toBe("function");
        const timer = vi.spyOn(globalThis, "setTimeout");
        try {
            await expect(yieldTask()).resolves.toBeUndefined();
            expect(timer).not.toHaveBeenCalled();
        } finally {
            timer.mockRestore();
        }
    });
    it("resolves through a timer when MessageChannel is unavailable", async () => {
        vi.stubGlobal("MessageChannel", undefined);
        await expect(yieldTask()).resolves.toBeUndefined();
    });
});
