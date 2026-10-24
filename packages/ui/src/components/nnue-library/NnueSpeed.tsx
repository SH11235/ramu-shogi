import {
    engineActivity,
    NNUE_SPEED_BENCHMARK_POSITIONS,
    nnueSpeedStore,
    runNnueSpeedBenchmark,
} from "@shogi/app-controller";
import type { NnueMeta, NnueSpeedRow } from "@shogi/app-core";
import {
    detectParallelism,
    formatNodesPerSecond,
    nnueSpeedRows,
    primaryNnueSpeed,
} from "@shogi/app-core";
import type { ReactElement } from "react";
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
 * AI の行に出す、この端末での速さ。普段は 1 行で、開くとスレッド数ごとの表を出す。
 */
export function NnueSpeedLine({
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
    const [isOpen, setIsOpen] = useState(false);
    const current = primaryNnueSpeed(rows.find((row) => row.threads === threads));
    const isRunningHere = state.phase === "running" && state.metaId === meta.id;
    const message = state.phase === "done" && state.metaId === meta.id ? state.message : null;
    const blockedReason =
        disabledReason ??
        (benchmark.isRunning
            ? "ほかの AI を測っています"
            : benchmark.isEngineBusy
              ? "対局・解析中は測れません"
              : undefined);

    if (isRunningHere && state.phase === "running") {
        const position = NNUE_SPEED_BENCHMARK_POSITIONS[state.index];
        return (
            <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                <span aria-live="polite">
                    速さを測っています…（{position?.label} {state.index + 1}/
                    {NNUE_SPEED_BENCHMARK_POSITIONS.length}）
                </span>
                <InlineButton onClick={benchmark.cancel}>やめる</InlineButton>
            </p>
        );
    }

    const measureButton = (label: string) => (
        <InlineButton
            onClick={() => void benchmark.start(meta)}
            disabled={blockedReason !== undefined}
            title={blockedReason ?? `${threads} スレッドで約 10 秒探索します`}
        >
            {label}
        </InlineButton>
    );

    // 括弧の中で折り返すと読みにくいので、括弧はひとかたまりで送る。
    const summary = current ? (
        <span>
            この端末で 約 {formatNodesPerSecond(current.nps)}局面/秒
            <span className="whitespace-nowrap">
                （{threads} スレッド・{current.source === "observed" ? "対局での実測" : "計測"}）
            </span>
        </span>
    ) : (
        <span>
            この端末での速さ: まだ測っていません
            <span className="whitespace-nowrap">（{threads} スレッド）</span>
        </span>
    );

    return (
        <div className="flex flex-col gap-1 text-xs text-muted-foreground">
            <p className="flex flex-wrap items-center gap-x-2">
                {summary}
                {!current && measureButton("測る")}
                {rows.length > 0 && (
                    <button
                        type="button"
                        aria-expanded={isOpen}
                        onClick={() => setIsOpen(!isOpen)}
                        className="underline underline-offset-2 hover:text-foreground"
                    >
                        {isOpen ? "閉じる" : "詳しく"}
                    </button>
                )}
            </p>
            {isOpen && rows.length > 0 && (
                <div className="flex flex-col items-start gap-2 pt-1">
                    <SpeedTable rows={rows} />
                    <p>
                        局面/秒は 1 秒あたりに読む局面の数。端末の混み具合で変わる参考値です。
                        {current && <> {measureButton(`${threads} スレッドで測り直す`)}</>}
                    </p>
                </div>
            )}
            {message && <p aria-live="polite">{message}</p>}
        </div>
    );
}

function SpeedTable({ rows }: { rows: NnueSpeedRow[] }): ReactElement {
    const cell = (nps: number | null, count?: number) =>
        nps === null
            ? "—"
            : `約 ${formatNodesPerSecond(nps)}${count !== undefined ? `・${count} 回` : ""}`;
    return (
        <table className="border-collapse text-left tabular-nums">
            <thead>
                <tr className="border-b border-border">
                    <th className="py-1 pr-4 font-normal">スレッド</th>
                    <th className="py-1 pr-4 font-normal">計測</th>
                    <th className="py-1 font-normal">対局での実測</th>
                </tr>
            </thead>
            <tbody>
                {rows.map((row) => (
                    <tr key={row.threads} className="text-foreground">
                        <td className="py-1 pr-4">{row.threads}</td>
                        <td className="py-1 pr-4">{cell(row.benchmarkNps)}</td>
                        <td className="py-1">{cell(row.observedNps, row.observedCount)}</td>
                    </tr>
                ))}
            </tbody>
        </table>
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
