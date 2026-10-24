import type { LayerStacksConfig, NnueSpeedData, NnueSpeedKey } from "@shogi/app-core";
import {
    addObservedNnueSpeed,
    EMPTY_NNUE_SPEED_DATA,
    NNUE_SPEED_MIN_SEARCH_MS,
    parseNnueSpeedData,
    setNnueSpeedBenchmark,
} from "@shogi/app-core";
import type {
    AnalysisClient,
    AnalysisFinished,
    AnalysisRun,
    EngineClient,
    EngineEvent,
    EngineInfoEvent,
    SearchHandle,
} from "@shogi/engine-client";

/** NPS を比べるための、このアプリのエンジンの素性。 */
export interface EngineSpeedEnvironment {
    /** Web の wasm と Desktop のネイティブで別になる版（例: `wasm:0.8.1+05d89777`） */
    engineVersion: string;
    /** マルチスレッド版で動くか */
    threaded: boolean;
}

// ============================================================
// 動いているエンジンの数
// ============================================================

type ActivityListener = () => void;

/**
 * ページの中で初期化済みのエンジンと、探索中のエンジンを数える。
 * 実測は「エンジンが 1 つだけ動いているとき」に限り、計測は「探索中のエンジンが無いとき」に限る。
 */
function createEngineActivity() {
    const live = new Set<symbol>();
    const searching = new Set<symbol>();
    const listeners = new Set<ActivityListener>();
    let snapshot = { live: 0, searching: 0 };
    const notify = () => {
        snapshot = { live: live.size, searching: searching.size };
        for (const listener of listeners) listener();
    };
    const toggle = (set: Set<symbol>, id: symbol, on: boolean) => {
        if (set.has(id) === on) return;
        if (on) set.add(id);
        else set.delete(id);
        notify();
    };
    return {
        setLive: (id: symbol, on: boolean) => toggle(live, id, on),
        setSearching: (id: symbol, on: boolean) => toggle(searching, id, on),
        /** 自分以外のエンジンが初期化済みか、探索中か */
        hasOthers: (id: symbol) =>
            [...live].some((other) => other !== id) || [...searching].some((other) => other !== id),
        getSnapshot: () => snapshot,
        subscribe(listener: ActivityListener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
    };
}

export const engineActivity = createEngineActivity();

// ============================================================
// 保存先
// ============================================================

const STORAGE_KEY = "shogi-nnue-speed";

type SpeedStorage = Pick<Storage, "getItem" | "setItem">;

const defaultStorage = (): SpeedStorage | null => {
    try {
        return typeof localStorage === "undefined" ? null : localStorage;
    } catch {
        // Safari のプライベートモードなどでは localStorage を触るだけで投げる
        return null;
    }
};

export function createNnueSpeedStore(storage: SpeedStorage | null = defaultStorage()) {
    const listeners = new Set<() => void>();
    let cache: NnueSpeedData | null = null;
    const read = (): NnueSpeedData => {
        if (cache) return cache;
        try {
            const raw = storage?.getItem(STORAGE_KEY);
            cache = raw ? parseNnueSpeedData(JSON.parse(raw)) : EMPTY_NNUE_SPEED_DATA;
        } catch {
            cache = EMPTY_NNUE_SPEED_DATA;
        }
        return cache;
    };
    const write = (next: NnueSpeedData) => {
        cache = next;
        try {
            storage?.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {
            // 容量不足などで残せなくても、このページの中では見せる
        }
        for (const listener of listeners) listener();
    };
    return {
        getSnapshot: read,
        addObserved: (key: NnueSpeedKey, nps: number) =>
            write(addObservedNnueSpeed(read(), key, nps)),
        setBenchmark: (key: NnueSpeedKey, nps: number, measuredAt: number) =>
            write(setNnueSpeedBenchmark(read(), key, nps, measuredAt)),
        subscribe(listener: () => void) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
    };
}

export type NnueSpeedStore = ReturnType<typeof createNnueSpeedStore>;

export const nnueSpeedStore = createNnueSpeedStore();

// ============================================================
// 対局・解析での実測
// ============================================================

interface NpsRecordingOptions {
    environment: EngineSpeedEnvironment;
    /** 端末に保存した評価関数の id から SHA-256 を引く */
    resolveContentHash: (nnueId: string) => Promise<string | null>;
    store?: NnueSpeedStore;
    /** false にすると数えるだけで記録しない（計測用のエンジン） */
    record?: boolean;
}

/** 探索 1 回の、最後に届いた探索量 */
interface SearchSample {
    nodes: number;
    timeMs: number;
}

const sampleOf = (info: EngineInfoEvent): SearchSample | null =>
    info.nodes !== undefined && info.timeMs !== undefined && info.timeMs > 0
        ? { nodes: info.nodes, timeMs: info.timeMs }
        : null;

/**
 * エンジンを包み、対局・解析で出た NPS を記録する。
 * 記録するのは、探索の間ずっとほかのエンジンが動いていなかった（AI 対 AI や並列解析でない）、
 * 1 秒以上の探索だけ。評価関数を読み込んでいないエンジンは記録しない。
 */
export function withNpsRecording<T extends EngineClient>(
    inner: T,
    options: NpsRecordingOptions,
): T {
    const id = Symbol("engine");
    const store = options.store ?? nnueSpeedStore;
    const record = options.record ?? true;
    let contentHash: Promise<string | null> = Promise.resolve(null);
    let threadsOption: number | null = null;
    let requestedThreads = 1;

    /** 進行中の探索。ほかのエンジンが動いたら記録しない印を付ける。 */
    let active: { contaminated: boolean; sample: SearchSample | null } | null = null;
    let unsubscribeActivity: (() => void) | null = null;
    let unsubscribeEvents: (() => void) | null = null;

    const effectiveThreads = () => {
        const reported = inner.getThreadInfo?.().activeThreads;
        const base = reported && reported > 0 ? reported : requestedThreads;
        return threadsOption !== null ? Math.min(base, threadsOption) : base;
    };

    const begin = () => {
        finish(null);
        active = { contaminated: engineActivity.hasOthers(id), sample: null };
        engineActivity.setSearching(id, true);
        unsubscribeActivity = engineActivity.subscribe(() => {
            if (active && engineActivity.hasOthers(id)) active.contaminated = true;
        });
    };

    /** 探索を締める。`override` は解析の結果のように、探索全体の量が分かっているとき。 */
    const finish = (override: SearchSample | null) => {
        if (!active) return;
        const { contaminated, sample: lastSample } = active;
        active = null;
        unsubscribeActivity?.();
        unsubscribeActivity = null;
        engineActivity.setSearching(id, false);
        const sample = override ?? lastSample;
        if (!record || contaminated || !sample || sample.timeMs < NNUE_SPEED_MIN_SEARCH_MS) {
            return;
        }
        const threads = effectiveThreads();
        const nps = (sample.nodes * 1000) / sample.timeMs;
        void contentHash.then((hash) => {
            if (!hash) return;
            store.addObserved(
                {
                    contentHash: hash,
                    threads,
                    engineVersion: options.environment.engineVersion,
                    threaded: options.environment.threaded,
                },
                nps,
            );
        });
    };

    const onEvent = (event: EngineEvent) => {
        if (!active) return;
        if (event.type === "info") {
            active.sample = sampleOf(event) ?? active.sample;
        } else if (
            event.type === "bestmove" ||
            (event.type === "error" && event.severity !== "warning")
        ) {
            finish(null);
        }
    };

    const wrapRun = (run: AnalysisRun): AnalysisRun => {
        const settle = (result: AnalysisFinished) => {
            finish(result.timeMs > 0 ? { nodes: result.nodes, timeMs: result.timeMs } : null);
            return result;
        };
        const finished = run.finished.then(settle, (error: unknown) => {
            finish(null);
            throw error;
        });
        return {
            ...run,
            finished,
            pause: () =>
                run.pause().then(settle, (error: unknown) => {
                    finish(null);
                    throw error;
                }),
        };
    };

    const startAnalysis =
        (start: AnalysisClient["start"]): AnalysisClient["start"] =>
        async (sessionId, budget, onInfo) => {
            begin();
            try {
                const run = await start(sessionId, budget, (info) => {
                    if (active) active.sample = sampleOf(info) ?? active.sample;
                    onInfo(info);
                });
                return wrapRun(run);
            } catch (error) {
                finish(null);
                throw error;
            }
        };

    const analysis: AnalysisClient | undefined = inner.analysis
        ? {
              ...inner.analysis,
              available: inner.analysis.available.bind(inner.analysis),
              release: inner.analysis.release.bind(inner.analysis),
              start: startAnalysis(inner.analysis.start.bind(inner.analysis)),
              resume: startAnalysis(inner.analysis.resume.bind(inner.analysis)),
          }
        : undefined;

    return {
        ...inner,
        ...(analysis ? { analysis } : {}),
        async init(opts) {
            requestedThreads = opts?.threads ?? requestedThreads;
            threadsOption = null;
            engineActivity.setLive(id, true);
            unsubscribeEvents ??= inner.subscribe(onEvent);
            await inner.init(opts);
        },
        async loadNnue(nnueId, layerStacks) {
            if (!inner.loadNnue) return;
            await inner.loadNnue(nnueId, layerStacks);
            contentHash = options.resolveContentHash(nnueId).catch(() => null);
        },
        async setOption(name, value) {
            if (name === "Threads" && typeof value === "number") threadsOption = value;
            await inner.setOption(name, value);
        },
        async search(params): Promise<SearchHandle> {
            begin();
            try {
                const handle = await inner.search(params);
                return {
                    cancel: async () => {
                        finish(null);
                        await handle.cancel();
                    },
                };
            } catch (error) {
                finish(null);
                throw error;
            }
        },
        async stop() {
            finish(null);
            await inner.stop();
        },
        async dispose() {
            finish(null);
            unsubscribeEvents?.();
            unsubscribeEvents = null;
            contentHash = Promise.resolve(null);
            engineActivity.setLive(id, false);
            await inner.dispose();
        },
    } as T;
}

// ============================================================
// 「速さを測る」
// ============================================================

/** 序盤・中盤・終盤の 3 局面。各 3 秒、計 9 秒ほど探索する。 */
export const NNUE_SPEED_BENCHMARK_POSITIONS: ReadonlyArray<{ label: string; sfen: string }> = [
    {
        label: "序盤",
        sfen: "ln1gkg1nl/1rs3sb1/p1pppp1pp/1p4p2/9/2PP5/PPS1PPPPP/1BG4R1/LN2KGSNL w - 1",
    },
    {
        label: "中盤",
        sfen: "ln1g3nl/1r1s1kg2/p1pppps1p/1p4pp1/9/2PSP1P2/PP1P1PNPP/2GSK2R1/LN3G2L b Bb 1",
    },
    {
        label: "終盤",
        sfen: "l6nl/5+P1gk/2np1S3/p1p4Pp/3P2Sp1/1PPb2P1P/P5GS1/R8/LN4bKL w RGgsn5p 1",
    },
];

export const NNUE_SPEED_BENCHMARK_MS_PER_POSITION = 3000;

const abortedError = () => new Error("計測を中断しました");

interface NnueSpeedBenchmarkParams {
    /** 包んだエンジンを作る（`withNpsRecording` の `record: false`） */
    createClient: () => EngineClient;
    nnueId: string;
    layerStacks?: LayerStacksConfig;
    fvScale?: number;
    threads: number;
    signal: AbortSignal;
    /** 局面を 1 つ始めるたびに呼ぶ（0 始まり） */
    onProgress?: (index: number) => void;
}

/**
 * 局面を順に決まった時間だけ探索し、全体の NPS（総ノード数 / 総時間）とスレッド数を返す。
 * `signal` で止めたときは失敗として返る（呼び出し側は `signal.aborted` で見分ける）。
 */
export async function runNnueSpeedBenchmark(
    params: NnueSpeedBenchmarkParams,
): Promise<{ nps: number; threads: number }> {
    const { signal } = params;
    const throwIfAborted = () => {
        if (signal.aborted) throw abortedError();
    };
    const client = params.createClient();
    try {
        throwIfAborted();
        await client.init({ threads: params.threads });
        throwIfAborted();
        await client.loadNnue?.(params.nnueId, params.layerStacks);
        if (params.fvScale !== undefined) await client.setOption("FV_SCALE", params.fvScale);
        const threads = client.getThreadInfo?.().activeThreads || params.threads;
        let totalNodes = 0;
        let totalMs = 0;
        for (const [index, position] of NNUE_SPEED_BENCHMARK_POSITIONS.entries()) {
            throwIfAborted();
            params.onProgress?.(index);
            await client.loadPosition(position.sfen);
            const sample = await searchOnce(client, signal);
            totalNodes += sample.nodes;
            totalMs += sample.timeMs;
        }
        if (totalMs <= 0 || totalNodes <= 0) throw new Error("探索の結果を受け取れませんでした");
        return { nps: (totalNodes * 1000) / totalMs, threads };
    } finally {
        await client.dispose().catch(() => undefined);
    }
}

function searchOnce(client: EngineClient, signal: AbortSignal): Promise<SearchSample> {
    return new Promise((resolve, reject) => {
        let sample: SearchSample | null = null;
        const cleanup = () => {
            unsubscribe();
            signal.removeEventListener("abort", onAbort);
        };
        const onAbort = () => {
            cleanup();
            void client.stop().catch(() => undefined);
            reject(abortedError());
        };
        const unsubscribe = client.subscribe((event) => {
            if (event.type === "info") {
                sample = sampleOf(event) ?? sample;
            } else if (event.type === "bestmove") {
                cleanup();
                if (sample) resolve(sample);
                else reject(new Error("探索の結果を受け取れませんでした"));
            } else if (event.type === "error" && event.severity !== "warning") {
                cleanup();
                reject(new Error(event.message));
            }
        });
        signal.addEventListener("abort", onAbort);
        client
            .search({ limits: { movetimeMs: NNUE_SPEED_BENCHMARK_MS_PER_POSITION } })
            .catch((error: unknown) => {
                cleanup();
                reject(error);
            });
    });
}
