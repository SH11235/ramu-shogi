import { describe, expect, it } from "vitest";
import { DEFAULT_WASM_THREADS, resolveWasmThreads } from "./wasm-engine-client";

describe("resolveWasmThreads", () => {
    it.each([
        undefined,
        "",
        "false",
        "0",
        "-1",
        "NaN",
    ])("無効値 %s ではマルチスレッド既定値を返す", (raw) => {
        expect(resolveWasmThreads(raw)).toBe(DEFAULT_WASM_THREADS);
    });

    it("正の有限値を整数化する", () => {
        expect(resolveWasmThreads("8.9")).toBe(8);
    });
});
