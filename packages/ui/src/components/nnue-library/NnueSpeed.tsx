import {
    engineActivity,
    NNUE_SPEED_BENCHMARK_MS_PER_POSITION,
    NNUE_SPEED_BENCHMARK_POSITIONS,
    nnueSpeedStore,
    runNnueSpeedBenchmark,
} from "@shogi/app-controller";
import type { NnueMeta, NnueSpeedRow } from "@shogi/app-core";
import { detectParallelism, formatNodesPerSecond, nnueSpeedRows } from "@shogi/app-core";
import type { ReactElement } from "react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "../button";
import { NativeSelect } from "../native-select";
import { ENGINE_THREADS_STORAGE_KEY } from "../shogi-match/constants";
import type { NnueSpeedSupport } from "./types";

/**
 * 対局・解析のスレッド設定（先後で多いほう。解析エンジンと同じ決め方）を、エンジンの上限に丸めた数。
 * 0（自動）は推奨値にする。
 */
function readCurrentThreads(maxThreads: number | undefined): number {
    const resolve = (value: unknown) =>
        typeof value === "number" && Number.isFinite(value) && value > 0
            ? Math.trunc(value)
            : detectParallelism().recommendedWorkers;
    let stored: unknown = null;
    try {
        const raw = localStorage.getItem(ENGINE_THREADS_STORAGE_KEY);
        stored = raw ? JSON.parse(raw) : null;
    } catch {
        stored = null;
    }
    const threads =
        stored && typeof stored === "object"
            ? Math.max(
                  resolve((stored as { sente?: unknown }).sente),
                  resolve((stored as { gote?: unknown }).gote),
              )
            : resolve(stored);
    return Math.max(1, maxThreads !== undefined ? Math.min(threads, maxThreads) : threads);
}

/**
 * 表に出すスレッド数。1・上限の半分・上限を基本に、いまの設定と記録のある数を足す（重なりは 1 つに）。
 * 対局で使う数（いまの設定）の値が無いと、対局での実測と見比べられないので必ず入れる。
 */
export function speedTableThreads(
    threadCap: number,
    currentThreads: number,
    recorded: readonly number[],
): number[] {
    const cap = Math.max(1, threadCap);
    const threads = new Set([
        1,
        Math.max(1, Math.floor(cap / 2)),
        cap,
        currentThreads,
        ...recorded,
    ]);
    return [...threads].sort((a, b) => a - b);
}

type BenchmarkState =
    | { phase: "idle" }
    /** `index` が null のあいだは、評価関数を用意している（端末に無ければダウンロードしている） */
    | { phase: "running"; contentHash: string; threads: number; index: number | null }
    | { phase: "done"; contentHash: string; message: string | null };

interface BenchmarkTarget {
    contentHash: string;
    threads: number;
    /** 測る評価関数を用意する。用意できなければ undefined（理由は呼び出し側が出す） */
    prepare: () => Promise<NnueMeta | undefined>;
}

/** 「速さを測る」の進み具合。1 度に 1 つの AI・1 つのスレッド数だけ測る。 */
export function useNnueSpeedBenchmark(support: NnueSpeedSupport | undefined) {
    const [state, setState] = useState<BenchmarkState>({ phase: "idle" });
    const controllerRef = useRef<AbortController | null>(null);
    const abortReasonRef = useRef<string | null>(null);
    const activity = useSyncExternalStore(engineActivity.subscribe, engineActivity.getSnapshot);
    const [threadCap] = useState(
        () => support?.maxThreads ?? detectParallelism().detectedConcurrency,
    );
    const [currentThreads] = useState(() => readCurrentThreads(support?.maxThreads));

    const abort = (reason: string) => {
        if (!controllerRef.current) return;
        abortReasonRef.current = reason;
        controllerRef.current.abort();
    };

    // 画面を閉じたら測るのをやめる（計測のエンジンを残さない）。
    useEffect(() => () => controllerRef.current?.abort(), []);

    const start = async ({ contentHash, threads, prepare }: BenchmarkTarget) => {
        if (!support || controllerRef.current) return;
        const controller = new AbortController();
        controllerRef.current = controller;
        abortReasonRef.current = null;
        setState({ phase: "running", contentHash, threads, index: null });
        // 裏に回ったブラウザは探索を遅らせるので、測った値が低く出る。止めて捨てる。
        const onVisibilityChange = () => {
            if (document.visibilityState === "hidden") {
                abort("画面を離れたので、測るのをやめました。");
            }
        };
        document.addEventListener("visibilitychange", onVisibilityChange);
        let unsubscribeActivity = () => {};
        try {
            const meta = await prepare();
            if (!meta) {
                setState({ phase: "done", contentHash, message: null });
                return;
            }
            if (controller.signal.aborted) throw new Error("aborted");
            // 測っている途中で対局・解析が始まったら、互いに遅くなるので止める。待機しているだけの
            // エンジン（開く前からあったもの）は探索しないので数えない。増えるのは計測のエンジンの 1 つだけ。
            const liveBefore = engineActivity.getSnapshot().live;
            unsubscribeActivity = engineActivity.subscribe(() => {
                const { live, searching } = engineActivity.getSnapshot();
                if (live > liveBefore + 1 || searching > 1) {
                    abort("対局・解析が始まったので、測るのをやめました。");
                }
            });
            setState({ phase: "running", contentHash, threads, index: 0 });
            const result = await runNnueSpeedBenchmark({
                createClient: support.createBenchmarkClient,
                nnueId: meta.id,
                layerStacks: meta.layerStacks,
                fvScale: meta.fvScale,
                threads,
                signal: controller.signal,
                onProgress: (index) => setState({ phase: "running", contentHash, threads, index }),
            });
            nnueSpeedStore.setBenchmark(
                {
                    contentHash: meta.contentHashSha256,
                    threads: result.threads,
                    engineVersion: support.environment.engineVersion,
                    threaded: support.environment.threaded,
                },
                result.nps,
                Date.now(),
            );
            setState({ phase: "done", contentHash, message: null });
        } catch {
            setState({
                phase: "done",
                contentHash,
                message: controller.signal.aborted
                    ? abortReasonRef.current
                    : "測れませんでした。もう一度お試しください。",
            });
        } finally {
            document.removeEventListener("visibilitychange", onVisibilityChange);
            unsubscribeActivity();
            controllerRef.current = null;
        }
    };

    return {
        threadCap,
        currentThreads,
        state,
        isRunning: state.phase === "running",
        /** 探索中のエンジンがあるあいだは測らない */
        isEngineBusy: activity.searching > 0,
        start,
    };
}

type Benchmark = ReturnType<typeof useNnueSpeedBenchmark>;

/**
 * AI の行に出す、この端末での NPS。スレッド数を選んで測る欄（測り直しも同じ操作）を上に置き、
 * 記録が増えても押しやすいようにする。その下に、スレッド数ごとの計測と対局での実測を並べる。端末に無い AI も、測るときにダウンロードする
 * （`downloadNote` で通信量を知らせる）。
 */
export function NnueSpeedTable({
    contentHash,
    prepare,
    downloadNote,
    support,
    benchmark,
    disabledReason,
}: {
    contentHash: string;
    prepare: BenchmarkTarget["prepare"];
    downloadNote?: string;
    support: NnueSpeedSupport;
    benchmark: Benchmark;
    /** 測れない理由（対局中・ほかの処理中など） */
    disabledReason?: string;
}): ReactElement {
    const data = useSyncExternalStore(nnueSpeedStore.subscribe, nnueSpeedStore.getSnapshot);
    const rows = nnueSpeedRows(data, {
        contentHash,
        engineVersion: support.environment.engineVersion,
        threaded: support.environment.threaded,
    });
    const { state, threadCap } = benchmark;
    const [selectedThreads, setSelectedThreads] = useState(benchmark.currentThreads);
    const running = state.phase === "running" && state.contentHash === contentHash ? state : null;
    const tableRows: NnueSpeedRow[] = speedTableThreads(threadCap, benchmark.currentThreads, [
        ...rows.map((row) => row.threads),
        ...(running ? [running.threads] : []),
    ]).map(
        (threads) =>
            rows.find((row) => row.threads === threads) ?? {
                threads,
                benchmarkNps: null,
                observedNps: null,
                observedCount: 0,
            },
    );
    const totalSeconds =
        (NNUE_SPEED_BENCHMARK_POSITIONS.length * NNUE_SPEED_BENCHMARK_MS_PER_POSITION) / 1000;
    const message =
        state.phase === "done" && state.contentHash === contentHash ? state.message : null;
    const blockedReason =
        disabledReason ??
        (benchmark.isRunning
            ? "ほかの計測が終わってから測れます"
            : benchmark.isEngineBusy
              ? "対局・解析中は測れません"
              : undefined);
    // 局面ごとに決まった時間だけ読むので、残りの局面の数から残り時間が分かる。
    const progressLabel = !running
        ? null
        : running.index === null
          ? "準備中"
          : `あと約 ${
                ((NNUE_SPEED_BENCHMARK_POSITIONS.length - running.index) *
                    NNUE_SPEED_BENCHMARK_MS_PER_POSITION) /
                1000
            } 秒`;

    return (
        <div className="flex flex-col items-start gap-2 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
                <NativeSelect
                    aria-label="測るスレッド数"
                    value={selectedThreads}
                    onChange={(event) => setSelectedThreads(Number(event.target.value))}
                    disabled={running !== null}
                    // 表と同じ文字の大きさにする（指で操作する端末では、拡大を防ぐ共通の指定で 16px になる）
                    className="h-8 py-0 pl-2 pr-8 text-xs"
                >
                    {Array.from({ length: Math.max(1, threadCap) }, (_, index) => index + 1).map(
                        (threads) => (
                            <option key={threads} value={threads}>
                                {threads} スレッド
                            </option>
                        ),
                    )}
                </NativeSelect>
                <Button
                    size="sm"
                    variant="outline"
                    className="h-8 px-3 text-xs [@media(pointer:coarse)]:text-base"
                    disabled={running !== null || blockedReason !== undefined}
                    title={blockedReason ?? `約 ${totalSeconds} 秒読んで測ります`}
                    onClick={() =>
                        void benchmark.start({ contentHash, threads: selectedThreads, prepare })
                    }
                >
                    {progressLabel ?? "測る"}
                </Button>
            </div>
            <table className="w-fit border-collapse whitespace-nowrap text-left tabular-nums">
                <thead>
                    <tr className="border-b border-border">
                        <th className="py-1 pr-4 font-normal">スレッド数</th>
                        <th className="py-1 pr-4 font-normal">NPS</th>
                        <th className="py-1 font-normal">対局での実測</th>
                    </tr>
                </thead>
                <tbody>
                    {tableRows.map((row) => (
                        <tr key={row.threads} className="text-foreground">
                            <td className="py-1 pr-4">{row.threads}</td>
                            <td className="py-1 pr-4">
                                {running?.threads === row.threads
                                    ? "測定中"
                                    : row.benchmarkNps === null
                                      ? "—"
                                      : `約 ${formatNodesPerSecond(row.benchmarkNps)}`}
                            </td>
                            <td className="py-1">
                                {row.observedNps === null
                                    ? "—"
                                    : `約 ${formatNodesPerSecond(row.observedNps)}・${row.observedCount} 回`}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
            {downloadNote && !running && <p>{downloadNote}</p>}
            {message && <p aria-live="polite">{message}</p>}
        </div>
    );
}
