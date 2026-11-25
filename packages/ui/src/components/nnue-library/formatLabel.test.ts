import { describe, expect, it } from "vitest";
import { formatLabel } from "./formatLabel";

describe("formatLabel", () => {
    it("両視点を連結する HalfKP は FT に x2 を付ける", () => {
        expect(
            formatLabel({
                architecture: "HalfKP256",
                l1Dimension: 256,
                l2Dimension: 32,
                l3Dimension: 32,
                activation: "CReLU",
            }),
        ).toBe("HalfKP 256x2-32-32");
    });

    it("Pairwise は次の層への入力が L1 のままなので x2 を付けない", () => {
        expect(
            formatLabel({
                architecture: "HalfKaHmMerged512",
                l1Dimension: 512,
                l2Dimension: 8,
                l3Dimension: 96,
                activation: "PairwiseCReLU",
            }),
        ).toBe("HalfKaHmMerged 512-8-96");
    });

    it("rshogi の LayerStacks は近道込みの 16 を 15 と書く", () => {
        expect(
            formatLabel({
                architecture: "LayerStacks",
                l1Dimension: 2304,
                l2Dimension: 16,
                l3Dimension: 64,
                activation: "CReLU",
            }),
        ).toBe("LayerStacks 2304-15-64");
    });

    it("YaneuraOu の SFNN は header の 15 をそのまま書く", () => {
        expect(
            formatLabel({
                architecture: "LayerStacks",
                l1Dimension: 1536,
                l2Dimension: 15,
                l3Dimension: 32,
                activation: "CReLU",
            }),
        ).toBe("LayerStacks 1536-15-32");
    });

    it("次元が揃わなければ名前だけ、unknown なら null", () => {
        expect(formatLabel({ architecture: "HalfKP256", l1Dimension: 256 })).toBe("HalfKP256");
        expect(formatLabel({ architecture: "unknown" })).toBeNull();
        expect(formatLabel(undefined)).toBeNull();
    });
});
