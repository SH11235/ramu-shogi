import type { AnalysisFinished, EngineClient } from "@shogi/engine-client";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { EngineOption } from "../types";
import { usePlayHintSearch } from "./usePlayHintSearch";

const finished = (sessionId: string, totalNodes: number): AnalysisFinished => ({
    sessionId,
    runId: 2,
    reason: "paused",
    resumable: true,
    completedDepth: 10,
    nodes: totalNodes,
    timeMs: 100,
    totalNodes,
    totalTimeMs: 100,
    workerDepths: [],
});

/** 再開できる解析を持つ偽のクライアント。pause するとその時点で止まり、続きから再開できる。 */
function createResumableClient(available = true) {
    const calls: string[] = [];
    let totalNodes = 0;
    const run = (kind: "start" | "resume") => async (sessionId: string) => {
        calls.push(kind);
        let resolve!: (value: AnalysisFinished) => void;
        const done = new Promise<AnalysisFinished>((r) => {
            resolve = r;
        });
        return {
            sessionId,
            runId: 2,
            finished: done,
            pause: async () => {
                totalNodes += 1000;
                resolve(finished(sessionId, totalNodes));
                return done;
            },
        };
    };
    const client = {
        analysis: {
            available: () => available,
            start: run("start"),
            resume: run("resume"),
            release: vi.fn(async () => {}),
        },
        init: vi.fn(async () => {}),
        loadPosition: vi.fn(async () => {}),
        setOption: vi.fn(async () => {}),
        dispose: vi.fn(async () => {}),
    } as unknown as EngineClient;
    return { client, calls };
}

const baseOptions = (engineOption: EngineOption, analyze = vi.fn(async () => true)) => ({
    enabled: true,
    engineOption,
    threads: 2,
    multiPv: 3,
    nnueSelection: { presetKey: null, nnueId: null },
    resolveNnue: vi.fn(async () => null),
    startSfen: "startpos",
    moves: [] as string[],
    currentPly: 0,
    usesPassRights: false,
    matchActive: true,
    recordEvalByPly: vi.fn(),
    clearEvalByPly: vi.fn(),
    fallback: { analyze, cancel: vi.fn(async () => {}), isAnalyzing: false },
});

describe("usePlayHintSearch", () => {
    it("再開できるエンジンでは、止めたあと同じ局面の続きから読む（新しく読み直さない）", async () => {
        const { client, calls } = createResumableClient();
        const engine: EngineOption = { id: "wasm", label: "wasm", createClient: () => client };
        const { result } = renderHook(() => usePlayHintSearch(baseOptions(engine)));

        act(() => result.current.request());
        await waitFor(() => expect(result.current.status.phase).toBe("searching"));
        act(() => result.current.stop());
        await waitFor(() => expect(result.current.status.canContinue).toBe(true));

        act(() => result.current.resume());
        await waitFor(() => expect(result.current.status.phase).toBe("searching"));
        expect(calls).toEqual(["start", "resume"]);
    });

    it("再開できないエンジンでは 1 回だけ読み、続きを読めるとは見せない", async () => {
        const { client, calls } = createResumableClient(false);
        const engine: EngineOption = { id: "native", label: "native", createClient: () => client };
        const analyze = vi.fn(async () => true);
        const { result } = renderHook(() => usePlayHintSearch(baseOptions(engine, analyze)));

        act(() => result.current.request());
        await waitFor(() => expect(analyze).toHaveBeenCalledTimes(1));
        expect(analyze).toHaveBeenCalledWith(
            0,
            expect.objectContaining({ multiPv: 3, timeMs: 30_000 }),
        );
        act(() => result.current.stop());
        expect(result.current.status.canContinue).toBe(false);
        expect(calls).toEqual([]);
    });
});
