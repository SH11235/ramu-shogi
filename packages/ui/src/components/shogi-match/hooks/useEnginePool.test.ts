import type { StudyLayerRef } from "@shogi/app-core";
import type { EngineClient, EngineEventHandler } from "@shogi/engine-client";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useEnginePool } from "./useEnginePool";

const jobs = Array.from({ length: 4 }, (_, i) => ({
    ply: i + 1,
    sfen: "startpos",
    moves: [],
    timeMs: 100,
    depth: 2,
}));

function engineFactory(external = false) {
    let active = 0;
    let peak = 0;
    const clients: EngineClient[] = [];
    const createClient = () => {
        const listeners = new Set<EngineEventHandler>();
        const client: EngineClient = {
            init: vi.fn().mockResolvedValue(undefined),
            loadPosition: vi.fn().mockResolvedValue(undefined),
            setOption: vi.fn().mockResolvedValue(undefined),
            stop: vi.fn().mockResolvedValue(undefined),
            dispose: vi.fn().mockResolvedValue(undefined),
            ...(external ? {} : { reset: vi.fn().mockResolvedValue(undefined) }),
            subscribe(handler) {
                listeners.add(handler);
                return () => listeners.delete(handler);
            },
            async search() {
                active++;
                peak = Math.max(peak, active);
                const timer = setTimeout(() => {
                    active--;
                    for (const listener of listeners) listener({ type: "bestmove", move: "7g7f" });
                }, 10);
                return {
                    async cancel() {
                        clearTimeout(timer);
                    },
                };
            },
        };
        clients.push(client);
        return client;
    };
    return {
        clients,
        createClient,
        getPeak: () => peak,
        resetPeak: () => {
            peak = 0;
        },
    };
}

const baseJob = { sfen: "startpos", moves: [] as string[], timeMs: 100, depth: 12 };

const createLayer = (multiPv: number): StudyLayerRef => ({
    layerId: `layer-${multiPv}`,
    spec: {
        version: 1,
        engine: { kind: "wasm", name: "rshogi", version: "0.8.1" },
        evaluation: { nnueSha256: null, fvScale: null, progressSha256: null, layerStacks: null },
        limits: { timeMs: 100, depth: 12, nodes: null },
        multiPv,
        rules: { variant: "standard" },
    },
    display: { label: "RAMU・0.1 秒" },
});

/** 探索のたびに info を 3 回流してから bestmove を返すエンジン。 */
function infoEngineFactory(options: { finish?: boolean } = {}) {
    let infoCount = 0;
    const createClient = (): EngineClient => {
        const listeners = new Set<EngineEventHandler>();
        const emit: EngineEventHandler = (event) => {
            for (const listener of listeners) listener(event);
        };
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
                const timer = setTimeout(() => {
                    emit({ type: "info", depth: 8, scoreCp: 50, multipv: 1, pv: ["7g7f"] });
                    emit({ type: "info", depth: 8, scoreCp: 20, multipv: 2 });
                    emit({
                        type: "info",
                        depth: 12,
                        seldepth: 18,
                        scoreCp: 80,
                        multipv: 1,
                        pv: ["2g2f"],
                        nodes: 5000,
                        timeMs: 100,
                    });
                    infoCount += 3;
                    if (options.finish !== false) emit({ type: "bestmove", move: "2g2f" });
                }, 5);
                return {
                    async cancel() {
                        clearTimeout(timer);
                    },
                };
            },
        };
    };
    return { createClient, getInfoCount: () => infoCount };
}

describe("useEnginePool", () => {
    it("同じモデルでも並列数を1→4→1へ変更した次回解析でプールを作り直す", async () => {
        const factory = engineFactory();
        const onComplete = vi.fn();
        const { result, rerender, unmount } = renderHook(
            ({ count }) =>
                useEnginePool({
                    createClient: factory.createClient,
                    workerCount: count,
                    onComplete,
                }),
            { initialProps: { count: 1 } },
        );
        for (const [round, count] of [1, 4, 1].entries()) {
            rerender({ count });
            factory.resetPeak();
            act(() => result.current.start(jobs));
            await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(round + 1));
            expect(factory.getPeak()).toBe(count);
        }
        expect(factory.clients).toHaveLength(6);
        for (const client of factory.clients)
            expect(client.init).toHaveBeenCalledWith({ threads: 1, usiThreads: 1 });
        for (const client of factory.clients.slice(0, 5))
            expect(client.dispose).toHaveBeenCalledTimes(1);
        unmount();
    });

    it("外部USIにもThreads=1を適用して局面並列と探索並列の重複を防ぐ", async () => {
        const factory = engineFactory(true);
        const onComplete = vi.fn();
        const { result, unmount } = renderHook(() =>
            useEnginePool({ createClient: factory.createClient, workerCount: 2, onComplete }),
        );
        act(() => result.current.start(jobs));
        await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
        for (const client of factory.clients)
            expect(client.init).toHaveBeenCalledWith({ threads: 1, usiThreads: 1 });
        unmount();
    });

    it("一括解析でも候補手数（MultiPV）を毎回エンジンに設定する", async () => {
        const factory = engineFactory();
        const onComplete = vi.fn();
        const { result, unmount } = renderHook(() =>
            useEnginePool({ createClient: factory.createClient, workerCount: 2, onComplete }),
        );
        act(() => result.current.start(jobs, { multiPv: 3 }));
        await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
        for (const client of factory.clients)
            expect(client.setOption).toHaveBeenLastCalledWith("MultiPV", "3");
        // 指定しなければ 1 に戻す（前回の設定を残さない）。
        act(() => result.current.start(jobs));
        await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(2));
        for (const client of factory.clients)
            expect(client.setOption).toHaveBeenLastCalledWith("MultiPV", "1");
        unmount();
    });

    it("1 局面の探索が終わるごとに、ノード・レイヤー・結果を 1 回だけ通知する", async () => {
        const factory = infoEngineFactory();
        const onComplete = vi.fn();
        const onResult = vi.fn();
        const onPositionAnalyzed = vi.fn();
        const { result, unmount } = renderHook(() =>
            useEnginePool({
                createClient: factory.createClient,
                workerCount: 1,
                onComplete,
                onResult,
                onPositionAnalyzed,
            }),
        );
        const layer = createLayer(2);
        act(() =>
            result.current.start(
                [
                    // 開始局面（ルート）も解析できる。
                    { ...baseJob, ply: 0, moves: [], nodeId: "root", sideToMove: "sente" },
                    { ...baseJob, ply: 1, moves: ["7g7f"], nodeId: "n1", sideToMove: "gote" },
                    // 手番を渡さないジョブ（既存の画面）は通知しない。
                    { ...baseJob, ply: 2, moves: ["7g7f", "3c3d"] },
                ],
                { multiPv: 2, layer },
            ),
        );
        await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));

        // 途中経過（info）は 3 局面 × 3 回届くが、終了の通知は手番つきの 2 局面で 1 回ずつ。
        expect(onResult).toHaveBeenCalledTimes(9);
        expect(onPositionAnalyzed).toHaveBeenCalledTimes(2);
        const [root, first] = onPositionAnalyzed.mock.calls.map((call) => call[0]);
        expect(root).toMatchObject({ runtimeNodeId: "root", ply: 0, layer });
        expect(root.result).toMatchObject({
            completion: "completed",
            depth: 12,
            nodes: 5000,
            timeMs: 100,
            execution: { threads: 1, hashMb: null, parallelWorkers: 1 },
            candidates: [
                {
                    rank: 1,
                    score: { kind: "cp", value: 80 },
                    depth: 12,
                    seldepth: 18,
                    pv: ["2g2f"],
                },
                { rank: 2, score: { kind: "cp", value: 20 }, depth: 8, seldepth: null, pv: [] },
            ],
        });
        // 後手番の局面の評価値は符号を反転して先手視点にする。
        expect(first).toMatchObject({ runtimeNodeId: "n1", ply: 1, layer });
        expect(first.result.candidates[0].score).toEqual({ kind: "cp", value: -80 });
        expect(first.result.runId).not.toBe(root.result.runId);
        unmount();
    });

    it("レイヤーは start の時点のものが、その探索の結果に最後まで付く", async () => {
        const factory = infoEngineFactory();
        const onComplete = vi.fn();
        const onPositionAnalyzed = vi.fn();
        const { result, unmount } = renderHook(() =>
            useEnginePool({
                createClient: factory.createClient,
                workerCount: 1,
                onComplete,
                onPositionAnalyzed,
            }),
        );
        const first = createLayer(1);
        const second = createLayer(3);
        act(() =>
            result.current.start([{ ...baseJob, ply: 0, nodeId: "a", sideToMove: "sente" }], {
                layer: first,
            }),
        );
        await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
        act(() =>
            result.current.start([{ ...baseJob, ply: 0, nodeId: "b", sideToMove: "sente" }], {
                layer: second,
            }),
        );
        await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(2));
        expect(
            onPositionAnalyzed.mock.calls.map((call) => [call[0].runtimeNodeId, call[0].layer]),
        ).toEqual([
            ["a", first],
            ["b", second],
        ]);
        unmount();
    });

    it("キャンセルで止めた探索は、そこまでの結果を aborted で通知する", async () => {
        const factory = infoEngineFactory({ finish: false });
        const onPositionAnalyzed = vi.fn();
        const { result, unmount } = renderHook(() =>
            useEnginePool({
                createClient: factory.createClient,
                workerCount: 1,
                onPositionAnalyzed,
            }),
        );
        act(() =>
            result.current.start([{ ...baseJob, ply: 0, nodeId: "root", sideToMove: "sente" }]),
        );
        await waitFor(() => expect(factory.getInfoCount()).toBe(3));
        expect(onPositionAnalyzed).not.toHaveBeenCalled();
        await act(async () => {
            await result.current.cancel();
        });
        expect(onPositionAnalyzed).toHaveBeenCalledTimes(1);
        expect(onPositionAnalyzed.mock.calls[0][0]).toMatchObject({
            runtimeNodeId: "root",
            layer: null,
            result: { completion: "aborted", depth: 12 },
        });
        unmount();
    });
});
