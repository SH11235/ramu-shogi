import type {
    AnalysisFinished,
    EngineClient,
    EngineEvent,
    EngineEventHandler,
    EngineInfoEvent,
} from "@shogi/engine-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    createEngineActivity,
    createNnueSpeedStore,
    NNUE_SPEED_BENCHMARK_POSITIONS,
    runNnueSpeedBenchmark,
    withNpsRecording,
} from "./engine-speed";

const environment = { engineVersion: "wasm:1", threaded: true };

/** 探索の結果を外から流せるエンジン */
const createFakeClient = ({ threads = 4, threadedAvailable = true } = {}) => {
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
        reset: vi.fn(async () => {}),
        loadNnue: vi.fn(async () => {}),
        getThreadInfo: () => ({
            activeThreads: threads,
            maxThreads: 8,
            threadedAvailable,
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
        /** 2 秒で 300 万局面読んで指す（150 万局面/秒） */
        think: () => {
            emit({ type: "info", nodes: 1_000_000, timeMs: 500 });
            emit({ type: "info", nodes: 3_000_000, timeMs: 2000 });
            emit({ type: "bestmove", move: "7g7f" });
        },
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

/** 交互の探索かどうかを見極める間（記録を書くまで待つ時間）より長く進める */
const settle = () => vi.advanceTimersByTimeAsync(6000);

describe("withNpsRecording", () => {
    let store: ReturnType<typeof createNnueSpeedStore>;
    let activity: ReturnType<typeof createEngineActivity>;
    const wrap = (fake: ReturnType<typeof createFakeClient>, record = true) =>
        withNpsRecording(fake.client, {
            environment,
            resolveContentHash: async () => "hash",
            store,
            activity,
            record,
        });
    const start = async (fake: ReturnType<typeof createFakeClient>) => {
        const client = wrap(fake);
        await client.init({ threads: 4 });
        await client.loadNnue?.("id");
        return client;
    };

    beforeEach(() => {
        vi.useFakeTimers();
        store = createNnueSpeedStore(null);
        activity = createEngineActivity(() => Date.now());
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("ほかのエンジンが探索していなければ、1 秒以上の探索の NPS を記録する", async () => {
        const fake = createFakeClient();
        const client = await start(fake);
        await client.search({});
        fake.think();
        await settle();
        expect(store.getSnapshot().records).toEqual([
            {
                contentHash: "hash",
                threads: 4,
                engineVersion: "wasm:1",
                threaded: true,
                observed: [1_500_000],
            },
        ]);
    });

    it("同じエンジンの探索が続いても（すぐ指し返されても）、それぞれ記録する", async () => {
        const fake = createFakeClient();
        const client = await start(fake);
        await client.search({});
        fake.think();
        await vi.advanceTimersByTimeAsync(1000);
        await client.search({});
        fake.think();
        await settle();
        expect(store.getSnapshot().records[0]?.observed).toEqual([1_500_000, 1_500_000]);
    });

    it("1 秒未満の探索と、評価関数を読み込んでいないエンジンは記録しない", async () => {
        const fake = createFakeClient();
        const client = wrap(fake);
        await client.init({ threads: 4 });
        await client.search({});
        fake.think();
        await settle();
        await client.loadNnue?.("id");
        await client.search({});
        fake.info(100_000, 900);
        fake.bestmove();
        await settle();
        expect(store.getSnapshot().records).toEqual([]);
    });

    it("待機しているだけのほかのエンジン（一度使ったヒントなど）は妨げにならない", async () => {
        const hint = createFakeClient();
        const hintClient = await start(hint);
        await hintClient.search({});
        hint.think();
        await settle();
        const fake = createFakeClient();
        const client = await start(fake);
        await client.search({});
        fake.think();
        await settle();
        expect(store.getSnapshot().records[0]?.observed).toHaveLength(2);
    });

    it("AI 対 AI のように交互に探索するエンジンは、どちらも記録しない", async () => {
        const sente = createFakeClient();
        const gote = createFakeClient();
        const a = await start(sente);
        const b = await start(gote);
        await a.search({});
        sente.think();
        await b.search({});
        gote.think();
        await a.search({});
        sente.think();
        await settle();
        expect(store.getSnapshot().records).toEqual([]);
    });

    it("閉じたエンジンの直後に探索した別のエンジンも、交互の探索として記録しない", async () => {
        const first = createFakeClient();
        const second = createFakeClient();
        const a = await start(first);
        await a.search({});
        first.think();
        await a.dispose();
        await vi.advanceTimersByTimeAsync(100);
        const b = await start(second);
        await b.search({});
        second.think();
        await settle();
        expect(store.getSnapshot().records).toEqual([]);
    });

    it("閉じるときに打ち切った探索と、まだ書いていない記録は残さない", async () => {
        const fake = createFakeClient();
        const client = await start(fake);
        await client.search({});
        fake.think();
        await client.search({});
        fake.info(3_000_000, 2000);
        await client.dispose();
        await settle();
        expect(store.getSnapshot().records).toEqual([]);
    });

    it("評価関数のハッシュが遅れて分かっても、閉じたあとには書かない", async () => {
        let resolveHash: (hash: string) => void = () => {};
        const fake = createFakeClient();
        const client = withNpsRecording(fake.client, {
            environment,
            resolveContentHash: () =>
                new Promise((resolve) => {
                    resolveHash = resolve;
                }),
            store,
            activity,
        });
        await client.init({ threads: 4 });
        await client.loadNnue?.("id");
        await client.search({});
        fake.think();
        await settle();
        await client.dispose();
        resolveHash("hash");
        await vi.advanceTimersByTimeAsync(0);
        expect(store.getSnapshot().records).toEqual([]);
    });

    it("並列解析のように同時に探索するエンジンは記録しない", async () => {
        const first = createFakeClient();
        const second = createFakeClient();
        const a = await start(first);
        const b = await start(second);
        await a.search({});
        await b.search({});
        first.think();
        second.think();
        await settle();
        expect(store.getSnapshot().records).toEqual([]);
    });

    it("解析（analysis）は、その回の探索量から記録する", async () => {
        const fake = createFakeClient({ threads: 2 });
        const client = await start(fake);
        const onInfo = vi.fn();
        const run = await client.analysis?.start("s", { type: "unlimited" }, onInfo);
        fake.analysisInfo({ type: "info", nodes: 10, timeMs: 10 });
        expect(onInfo).toHaveBeenCalledTimes(1);
        fake.finishAnalysis(4_000_000, 4000);
        await run?.finished;
        await settle();
        expect(store.getSnapshot().records[0]).toMatchObject({ threads: 2, observed: [1_000_000] });
    });

    it("スレッド数は設定値ではなく、実際に動いている数で記録する", async () => {
        const fake = createFakeClient({ threads: 4 });
        const client = await start(fake);
        // Wasm では次の初期化まで効かない
        await client.setOption("Threads", 2);
        await client.search({});
        fake.think();
        await settle();
        expect(store.getSnapshot().records[0]?.threads).toBe(4);
    });

    it("1 スレッド版に切り替わって動いた値は、マルチスレッド版の値と分ける", async () => {
        const fake = createFakeClient({ threads: 1, threadedAvailable: false });
        const client = await start(fake);
        await client.search({});
        fake.think();
        await settle();
        expect(store.getSnapshot().records[0]?.threaded).toBe(false);
    });

    it("探索の途中で作り直したエンジンを、探索中のまま残さない", async () => {
        const fake = createFakeClient();
        const client = await start(fake);
        await client.search({});
        expect(activity.getSnapshot().searching).toBe(1);
        await client.reset?.();
        expect(activity.getSnapshot().searching).toBe(0);
    });

    it("起動できなかったエンジンは、動いているエンジンに数えない", async () => {
        const fake = createFakeClient();
        vi.mocked(fake.client.init).mockRejectedValueOnce(new Error("failed"));
        await expect(wrap(fake).init({ threads: 4 })).rejects.toThrow();
        expect(activity.getSnapshot().live).toBe(0);
    });

    it("計測用のエンジンは記録しない", async () => {
        const fake = createFakeClient();
        const client = wrap(fake, false);
        await client.init({ threads: 4 });
        await client.loadNnue?.("id");
        await client.search({});
        fake.think();
        await settle();
        expect(store.getSnapshot().records).toEqual([]);
    });
});

describe("runNnueSpeedBenchmark", () => {
    const answerEachSearch = (fake: ReturnType<typeof createFakeClient>) =>
        vi.mocked(fake.client.search).mockImplementation(async () => {
            setTimeout(() => {
                fake.info(1_000_000, 1000);
                fake.info(3_000_000, 3000);
                fake.bestmove();
            }, 0);
            return { cancel: async () => {} };
        });

    it("用意した局面を順に探索し、総ノード数 / 総時間を返す", async () => {
        const fake = createFakeClient({ threads: 3 });
        answerEachSearch(fake);
        const onProgress = vi.fn();
        const result = await runNnueSpeedBenchmark({
            createClient: () => fake.client,
            nnueId: "id",
            fvScale: 24,
            threads: 4,
            signal: new AbortController().signal,
            onProgress,
        });
        expect(result).toEqual({ nps: 1_000_000, threads: 3, threaded: true });
        expect(fake.client.loadPosition).toHaveBeenCalledTimes(
            NNUE_SPEED_BENCHMARK_POSITIONS.length,
        );
        expect(fake.client.search).toHaveBeenCalledWith({ limits: { movetimeMs: 3000 } });
        expect(onProgress.mock.calls.map(([index]) => index)).toEqual([0, 1, 2]);
        expect(fake.client.dispose).toHaveBeenCalled();
    });

    it("止めると失敗として返し、エンジンは作り直さずに片付ける", async () => {
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
        expect(fake.client.stop).not.toHaveBeenCalled();
        expect(fake.client.dispose).toHaveBeenCalled();
    });

    it("最後の局面を読み込んでいる間に止めても、結果を返さない", async () => {
        const fake = createFakeClient();
        answerEachSearch(fake);
        const controller = new AbortController();
        vi.mocked(fake.client.loadPosition).mockImplementation(async () => {
            if (vi.mocked(fake.client.loadPosition).mock.calls.length === 3) controller.abort();
        });
        await expect(
            runNnueSpeedBenchmark({
                createClient: () => fake.client,
                nnueId: "id",
                threads: 4,
                signal: controller.signal,
            }),
        ).rejects.toThrow();
        expect(fake.client.search).toHaveBeenCalledTimes(2);
    });
});
