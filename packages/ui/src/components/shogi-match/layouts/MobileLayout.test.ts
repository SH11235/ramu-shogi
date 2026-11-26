import { describe, expect, it } from "vitest";
import { MATE_WITHOUT_PLY } from "../utils/kifFormat";
import { formatMobileCompactEval } from "./MobileLayout";

describe("formatMobileCompactEval", () => {
    it("符号のみの mate は符号を表示する", () => {
        expect(formatMobileCompactEval(undefined, MATE_WITHOUT_PLY)).toBe("mate +");
        expect(formatMobileCompactEval(undefined, -MATE_WITHOUT_PLY)).toBe("mate -");
    });

    it("mate と cp に共通の表記を使う", () => {
        expect(formatMobileCompactEval(undefined, 5)).toBe("mate 5");
        expect(formatMobileCompactEval(undefined, -7)).toBe("mate -7");
        expect(formatMobileCompactEval(150)).toBe("+150");
        expect(formatMobileCompactEval()).toBe("-");
    });
});
