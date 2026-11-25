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
        for (const activation of ["PairwiseCReLU", "SCReLU-Pairwise"]) {
            expect(
                formatLabel({
                    architecture: "HalfKaHmMerged768",
                    l1Dimension: 768,
                    l2Dimension: 8,
                    l3Dimension: 96,
                    activation,
                }),
            ).toBe("HalfKaHmMerged 768-8-96");
        }
    });

    it("LayerStacks は近道込みの fc_0 出力から 1 を引いて書く", () => {
        expect(
            formatLabel({
                architecture: "LayerStacks",
                l1Dimension: 2304,
                l2Dimension: 16,
                l3Dimension: 64,
                activation: "CReLU",
            }),
        ).toBe("LayerStacks 2304-15-64");
        expect(
            formatLabel({
                architecture: "LayerStacks",
                l1Dimension: 1536,
                l2Dimension: 12,
                l3Dimension: 32,
                activation: "CReLU",
            }),
        ).toBe("LayerStacks 1536-11-32");
    });

    it("利きバケット付きの LayerStacks にも x2 を付けない", () => {
        expect(
            formatLabel({
                architecture: "HalfKaHmMergedEffectBucket1536",
                l1Dimension: 1536,
                l2Dimension: 16,
                l3Dimension: 32,
                activation: "CReLU",
            }),
        ).toBe("HalfKaHmMergedEffectBucket 1536-15-32");
    });

    it("次元が揃わなければ名前だけ、unknown なら null", () => {
        expect(formatLabel({ architecture: "HalfKP256", l1Dimension: 256 })).toBe("HalfKP256");
        expect(formatLabel({ architecture: "unknown" })).toBeNull();
        expect(formatLabel(undefined)).toBeNull();
    });
});
