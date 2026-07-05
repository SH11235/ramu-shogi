import { describe, expect, it } from "vitest";
import { analysisSnapshotEntryToRecordedEvalInfoEvent } from "./shogi-match";

describe("analysisSnapshotEntryToRecordedEvalInfoEvent", () => {
    it("initialAnalysisEntries 再適用用イベントには normalized:true を付ける", () => {
        expect(
            analysisSnapshotEntryToRecordedEvalInfoEvent({
                ply: 1,
                evalCp: 123,
                evalMate: null,
                depth: 10,
                pv: ["3c3d"],
                multiPv: null,
            }),
        ).toMatchObject({
            type: "info",
            scoreCp: 123,
            scoreMate: undefined,
            depth: 10,
            pv: ["3c3d"],
            multipv: 1,
            normalized: true,
        });
    });
});
