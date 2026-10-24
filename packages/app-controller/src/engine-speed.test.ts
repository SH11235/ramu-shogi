import type {
    AnalysisFinished,
    EngineClient,
    EngineEvent,
    EngineEventHandler,
    EngineInfoEvent,
} from "@shogi/engine-client";
import { describe, expect, it, vi } from "vitest";
import {
    createNnueSpeedStore,
    NNUE_SPEED_BENCHMARK_POSITIONS,
    runNnueSpeedBenchmark,
    withNpsRecording,
} from "./engine-speed";

const environment = { engineVersion: "wasm:1", threaded: true };

/** 探索の結果を外から流せるエンジン */
const createFakeClient = (threads = 4) => {
    const listeners = new Set<EngineEventHandler>();
    const emit = (event: EngineEvent) => {
        for (const listener of listeners) listener(event);
    };
    let finishAnalysis: ((result: AnalysisFinished) => void) | null = null;
    let analysisInfo: ((info: EngineInfoEvent) => void) | null = null;
    const client: EngineClient = {
        init: vi.fn(async () => {}),
        loadPosition: vi.fn(async () => {}),
        search: vi.fn(async () => ({ cancel: async () => {} })),
        stop: vi.fn(async () => {}),
        setOption: vi.fn(async () => {}),
        subscribe: (handler) => {
            listeners.add(handler);
            return () => listeners.delete(handler);
        },
        dispose: vi.fn(async () => {}),
        loadNnue: vi.fn(async () => {}),
        getThreadInfo: () => ({
            activeThreads: threads,
            maxThreads: 8,
            threadedAvailable: true,
            hardwareConcurrency: 8,
        }),
        analysis: {
            available: () => true,
            start: vi.fn(async (sessionId, _budget, onInfo) => {
                analysisInfo = onInfo;
                return {
                    sessionId,
                    runId: 1,
                    finished: new Promise<AnalysisFinished>((resolve) => {
                        finishAnalysis = resolve;
                    }),
                    pause: vi.fn(),
                };
            }),
            resume: vi.fn(),
            release: vi.fn(async () => {}),
        },
    };
    return {
        client,
        emit,
        info: (nodes: number, timeMs: number) => emit({ type: "info", nodes, timeMs }),
        bestmove: () => emit({ type: "bestmove", move: "7g7f" }),
        analysisInfo: (info: EngineInfoEvent) => analysisInfo?.(info),
        finishAnalysis: (nodes: number, timeMs: number) =>
            finishAnalysis?.({
                sessionId: "s",
                runId: 1,
                reason: "budgetReached",
                resumable: true,
                completedDepth: 10,
                nodes,
                timeMs,
                totalNodes: nodes,
                totalTimeMs: timeMs,
                workerDepths: [],
            }),
    };
};

const setup = () => {
    const store = createNnueSpeedStore(null);
    const wrap = (fake: ReturnType<typeof createFakeClient>, record = true) =>
        withNpsRecording(fake.client, {
            environment,
            resolveContentHash: async () => "hash",
            store,
            record,
        });
    return { store, wrap };
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("withNpsRecording", () => {
    it("エンジンが 1 つだけのとき、1 秒以上の探索の NPS を記録する", async () => {
        const { store, wrap } = setup();
        const fake = createFakeClient();
        const client = wrap(fake);
        await client.init({ threads: 4 });
        await client.loadNnue?.("id");
        await client.search({});
        fake.info(1_000_000, 500);
        fake.info(3_000_000, 2000);
        fake.bestmove();
        await flush();
        expect(store.getSnapshot().records).toEqual([
            {
                contentHash: "hash",
                threads: 4,
                engineVersion: "wasm:1",
                threaded: true,
                observed: [1_500_000],
            },
        ]);
        await client.dispose();
    });

    it("1 秒未満の探索と、評価関数を読み込んでいないエンジンは記録しない", async () => {
        const { store, wrap } = setup();
        const fake = createFakeClient();
        const client = wrap(fake);
        await client.init({ threads: 4 });
        await client.search({});
        fake.info(3_000_000, 2000);
        fake.bestmove();
        await client.loadNnue?.("id");
        await client.search({});
        fake.info(100_000, 900);
        fake.bestmove();
        await flush();
        expect(store.getSnapshot().records).toEqual([]);
        await client.dispose();
    });

    it("ほかのエンジンも動いているとき（AI 対 AI・並列解析）は記録しない", async () => {
        const { store, wrap } = setup();
        const first = createFakeClient();
        const second = createFakeClient();
        const a = wrap(first);
        const b = wrap(second);
        await a.init({ threads: 4 });
        await a.loadNnue?.("id");
        await b.init({ threads: 4 });
        await a.search({});
        first.info(3_000_000, 2000);
        first.bestmove();
        await b.dispose();
        // 途中でほかのエンジンが立ち上がった探索も記録しない
        await a.search({});
        const c = wrap(createFakeClient());
        await c.init({ threads: 4 });
        await c.dispose();
        first.info(3_000_000, 2000);
        first.bestmove();
        await flush();
        expect(store.getSnapshot().records).toEqual([]);
        await a.dispose();
    });

    it("解析（analysis）は、その回の探索量から記録する", async () => {
        const { store, wrap } = setup();
        const fake = createFakeClient(2);
        const client = wrap(fake);
        await client.init({ threads: 2 });
        await client.loadNnue?.("id");
        const onInfo = vi.fn();
        const run = await client.analysis?.start("s", { type: "unlimited" }, onInfo);
        fake.analysisInfo({ type: "info", nodes: 10, timeMs: 10 });
        expect(onInfo).toHaveBeenCalledTimes(1);
        fake.finishAnalysis(4_000_000, 4000);
        await run?.finished;
        await flush();
        expect(store.getSnapshot().records[0]).toMatchObject({ threads: 2, observed: [1_000_000] });
        await client.dispose();
    });

    it("計測用のエンジンは記録しない", async () => {
        const { store, wrap } = setup();
        const fake = createFakeClient();
        const client = wrap(fake, false);
        await client.init({ threads: 4 });
        await client.loadNnue?.("id");
        await client.search({});
        fake.info(3_000_000, 2000);
        fake.bestmove();
        await flush();
        expect(store.getSnapshot().records).toEqual([]);
        await client.dispose();
    });
});

describe("runNnueSpeedBenchmark", () => {
    it("用意した局面を順に探索し、総ノード数 / 総時間を返す", async () => {
        const fake = createFakeClient(3);
        vi.mocked(fake.client.search).mockImplementation(async () => {
            setTimeout(() => {
                fake.info(1_000_000, 1000);
                fake.info(3_000_000, 3000);
                fake.bestmove();
            }, 0);
            return { cancel: async () => {} };
        });
        const onProgress = vi.fn();
        const result = await runNnueSpeedBenchmark({
            createClient: () => fake.client,
            nnueId: "id",
            fvScale: 24,
            threads: 4,
            signal: new AbortController().signal,
            onProgress,
        });
        expect(result).toEqual({ nps: 1_000_000, threads: 3 });
        expect(fake.client.loadPosition).toHaveBeenCalledTimes(
            NNUE_SPEED_BENCHMARK_POSITIONS.length,
        );
        expect(fake.client.search).toHaveBeenCalledWith({ limits: { movetimeMs: 3000 } });
        expect(onProgress.mock.calls.map(([index]) => index)).toEqual([0, 1, 2]);
        expect(fake.client.dispose).toHaveBeenCalled();
    });

    it("止めると失敗として返し、エンジンを片付ける", async () => {
        const fake = createFakeClient();
        const controller = new AbortController();
        vi.mocked(fake.client.search).mockImplementation(async () => {
            setTimeout(() => controller.abort(), 0);
            return { cancel: async () => {} };
        });
        await expect(
            runNnueSpeedBenchmark({
                createClient: () => fake.client,
                nnueId: "id",
                threads: 4,
                signal: controller.signal,
            }),
        ).rejects.toThrow();
        expect(fake.client.stop).toHaveBeenCalled();
        expect(fake.client.dispose).toHaveBeenCalled();
    });
});
