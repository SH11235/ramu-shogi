import { applyStudyOps, computeStudyHighlights } from "@shogi/app-core";
import { describe, expect, it } from "vitest";
import { buildStudyReviewItems } from "./StudyReviewList";
import { cp, createTestStudy, putScoreOp, TEST_LAYER_ID } from "./study-test-support";
import { buildStudyStructureTree } from "./studyView";

describe("buildStudyReviewItems", () => {
    it("悪手には 1 手前の局面の最善手を添え、コメントだけの手も手順の順に並べる", () => {
        const base = createTestStudy([cp(0), cp(50), cp(1500), cp(1500), cp(1500)]);
        // 2 手目（☖3四歩）の前の局面では ☖8四歩 が最善。
        const doc = applyStudyOps(base.doc, [
            putScoreOp(base.ids[1], cp(50), { pv: ["8c8d"], depth: 20 }),
            { type: "setComment", nodeId: base.ids[4], value: "ここを考える" },
        ]);
        const tree = buildStudyStructureTree(doc).tree;
        const items = buildStudyReviewItems({
            doc,
            tree,
            line: base.ids,
            highlights: computeStudyHighlights(doc, TEST_LAYER_ID),
            displayLayerId: TEST_LAYER_ID,
        });

        expect(
            items.map(({ ply, kind, bestLabel, comment }) => ({ ply, kind, bestLabel, comment })),
        ).toEqual([
            { ply: 2, kind: "blunder", bestLabel: expect.stringContaining("8四歩"), comment: "" },
            { ply: 4, kind: null, bestLabel: null, comment: "ここを考える" },
        ]);
    });

    it("指した手が最善と同じなら最善手を添えない", () => {
        const base = createTestStudy([cp(0), cp(50), cp(1500), cp(1500), cp(1500)]);
        const doc = applyStudyOps(base.doc, [
            putScoreOp(base.ids[1], cp(50), { pv: ["3c3d"], depth: 20 }),
        ]);
        const items = buildStudyReviewItems({
            doc,
            tree: buildStudyStructureTree(doc).tree,
            line: base.ids,
            highlights: computeStudyHighlights(doc, TEST_LAYER_ID),
            displayLayerId: TEST_LAYER_ID,
        });

        expect(items.find((item) => item.ply === 2)?.bestLabel).toBeNull();
    });
});
