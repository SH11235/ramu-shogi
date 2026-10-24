import {
    engineActivity,
    NNUE_SPEED_BENCHMARK_POSITIONS,
    nnueSpeedStore,
    runNnueSpeedBenchmark,
} from "@shogi/app-controller";
import type { NnueMeta, NnueSpeedRow } from "@shogi/app-core";
import { detectParallelism, formatNodesPerSecond, nnueSpeedRows } from "@shogi/app-core";
import type { ReactElement, ReactNode } from "react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
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

type BenchmarkState =
    | { phase: "idle" }
    | { phase: "running"; metaId: string; index: number }
    | { phase: "done"; metaId: string; message: string | null };

/** 「速さを測る」の進み具合。1 度に 1 つの AI だけ測る。 */
export function useNnueSpeedBenchmark(support: NnueSpeedSupport | undefined) {
    const [state, setState] = useState<BenchmarkState>({ phase: "idle" });
    const controllerRef = useRef<AbortController | null>(null);
    const abortReasonRef = useRef<string | null>(null);
    const activity = useSyncExternalStore(engineActivity.subscribe, engineActivity.getSnapshot);
    const [threads] = useState(() => readCurrentThreads(support?.maxThreads));

    const abort = (reason: string | null) => {
        if (!controllerRef.current) return;
        abortReasonRef.current = reason;
        controllerRef.current.abort();
    };

    // 画面を閉じたら測るのをやめる（計測のエンジンを残さない）。
    useEffect(() => () => controllerRef.current?.abort(), []);

    const start = async (meta: NnueMeta) => {
        if (!support || controllerRef.current) return;
        const controller = new AbortController();
        controllerRef.current = controller;
        abortReasonRef.current = null;
        setState({ phase: "running", metaId: meta.id, index: 0 });
        // 裏に回ったブラウザは探索を遅らせるので、測った値が低く出る。止めて捨てる。
        const onVisibilityChange = () => {
            if (document.visibilityState === "hidden") {
                abort("画面を離れたので、測るのをやめました。");
            }
        };
        document.addEventListener("visibilitychange", onVisibilityChange);
        // 測っている途中で対局・解析が始まったら、互いに遅くなるので止める。待機しているだけの
        // エンジン（開く前からあったもの）は探索しないので数えない。増えるのは計測のエンジンの 1 つだけ。
        const liveBefore = engineActivity.getSnapshot().live;
        const unsubscribeActivity = engineActivity.subscribe(() => {
            const { live, searching } = engineActivity.getSnapshot();
            if (live > liveBefore + 1 || searching > 1) {
                abort("対局・解析が始まったので、測るのをやめました。");
            }
        });
        try {
            const result = await runNnueSpeedBenchmark({
                createClient: support.createBenchmarkClient,
                nnueId: meta.id,
                layerStacks: meta.layerStacks,
                fvScale: meta.fvScale,
                threads,
                signal: controller.signal,
                onProgress: (index) => setState({ phase: "running", metaId: meta.id, index }),
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
            setState({ phase: "done", metaId: meta.id, message: null });
        } catch {
            setState({
                phase: "done",
                metaId: meta.id,
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
        threads,
        state,
        isRunning: state.phase === "running",
        /** 探索中のエンジンがあるあいだは測らない */
        isEngineBusy: activity.searching > 0,
        start,
        cancel: () => abort(null),
    };
}

type Benchmark = ReturnType<typeof useNnueSpeedBenchmark>;

/**
 * AI の行に出す、この端末での NPS。スレッド数ごとに、計測と対局での実測を並べる。
 */
export function NnueSpeedTable({
    meta,
    support,
    benchmark,
    disabledReason,
}: {
    meta: NnueMeta;
    support: NnueSpeedSupport;
    benchmark: Benchmark;
    /** 測れない理由（対局中・ほかの処理中など） */
    disabledReason?: string;
}): ReactElement {
    const data = useSyncExternalStore(nnueSpeedStore.subscribe, nnueSpeedStore.getSnapshot);
    const rows = nnueSpeedRows(data, {
        contentHash: meta.contentHashSha256,
        engineVersion: support.environment.engineVersion,
        threaded: support.environment.threaded,
    });
    const { threads, state } = benchmark;
    // いまのスレッド数の行は、値が無くても出して「測る」を置く。ほかのスレッド数は値のある行だけ。
    const tableRows: NnueSpeedRow[] = rows.some((row) => row.threads === threads)
        ? rows
        : [...rows, { threads, benchmarkNps: null, observedNps: null, observedCount: 0 }].sort(
              (a, b) => a.threads - b.threads,
          );
    const isRunningHere = state.phase === "running" && state.metaId === meta.id;
    const message = state.phase === "done" && state.metaId === meta.id ? state.message : null;
    const blockedReason =
        disabledReason ??
        (benchmark.isRunning
            ? "ほかの AI を測っています"
            : benchmark.isEngineBusy
              ? "対局・解析中は測れません"
              : undefined);

    const benchmarkCell = (row: NnueSpeedRow): ReactNode => {
        if (row.threads === threads && isRunningHere && state.phase === "running") {
            return (
                <span className="flex items-center gap-x-1.5" aria-live="polite">
                    <span className="text-muted-foreground">
                        測定中 {state.index + 1}/{NNUE_SPEED_BENCHMARK_POSITIONS.length}
                    </span>
                    <InlineButton onClick={benchmark.cancel}>やめる</InlineButton>
                </span>
            );
        }
        if (row.benchmarkNps !== null) return `約 ${formatNodesPerSecond(row.benchmarkNps)}`;
        if (row.threads !== threads) return "—";
        return (
            <InlineButton
                onClick={() => void benchmark.start(meta)}
                disabled={blockedReason !== undefined}
                title={blockedReason ?? `${threads} スレッドで約 10 秒探索して測ります`}
            >
                測る
            </InlineButton>
        );
    };

    return (
        <div className="flex flex-col gap-1 text-xs text-muted-foreground">
            <table className="w-fit border-collapse whitespace-nowrap text-left tabular-nums">
                <caption className="pb-1 text-left whitespace-normal">
                    この端末での NPS
                    {tableRows.length > 1 && (
                        <span className="whitespace-nowrap">
                            （いまの設定は {threads} スレッド）
                        </span>
                    )}
                </caption>
                <thead>
                    <tr className="border-b border-border">
                        <th className="py-1 pr-3 font-normal">スレッド数</th>
                        <th className="py-1 pr-3 font-normal">計測</th>
                        <th className="py-1 font-normal">対局での実測</th>
                    </tr>
                </thead>
                <tbody>
                    {tableRows.map((row) => (
                        <tr key={row.threads} className="text-foreground">
                            <td className="py-1 pr-3">{row.threads}</td>
                            <td className="py-1 pr-3">{benchmarkCell(row)}</td>
                            <td className="py-1">
                                {row.observedNps === null
                                    ? "—"
                                    : `約 ${formatNodesPerSecond(row.observedNps)}・${row.observedCount} 回`}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
            {message && <p aria-live="polite">{message}</p>}
        </div>
    );
}

function InlineButton({
    onClick,
    disabled,
    title,
    children,
}: {
    onClick: () => void;
    disabled?: boolean;
    title?: string;
    children: string;
}): ReactElement {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            title={title}
            className="text-wafuu-ai underline underline-offset-2 hover:text-wafuu-ai-light disabled:cursor-not-allowed disabled:text-muted-foreground disabled:no-underline"
        >
            {children}
        </button>
    );
}
