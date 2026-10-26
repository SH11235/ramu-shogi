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
    MateClient,
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
 * AI 対 AI のように、ほかのエンジンの探索と交互に動いている探索とみなす間隔。
 * 探索を終えてからこの時間のうちに別のエンジンが探索を始めたら、両方を実測に入れない。
 */
const ALTERNATING_SEARCH_WINDOW_MS = 5000;

/**
 * ページの中で初期化済みのエンジンと、探索中のエンジンを数える。
 * 実測は「ほかのエンジンが探索していないとき」に限り（待機しているだけのエンジンは数えない）、
 * 計測は「探索中のエンジンが無いとき」に限る。
 */
function createEngineActivity(now: () => number = Date.now) {
    const live = new Set<symbol>();
    const searching = new Set<symbol>();
    const lastSearchEndedAt = new Map<symbol, number>();
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
        setSearching: (id: symbol, on: boolean) => {
            if (!on && searching.has(id)) lastSearchEndedAt.set(id, now());
            toggle(searching, id, on);
        },
        /** 自分以外のエンジンが探索中か */
        othersSearching: (id: symbol) => [...searching].some((other) => other !== id),
        /** 自分以外のエンジンが探索中か、少し前まで探索していた（AI 対 AI・並列解析） */
        // 閉じたエンジンの履歴も、この間が過ぎるまでは残す（閉じた直後に別のエンジンが探索することがある）
        othersSearchingOrJustDid: (id: symbol) => {
            const current = now();
            for (const [other, endedAt] of lastSearchEndedAt) {
                if (current - endedAt >= ALTERNATING_SEARCH_WINDOW_MS) {
                    lastSearchEndedAt.delete(other);
                }
            }
            return (
                [...searching].some((other) => other !== id) ||
                [...lastSearchEndedAt.keys()].some((other) => other !== id)
            );
        },
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

type EngineActivity = ReturnType<typeof createEngineActivity>;

export { createEngineActivity };

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

type NnueSpeedStore = ReturnType<typeof createNnueSpeedStore>;

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
    activity?: EngineActivity;
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
 * 記録するのは、ほかのエンジンと重ならず・交互にもならずに動いた（AI 対 AI や並列解析でない）、
 * 1 秒以上の探索だけ。評価関数を読み込んでいないエンジンは記録しない。
 */
export function withNpsRecording<T extends EngineClient>(
    inner: T,
    options: NpsRecordingOptions,
): T {
    const id = Symbol("engine");
    const store = options.store ?? nnueSpeedStore;
    const activity = options.activity ?? engineActivity;
    const record = options.record ?? true;
    let contentHash: Promise<string | null> = Promise.resolve(null);
    let requestedThreads = 1;

    /** 進行中の探索。ほかのエンジンが探索したら記録しない印を付ける。 */
    let active: { contaminated: boolean; sample: SearchSample | null } | null = null;
    let unsubscribeActivity: (() => void) | null = null;
    let unsubscribeEvents: (() => void) | null = null;
    /** 交互の探索でないと分かるまで書くのを待っている記録。閉じたら捨てる。 */
    const pendingWrites = new Set<() => void>();
    let disposed = false;
    // 探索と詰み探索は重ねて呼ばれうる（後のほうはエンジンに断られる）。断られた側が先の探索の印を
    // 外さないよう、このクライアントの中で数え、0 になったときだけ探索中でなくする。
    let runningCount = 0;
    const markSearching = (on: boolean) => {
        runningCount = Math.max(0, runningCount + (on ? 1 : -1));
        activity.setSearching(id, runningCount > 0);
    };
    // Wasm の setOption("Threads") は次の初期化まで効かないので、設定値ではなく実際に動いている数を使う。
    const effectiveThreads = () => {
        const reported = inner.getThreadInfo?.().activeThreads;
        return reported && reported > 0 ? reported : requestedThreads;
    };
    // マルチスレッド版が起動できずに 1 スレッド版へ切り替わったときは、その版の値として分ける。
    const effectiveThreaded = () =>
        inner.getThreadInfo?.().threadedAvailable ?? options.environment.threaded;

    const begin = () => {
        finish(null);
        active = { contaminated: activity.othersSearchingOrJustDid(id), sample: null };
        markSearching(true);
        unsubscribeActivity = activity.subscribe(() => {
            if (active && activity.othersSearching(id)) active.contaminated = true;
        });
    };

    /** 探索を締める。`override` は解析の結果のように、探索全体の量が分かっているとき。 */
    const finish = (override: SearchSample | null, { discard = false } = {}) => {
        if (!active) return;
        const { contaminated, sample: lastSample } = active;
        active = null;
        unsubscribeActivity?.();
        unsubscribeActivity = null;
        markSearching(false);
        const sample = override ?? lastSample;
        if (
            discard ||
            !record ||
            contaminated ||
            !sample ||
            sample.timeMs < NNUE_SPEED_MIN_SEARCH_MS
        ) {
            return;
        }
        const key = {
            threads: effectiveThreads(),
            engineVersion: options.environment.engineVersion,
            threaded: effectiveThreaded(),
        };
        const nps = (sample.nodes * 1000) / sample.timeMs;
        const hash = contentHash;
        // 直後にほかのエンジンが探索を始めたら AI 対 AI とみなし、この探索も記録しない。
        const cancel = () => {
            clearTimeout(timer);
            unsubscribe();
            pendingWrites.delete(cancel);
        };
        const timer = setTimeout(() => {
            cancel();
            void hash.then((contentHash) => {
                if (contentHash && !disposed) store.addObserved({ contentHash, ...key }, nps);
            });
        }, ALTERNATING_SEARCH_WINDOW_MS);
        const unsubscribe = activity.subscribe(() => {
            if (activity.othersSearching(id)) cancel();
        });
        pendingWrites.add(cancel);
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

    // 詰み探索も CPU を使うので探索中として数える（NPS の意味が違うので記録はしない）
    const innerMate = inner.mate;
    const mate: MateClient | undefined = innerMate
        ? {
              available: innerMate.available.bind(innerMate),
              async solve(params, onProgress) {
                  markSearching(true);
                  try {
                      return await innerMate.solve(params, onProgress);
                  } finally {
                      markSearching(false);
                  }
              },
          }
        : undefined;

    return {
        ...inner,
        ...(analysis ? { analysis } : {}),
        ...(mate ? { mate } : {}),
        async init(opts) {
            disposed = false;
            finish(null);
            requestedThreads = opts?.threads ?? requestedThreads;
            activity.setLive(id, true);
            unsubscribeEvents ??= inner.subscribe(onEvent);
            try {
                await inner.init(opts);
            } catch (error) {
                // 起動できなかったエンジンは動いていないので、計測の妨げにしない
                activity.setLive(id, false);
                throw error;
            }
        },
        // reset はワーカーを止め、探索の終わり（bestmove）が届かないことがある
        ...(inner.reset
            ? {
                  async reset() {
                      finish(null);
                      await inner.reset?.();
                  },
              }
            : {}),
        async loadNnue(nnueId, layerStacks) {
            if (!inner.loadNnue) return;
            await inner.loadNnue(nnueId, layerStacks);
            contentHash = options.resolveContentHash(nnueId).catch(() => null);
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
            // 閉じるときに打ち切った探索と、まだ書いていない記録は残さない（画面を離れた途中の値など）
            finish(null, { discard: true });
            unsubscribeEvents?.();
            unsubscribeEvents = null;
            contentHash = Promise.resolve(null);
            activity.setLive(id, false);
            disposed = true;
            for (const cancel of [...pendingWrites]) cancel();
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
 * 局面を順に決まった時間だけ探索し、全体の NPS（総ノード数 / 総時間）と、実際に動いた
 * スレッド数・マルチスレッド版かどうかを返す。`signal` で止めたときは失敗として返る
 * （呼び出し側は `signal.aborted` で見分ける）。
 */
export async function runNnueSpeedBenchmark(
    params: NnueSpeedBenchmarkParams,
): Promise<{ nps: number; threads: number; threaded: boolean | undefined }> {
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
        const threadInfo = client.getThreadInfo?.();
        const threads = threadInfo?.activeThreads || params.threads;
        let totalNodes = 0;
        let totalMs = 0;
        for (const [index, position] of NNUE_SPEED_BENCHMARK_POSITIONS.entries()) {
            throwIfAborted();
            params.onProgress?.(index);
            await client.loadPosition(position.sfen);
            throwIfAborted();
            const sample = await searchOnce(client, signal);
            totalNodes += sample.nodes;
            totalMs += sample.timeMs;
        }
        throwIfAborted();
        if (totalMs <= 0 || totalNodes <= 0) throw new Error("探索の結果を受け取れませんでした");
        return {
            nps: (totalNodes * 1000) / totalMs,
            threads,
            threaded: threadInfo?.threadedAvailable,
        };
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
        // 止めるのは呼び出し側の dispose に任せる（Wasm の stop はワーカーを作り直してしまう）。
        const onAbort = () => {
            cleanup();
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
