import {
    applyStudyOps,
    createStudyDocumentFromMoves,
    type StudyDocument,
    type StudyOp,
} from "@shogi/app-core";
import type {
    AnalysisFinished,
    EngineClient,
    EngineEventHandler,
    EngineInfoEvent,
    SearchLimits,
} from "@shogi/engine-client";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineOption } from "../shogi-match/types";
import { createTestStudy } from "./study-test-support";
import { buildStudyViewTree } from "./studyView";
import {
    hasStudyLiveStarted,
    STUDY_DEEP_TIME_MS,
    type StudyApplyOpsOptions,
    type StudyLiveSearch,
    useStudyAnalysis,
} from "./useStudyAnalysis";

/** 探索のたびに評価値つきの info を 1 回流してから bestmove を返すエンジン。 */
/** `cancelMs` は探索を止め終わるまでの時間（止めている途中に次の操作を挟むのに使う）。 */
function createEngineOption(
    searchMs = 5,
    cancelMs = 0,
): {
    option: EngineOption;
    searches: () => number;
    clients: () => number;
    /** エンジンの初期化で渡されたスレッド数（作った順）。 */
    initThreads: () => Array<number | undefined>;
} {
    let searches = 0;
    let clients = 0;
    const initThreads: Array<number | undefined> = [];
    const createClient = (): EngineClient => {
        clients++;
        const listeners = new Set<EngineEventHandler>();
        return {
            init: vi.fn(async (options?: { threads?: number }) => {
                initThreads.push(options?.threads);
            }),
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
                        if (cancelMs > 0)
                            await new Promise((resolve) => setTimeout(resolve, cancelMs));
                    },
                };
            },
        };
    };
    return {
        option: { id: "wasm", label: "内蔵エンジン", createClient, kind: "internal" },
        searches: () => searches,
        clients: () => clients,
        initThreads: () => initThreads,
    };
}

/** 続きから読めず、`emit` で流した info だけを返し、止められるまで bestmove を返さないエンジン。 */
function createManualEngineOption(): {
    option: EngineOption;
    emit: (info: Omit<EngineInfoEvent, "type">) => void;
    /** 探索ごとに渡された条件。 */
    limits: () => Array<SearchLimits | undefined>;
    searches: () => number;
} {
    const listeners = new Set<EngineEventHandler>();
    const limits: Array<SearchLimits | undefined> = [];
    const createClient = (): EngineClient => ({
        init: vi.fn().mockResolvedValue(undefined),
        loadPosition: vi.fn().mockResolvedValue(undefined),
        setOption: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
        dispose: vi.fn().mockResolvedValue(undefined),
        subscribe(handler) {
            listeners.add(handler);
            return () => listeners.delete(handler);
        },
        async search(params) {
            limits.push(params.limits);
            return { async cancel() {} };
        },
    });
    return {
        option: { id: "wasm", label: "内蔵エンジン", createClient, kind: "internal" },
        emit: (info) => {
            for (const listener of listeners) listener({ type: "info", ...info });
        },
        limits: () => limits,
        searches: () => limits.length,
    };
}

/**
 * 止めても続きから読める探索（`analysis`）を持つエンジン。読み始める・続けるたびに 5 ずつ深く読んだ
 * info を 1 回流す。読みは `finishRun` で上限に届かせるか、止められるまで続く。
 */
function createResumableEngineOption(
    /** 渡すと、読みを止めるのをこの Promise が解決するまで遅らせる。 */
    holdPause?: Promise<void>,
): {
    option: EngineOption;
    starts: () => number;
    resumes: () => number;
    searches: () => number;
    /** いまの読みを、上限に届いたことにして終える。 */
    finishRun: (elapsedMs: number) => void;
    /** いまの読みの info を流す（同じ深さで最善手が入れ替わる、など）。 */
    emitInfo: (info: Omit<EngineInfoEvent, "type">) => void;
} {
    let starts = 0;
    let resumes = 0;
    let searches = 0;
    let depth = 0;
    let totalTimeMs = 0;
    let emit: ((info: EngineInfoEvent) => void) | null = null;
    let end: ((reason: AnalysisFinished["reason"], elapsedMs: number) => AnalysisFinished) | null =
        null;
    const run = (sessionId: string, onInfo: (info: EngineInfoEvent) => void) => {
        depth += 5;
        emit = onInfo;
        onInfo({ type: "info", depth, scoreCp: 100 + depth, multipv: 1, pv: ["8c8d"] });
        let resolve: (finished: AnalysisFinished) => void = () => {};
        const finished = new Promise<AnalysisFinished>((done) => {
            resolve = done;
        });
        let result: AnalysisFinished | null = null;
        end = (reason, elapsedMs) => {
            if (result) return result;
            totalTimeMs += elapsedMs;
            result = {
                sessionId,
                runId: 1,
                reason,
                resumable: true,
                completedDepth: depth,
                nodes: 1000,
                timeMs: elapsedMs,
                totalNodes: depth * 1000,
                totalTimeMs,
                workerDepths: [],
            };
            resolve(result);
            return result;
        };
        return {
            sessionId,
            runId: 1,
            finished,
            pause: async () => {
                await holdPause;
                return (end as NonNullable<typeof end>)("paused", 10_000);
            },
        };
    };
    const createClient = (): EngineClient => ({
        init: vi.fn().mockResolvedValue(undefined),
        loadPosition: vi.fn().mockResolvedValue(undefined),
        setOption: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
        dispose: vi.fn().mockResolvedValue(undefined),
        subscribe: () => () => {},
        async search() {
            searches++;
            return { async cancel() {} };
        },
        analysis: {
            available: () => true,
            async start(sessionId, _budget, onInfo) {
                starts++;
                depth = 0;
                totalTimeMs = 0;
                return run(sessionId, onInfo);
            },
            async resume(sessionId, _budget, onInfo) {
                resumes++;
                return run(sessionId, onInfo);
            },
            release: vi.fn().mockResolvedValue(undefined),
        },
    });
    return {
        option: { id: "wasm", label: "内蔵エンジン", createClient, kind: "internal" },
        starts: () => starts,
        resumes: () => resumes,
        searches: () => searches,
        finishRun: (elapsedMs) => {
            end?.("budgetReached", elapsedMs);
        },
        emitInfo: (info) => emit?.({ type: "info", ...info }),
    };
}

/** ページの代わりに、操作を文書へ適用しながらフックを動かす。 */
function useHarness(
    initialDoc: StudyDocument,
    engineOptions: EngineOption[],
    options: {
        rejectAnalysis?: boolean;
        /** この局面の解析結果だけ保存できなかったことにする。 */
        rejectAnalysisOf?: string;
        /** 渡すと、`rejectAnalysisOf` の保存の失敗をこの Promise が解決するまで遅らせる。 */
        rejectAfter?: Promise<void>;
        onOps?: (ops: StudyOp[], applyOptions?: StudyApplyOpsOptions) => void;
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
        onApplyOps: (next, applyOptions) => {
            options.onOps?.(next, applyOptions);
            // 解析結果が保存できなかった（上限を超えた）場合の模擬。
            if (options.rejectAnalysis && next.some((op) => op.type === "putAnalysis")) {
                return Promise.resolve(false);
            }
            if (
                next.some(
                    (op) => op.type === "putAnalysis" && op.nodeId === options.rejectAnalysisOf,
                )
            ) {
                return (options.rejectAfter ?? Promise.resolve()).then(() => false);
            }
            setOps((previous) => [...previous, ...next]);
            setDoc((previous) => applyStudyOps(previous, next));
            return undefined;
        },
        onFlush: () => setFlushCount((count) => count + 1),
        onLayerStarted: (layerId) =>
            setStartedLayers((previous) => [...previous, `full:${layerId}`]),
        onDeepResult: (layerId, nodeId) =>
            setStartedLayers((previous) => [...previous, `deep:${layerId}:${nodeId}`]),
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

    it("エンジンが失敗したときは、内部の言葉を出さずに読み込み直しを促す", async () => {
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        const { doc } = createTestStudy();
        const engine = createEngineOption();
        const failing: EngineOption = {
            ...engine.option,
            createClient: () => ({
                ...engine.option.createClient(),
                init: vi.fn().mockRejectedValue(new Error("worker replaced")),
            }),
        };
        const onMessage = vi.fn();
        const { result } = renderHook(() => useHarness(doc, [failing], { onMessage }));

        await act(async () => {
            await result.current.controller.startFull();
        });
        await waitFor(() =>
            expect(onMessage).toHaveBeenCalledWith({
                text: "解析に失敗した局面があります。ページを読み込み直してから、もう一度お試しください。",
                type: "error",
            }),
        );
        consoleError.mockRestore();
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

    it("玉の無い側がある局面（詰将棋）は、全体も 1 局面も解析を始めずに理由を知らせる", async () => {
        const doc = createStudyDocumentFromMoves({
            id: "22222222-2222-4222-8222-222222222222",
            title: "詰将棋",
            origin: { kind: "paste", ref: null },
            startSfen: "4k4/9/4P4/9/9/9/9/9/9 b G 1",
            moves: ["G*5b"],
        });
        const engine = createEngineOption();
        const onMessage = vi.fn();
        const { result } = renderHook(() => useHarness(doc, [engine.option], { onMessage }));
        await act(async () => {
            await result.current.controller.startFull();
        });
        await act(async () => {
            await result.current.controller.startDeep(doc.tree.rootId);
        });
        expect(engine.searches()).toBe(0);
        expect(onMessage).toHaveBeenCalledWith({
            text: "玉の無い局面は解析できません。",
            type: "warning",
        });
    });

    it("全体の解析は、設定した 1 局面あたりのスレッド数でエンジンを用意する", async () => {
        localStorage.setItem(
            "shogi-analysis-settings",
            JSON.stringify({
                parallelWorkers: 2,
                batchAnalysisTimeMs: 500,
                batchAnalysisDepth: 15,
                multiPv: 1,
                batchAnalysisThreads: 3,
            }),
        );
        const { doc } = createTestStudy();
        const engine = createEngineOption();
        const { result } = renderHook(() => useHarness(doc, [engine.option]));

        await act(async () => {
            await result.current.controller.startFull();
        });
        await waitFor(() => expect(result.current.flushCount).toBe(1));
        expect(engine.initThreads()).toEqual([3, 3]);
        const layer = result.current.doc.layers[0];
        expect(Object.values(layer.results)[0].execution).toEqual({
            threads: 3,
            hashMb: null,
            parallelWorkers: 2,
        });
    });

    it("続きから読めないエンジンでも、深く解析は 1 つのエンジンに深く解析のスレッド数を当てる", async () => {
        localStorage.setItem(
            "shogi-analysis-settings",
            JSON.stringify({
                parallelWorkers: 2,
                batchAnalysisTimeMs: 500,
                batchAnalysisDepth: 15,
                multiPv: 1,
                batchAnalysisThreads: 1,
                deepAnalysisThreads: 3,
            }),
        );
        const { doc, ids } = createTestStudy();
        const engine = createEngineOption();
        const { result } = renderHook(() => useHarness(doc, [engine.option]));

        await act(async () => {
            await result.current.controller.startDeep(ids[2]);
        });
        await waitFor(() => expect(result.current.flushCount).toBe(1));
        // 1 つ目は続きから読めるかを確かめるためのエンジン、2 つ目が 1 回だけの読みのエンジン。
        expect(engine.initThreads()).toEqual([3, 3]);
        expect(engine.searches()).toBe(1);
    });

    it("続きから読めないエンジンでは、深さだけの info でも読み始めたことにし、深さの無い info では深さを残す", async () => {
        const { doc, ids } = createTestStudy();
        const listeners = new Set<EngineEventHandler>();
        const emit = (event: Omit<EngineInfoEvent, "type">): void => {
            for (const listener of listeners) listener({ type: "info", ...event });
        };
        const option: EngineOption = {
            id: "wasm",
            label: "内蔵エンジン",
            kind: "internal",
            createClient: (): EngineClient => ({
                init: vi.fn().mockResolvedValue(undefined),
                loadPosition: vi.fn().mockResolvedValue(undefined),
                setOption: vi.fn().mockResolvedValue(undefined),
                stop: vi.fn().mockResolvedValue(undefined),
                dispose: vi.fn().mockResolvedValue(undefined),
                subscribe(handler) {
                    listeners.add(handler);
                    return () => listeners.delete(handler);
                },
                search: vi.fn().mockResolvedValue({ cancel: async () => {} }),
            }),
        };
        const { result } = renderHook(() => useHarness(doc, [option]));
        await act(async () => {
            await result.current.controller.startDeep(ids[2]);
        });
        await waitFor(() => expect(result.current.controller.live?.nodeId).toBe(ids[2]));
        const live = () => result.current.controller.live as StudyLiveSearch;
        expect(hasStudyLiveStarted(live())).toBe(false);
        // ログの行（info string）では読み始めたことにしない。
        act(() => emit({}));
        expect(hasStudyLiveStarted(live())).toBe(false);
        // 評価値を添えない、深さだけの行でも読み始めたことにする。
        act(() => emit({ depth: 3 }));
        await waitFor(() => expect(live().depth).toBe(3));
        expect(hasStudyLiveStarted(live())).toBe(true);
        act(() => emit({ depth: 12, scoreCp: 80, multipv: 1, pv: ["7g7f"] }));
        await waitFor(() => expect(result.current.controller.live?.depth).toBe(12));
        act(() => emit({ scoreCp: 90, multipv: 1, pv: ["7g7f"] }));
        expect(result.current.controller.live?.depth).toBe(12);
    });

    it("続きから読めないエンジンでは、止めるまで読み続け、途中の候補を出して数秒ごとに残す", async () => {
        const { doc, ids } = createTestStudy();
        const engine = createManualEngineOption();
        const saves: Array<StudyApplyOpsOptions | undefined> = [];
        let now = 1_000_000;
        const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
        try {
            const { result } = renderHook(() =>
                useHarness(doc, [engine.option], {
                    onOps: (ops, applyOptions) => {
                        if (ops.some((op) => op.type === "putAnalysis")) saves.push(applyOptions);
                    },
                }),
            );
            await act(async () => {
                await result.current.controller.startDeep(ids[2]);
            });
            await waitFor(() => expect(engine.limits()).toHaveLength(1));
            const limits = engine.limits()[0];
            expect(limits?.maxDepth).toBe(64);
            expect(limits?.movetimeMs).toBeGreaterThanOrEqual(60 * 60 * 1000);
            const live = () => result.current.controller.live as StudyLiveSearch;
            expect(live().budgetMs).toBeNull();
            const saved = () => result.current.doc.layers[0]?.results[ids[2]];

            // 最初の候補は待たずに出す。保存は 3 秒たつまで待つ。
            act(() => engine.emit({ depth: 5, scoreCp: 40, multipv: 1, pv: ["7g7f"] }));
            await waitFor(() => expect(live().preview?.candidates[0].pv).toEqual(["7g7f"]));
            expect(saved()).toBeUndefined();

            now += 3_000;
            act(() => engine.emit({ depth: 8, scoreCp: 60, multipv: 1, pv: ["2g2f"] }));
            await waitFor(() => expect(saved()?.depth).toBe(8));
            expect(saved()?.completion).toBe("aborted");
            expect(saves).toEqual([{ syncDelayMs: 30_000 }]);
            expect(result.current.startedLayers).toEqual([
                `deep:${result.current.doc.layers[0].id}:${ids[2]}`,
            ]);

            // 区切りの時間を過ぎても読み終えない。止めた結果は、区切りまで読んだので「済んだ」になる。
            now += STUDY_DEEP_TIME_MS;
            act(() =>
                engine.emit({ depth: 14, scoreCp: 90, multipv: 1, pv: ["2g2f"], timeMs: 33_000 }),
            );
            await waitFor(() => expect(saved()?.depth).toBe(14));
            expect(result.current.controller.mode).toBe("deep");
            await act(async () => {
                await result.current.controller.cancel();
            });
            expect(saved()?.completion).toBe("completed");
            expect(result.current.controller.mode).toBeNull();
            expect(engine.searches()).toBe(1);
        } finally {
            clock.mockRestore();
        }
    });

    it("続きから読めないエンジンで、区切りの時間より前に止めた読みは「途中まで」として残る", async () => {
        const { doc, ids } = createTestStudy();
        const engine = createManualEngineOption();
        let now = 1_000_000;
        const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
        try {
            const { result } = renderHook(() => useHarness(doc, [engine.option]));
            await act(async () => {
                await result.current.controller.startDeep(ids[2]);
            });
            await waitFor(() => expect(engine.limits()).toHaveLength(1));
            now += 5_000;
            act(() =>
                engine.emit({ depth: 9, scoreCp: 50, multipv: 1, pv: ["7g7f"], timeMs: 5_000 }),
            );
            await act(async () => {
                await result.current.controller.cancel();
            });
            await waitFor(() =>
                expect(result.current.doc.layers[0]?.results[ids[2]]?.depth).toBe(9),
            );
            expect(result.current.doc.layers[0].results[ids[2]].completion).toBe("aborted");
        } finally {
            clock.mockRestore();
        }
    });

    it("続きから読めないエンジンで、最後の info より後に区切りの時間を過ぎてから止めた読みは「済んだ」になる", async () => {
        const { doc, ids } = createTestStudy();
        const engine = createManualEngineOption();
        let now = 1_000_000;
        const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
        try {
            const { result } = renderHook(() => useHarness(doc, [engine.option]));
            await act(async () => {
                await result.current.controller.startDeep(ids[2]);
            });
            await waitFor(() => expect(engine.limits()).toHaveLength(1));
            // エンジンの用意にかかった時間は、読んだ時間に数えない。
            now += 40_000;
            act(() =>
                engine.emit({ depth: 9, scoreCp: 50, multipv: 1, pv: ["7g7f"], timeMs: 1_000 }),
            );
            now += 20_000;
            act(() =>
                engine.emit({ depth: 20, scoreCp: 60, multipv: 1, pv: ["7g7f"], timeMs: 20_000 }),
            );
            // 次の深さを読んでいる途中で、届き始めてから 30 秒を過ぎた。
            now += 15_000;
            await act(async () => {
                await result.current.controller.cancel();
            });
            await waitFor(() =>
                expect(result.current.doc.layers[0]?.results[ids[2]]?.depth).toBe(20),
            );
            expect(result.current.doc.layers[0].results[ids[2]].completion).toBe("completed");
        } finally {
            clock.mockRestore();
        }
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
        expect(layer.display.label).toBe("簡易AI（駒得）・30 秒");
        expect(Object.keys(layer.results)).toEqual([ids[2]]);
        expect(result.current.startedLayers).toEqual([`deep:${layer.id}:${ids[2]}`]);
        expect(engine.searches()).toBe(1);
    });

    it.each([
        { name: "全体の解析と別に決めた数", stored: { multiPv: 4, deepMultiPv: 1 }, expected: 1 },
        { name: "分ける前の設定では max(候補手の数, 3)", stored: { multiPv: 4 }, expected: 4 },
        { name: "分ける前の設定で候補手の数が 1", stored: { multiPv: 1 }, expected: 3 },
    ])("この局面の読みの候補手の数は、$name", async ({ stored, expected }) => {
        localStorage.setItem(
            "shogi-analysis-settings",
            JSON.stringify({
                parallelWorkers: 2,
                batchAnalysisTimeMs: 500,
                batchAnalysisDepth: 15,
                ...stored,
            }),
        );
        const { doc, ids } = createTestStudy();
        const engine = createEngineOption();
        const { result } = renderHook(() => useHarness(doc, [engine.option]));
        expect(result.current.controller.form.settings.deepMultiPv).toBe(expected);

        await act(async () => {
            await result.current.controller.startDeep(ids[2]);
        });
        await waitFor(() => expect(result.current.flushCount).toBe(1));
        expect(result.current.doc.layers[0].spec.multiPv).toBe(expected);
    });

    it("エンジンの準備に失敗した深い読みは、結果を書いたと知らせない", async () => {
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        const { doc, ids } = createTestStudy();
        const engine = createEngineOption();
        const failing: EngineOption = {
            ...engine.option,
            createClient: () => ({
                ...engine.option.createClient(),
                init: vi.fn().mockRejectedValue(new Error("worker replaced")),
            }),
        };
        const onMessage = vi.fn();
        const { result } = renderHook(() => useHarness(doc, [failing], { onMessage }));

        await act(async () => {
            await result.current.controller.startDeep(ids[2]);
        });
        await waitFor(() =>
            expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "error" })),
        );
        await waitFor(() => expect(result.current.controller.mode).toBeNull());
        expect(result.current.startedLayers).toEqual([]);
        consoleError.mockRestore();
    });

    it("続きから読めるエンジンでは、深く解析を止めても同じ局面の続きから読め、止めるたびに結果を残す", async () => {
        const { doc, ids } = createTestStudy();
        const engine = createResumableEngineOption();
        const { result } = renderHook(() => useHarness(doc, [engine.option]));

        await act(async () => {
            await result.current.controller.startDeep(ids[2]);
        });
        await waitFor(() => expect(result.current.controller.mode).toBe("deep"));
        expect(result.current.controller.live).toMatchObject({
            nodeId: ids[2],
            depth: 5,
            budgetMs: 30_000,
        });
        expect(result.current.controller.live?.startedAt).toEqual(expect.any(Number));

        // 上限（30 秒）の前に止めると、そこまでの結果を「途中まで」として残し、続きから読める。
        await act(async () => {
            await result.current.controller.cancel();
        });
        await waitFor(() => expect(result.current.controller.continuableDeepNodeId).toBe(ids[2]));
        const layerId = result.current.doc.layers[0].id;
        const paused = result.current.doc.layers[0].results[ids[2]];
        expect(paused.completion).toBe("aborted");
        expect(paused.depth).toBe(5);
        expect(result.current.controller.mode).toBeNull();

        await act(async () => {
            await result.current.controller.continueDeep();
        });
        await waitFor(() => expect(result.current.controller.mode).toBe("deep"));
        expect(engine.resumes()).toBe(1);
        // 知らせるのは結果を書いた局面と設定だけ（読み始めでは知らせない）。
        expect(result.current.startedLayers.length).toBeGreaterThan(0);
        expect(new Set(result.current.startedLayers)).toEqual(
            new Set([`deep:${layerId}:${ids[2]}`]),
        );

        // 続きの読みが上限に届くと、深くなった結果で置き換わる（読んだ時間は通算）。
        await act(async () => {
            engine.finishRun(30_000);
        });
        await waitFor(() =>
            expect(result.current.doc.layers[0].results[ids[2]].completion).toBe("completed"),
        );
        const reached = result.current.doc.layers[0].results[ids[2]];
        expect(reached.depth).toBe(10);
        expect(reached.timeMs).toBe(40_000);
        expect(reached.candidates[0].score).toEqual({ kind: "cp", value: 110 });
        expect(result.current.controller.continuableDeepNodeId).toBe(ids[2]);
        expect(engine.starts()).toBe(1);
        expect(engine.searches()).toBe(0);
    });

    it("読んでいる途中も、最善手・評価値・深さが変わるたびに結果を残し、サーバーへはまとめて送る", async () => {
        const { doc, ids } = createTestStudy();
        const engine = createResumableEngineOption();
        const saves: Array<StudyApplyOpsOptions | undefined> = [];
        let now = 1_000_000;
        const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
        try {
            const { result } = renderHook(() =>
                useHarness(doc, [engine.option], {
                    onOps: (ops, applyOptions) => {
                        if (ops.some((op) => op.type === "putAnalysis")) saves.push(applyOptions);
                    },
                }),
            );
            await act(async () => {
                await result.current.controller.startDeep(ids[2]);
            });
            await waitFor(() => expect(result.current.controller.mode).toBe("deep"));
            const saved = () => result.current.doc.layers[0]?.results[ids[2]];

            // 同じ深さのまま最善手が入れ替わっても、残す。
            now += 3_000;
            act(() => {
                engine.emitInfo({ depth: 5, scoreCp: 300, multipv: 1, pv: ["2g2f"] });
            });
            await waitFor(() => expect(saved()?.candidates[0].pv).toEqual(["2g2f"]));
            expect(saved()?.completion).toBe("aborted");
            expect(saves).toEqual([{ syncDelayMs: 30_000 }]);
            const flushes = result.current.flushCount;

            // 何も変わらなければ残さない。
            now += 3_000;
            act(() => {
                engine.emitInfo({ depth: 5, scoreCp: 300, multipv: 1, pv: ["2g2f"] });
            });
            expect(saves).toHaveLength(1);
            expect(result.current.flushCount).toBe(flushes);

            // 同じ深さでもう一度入れ替われば、また残す。
            now += 3_000;
            act(() => {
                engine.emitInfo({ depth: 5, scoreCp: 50, multipv: 1, pv: ["7g7f"], nodes: 400 });
            });
            await waitFor(() => expect(saved()?.candidates[0].pv).toEqual(["7g7f"]));
            expect(saves).toHaveLength(2);

            // 止めて続きを読むと、info の局面数は 0 から数え直しても、途中の結果は前の区切りまでの
            // 局面数に足した数で残る（同じ深さで前の区切りの結果に負けない）。
            await act(async () => {
                await result.current.controller.cancel();
            });
            await waitFor(() =>
                expect(result.current.controller.continuableDeepNodeId).toBe(ids[2]),
            );
            const before = saved()?.nodes ?? 0;
            await act(async () => {
                await result.current.controller.continueDeep();
            });
            await waitFor(() => expect(result.current.controller.mode).toBe("deep"));
            const timeBefore = saved()?.timeMs ?? 0;
            now += 3_000;
            act(() => {
                engine.emitInfo({
                    depth: 10,
                    scoreCp: 80,
                    multipv: 1,
                    pv: ["2g2f"],
                    nodes: 10,
                    timeMs: 500,
                });
            });
            await waitFor(() => expect(saved()?.depth).toBe(10));
            expect(saved()?.nodes).toBe(before + 10);
            // 読んだ時間も前の区切りまでの通算に足す。
            expect(saved()?.timeMs).toBe(timeBefore + 500);
        } finally {
            clock.mockRestore();
        }
    });

    it("読み始めの途中の候補はすぐ画面に出し、保存は 3 秒たつまで待つ", async () => {
        const { doc, ids } = createTestStudy();
        const engine = createResumableEngineOption();
        const saves: Array<StudyApplyOpsOptions | undefined> = [];
        let now = 1_000_000;
        const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
        try {
            const { result } = renderHook(() =>
                useHarness(doc, [engine.option], {
                    onOps: (ops, applyOptions) => {
                        if (ops.some((op) => op.type === "putAnalysis")) saves.push(applyOptions);
                    },
                }),
            );
            await act(async () => {
                await result.current.controller.startDeep(ids[2]);
            });
            await waitFor(() => expect(result.current.controller.mode).toBe("deep"));
            const preview = () => result.current.controller.live?.preview;
            // 読み始めの最初の info（深さ 5）は待たずに写す。
            await waitFor(() => expect(preview()?.candidates[0].pv).toEqual(["8c8d"]));
            expect(preview()?.depth).toBe(5);

            // 間隔より短いうちの info は写さない。
            now += 200;
            act(() => {
                engine.emitInfo({ depth: 6, scoreCp: 40, multipv: 1, pv: ["2g2f"] });
            });
            expect(preview()?.depth).toBe(5);

            now += 400;
            act(() => {
                engine.emitInfo({ depth: 7, scoreCp: 60, multipv: 1, pv: ["2g2f"] });
            });
            await waitFor(() => expect(preview()?.depth).toBe(7));
            expect(saves).toHaveLength(0);
            expect(result.current.doc.layers[0]?.results[ids[2]]).toBeUndefined();

            now += 2_200;
            act(() => {
                engine.emitInfo({ depth: 8, scoreCp: 80, multipv: 1, pv: ["2g2f"] });
            });
            await waitFor(() => expect(preview()?.depth).toBe(8));
            expect(saves).toHaveLength(0);

            // 保存は 3 秒ごとに、画面の間隔とは別に行う（画面はまだ写さない）。
            now += 200;
            act(() => {
                engine.emitInfo({ depth: 9, scoreCp: 90, multipv: 1, pv: ["2g2f"] });
            });
            await waitFor(() =>
                expect(result.current.doc.layers[0]?.results[ids[2]]?.depth).toBe(9),
            );
            expect(preview()?.depth).toBe(8);
            expect(saves).toEqual([{ syncDelayMs: 30_000 }]);
        } finally {
            clock.mockRestore();
        }
    });

    it("移る前の局面の結果を保存できなくても、移った先の局面の読みは止めない", async () => {
        const { doc, ids } = createTestStudy();
        const engine = createResumableEngineOption();
        let now = 1_000_000;
        const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
        try {
            const { result } = renderHook(() =>
                useHarness(doc, [engine.option], { rejectAnalysisOf: ids[2] }),
            );
            await act(async () => {
                await result.current.controller.startDeep(ids[2]);
            });
            await waitFor(() => expect(result.current.controller.mode).toBe("deep"));
            // 前の局面の途中の結果の保存が失敗する前に、別の局面へ移る。
            now += 3_000;
            await act(async () => {
                engine.emitInfo({ depth: 5, scoreCp: 300, multipv: 1, pv: ["2g2f"] });
                await result.current.controller.startDeep(ids[3]);
            });
            await waitFor(() => expect(result.current.controller.live?.nodeId).toBe(ids[3]));
            expect(result.current.controller.mode).toBe("deep");
        } finally {
            clock.mockRestore();
        }
    });

    it("上限まで読み終えた局面の結果を保存できなくても、次に始めた局面の読みは止めない", async () => {
        const { doc, ids } = createTestStudy();
        const engine = createResumableEngineOption();
        let now = 1_000_000;
        const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
        try {
            let release: () => void = () => {};
            const rejectAfter = new Promise<void>((resolve) => {
                release = resolve;
            });
            const { result } = renderHook(() =>
                useHarness(doc, [engine.option], { rejectAnalysisOf: ids[2], rejectAfter }),
            );
            await act(async () => {
                await result.current.controller.startDeep(ids[2]);
            });
            await waitFor(() => expect(result.current.controller.mode).toBe("deep"));
            now += 3_000;
            act(() => {
                engine.emitInfo({ depth: 5, scoreCp: 300, multipv: 1, pv: ["2g2f"] });
                engine.finishRun(30_000);
            });
            await waitFor(() => expect(result.current.controller.mode).toBeNull());
            // 次の局面を始めてから、前の局面の保存が失敗する。
            await act(async () => {
                const starting = result.current.controller.startDeep(ids[3]);
                release();
                await starting;
            });
            await waitFor(() => expect(result.current.controller.live?.nodeId).toBe(ids[3]));
            expect(result.current.controller.mode).toBe("deep");
        } finally {
            clock.mockRestore();
        }
    });

    it("深く読んでいる途中に全体を解析すると、読みを止め終えてから全体の解析を始める", async () => {
        const { doc, ids } = createTestStudy();
        const engine = createResumableEngineOption();
        const { result } = renderHook(() => useHarness(doc, [engine.option]));
        await act(async () => {
            await result.current.controller.startDeep(ids[2]);
        });
        await waitFor(() => expect(result.current.controller.mode).toBe("deep"));
        await act(async () => {
            await result.current.controller.startFull();
        });
        await waitFor(() =>
            expect(result.current.startedLayers.some((key) => key.startsWith("full:"))).toBe(true),
        );
    });

    it("読みを止め終わるまでに別の中止があれば、全体の解析は始めない", async () => {
        const { doc, ids } = createTestStudy();
        const engine = createResumableEngineOption();
        const { result } = renderHook(() => useHarness(doc, [engine.option]));
        await act(async () => {
            await result.current.controller.startDeep(ids[2]);
        });
        await waitFor(() => expect(result.current.controller.mode).toBe("deep"));
        await act(async () => {
            const controller = result.current.controller;
            const starting = controller.startFull();
            void controller.cancel();
            await starting;
        });
        expect(result.current.startedLayers.some((key) => key.startsWith("full:"))).toBe(false);
        expect(result.current.controller.mode).toBeNull();
    });

    it("読みを止め終えるまでに画面で別の操作をしていたら、全体の解析は始めない", async () => {
        const { doc, ids } = createTestStudy();
        const engine = createResumableEngineOption();
        const { result } = renderHook(() => useHarness(doc, [engine.option]));
        await act(async () => {
            await result.current.controller.startDeep(ids[2]);
        });
        await waitFor(() => expect(result.current.controller.mode).toBe("deep"));
        await act(async () => {
            await result.current.controller.startFull({ isWanted: () => false });
        });
        expect(result.current.startedLayers.some((key) => key.startsWith("full:"))).toBe(false);
    });

    it("準備を待つ間に画面で別の操作をしていたら、全体の解析は始めない", async () => {
        const { doc } = createTestStudy();
        const engine = createEngineOption();
        const { result } = renderHook(() => useHarness(doc, [engine.option]));
        let wanted = true;
        await act(async () => {
            const starting = result.current.controller.startFull({
                onCommit: () => {
                    // 始めると決めたあと、準備を終える前に別の操作をした。
                    wanted = false;
                },
                isWanted: () => wanted,
            });
            await starting;
        });
        expect(result.current.startedLayers).toEqual([]);
        expect(engine.searches()).toBe(0);
        expect(result.current.controller.isPreparing).toBe(false);
    });

    it("始めるときの通知は、前の通知を消したあとに出す", async () => {
        const { doc, ids } = createTestStudy();
        const engine = createResumableEngineOption();
        const onMessage = vi.fn();
        const { result } = renderHook(() => useHarness(doc, [engine.option], { onMessage }));
        await act(async () => {
            await result.current.controller.startDeep(ids[2]);
        });
        await waitFor(() => expect(result.current.controller.mode).toBe("deep"));
        const notice = { text: "自動で読むを切りました", type: "warning" } as const;
        await act(async () => {
            await result.current.controller.startFull({ notice });
        });
        await waitFor(() =>
            expect(result.current.startedLayers.some((key) => key.startsWith("full:"))).toBe(true),
        );
        expect(onMessage).toHaveBeenLastCalledWith(notice);
    });

    it("読みを止め終えるまでに解析エンジンが変わったら、全体の解析は始めない", async () => {
        const { doc, ids } = createTestStudy();
        let release: () => void = () => {};
        const holdPause = new Promise<void>((resolve) => {
            release = resolve;
        });
        const engine = createResumableEngineOption(holdPause);
        const other = createEngineOption();
        const { result, rerender } = renderHook(
            ({ engines }: { engines: EngineOption[] }) => useHarness(doc, engines),
            { initialProps: { engines: [engine.option] } },
        );
        await act(async () => {
            await result.current.controller.startDeep(ids[2]);
        });
        await waitFor(() => expect(result.current.controller.mode).toBe("deep"));
        let starting: Promise<void> = Promise.resolve();
        const onNotStarted = vi.fn();
        act(() => {
            starting = result.current.controller.startFull({ onNotStarted });
        });
        rerender({ engines: [{ ...other.option, id: "other" }] });
        await act(async () => {
            release();
            await starting;
        });
        expect(result.current.startedLayers.some((key) => key.startsWith("full:"))).toBe(false);
        expect(other.searches()).toBe(0);
        // 自動で読むを切って始めようとしていたなら、画面が入れ直せるよう知らせる。
        expect(onNotStarted).toHaveBeenCalledTimes(1);
    });

    it("全体の解析の準備中に解析エンジンが変わったら、始めずに終わったと知らせる", async () => {
        const { doc } = createTestStudy();
        const engine = createEngineOption();
        const other = createEngineOption();
        const { result, rerender } = renderHook(
            ({ engines }: { engines: EngineOption[] }) => useHarness(doc, engines),
            { initialProps: { engines: [engine.option] } },
        );
        const onNotStarted = vi.fn();
        let starting: Promise<void> = Promise.resolve();
        act(() => {
            starting = result.current.controller.startFull({ onNotStarted });
        });
        rerender({ engines: [{ ...other.option, id: "other" }] });
        await act(async () => {
            await starting;
        });
        expect(engine.searches() + other.searches()).toBe(0);
        expect(onNotStarted).toHaveBeenCalledTimes(1);
    });

    it("別の局面を深く解析している途中に深く解析すると、前の読みを結果に残して切り替える", async () => {
        const { doc, ids } = createTestStudy();
        const engine = createResumableEngineOption();
        const { result } = renderHook(() => useHarness(doc, [engine.option]));

        await act(async () => {
            await result.current.controller.startDeep(ids[2]);
        });
        await waitFor(() => expect(result.current.controller.live?.nodeId).toBe(ids[2]));

        await act(async () => {
            await result.current.controller.startDeep(ids[3]);
        });
        await waitFor(() => expect(result.current.controller.live?.nodeId).toBe(ids[3]));
        expect(result.current.controller.mode).toBe("deep");
        expect(result.current.doc.layers[0].results[ids[2]].completion).toBe("aborted");
    });

    it("切り替えで前の読みを止め終わる前に中止したら、切り替え先の解析は始めない", async () => {
        const { doc, ids } = createTestStudy();
        const engine = createResumableEngineOption();
        const { result } = renderHook(() => useHarness(doc, [engine.option]));

        await act(async () => {
            await result.current.controller.startDeep(ids[2]);
        });
        await waitFor(() => expect(result.current.controller.live?.nodeId).toBe(ids[2]));

        await act(async () => {
            const switching = result.current.controller.startDeep(ids[3]);
            await result.current.controller.cancel();
            await switching;
        });
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(result.current.controller.mode).toBeNull();
        expect(result.current.controller.live).toBeNull();
    });

    it("続けて別の局面に切り替えると、最後に押した局面だけを解析し、その状態を消さない", async () => {
        const { doc, ids } = createTestStudy();
        const engine = createEngineOption(60_000, 40);
        const { result } = renderHook(() => useHarness(doc, [engine.option]));

        await act(async () => {
            await result.current.controller.startDeep(ids[1]);
        });
        await waitFor(() => expect(result.current.controller.live?.nodeId).toBe(ids[1]));

        await act(async () => {
            const toSecond = result.current.controller.startDeep(ids[2]);
            // 1 回目の停止が探索を止めている途中で、もう一度切り替える。
            await new Promise((resolve) => setTimeout(resolve, 10));
            const toThird = result.current.controller.startDeep(ids[3]);
            await Promise.all([toSecond, toThird]);
        });
        await waitFor(() => expect(result.current.controller.live?.nodeId).toBe(ids[3]));
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(result.current.controller.mode).toBe("deep");
        expect(result.current.controller.live?.nodeId).toBe(ids[3]);
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

    it("全体の解析は、最後まで読み終えた回だけ読み終えた回数に数える", async () => {
        const { doc } = createTestStudy();
        const engine = createEngineOption(50);
        const { result } = renderHook(() => useHarness(doc, [engine.option]));
        await act(async () => {
            await result.current.controller.startFull();
        });
        await waitFor(() => expect(result.current.controller.mode).toBe("full"));
        await act(async () => {
            await result.current.controller.cancel();
        });
        expect(result.current.controller.completedRuns).toBe(0);
        await act(async () => {
            await result.current.controller.startFull();
        });
        await waitFor(() => expect(result.current.controller.completedRuns).toBe(1));
    });

    it("読めなかった局面があった全体の解析は、最後まで進んでも読み終えた回数に数えない", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        const { doc } = createTestStudy();
        const engine = createEngineOption();
        // 最初の 1 局面の探索だけ失敗し、残りは読める。
        let failed = false;
        const failing: EngineOption = {
            ...engine.option,
            createClient: () => {
                const client = engine.option.createClient();
                return {
                    ...client,
                    search: (...args: Parameters<EngineClient["search"]>) => {
                        if (failed) return client.search(...args);
                        failed = true;
                        return Promise.reject(new Error("search failed"));
                    },
                };
            },
        };
        const { result } = renderHook(() => useHarness(doc, [failing]));
        await act(async () => {
            await result.current.controller.startFull();
        });
        await waitFor(() => expect(result.current.flushCount).toBe(1));
        expect(engine.searches()).toBe(4);
        expect(result.current.controller.completedRuns).toBe(0);
    });

    it("解析する局面が無くて全体の解析を始めなかったときは、始めるときの通知を消し、始めなかったと知らせる", async () => {
        const { doc } = createTestStudy();
        const engine = createEngineOption();
        const onMessage = vi.fn();
        const { result } = renderHook(() => useHarness(doc, [engine.option], { onMessage }));
        await act(async () => {
            await result.current.controller.startFull();
        });
        await waitFor(() => expect(result.current.flushCount).toBe(1));
        const onNotStarted = vi.fn();
        await act(async () => {
            await result.current.controller.startFull({
                notice: { text: "自動で読むを切りました", type: "warning" },
                onNotStarted,
            });
        });
        expect(onNotStarted).toHaveBeenCalledTimes(1);
        expect(onMessage).toHaveBeenLastCalledWith(null);
    });

    it("準備を待つ間に止めた深く解析は、始まったことにしない", async () => {
        const { doc, ids } = createTestStudy();
        const engine = createResumableEngineOption();
        let releaseInit: () => void = () => {};
        const initHeld = new Promise<void>((resolve) => {
            releaseInit = resolve;
        });
        const slow: EngineOption = {
            ...engine.option,
            createClient: () => ({
                ...engine.option.createClient(),
                init: vi.fn(() => initHeld),
            }),
        };
        const { result } = renderHook(() => useHarness(doc, [slow]));
        let starting: Promise<void> = Promise.resolve();
        act(() => {
            starting = result.current.controller.startDeep(ids[2]);
        });
        await waitFor(() => expect(result.current.controller.mode).toBe("deep"));
        let stopping: Promise<void> = Promise.resolve();
        act(() => {
            stopping = result.current.controller.cancel();
        });
        await act(async () => {
            releaseInit();
            await starting;
            await stopping;
        });
        expect(result.current.startedLayers).toEqual([]);
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
