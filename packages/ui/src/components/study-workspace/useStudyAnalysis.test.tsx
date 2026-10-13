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
    options: {
        rejectAnalysis?: boolean;
        onOps?: (ops: StudyOp[]) => void;
        locked?: boolean;
        onMessage?: (message: { text: string } | null) => void;
    } = {},
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
        setMessage: (message) => options.onMessage?.(message),
        locked: options.locked,
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

    it("「残りを解析」は、設定の画面の値ではなく、その解析結果と同じ設定で、未解析の局面だけを解析する", async () => {
        const { doc, ids } = createTestStudy();
        const engine = createEngineOption();
        const { result, unmount } = renderHook(() => useHarness(doc, [engine.option]));
        // 0.5 秒・候補 1 で全体を解析する。
        await act(async () => {
            await result.current.controller.startFull();
        });
        await waitFor(() => expect(result.current.controller.mode).toBeNull());
        const layer = result.current.doc.layers[0];
        expect(layer.spec.limits.timeMs).toBe(500);
        expect(layer.spec.multiPv).toBe(1);
        const analyzed = result.current.doc;
        const searchesBefore = engine.searches();
        unmount();

        // 手を足して未解析の局面を 2 つ作り、設定の画面では別の設定（3 秒・候補 3）にしておく。
        localStorage.setItem(
            "shogi-analysis-settings",
            JSON.stringify({
                parallelWorkers: 2,
                batchAnalysisTimeMs: 3000,
                batchAnalysisDepth: 15,
                multiPv: 3,
            }),
        );
        const extended = applyStudyOps(analyzed, [
            { type: "addMoves", parentId: ids[4], moves: ["2f2e", "8d8e"] },
        ]);
        const { result: resumed } = renderHook(() => useHarness(extended, [engine.option]));
        expect(resumed.current.controller.settingsLabel).toBe("簡易AI（駒得）・3 秒");

        await act(async () => {
            await resumed.current.controller.resumeLayer(layer.id);
        });
        await waitFor(() => expect(resumed.current.controller.mode).toBeNull());

        // 新しい設定の結果は作らず、同じ設定（0.5 秒・候補 1）の結果に、足した 2 局面だけが増える。
        expect(engine.searches() - searchesBefore).toBe(2);
        expect(resumed.current.doc.layers.map((item) => item.id)).toEqual([layer.id]);
        expect(Object.keys(resumed.current.doc.layers[0].results)).toHaveLength(7);
        expect(resumed.current.startedLayers).toEqual([`full:${layer.id}`]);
    });

    it("編集できない間（ログインが切れた）は、どの入口からも解析を始めない", async () => {
        const { doc, ids } = createTestStudy();
        const engine = createEngineOption();
        const onOps = vi.fn();
        const { result } = renderHook(() =>
            useHarness(doc, [engine.option], { onOps, locked: true }),
        );

        await act(async () => {
            await result.current.controller.startFull();
            await result.current.controller.startDeep(ids[1]);
            await result.current.controller.resumeLayer("any-layer");
        });
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 50));
        });

        expect(onOps).not.toHaveBeenCalled();
        expect(engine.clients()).toBe(0);
        expect(result.current.controller.mode).toBeNull();
        expect(result.current.controller.isPreparing).toBe(false);
        expect(result.current.startedLayers).toEqual([]);
    });

    it("解析の途中で編集できなくなったら、解析を止める", async () => {
        const { doc } = createTestStudy();
        const engine = createEngineOption(200);
        const { result, rerender } = renderHook(
            ({ locked }: { locked: boolean }) => useHarness(doc, [engine.option], { locked }),
            { initialProps: { locked: false } },
        );
        await act(async () => {
            await result.current.controller.startFull();
        });
        await waitFor(() => expect(result.current.controller.mode).toBe("full"));

        rerender({ locked: true });

        await waitFor(() => expect(result.current.controller.mode).toBeNull());
        const searches = engine.searches();
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 300));
        });
        // 残りの局面の探索は始まらない。
        expect(engine.searches()).toBe(searches);
    });

    it("始めてすぐ中止したときは、結果が 1 件も無い設定を文書に作らない", async () => {
        const { doc } = createTestStudy();
        // 探索が終わる前に中止できるよう、探索に時間のかかるエンジンにする。
        const engine = createEngineOption(500);
        const onOps = vi.fn();
        const { result } = renderHook(() => useHarness(doc, [engine.option], { onOps }));

        await act(async () => {
            await result.current.controller.startFull();
        });
        await waitFor(() => expect(result.current.controller.mode).toBe("full"));
        await act(async () => {
            await result.current.controller.cancel();
        });

        expect(result.current.controller.mode).toBeNull();
        expect(onOps).not.toHaveBeenCalled();
        expect(result.current.doc.layers).toEqual([]);
    });

    it("解析していないときに編集できなくなっても、通知を出さない（ダウンロードの確認を待っていないので、閉じるものが無い）", async () => {
        const { doc } = createTestStudy();
        const engine = createEngineOption();
        const onMessage = vi.fn();
        const { rerender } = renderHook(
            ({ locked }: { locked: boolean }) =>
                useHarness(doc, [engine.option], { locked, onMessage }),
            { initialProps: { locked: false } },
        );

        rerender({ locked: true });
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 50));
        });

        expect(onMessage.mock.calls.filter(([message]) => message !== null)).toEqual([]);
    });
    it("外部エンジンを選ぶと、評価関数を用意せずに、そのエンジンの名前の解析結果として解析する", async () => {
        const { doc, ids } = createTestStudy();
        const internal = createEngineOption();
        const externalBase = createEngineOption();
        const external: EngineOption = {
            ...externalBase.option,
            id: "ext-1",
            label: "MyEngine",
            kind: "external",
        };
        const { result } = renderHook(() => useHarness(doc, [internal.option, external]));

        // 既定は内蔵エンジン。選べるエンジンとして両方が並ぶ。
        expect(result.current.controller.form.engines).toEqual([
            { id: "wasm", label: "内蔵エンジン", kind: "internal" },
            { id: "ext-1", label: "MyEngine", kind: "external" },
        ]);
        expect(result.current.controller.form.engineId).toBe("wasm");

        act(() => result.current.controller.form.onEngineIdChange("ext-1"));
        expect(result.current.controller.form.engineId).toBe("ext-1");
        expect(result.current.controller.settingsLabel).toBe("MyEngine・0.5 秒");

        await act(async () => {
            await result.current.controller.startFull();
        });
        await waitFor(() => expect(result.current.flushCount).toBe(1));

        const layer = result.current.doc.layers[0];
        expect(layer.display.label).toBe("MyEngine・0.5 秒");
        // 外部エンジンは、表示名が同じ別のエンジンと混ざらないよう、登録の ID で見分ける。
        expect(layer.spec.engine).toEqual({ kind: "external", name: "MyEngine", version: "ext-1" });
        expect(layer.spec.evaluation.nnueSha256).toBeNull();
        expect(Object.keys(layer.results).sort()).toEqual([...ids].sort());
        // 探索したのは外部エンジンだけ。
        expect(externalBase.searches()).toBe(5);
        expect(internal.searches()).toBe(0);
    });

    it("表示名が同じ別の外部エンジンの結果は、別の解析結果として残る", async () => {
        const { doc } = createTestStudy();
        const first = createEngineOption();
        const second = createEngineOption();
        const options: EngineOption[] = [
            { ...first.option, id: "ext-1", label: "MyEngine", kind: "external" },
            { ...second.option, id: "ext-2", label: "MyEngine", kind: "external" },
        ];
        const { result } = renderHook(() => useHarness(doc, options));

        act(() => result.current.controller.form.onEngineIdChange("ext-1"));
        await act(async () => {
            await result.current.controller.startFull();
        });
        await waitFor(() => expect(result.current.flushCount).toBe(1));

        act(() => result.current.controller.form.onEngineIdChange("ext-2"));
        // 2 つ目のエンジンでは、まだ 1 局面も解析していない。
        expect(result.current.controller.fullTargetCount).toBe(5);
        await act(async () => {
            await result.current.controller.startFull();
        });
        await waitFor(() => expect(result.current.flushCount).toBe(2));

        expect(result.current.doc.layers.map((layer) => layer.spec.engine.version)).toEqual([
            "ext-1",
            "ext-2",
        ]);
        expect(first.searches()).toBe(5);
        expect(second.searches()).toBe(5);
    });

    it("「残りを解析」は、その結果を作ったエンジンを選んでいないときは、選び直すよう知らせる", async () => {
        const { doc } = createTestStudy();
        const internal = createEngineOption();
        const externalBase = createEngineOption();
        const external: EngineOption = {
            ...externalBase.option,
            id: "ext-1",
            label: "MyEngine",
            kind: "external",
        };
        const onMessage = vi.fn();
        const { result } = renderHook(() =>
            useHarness(doc, [internal.option, external], { onMessage }),
        );
        // 内蔵エンジンで全体を解析しておく。
        await act(async () => {
            await result.current.controller.startFull();
        });
        await waitFor(() => expect(result.current.flushCount).toBe(1));
        const internalLayerId = result.current.doc.layers[0].id;

        // 外部エンジンを選んだまま、内蔵エンジンの結果の続きを頼む。
        act(() => result.current.controller.form.onEngineIdChange("ext-1"));
        onMessage.mockClear();
        await act(async () => {
            await result.current.controller.resumeLayer(internalLayerId);
        });
        expect(onMessage).toHaveBeenCalledWith(
            expect.objectContaining({ text: expect.stringContaining("内蔵エンジンの結果です") }),
        );
        expect(externalBase.searches()).toBe(0);
    });
});
