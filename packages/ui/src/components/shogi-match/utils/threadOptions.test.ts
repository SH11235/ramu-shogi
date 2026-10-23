import { afterEach, describe, expect, it, vi } from "vitest";
import { buildThreadOptions, threadCapOf } from "./threadOptions";

describe("buildThreadOptions", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("エンジンの上限より多い数は出さず、自動の数も上限に合わせる", () => {
        vi.stubGlobal("navigator", { hardwareConcurrency: 20 });
        const options = buildThreadOptions({ compact: true, maxThreads: 8 });
        expect(options.map((option) => option.value)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
        expect(options[0].label).toBe("自動（8）");
    });

    it("上限の無いエンジンは、端末のコア数まで出す", () => {
        vi.stubGlobal("navigator", { hardwareConcurrency: 12 });
        const options = buildThreadOptions();
        expect(options.at(-1)?.value).toBe(12);
        expect(options[0].label).toBe("自動（推奨: 6）");
    });
});

describe("threadCapOf", () => {
    const createClient = () => {
        throw new Error("テストではエンジンを作らない");
    };
    const engines = [
        { id: "wasm", label: "内蔵", createClient, maxThreads: 8 },
        { id: "ext", label: "外部", createClient, kind: "external" as const },
    ];

    it("上限のあるエンジンだけで最小を取り、どれにも無ければ undefined", () => {
        expect(threadCapOf(engines, ["wasm", "ext"])).toBe(8);
        expect(threadCapOf(engines, ["ext"])).toBeUndefined();
        // engineId の無い AI は先頭のエンジン（ここでは wasm）として扱う
        expect(threadCapOf(engines, [undefined])).toBe(8);
        expect(threadCapOf(undefined, [undefined])).toBeUndefined();
    });
});
