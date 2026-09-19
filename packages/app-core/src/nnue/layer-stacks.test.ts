import { describe, expect, it } from "vitest";
import {
    encodeProgressCoefficients,
    PROGRESS_COEFFICIENTS_SIZE,
    validateLayerStacks,
} from "./layer-stacks";

describe("LayerStacks configuration", () => {
    it.each([2, 4, 8, 16])("accepts Q16 progress%d with coefficients", (progressBuckets) => {
        expect(() =>
            validateLayerStacks({
                bucketMode: "progresskpabsq16",
                progressBuckets,
                progressCoeffBase64: "coefficients",
            }),
        ).not.toThrow();
    });
    it.each([
        undefined,
        1,
        3,
        5,
        6,
        7,
        9,
        10,
        12,
        15,
        17,
    ])("rejects unsupported Q16 progress bucket count %s", (progressBuckets) => {
        expect(() =>
            validateLayerStacks({
                bucketMode: "progresskpabsq16",
                progressBuckets,
                progressCoeffBase64: "coefficients",
            }),
        ).toThrow();
    });
    it("requires Q16 coefficients even for two buckets", () => {
        expect(() =>
            validateLayerStacks({ bucketMode: "progresskpabsq16", progressBuckets: 2 }),
        ).toThrow();
    });
    it("accepts KingRank9 and single progress bucket without coefficients", () => {
        expect(() => validateLayerStacks({ bucketMode: "kingrank9" })).not.toThrow();
        expect(() =>
            validateLayerStacks({ bucketMode: "progresskpabs", progressBuckets: 1 }),
        ).not.toThrow();
    });
    it("requires coefficients for multiple progress buckets and limits bucket count", () => {
        expect(() =>
            validateLayerStacks({ bucketMode: "progresskpabs", progressBuckets: 9 }),
        ).toThrow();
        expect(() =>
            validateLayerStacks({
                bucketMode: "progresskpabs",
                progressBuckets: 17,
                progressCoeffBase64: "x",
            }),
        ).toThrow();
    });
    it("validates raw coefficient size and finite little endian values", () => {
        expect(() => encodeProgressCoefficients(new Uint8Array(8))).toThrow();
        const bytes = new Uint8Array(PROGRESS_COEFFICIENTS_SIZE);
        new DataView(bytes.buffer).setFloat64(0, 1.25, true);
        expect(atob(encodeProgressCoefficients(bytes)).length).toBe(PROGRESS_COEFFICIENTS_SIZE);
        new DataView(bytes.buffer).setFloat64(8, Number.MAX_VALUE, true);
        expect(() => encodeProgressCoefficients(bytes)).toThrow();
        expect(atob(encodeProgressCoefficients(bytes, "progresskpabsq16")).length).toBe(
            PROGRESS_COEFFICIENTS_SIZE,
        );
        new DataView(bytes.buffer).setFloat64(8, Number.NaN, true);
        expect(() => encodeProgressCoefficients(bytes)).toThrow();
        expect(() => encodeProgressCoefficients(bytes, "progresskpabsq16")).toThrow();
    });
});
