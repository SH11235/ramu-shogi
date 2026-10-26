import { describe, expect, it, vi } from "vitest";
import {
    analysisSnapshotEntryToRecordedEvalInfoEvent,
    analysisSnapshotMultiPvToRecordedEvalInfoEvent,
    applyAnalysisSnapshotEntryEvals,
} from "./useAnalysisSnapshot";

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

describe("analysisSnapshotMultiPvToRecordedEvalInfoEvent", () => {
    it("multiPv 候補の multipv 番号と評価値を保持する", () => {
        expect(
            analysisSnapshotMultiPvToRecordedEvalInfoEvent({
                multipv: 2,
                evalCp: -80,
                evalMate: undefined,
                depth: 12,
                pv: ["2g2f", "8c8d"],
            }),
        ).toMatchObject({
            type: "info",
            scoreCp: -80,
            scoreMate: undefined,
            depth: 12,
            pv: ["2g2f", "8c8d"],
            multipv: 2,
            normalized: true,
        });
    });

    it("省略された evalCp / evalMate は undefined へフォールバックする", () => {
        const event = analysisSnapshotMultiPvToRecordedEvalInfoEvent({ multipv: 1, depth: 5 });
        expect(event.scoreCp).toBeUndefined();
        expect(event.scoreMate).toBeUndefined();
    });
});

describe("applyAnalysisSnapshotEntryEvals", () => {
    it("主評価 (multipv:1) と各 multiPv 候補を multipv スロットへ再適用する", () => {
        const clearEvalByPly = vi.fn();
        const recordEvalByPly = vi.fn();

        applyAnalysisSnapshotEntryEvals(
            {
                ply: 3,
                evalCp: 40,
                evalMate: null,
                depth: 15,
                pv: ["7g7f"],
                multiPv: [
                    { multipv: 1, evalCp: 40, depth: 15, pv: ["7g7f"] },
                    { multipv: 2, evalCp: -20, depth: 15, pv: ["2g2f"] },
                ],
            },
            { clearEvalByPly, recordEvalByPly },
        );

        expect(clearEvalByPly).toHaveBeenCalledExactlyOnceWith(3);
        // 主評価 + multiPv 2 候補 = 3 回
        expect(recordEvalByPly).toHaveBeenCalledTimes(3);
        expect(recordEvalByPly).toHaveBeenNthCalledWith(
            1,
            3,
            expect.objectContaining({ multipv: 1, scoreCp: 40 }),
        );
        expect(recordEvalByPly).toHaveBeenNthCalledWith(
            2,
            3,
            expect.objectContaining({ multipv: 1, scoreCp: 40 }),
        );
        expect(recordEvalByPly).toHaveBeenNthCalledWith(
            3,
            3,
            expect.objectContaining({ multipv: 2, scoreCp: -20 }),
        );
    });

    it("multiPv が null のときは主評価のみ再適用する", () => {
        const clearEvalByPly = vi.fn();
        const recordEvalByPly = vi.fn();

        applyAnalysisSnapshotEntryEvals(
            { ply: 1, evalCp: 10, evalMate: null, depth: 8, pv: null, multiPv: null },
            { clearEvalByPly, recordEvalByPly },
        );

        expect(clearEvalByPly).toHaveBeenCalledExactlyOnceWith(1);
        expect(recordEvalByPly).toHaveBeenCalledTimes(1);
        expect(recordEvalByPly).toHaveBeenCalledWith(
            1,
            expect.objectContaining({ multipv: 1, scoreCp: 10 }),
        );
    });

    it("multiPv が空配列のときも主評価のみ再適用する", () => {
        const clearEvalByPly = vi.fn();
        const recordEvalByPly = vi.fn();

        applyAnalysisSnapshotEntryEvals(
            { ply: 2, evalCp: 50, evalMate: null, depth: 10, pv: ["3g3f"], multiPv: [] },
            { clearEvalByPly, recordEvalByPly },
        );

        expect(clearEvalByPly).toHaveBeenCalledExactlyOnceWith(2);
        expect(recordEvalByPly).toHaveBeenCalledTimes(1);
        expect(recordEvalByPly).toHaveBeenCalledWith(
            2,
            expect.objectContaining({ multipv: 1, scoreCp: 50 }),
        );
    });
});
