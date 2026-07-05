import { describe, expect, it } from "vitest";
import { MATE_WITHOUT_PLY } from "../utils/kifFormat";
import { formatMobileCompactEval } from "./MobileLayout";

describe("formatMobileCompactEval", () => {
    it("手数不明の詰みは手数を表示しない", () => {
        expect(formatMobileCompactEval(undefined, MATE_WITHOUT_PLY)).toBe("詰み");
        expect(formatMobileCompactEval(undefined, -MATE_WITHOUT_PLY)).toBe("詰まされ");
    });

    it("手数付き詰みと通常評価値は従来表記を維持する", () => {
        expect(formatMobileCompactEval(undefined, 5)).toBe("詰み5手");
        expect(formatMobileCompactEval(undefined, -7)).toBe("詰まされ7手");
        expect(formatMobileCompactEval(150)).toBe("+1.5");
        expect(formatMobileCompactEval()).toBe("-");
    });
});
