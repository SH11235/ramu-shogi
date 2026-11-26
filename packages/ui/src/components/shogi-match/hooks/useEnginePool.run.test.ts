/**
 * 実行の世代（中止・やり直しのあとに、古い実行の続きが動かないこと）のテスト。
 */

import type { StudyAnalysisCompletion, StudyLayerRef } from "@shogi/app-core";
import type { EngineClient, EngineEventHandler } from "@shogi/engine-client";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useEnginePool } from "./useEnginePool";

/** 手で進められる待ち。 */
function createGate(): { wait: Promise<void>; open: () => void } {
    let open: () => void = () => {};
    const wait = new Promise<void>((resolve) => {
        open = resolve;
    });
    return { wait, open };
}

interface ControlledEngine {
    createClient: () => EngineClient;
    clients: EngineClient[];
    searches: string[][];
    /** 次の `loadPosition` を止める待ち（null なら止めない）。 */
    holdLoad: { wait: Promise<void> } | null;
    /** 次の `init` を止める待ち（null なら止めない）。 */
    holdInit: { wait: Promise<void> } | null;
}

/** 局面読込・初期化を途中で止められるエンジン。探索は 5 ms 後に評価値つきで終わる。 */
function controlledEngine(): ControlledEngine {
    const engine: ControlledEngine = {
        clients: [],
        searches: [],
        holdLoad: null,
        holdInit: null,
        createClient: () => {
            const listeners = new Set<EngineEventHandler>();
            let loaded: string[] = [];
            const client: EngineClient = {
                init: vi.fn(async () => {
                    const hold = engine.holdInit;
                    engine.holdInit = null;
                    if (hold) await hold.wait;
                }),
                loadPosition: vi.fn(async (_sfen: string, moves?: string[]) => {
                    const hold = engine.holdLoad;
                    engine.holdLoad = null;
                    if (hold) await hold.wait;
                    loaded = moves ?? [];
                }),
                setOption: vi.fn().mockResolvedValue(undefined),
                loadNnue: vi.fn().mockResolvedValue(undefined),
                stop: vi.fn().mockResolvedValue(undefined),
                dispose: vi.fn().mockResolvedValue(undefined),
                subscribe(handler) {
                    listeners.add(handler);
                    return () => listeners.delete(handler);
                },
                async search() {
                    const position = loaded;
                    engine.searches.push(position);
                    const timer = setTimeout(() => {
                        for (const listener of [...listeners]) {
                            listener({ type: "info", depth: 10, scoreCp: 30, multipv: 1 });
                        }
                        for (const listener of [...listeners]) {
                            listener({ type: "bestmove", move: "7g7f" });
                        }
                    }, 5);
                    return {
                        async cancel() {
                            clearTimeout(timer);
                        },
                    };
                },
            };
            engine.clients.push(client);
            return client;
        },
    };
    return engine;
}

const layer = (label: string): StudyLayerRef => ({
    layerId: `layer-${label}`,
    spec: {
        version: 1,
        engine: { kind: "wasm", name: "rshogi", version: "0.8.1" },
        evaluation: { nnueSha256: null, fvScale: null, progressSha256: null, layerStacks: null },
        limits: { timeMs: 100, depth: 12, nodes: null },
        multiPv: 1,
        rules: { variant: "standard" },
    },
    display: { label },
});

const job = (nodeId: string, moves: string[]) => ({
    ply: moves.length,
    sfen: "startpos",
    moves,
    timeMs: 100,
    depth: 12,
    nodeId,
    sideToMove: "sente" as const,
});

const settle = (ms = 30): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe("useEnginePool: 中止とやり直し", () => {
    it("局面読込の待機中に中止したら、読込が終わっても探索を始めず、結果も通知しない", async () => {
        const engine = controlledEngine();
        const analyzed: StudyAnalysisCompletion[] = [];
        const onComplete = vi.fn();
        const { result } = renderHook(() =>
            useEnginePool({
                createClient: engine.createClient,
                workerCount: 1,
                onPositionAnalyzed: (completion) => analyzed.push(completion),
                onComplete,
            }),
        );

        const gate = createGate();
        engine.holdLoad = gate;
        act(() => result.current.start([job("a", ["7g7f"])], { layer: layer("A") }));
        await waitFor(() => expect(engine.clients[0]?.loadPosition).toHaveBeenCalledTimes(1));

        // 読込を待っている間に中止する（この時点では、止める探索がまだ無い）。
        await act(async () => {
            await result.current.cancel();
        });
        expect(result.current.isRunning).toBe(false);

        // 読込が終わっても、探索は始まらない。
        await act(async () => {
            gate.open();
            await settle();
        });
        expect(engine.searches).toEqual([]);
        expect(analyzed).toEqual([]);
        expect(onComplete).not.toHaveBeenCalled();
        expect(result.current.isRunning).toBe(false);
    });

    it("中止の直後に別の解析を始めても、前の実行の探索・結果が混ざらない", async () => {
        const engine = controlledEngine();
        const analyzed: StudyAnalysisCompletion[] = [];
        const onComplete = vi.fn();
        const { result } = renderHook(() =>
            useEnginePool({
                createClient: engine.createClient,
                workerCount: 1,
                onPositionAnalyzed: (completion) => analyzed.push(completion),
                onComplete,
            }),
        );

        const gate = createGate();
        engine.holdLoad = gate;
        act(() =>
            result.current.start([job("a1", ["7g7f"]), job("a2", ["7g7f", "3c3d"])], {
                layer: layer("A"),
            }),
        );
        await waitFor(() => expect(engine.clients[0]?.loadPosition).toHaveBeenCalledTimes(1));

        // 中止して、すぐに別の解析（1 局面を深く）を始める。
        await act(async () => {
            await result.current.cancel();
        });
        act(() => result.current.start([job("b", ["2g2f"])], { layer: layer("B") }));
        await act(async () => {
            gate.open();
            await settle(60);
        });
        await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));

        // 探索したのは新しい実行の局面だけで、通知された結果も新しい実行のものだけ。
        expect(engine.searches).toEqual([["2g2f"]]);
        expect(analyzed.map((completion) => completion.runtimeNodeId)).toEqual(["b"]);
        expect(analyzed[0]?.layer?.layerId).toBe("layer-B");
        expect(result.current.isRunning).toBe(false);
    });

    it("初期化の待機中に中止して始め直しても、ワーカーを作りすぎず、新しい実行だけが走る", async () => {
        const engine = controlledEngine();
        const analyzed: StudyAnalysisCompletion[] = [];
        const onComplete = vi.fn();
        const { result, unmount } = renderHook(() =>
            useEnginePool({
                createClient: engine.createClient,
                workerCount: 1,
                onPositionAnalyzed: (completion) => analyzed.push(completion),
                onComplete,
            }),
        );

        const gate = createGate();
        engine.holdInit = gate;
        act(() => result.current.start([job("a", ["7g7f"])], { layer: layer("A") }));
        await waitFor(() => expect(engine.clients).toHaveLength(1));

        await act(async () => {
            await result.current.cancel();
        });
        act(() => result.current.start([job("b", ["2g2f"])], { layer: layer("B") }));
        await act(async () => {
            gate.open();
            await settle(60);
        });
        await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));

        // 前の実行の初期化で作ったワーカーをそのまま使い、作り直していない。
        expect(engine.clients).toHaveLength(1);
        expect(engine.searches).toEqual([["2g2f"]]);
        expect(analyzed.map((completion) => completion.runtimeNodeId)).toEqual(["b"]);

        // 破棄は、作ったワーカーをすべて片付ける。
        unmount();
        await settle();
        expect(engine.clients[0]?.dispose).toHaveBeenCalled();
    });

    it("探索の開始を待つ間に中止したら、開始した探索を止める", async () => {
        const engine = controlledEngine();
        // 探索の開始（`search()` の応答）を途中で止められるようにする。
        const gate = createGate();
        const cancelSearch = vi.fn(async () => {});
        const createClient = engine.createClient;
        engine.createClient = () => {
            const client = createClient();
            client.search = vi.fn(async () => {
                await gate.wait;
                return { cancel: cancelSearch };
            });
            return client;
        };
        const analyzed: StudyAnalysisCompletion[] = [];
        const { result } = renderHook(() =>
            useEnginePool({
                createClient: engine.createClient,
                workerCount: 1,
                onPositionAnalyzed: (completion) => analyzed.push(completion),
            }),
        );

        act(() => result.current.start([job("a", ["7g7f"])], { layer: layer("A") }));
        await waitFor(() => expect(engine.clients[0]?.search).toHaveBeenCalledTimes(1));
        await act(async () => {
            await result.current.cancel();
        });
        await act(async () => {
            gate.open();
            await settle();
        });

        expect(cancelSearch).toHaveBeenCalledTimes(1);
        expect(
            analyzed.filter((completion) => completion.result.completion === "completed"),
        ).toEqual([]);
    });

    it("前の実行の探索の開始応答が遅れて届いても、同じワーカーで始めた次の実行を止めない", async () => {
        // 実物のエンジンと同じく、停止は「その探索」ではなく「いま動いている探索」を止める。
        const listeners = new Set<EngineEventHandler>();
        let loaded: string[] = [];
        let running: { position: string[]; timer: ReturnType<typeof setTimeout> } | null = null;
        const started: string[][] = [];
        const stoppedWhile: Array<string[] | null> = [];
        const firstSearchGate = createGate();
        let searchCalls = 0;
        const client: EngineClient = {
            init: vi.fn().mockResolvedValue(undefined),
            loadPosition: vi.fn(async (_sfen: string, moves?: string[]) => {
                loaded = moves ?? [];
            }),
            setOption: vi.fn().mockResolvedValue(undefined),
            stop: vi.fn().mockResolvedValue(undefined),
            dispose: vi.fn().mockResolvedValue(undefined),
            subscribe(handler) {
                listeners.add(handler);
                return () => listeners.delete(handler);
            },
            async search() {
                const position = loaded;
                const isFirst = searchCalls++ === 0;
                started.push(position);
                const timer = setTimeout(
                    () => {
                        running = null;
                        for (const listener of [...listeners]) {
                            listener({ type: "info", depth: 10, scoreCp: 30, multipv: 1 });
                        }
                        for (const listener of [...listeners]) {
                            listener({ type: "bestmove", move: "7g7f" });
                        }
                        // 1 回目（A）の探索は、止めない限り終わらない長さにする。
                    },
                    isFirst ? 5000 : 40,
                );
                running = { position, timer };
                // 1 回目の探索だけ、開始の応答を遅らせる。
                if (isFirst) await firstSearchGate.wait;
                return {
                    async cancel() {
                        stoppedWhile.push(running?.position ?? null);
                        if (running) clearTimeout(running.timer);
                        running = null;
                    },
                };
            },
        };
        const analyzed: StudyAnalysisCompletion[] = [];
        const onComplete = vi.fn();
        const { result } = renderHook(() =>
            useEnginePool({
                createClient: () => client,
                workerCount: 1,
                onPositionAnalyzed: (completion) => analyzed.push(completion),
                onComplete,
            }),
        );

        // A の探索の開始応答を待っている間に中止し、同じワーカーで B を始める。
        act(() => result.current.start([job("a", ["7g7f"])], { layer: layer("A") }));
        await waitFor(() => expect(started).toEqual([["7g7f"]]));
        await act(async () => {
            await result.current.cancel();
        });
        act(() => result.current.start([job("b", ["2g2f"])], { layer: layer("B") }));
        await act(async () => {
            await settle(20);
        });
        // A の開始応答が返るまで、このワーカーでは B を始めない。
        expect(client.loadPosition).toHaveBeenCalledTimes(1);
        expect(started).toEqual([["7g7f"]]);

        // A の応答が後から届く。A の後始末（停止）が済んでから B が始まり、B は止まらない。
        await act(async () => {
            firstSearchGate.open();
            await settle(120);
        });
        await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));

        expect(started).toEqual([["7g7f"], ["2g2f"]]);
        // 停止したのは A の探索だけ（B の探索中には停止していない）。
        expect(stoppedWhile).toEqual([["7g7f"]]);
        expect(analyzed.map((completion) => completion.runtimeNodeId)).toEqual(["b"]);
        expect(analyzed[0]?.result.completion).toBe("completed");
        expect(analyzed[0]?.layer?.layerId).toBe("layer-B");
        expect(result.current.isRunning).toBe(false);
    });
});

describe("useEnginePool: 実行中の評価関数の変更", () => {
    const renderPool = (
        engine: ControlledEngine,
        analyzed: StudyAnalysisCompletion[],
        onComplete: () => void,
        initialNnueId: string | null,
    ) =>
        renderHook(
            ({ nnueId }: { nnueId: string | null }) =>
                useEnginePool({
                    createClient: engine.createClient,
                    workerCount: 1,
                    nnueId,
                    onPositionAnalyzed: (completion) => analyzed.push(completion),
                    onComplete,
                }),
            { initialProps: { nnueId: initialNnueId } },
        );

    it("実行中に評価関数が変わっても止めず、最後まで解析して完了を知らせる。次の start で読み直す", async () => {
        const engine = controlledEngine();
        const analyzed: StudyAnalysisCompletion[] = [];
        const onComplete = vi.fn();
        const { result, rerender } = renderPool(engine, analyzed, onComplete, "nnue-a");

        const gate = createGate();
        engine.holdLoad = gate;
        act(() =>
            result.current.start([job("a", ["7g7f"]), job("b", ["2g2f"])], { layer: layer("A") }),
        );
        await waitFor(() => expect(engine.clients[0]?.loadPosition).toHaveBeenCalledTimes(1));

        rerender({ nnueId: "nnue-b" });
        await act(async () => {
            gate.open();
            await settle(60);
        });
        await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));

        expect(analyzed.map((completion) => completion.runtimeNodeId)).toEqual(["a", "b"]);
        expect(analyzed.every((completion) => completion.result.completion === "completed")).toBe(
            true,
        );
        expect(engine.clients).toHaveLength(1);
        expect(engine.clients[0]?.dispose).not.toHaveBeenCalled();

        act(() => result.current.start([job("c", ["7g7f"])], { layer: layer("B") }));
        await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(2));
        expect(engine.clients).toHaveLength(2);
        expect(engine.clients[0]?.dispose).toHaveBeenCalled();
        expect(engine.clients[1]?.loadNnue).toHaveBeenCalledWith("nnue-b", undefined);
    });

    it("評価関数の id が null から、いま読み込んでいる id に変わっただけなら、作り直さない", async () => {
        const engine = controlledEngine();
        const analyzed: StudyAnalysisCompletion[] = [];
        const onComplete = vi.fn();
        const { result, rerender } = renderPool(engine, analyzed, onComplete, null);

        // 一覧の読み込み中（null）に、start で実際の id を渡して始める。
        act(() =>
            result.current.start([job("a", ["7g7f"])], { layer: layer("A"), nnueId: "nnue-a" }),
        );
        await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));

        rerender({ nnueId: "nnue-a" });
        await act(async () => {
            await settle();
        });
        expect(engine.clients[0]?.dispose).not.toHaveBeenCalled();

        act(() => result.current.start([job("b", ["2g2f"])], { layer: layer("A") }));
        await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(2));
        expect(engine.clients).toHaveLength(1);
        expect(analyzed.map((completion) => completion.runtimeNodeId)).toEqual(["a", "b"]);
    });

    it("実行していないときに評価関数が変わったら、読み込んだワーカーを手放す", async () => {
        const engine = controlledEngine();
        const onComplete = vi.fn();
        const { result, rerender } = renderPool(engine, [], onComplete, "nnue-a");

        act(() => result.current.start([job("a", ["7g7f"])], { layer: layer("A") }));
        await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));

        rerender({ nnueId: "nnue-b" });
        await waitFor(() => expect(engine.clients[0]?.dispose).toHaveBeenCalled());
    });
});

describe("native batch worker lifetime", () => {
    it("releases workers from a cancelled initialization before starting again", async () => {
        const engine = controlledEngine();
        const { result } = renderHook(() =>
            useEnginePool({
                createClient: engine.createClient,
                workerCount: 8,
                releaseWorkersAfterRun: true,
            }),
        );

        const gate = createGate();
        engine.holdInit = gate;
        act(() => result.current.start([job("a", ["7g7f"]), job("b", ["2g2f"])]));
        await waitFor(() => expect(engine.clients[0]?.init).toHaveBeenCalledTimes(1));

        await act(async () => {
            const cancelled = result.current.cancel();
            result.current.start([job("c", ["2g2f"])]);
            gate.open();
            await cancelled;
        });
        await waitFor(() => expect(engine.searches).toEqual([["2g2f"]]));
        await waitFor(() => expect(engine.clients[1]?.dispose).toHaveBeenCalledTimes(1));
        expect(engine.clients).toHaveLength(2);
        expect(engine.clients[0]?.dispose).toHaveBeenCalledTimes(1);
    });

    it("disposes the active native workers when cancelled after switching engines", async () => {
        const engine = controlledEngine();
        const { result, rerender } = renderHook(
            ({ native }) =>
                useEnginePool({
                    createClient: engine.createClient,
                    workerCount: 1,
                    releaseWorkersAfterRun: native,
                }),
            { initialProps: { native: true } },
        );
        const gate = createGate();
        engine.holdLoad = gate;
        act(() => result.current.start([job("a", ["7g7f"])]));
        await waitFor(() => expect(engine.clients[0]?.loadPosition).toHaveBeenCalledTimes(1));

        rerender({ native: false });
        await act(async () => {
            const cancelled = result.current.cancel();
            gate.open();
            await cancelled;
        });
        expect(engine.searches).toEqual([]);
        expect(engine.clients[0]?.dispose).toHaveBeenCalledTimes(1);
    });

    it("disposes replaced native workers when the replacement is cancelled before initialization", async () => {
        const engine = controlledEngine();
        const { result, rerender } = renderHook(
            ({ native }) =>
                useEnginePool({
                    createClient: engine.createClient,
                    clientKey: native ? "native" : "external",
                    workerCount: 1,
                    releaseWorkersAfterRun: native,
                }),
            { initialProps: { native: true } },
        );
        const gate = createGate();
        engine.holdLoad = gate;
        act(() => result.current.start([job("a", ["7g7f"])]));
        await waitFor(() => expect(engine.clients[0]?.loadPosition).toHaveBeenCalledTimes(1));

        rerender({ native: false });
        await act(async () => {
            result.current.start([job("b", ["2g2f"])]);
            const cancelled = result.current.cancel();
            gate.open();
            await cancelled;
        });
        await waitFor(() => expect(engine.clients[0]?.dispose).toHaveBeenCalledTimes(1));
        expect(engine.clients).toHaveLength(1);
        expect(engine.searches).toEqual([]);
    });

    it("keeps the original engine's pass support for queued jobs", async () => {
        const engine = controlledEngine();
        const originalError = vi.fn();
        const newError = vi.fn();
        const { result, rerender } = renderHook(
            ({ native }) =>
                useEnginePool({
                    createClient: engine.createClient,
                    workerCount: 1,
                    releaseWorkersAfterRun: native,
                    supportsPassRights: native,
                    onError: native ? originalError : newError,
                }),
            { initialProps: { native: true } },
        );
        const gate = createGate();
        engine.holdLoad = gate;
        act(() => result.current.start([job("a", ["7g7f"]), job("b", ["pass"])]));
        await waitFor(() => expect(engine.clients[0]?.loadPosition).toHaveBeenCalledTimes(1));

        rerender({ native: false });
        gate.open();
        await waitFor(() =>
            expect(engine.clients[0]?.loadPosition).toHaveBeenLastCalledWith("startpos", ["pass"], {
                passRights: { sente: 2, gote: 1 },
            }),
        );
        await waitFor(() => expect(engine.clients[0]?.dispose).toHaveBeenCalledTimes(1));
        expect(originalError).not.toHaveBeenCalled();
        expect(newError).not.toHaveBeenCalled();
    });

    it.each([true, false])(
        "reports an IPC string rejection to the original run after an engine switch (native first: %s)",
        async (initialNative) => {
            const engine = controlledEngine();
            const originalError = vi.fn();
            const newError = vi.fn();
            const gate = createGate();
            const createClient = () => {
                const client = engine.createClient();
                vi.mocked(client.loadPosition).mockImplementationOnce(async () => {
                    await gate.wait;
                    return Promise.reject("native position rejected");
                });
                return client;
            };
            const { result, rerender } = renderHook(
                ({ native }) =>
                    useEnginePool({
                        createClient,
                        workerCount: 1,
                        releaseWorkersAfterRun: native,
                        onError: native === initialNative ? originalError : newError,
                    }),
                { initialProps: { native: initialNative } },
            );
            act(() => result.current.start([job("a", ["7g7f"])]));
            await waitFor(() => expect(engine.clients[0]?.loadPosition).toHaveBeenCalledTimes(1));

            rerender({ native: !initialNative });
            gate.open();
            await waitFor(() =>
                expect(originalError).toHaveBeenCalledWith(
                    1,
                    new Error("native position rejected"),
                ),
            );
            expect(newError).not.toHaveBeenCalled();
            if (initialNative) {
                await waitFor(() => expect(engine.clients[0]?.dispose).toHaveBeenCalledTimes(1));
            }
        },
    );
});
