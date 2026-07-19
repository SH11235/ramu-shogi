import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_ANALYSIS_SETTINGS } from "../types";
import { useBatchAnalysis } from "./useBatchAnalysis";

describe("useBatchAnalysis", () => {
    it("NNUE未ダウンロード後の再解析に成功したら古いエラーメッセージを消す", async () => {
        const resolveNnue = vi
            .fn()
            .mockRejectedValueOnce(new Error("評価関数がダウンロードされていません"))
            .mockResolvedValueOnce({ nnueId: "ramu", fvScale: 8 });
        const analyzePosition = vi.fn().mockResolvedValue(undefined);
        const openNnueManager = vi.fn();
        const setMessage = vi.fn();

        const { result } = renderHook(() =>
            useBatchAnalysis({
                kifMoves: [],
                startSfen: "startpos",
                analysisSettings: DEFAULT_ANALYSIS_SETTINGS,
                enginePool: {
                    isRunning: false,
                    progress: null,
                    start: vi.fn(),
                    cancel: vi.fn().mockResolvedValue(undefined),
                    dispose: vi.fn().mockResolvedValue(undefined),
                },
                resolveNnue,
                analysisNnueSelection: { presetKey: "ramu", nnueId: null },
                recordEvalByPly: vi.fn(),
                recordEvalByNodeId: vi.fn(),
                clearEvalByPly: vi.fn(),
                clearEvalByNodeId: vi.fn(),
                analyzePosition,
                isAnalyzing: false,
                kifuTree: null,
                openNnueManager,
                setMessage,
                batchAnalysis: null,
                setBatchAnalysis: vi.fn(),
            }),
        );

        await act(() => result.current.handleAnalyzePly(0));

        expect(setMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: "error" }));
        expect(openNnueManager).toHaveBeenCalledWith("missing-analysis");
        expect(analyzePosition).not.toHaveBeenCalled();

        await act(() => result.current.handleAnalyzePly(0));

        expect(setMessage).toHaveBeenLastCalledWith(null);
        expect(analyzePosition).toHaveBeenCalledTimes(1);
    });
});
