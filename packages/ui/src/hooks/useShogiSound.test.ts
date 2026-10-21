import { describe, expect, it } from "vitest";
import { normalizeSoundVoice } from "./useShogiSound";

describe("normalizeSoundVoice", () => {
    it("keeps known voices and falls back for anything else", () => {
        expect(normalizeSoundVoice("standard", "dog")).toBe("standard");
        expect(normalizeSoundVoice("dog", "standard")).toBe("dog");
        expect(normalizeSoundVoice("cat", "dog")).toBe("dog");
        expect(normalizeSoundVoice(undefined, "dog")).toBe("dog");
    });
});
