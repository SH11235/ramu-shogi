import { describe, expect, it } from "vitest";
import { getMatchNnueSelections } from "./useGameControls";

const selections = {
    sente: { presetKey: "RAMU", nnueId: null },
    gote: { presetKey: "COCO", nnueId: null },
};
const engines = [
    { id: "builtin", kind: "internal" as const },
    { id: "usi", kind: "external" as const },
];

describe("match NNUE requirements", () => {
    it("does not require retained built-in models for an external-engine match", () => {
        expect(
            getMatchNnueSelections(
                {
                    sente: { role: "engine", engineId: "usi" },
                    gote: { role: "engine", engineId: "usi" },
                },
                engines,
                selections,
            ),
        ).toEqual([]);
    });
    it("requires only the internal side in a mixed-engine match", () => {
        expect(
            getMatchNnueSelections(
                {
                    sente: { role: "engine", engineId: "usi" },
                    gote: { role: "engine", engineId: "builtin" },
                },
                engines,
                selections,
            ),
        ).toEqual([selections.gote]);
    });
    it("resolves unspecified engine IDs to the default and excludes human sides", () => {
        const sides = { sente: { role: "engine" as const }, gote: { role: "human" as const } };
        expect(getMatchNnueSelections(sides, engines, selections)).toEqual([selections.sente]);
        expect(getMatchNnueSelections(sides, [...engines].reverse(), selections)).toEqual([]);
    });
    it("checks the default model when a removed engine ID remains in saved settings", () => {
        const sides = {
            sente: { role: "engine" as const, engineId: "removed-usi" },
            gote: { role: "human" as const },
        };
        expect(getMatchNnueSelections(sides, engines, selections)).toEqual([selections.sente]);
        expect(getMatchNnueSelections(sides, [...engines].reverse(), selections)).toEqual([]);
    });
});
