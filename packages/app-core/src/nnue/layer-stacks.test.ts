import { describe, expect, it } from "vitest";
import {
    encodeProgressCoefficients,
    PROGRESS_COEFFICIENTS_SIZE,
    validateLayerStacks,
} from "./layer-stacks";

describe("LayerStacks configuration", () => {
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
        new DataView(bytes.buffer).setFloat64(8, Number.NaN, true);
        expect(() => encodeProgressCoefficients(bytes)).toThrow();
    });
});
