import { describe, expect, it } from "vitest";
import { chooseDogClip } from "./dogSound";

const always = (value: number) => () => value;

describe("chooseDogClip", () => {
    it("picks from the scene's clips", () => {
        expect(chooseDogClip("check", false, always(0))).toBe("bark1");
        expect(chooseDogClip("capture", false, always(0.99))).toBe("strong4");
        expect(chooseDogClip("promote", false, always(0.5))).toBe("bark6");
    });

    it("sometimes replaces a quiet CPU move with the weak voice while the CPU is losing", () => {
        expect(chooseDogClip("move", true, always(0.1))).toBe("weak");
        expect(chooseDogClip("promote", true, always(0.1))).toBe("weak");
        expect(chooseDogClip("move", true, always(0.9))).not.toBe("weak");
        expect(chooseDogClip("move", false, always(0.1))).not.toBe("weak");
    });

    it("keeps check and capture voices even while the CPU is losing", () => {
        expect(chooseDogClip("check", true, always(0.1))).not.toBe("weak");
        expect(chooseDogClip("capture", true, always(0.1))).not.toBe("weak");
    });
});
