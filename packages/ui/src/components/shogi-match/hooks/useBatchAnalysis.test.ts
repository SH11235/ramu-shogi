import { addMove, createEmptyHands, createInitialBoard, createKifuTree } from "@shogi/app-core";
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

    it("分岐ノード解析はNNUE未ダウンロード中の案内を維持し、ダウンロード後の成功時に消す", async () => {
        const startPosition = {
            board: createInitialBoard(),
            hands: createEmptyHands(),
            turn: "sente" as const,
            ply: 0,
        };
        const nodePosition = { ...startPosition, turn: "gote" as const, ply: 1 };
        const kifuTree = addMove(createKifuTree(startPosition, "startpos"), "7g7f", nodePosition);
        const analyzePosition = vi.fn().mockResolvedValue(undefined);
        const openNnueManager = vi.fn();
        const setMessage = vi.fn();
        const resolveNnue = vi
            .fn()
            .mockRejectedValueOnce(new Error("評価関数がダウンロードされていません"))
            .mockRejectedValueOnce(new Error("評価関数がダウンロードされていません"))
            .mockResolvedValueOnce({ nnueId: "ramu", fvScale: 8 });

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
                kifuTree,
                openNnueManager,
                setMessage,
                batchAnalysis: null,
                setBatchAnalysis: vi.fn(),
            }),
        );

        await act(() => result.current.handleAnalyzePly(1));
        expect(setMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: "error" }));

        await act(() => result.current.handleAnalyzeNode(kifuTree.currentNodeId));
        expect(setMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: "error" }));
        expect(openNnueManager).toHaveBeenLastCalledWith("missing-analysis");
        expect(analyzePosition).not.toHaveBeenCalled();

        await act(() => result.current.handleAnalyzeNode(kifuTree.currentNodeId));

        expect(analyzePosition).toHaveBeenCalledWith(
            expect.objectContaining({ moves: ["7g7f"], ply: 1 }),
        );
        expect(setMessage).toHaveBeenLastCalledWith(null);
    });
});
