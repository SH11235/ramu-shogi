import { applyStudyOps, type StudyDocument, type StudyOp } from "@shogi/app-core";
import type { EngineClient, EngineEventHandler } from "@shogi/engine-client";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineOption } from "../shogi-match/types";
import { createTestStudy } from "./study-test-support";
import { buildStudyViewTree } from "./studyView";
import { STUDY_DEEP_TIME_MS, useStudyAnalysis } from "./useStudyAnalysis";

/** 探索のたびに評価値つきの info を 1 回流してから bestmove を返すエンジン。 */
function createEngineOption(searchMs = 5): {
    option: EngineOption;
    searches: () => number;
    clients: () => number;
} {
    let searches = 0;
    let clients = 0;
    const createClient = (): EngineClient => {
        clients++;
        const listeners = new Set<EngineEventHandler>();
        return {
            init: vi.fn().mockResolvedValue(undefined),
            loadPosition: vi.fn().mockResolvedValue(undefined),
            setOption: vi.fn().mockResolvedValue(undefined),
            stop: vi.fn().mockResolvedValue(undefined),
            dispose: vi.fn().mockResolvedValue(undefined),
            subscribe(handler) {
                listeners.add(handler);
                return () => listeners.delete(handler);
            },
            async search() {
                searches++;
                const timer = setTimeout(() => {
                    for (const listener of listeners) {
                        listener({
                            type: "info",
                            depth: 12,
                            scoreCp: 80,
                            multipv: 1,
                            pv: ["7g7f"],
                        });
                    }
                    for (const listener of listeners) listener({ type: "bestmove", move: "7g7f" });
                }, searchMs);
                return {
                    async cancel() {
                        clearTimeout(timer);
                    },
                };
            },
        };
    };
    return {
        option: { id: "wasm", label: "内蔵エンジン", createClient, kind: "internal" },
        searches: () => searches,
        clients: () => clients,
    };
}

/** ページの代わりに、操作を文書へ適用しながらフックを動かす。 */
function useHarness(
    initialDoc: StudyDocument,
    engineOptions: EngineOption[],
    options: { rejectAnalysis?: boolean; onOps?: (ops: StudyOp[]) => void } = {},
) {
    const [doc, setDoc] = useState(initialDoc);
    const [ops, setOps] = useState<StudyOp[]>([]);
    const [startedLayers, setStartedLayers] = useState<string[]>([]);
    const [flushCount, setFlushCount] = useState(0);
    const { tree } = buildStudyViewTree(doc, null);
    const { controller } = useStudyAnalysis({
        doc,
        tree,
        engineOptions,
        manifestUrl: "",
        engine: { kind: "wasm", name: "rshogi", version: "0.8.1", appVersion: "1.2.3" },
        onApplyOps: (next) => {
            options.onOps?.(next);
            // 解析結果が保存できなかった（上限を超えた）場合の模擬。
            if (options.rejectAnalysis && next.some((op) => op.type === "putAnalysis")) {
                return Promise.resolve(false);
            }
            setOps((previous) => [...previous, ...next]);
            setDoc((previous) => applyStudyOps(previous, next));
            return undefined;
        },
        onFlush: () => setFlushCount((count) => count + 1),
        onLayerStarted: (layerId, mode) =>
            setStartedLayers((previous) => [...previous, `${mode}:${layerId}`]),
        setMessage: () => {},
    });
    return { controller, doc, ops, startedLayers, flushCount };
}

describe("useStudyAnalysis", () => {
    beforeEach(() => {
        localStorage.clear();
        // NNUE を使わない AI（駒得）で解析する（ダウンロードの確認を挟まない）。
        localStorage.setItem(
            "shogi:analysisNnueSelection",
            JSON.stringify({ presetKey: null, nnueId: null }),
        );
        localStorage.setItem(
            "shogi-analysis-settings",
            JSON.stringify({
                parallelWorkers: 2,
                batchAnalysisTimeMs: 500,
                batchAnalysisDepth: 15,
                multiPv: 1,
            }),
        );
    });

    it("全体を解析すると、レイヤーを作り、全局面（開始局面を含む）の結果が操作として流れる", async () => {
        const { doc, ids } = createTestStudy();
        const engine = createEngineOption();
        const { result } = renderHook(() => useHarness(doc, [engine.option]));

        expect(result.current.controller.settingsLabel).toBe("簡易AI（駒得）・0.5 秒");
        await act(async () => {
            await result.current.controller.startFull();
        });
        await waitFor(() => expect(result.current.flushCount).toBe(1));

        const layer = result.current.doc.layers[0];
        expect(layer.display.label).toBe("簡易AI（駒得）・0.5 秒");
        expect(layer.spec.limits).toEqual({ timeMs: 500, depth: 15, nodes: null });
        expect(layer.spec.engine).toEqual({ kind: "wasm", name: "rshogi", version: "0.8.1" });
        expect(Object.keys(layer.results).sort()).toEqual([...ids].sort());
        // 解析した局面の手番で、評価値が先手視点に直っている（1 手目のあとは後手番）。
        expect(layer.results[ids[0]].candidates[0].score).toEqual({ kind: "cp", value: 80 });
        expect(layer.results[ids[1]].candidates[0].score).toEqual({ kind: "cp", value: -80 });
        expect(result.current.startedLayers).toEqual([`full:${layer.id}`]);
        expect(result.current.ops.filter((op) => op.type === "putAnalysis")).toHaveLength(5);
        expect(result.current.controller.mode).toBeNull();
        expect(engine.searches()).toBe(5);

        // もう一度押しても、解析済みの局面は解析し直さない。
        await act(async () => {
            await result.current.controller.startFull();
        });
        expect(engine.searches()).toBe(5);
    });

    it("この局面を深く解析すると、時間の長い別の設定の結果としてその局面だけに入る", async () => {
        const { doc, ids } = createTestStudy();
        const engine = createEngineOption();
        const { result } = renderHook(() => useHarness(doc, [engine.option]));

        await act(async () => {
            await result.current.controller.startDeep(ids[2]);
        });
        await waitFor(() => expect(result.current.flushCount).toBe(1));

        const layer = result.current.doc.layers[0];
        expect(layer.spec.limits.timeMs).toBe(STUDY_DEEP_TIME_MS);
        expect(layer.spec.multiPv).toBe(3);
        expect(layer.display.label).toBe("簡易AI（駒得）・10 秒");
        expect(Object.keys(layer.results)).toEqual([ids[2]]);
        expect(result.current.startedLayers).toEqual([`deep:${layer.id}`]);
        expect(engine.searches()).toBe(1);
    });

    it("AI の準備中に画面を離れたら、解析を始めない（エンジンも作らない）", async () => {
        const { doc } = createTestStudy();
        const engine = createEngineOption();
        const onOps = vi.fn();
        const { result, unmount } = renderHook(() => useHarness(doc, [engine.option], { onOps }));

        // 準備（AI の確認）を待っている間に離れる。
        const started = result.current.controller.startFull();
        unmount();
        await started;
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(engine.clients()).toBe(0);
        expect(engine.searches()).toBe(0);
        expect(onOps).not.toHaveBeenCalled();
    });

    it("AI の準備中に中止したら、解析を始めない", async () => {
        const { doc } = createTestStudy();
        const engine = createEngineOption();
        const { result } = renderHook(() => useHarness(doc, [engine.option]));

        await act(async () => {
            const started = result.current.controller.startFull();
            await result.current.controller.cancel();
            await started;
        });
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(engine.searches()).toBe(0);
        expect(result.current.doc.layers).toEqual([]);
        expect(result.current.controller.isPreparing).toBe(false);
        // 中止のあとは、あらためて始められる。
        await act(async () => {
            await result.current.controller.startFull();
        });
        await waitFor(() => expect(result.current.doc.layers).toHaveLength(1));
    });

    it("解析結果を保存できなかったら、黙って続けずに解析を止める", async () => {
        const { doc } = createTestStudy();
        // 1 局面 1 秒。結果の反映（400 ms ごと）で保存できないと分かった時点で止まる。
        const engine = createEngineOption(1000);
        const { result } = renderHook(() =>
            useHarness(doc, [engine.option], { rejectAnalysis: true }),
        );

        await act(async () => {
            await result.current.controller.startFull();
        });
        await waitFor(() => expect(result.current.controller.mode).toBeNull(), { timeout: 5000 });

        // 5 局面のうち、止まるまでに探索を始めたのは一部だけ。
        expect(engine.searches()).toBeLessThan(5);
        expect(result.current.ops.filter((op) => op.type === "putAnalysis")).toHaveLength(0);
    });

    it("いまの設定で実際に解析する局面の数を返す（解析済みの局面は数えない）", async () => {
        const { doc } = createTestStudy();
        const engine = createEngineOption();
        const { result } = renderHook(() => useHarness(doc, [engine.option]));
        expect(result.current.controller.fullTargetCount).toBe(5);

        await act(async () => {
            await result.current.controller.startFull();
        });
        await waitFor(() => expect(result.current.flushCount).toBe(1));

        expect(result.current.controller.fullTargetCount).toBe(0);
    });
});
