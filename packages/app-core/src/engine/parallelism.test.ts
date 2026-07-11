import { afterEach, describe, expect, it, vi } from "vitest";
import { detectParallelism, resolveWorkerCount } from "./parallelism";

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("detectParallelism", () => {
    it("hardwareConcurrency の半分を推奨する", () => {
        vi.stubGlobal("navigator", { hardwareConcurrency: 16 });
        expect(detectParallelism().recommendedWorkers).toBe(8);
    });

    it("異常値を clamp する", () => {
        vi.stubGlobal("navigator", { hardwareConcurrency: 100000 });
        expect(detectParallelism().detectedConcurrency).toBe(128);
        expect(detectParallelism().recommendedWorkers).toBe(32);
    });
});

describe("resolveWorkerCount", () => {
    it("自動 (0) は推奨値を maxWorkers で clamp する", () => {
        vi.stubGlobal("navigator", { hardwareConcurrency: 32 });
        expect(resolveWorkerCount(0)).toBe(4);
    });

    it("低コア機の自動は推奨値をそのまま使う", () => {
        vi.stubGlobal("navigator", { hardwareConcurrency: 4 });
        expect(resolveWorkerCount(0)).toBe(2);
    });

    it("明示指定は 1〜maxWorkers に clamp する", () => {
        vi.stubGlobal("navigator", { hardwareConcurrency: 32 });
        expect(resolveWorkerCount(10)).toBe(4);
        expect(resolveWorkerCount(2)).toBe(2);
        expect(resolveWorkerCount(-1)).toBe(1);
    });
});
