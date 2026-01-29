import type {
    EngineClient,
    EngineEvent,
    SearchHandle,
    SearchLimits,
    ThreadInfo,
} from "@shogi/engine-client";
import type { ReactElement } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@shogi/design-system";
import { Button } from "./button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "./dialog";
import { Input } from "./input";

type PanelStatus = "idle" | "init" | "ready" | "searching" | "stopping" | "error";

type EngineLogEntry = {
    id: number;
    text: string;
    event: EngineEvent;
    timestamp: Date;
};

type LimitsFormState = {
    depth: string;
    nodes: string;
    byoyomi: string;
    movetime: string;
    ponder: boolean;
};

type UsiOptionType = "spin" | "check";

type UsiOptionDefinition = {
    name: string;
    type: UsiOptionType;
    defaultValue: number | boolean;
    min?: number;
    max?: number;
    note?: string;
};

type EnginePosition = {
    label?: string;
    sfen: string;
    moves?: string[];
};

interface EngineControlPanelProps {
    engine: EngineClient;
    position?: EnginePosition;
    triggerLabel?: string;
    maxLogs?: number;
}

const DEFAULT_POSITION: EnginePosition = { label: "開始局面 (startpos)", sfen: "startpos" };
const DEFAULT_LIMITS: LimitsFormState = {
    depth: "",
    nodes: "",
    byoyomi: "5000",
    movetime: "",
    ponder: false,
};
const DEFAULT_MAX_LOGS = 60;

const LIMIT_INPUT_IDS = {
    depth: "engine-limit-depth",
    byoyomi: "engine-limit-byoyomi",
    nodes: "engine-limit-nodes",
    movetime: "engine-limit-movetime",
    ponder: "engine-limit-ponder",
} as const;

const USI_OPTIONS: UsiOptionDefinition[] = [
    {
        name: "Threads",
        type: "spin",
        defaultValue: 1,
        min: 1,
        max: 4,
        note: "並列探索スレッド数 (次回init時に適用)",
    },
    { name: "USI_Hash", type: "spin", defaultValue: 256, min: 1, max: 4096 },
    { name: "USI_Ponder", type: "check", defaultValue: false },
    { name: "Stochastic_Ponder", type: "check", defaultValue: false },
    { name: "MultiPV", type: "spin", defaultValue: 1, min: 1, max: 500 },
    { name: "NetworkDelay", type: "spin", defaultValue: 120, min: 0, max: 10000 },
    { name: "NetworkDelay2", type: "spin", defaultValue: 1120, min: 0, max: 10000 },
    { name: "MinimumThinkingTime", type: "spin", defaultValue: 2000, min: 1000, max: 100000 },
    { name: "SlowMover", type: "spin", defaultValue: 100, min: 1, max: 1000 },
    { name: "MaxMovesToDraw", type: "spin", defaultValue: 100000, min: 0, max: 100000 },
    { name: "Skill Level", type: "spin", defaultValue: 20, min: 0, max: 20 },
    { name: "UCI_LimitStrength", type: "check", defaultValue: false },
    { name: "UCI_Elo", type: "spin", defaultValue: 0, min: 0, max: 4000 },
];

const surfaceClassName =
    "rounded-xl border border-border bg-card p-4 text-foreground shadow-[0_18px_38px_rgba(0,0,0,0.18)]";
const gridClassName = "grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(160px,1fr))]";
const labelClassName = "text-xs text-muted-foreground";
const inputClassName = "bg-background";

function formatEvent(event: EngineEvent): string {
    if (event.type === "bestmove") {
        return event.ponder
            ? `bestmove ${event.move} (ponder ${event.ponder})`
            : `bestmove ${event.move}`;
    }
    if (event.type === "info") {
        const score =
            event.scoreMate !== undefined
                ? `mate ${event.scoreMate}`
                : event.scoreCp !== undefined
                  ? `cp ${event.scoreCp}`
                  : "";
        const pv = event.pv && event.pv.length > 0 ? ` pv ${event.pv.join(" ")}` : "";
        return [
            `info depth ${event.depth ?? "-"}`,
            event.nodes !== undefined ? `nodes ${event.nodes}` : null,
            event.nps !== undefined ? `nps ${event.nps}` : null,
            score ? `score ${score}` : null,
            pv ? pv : null,
        ]
            .filter(Boolean)
            .join(" ");
    }
    return `error ${event.message}`;
}

function parseNumber(value: string): number | undefined {
    const num = Number.parseInt(value, 10);
    return Number.isFinite(num) ? num : undefined;
}

function buildLimits(state: LimitsFormState): SearchLimits {
    const limits: SearchLimits = {};
    const depth = parseNumber(state.depth);
    if (depth !== undefined) limits.maxDepth = depth;

    const nodes = parseNumber(state.nodes);
    if (nodes !== undefined) limits.nodes = nodes;

    const byoyomi = parseNumber(state.byoyomi);
    if (byoyomi !== undefined) limits.byoyomiMs = byoyomi;

    const movetime = parseNumber(state.movetime);
    if (movetime !== undefined) limits.movetimeMs = movetime;

    return limits;
}

function nextLogId(): number {
    return Date.now() + Math.random();
}

function normalizeOptionId(name: string): string {
    return `usi-option-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

export function EngineControlPanel({
    engine,
    position = DEFAULT_POSITION,
    triggerLabel = "エンジン操作パネル",
    maxLogs = DEFAULT_MAX_LOGS,
}: EngineControlPanelProps): ReactElement {
    const [open, setOpen] = useState(false);
    const [status, setStatus] = useState<PanelStatus>("idle");
    const [limits, setLimits] = useState<LimitsFormState>(DEFAULT_LIMITS);
    const [logs, setLogs] = useState<EngineLogEntry[]>([]);
    const [bestmove, setBestmove] = useState<string | null>(null);
    const [initialized, setInitialized] = useState(false);
    const [busy, setBusy] = useState(false);
    const [customOption, setCustomOption] = useState({ name: "", value: "" });
    const [threadInfo, setThreadInfo] = useState<ThreadInfo | null>(null);
    const [latestNps, setLatestNps] = useState<number | null>(null);
    const handleRef = useRef<SearchHandle | null>(null);

    const updateThreadInfo = useCallback(() => {
        if (engine.getThreadInfo) {
            setThreadInfo(engine.getThreadInfo());
        }
    }, [engine]);

    const optionDefaults = useMemo(() => {
        const defaults: Record<string, string> = {};
        for (const opt of USI_OPTIONS) {
            defaults[opt.name] = String(opt.defaultValue);
        }
        return defaults;
    }, []);
    const [optionValues, setOptionValues] = useState<Record<string, string>>(optionDefaults);

    useEffect(() => {
        setOptionValues(optionDefaults);
    }, [optionDefaults]);

    useEffect(() => {
        // Update thread info on mount and when engine changes
        updateThreadInfo();
    }, [updateThreadInfo]);

    useEffect(() => {
        const unsubscribe = engine.subscribe((event) => {
            setLogs((prev) => {
                const entry: EngineLogEntry = {
                    id: nextLogId(),
                    text: formatEvent(event),
                    event,
                    timestamp: new Date(),
                };
                const next = [entry, ...prev];
                if (next.length > maxLogs) {
                    return next.slice(0, maxLogs);
                }
                return next;
            });
            if (event.type === "info" && event.nps !== undefined) {
                setLatestNps(event.nps);
            }
            if (event.type === "bestmove") {
                setBestmove(event.move);
                setStatus("idle");
                handleRef.current = null;
            }
            if (event.type === "error") {
                setStatus("error");
            }
        });

        return () => {
            const handle = handleRef.current;
            if (handle) {
                handle.cancel().catch(() => undefined);
                handleRef.current = null;
            }
            unsubscribe();
        };
    }, [engine, maxLogs]);

    const pushUiError = (message: string) => {
        setLogs((prev) => {
            const entry: EngineLogEntry = {
                id: nextLogId(),
                text: `ui error: ${message}`,
                event: { type: "error", message },
                timestamp: new Date(),
            };
            const next = [entry, ...prev];
            return next.length > maxLogs ? next.slice(0, maxLogs) : next;
        });
        setStatus("error");
    };

    const ensureInitialized = async () => {
        if (initialized) return;
        setStatus("init");
        await engine.init();
        await engine.loadPosition(position.sfen, position.moves);
        setInitialized(true);
        setStatus("ready");
        // Update thread info after init
        updateThreadInfo();
    };

    const applyOptions = async (): Promise<boolean> => {
        let hadError = false;
        for (const opt of USI_OPTIONS) {
            const raw = optionValues[opt.name];
            if (raw === undefined || raw === "") continue;
            if (opt.type === "check") {
                const boolValue = raw === "true" || raw === "1" || raw === "on" || raw === "yes";
                await engine.setOption(opt.name, boolValue);
                continue;
            }
            const numValue = parseNumber(raw);
            if (numValue === undefined) {
                pushUiError(`${opt.name} に数値を入力してください`);
                hadError = true;
                continue;
            }
            await engine.setOption(opt.name, numValue);
        }

        if (customOption.name.trim() && customOption.value.trim()) {
            const valueText = customOption.value.trim();
            const numValue = parseNumber(valueText);
            const normalizedValue =
                valueText === "true" || valueText === "false"
                    ? valueText === "true"
                    : numValue !== undefined
                      ? numValue
                      : valueText;
            await engine.setOption(customOption.name.trim(), normalizedValue);
        }

        return !hadError;
    };

    const handleInitClick = async () => {
        if (busy) return;
        setBusy(true);
        try {
            await ensureInitialized();
        } catch (error) {
            pushUiError(String(error));
        } finally {
            setBusy(false);
        }
    };

    const handleStart = async () => {
        if (busy || status === "searching") return;
        setBusy(true);
        try {
            await ensureInitialized();
            const ok = await applyOptions();
            if (!ok) {
                return;
            }
            const searchLimits = buildLimits(limits);
            setStatus("searching");
            const handle = await engine.search({ limits: searchLimits, ponder: limits.ponder });
            handleRef.current = handle;
        } catch (error) {
            pushUiError(String(error));
        } finally {
            setBusy(false);
        }
    };

    const handleStop = async () => {
        if (busy) return;
        setBusy(true);
        setStatus("stopping");
        try {
            const handle = handleRef.current;
            if (handle) {
                await handle.cancel().catch(() => undefined);
                handleRef.current = null;
            }
            await engine.stop();
            setStatus("idle");
        } catch (error) {
            pushUiError(String(error));
        } finally {
            setBusy(false);
        }
    };

    const resetLogs = () => setLogs([]);

    const statusLabel =
        status === "idle"
            ? "待機中"
            : status === "init"
              ? "初期化中..."
              : status === "ready"
                ? "準備完了"
                : status === "searching"
                  ? "探索中..."
                  : status === "stopping"
                    ? "停止処理中..."
                    : "エラー";

    return (
        <div className="flex flex-col gap-2">
            <div className={cn(surfaceClassName, "flex items-center justify-between gap-3")}>
                <div>
                    <div className="mb-1 font-semibold">エンジン操作</div>
                    <div className="text-[13px] text-muted-foreground">
                        状態: {statusLabel} {bestmove ? `| 最終 bestmove: ${bestmove}` : ""}
                    </div>
                </div>
                <Dialog open={open} onOpenChange={setOpen}>
                    <DialogTrigger asChild>
                        <Button
                            type="button"
                            className="h-10 rounded-md bg-gradient-to-r from-primary to-accent px-3.5 text-primary-foreground"
                        >
                            {triggerLabel}
                        </Button>
                    </DialogTrigger>
                    <DialogContent
                        overlayClassName="bg-[rgba(8,10,20,0.58)]"
                        className="w-[min(1040px,calc(100%-24px))]"
                    >
                        <DialogHeader>
                            <DialogTitle>エンジン操作パネル</DialogTitle>
                            <DialogDescription>
                                Web / Desktop 共通の操作モーダル。USI オプションは engine-usi
                                の定義に合わせています。
                            </DialogDescription>
                        </DialogHeader>

                        <div className="flex flex-col gap-4">
                            <section className={cn(surfaceClassName, "p-3")}>
                                <div className="flex justify-between gap-3">
                                    <div>
                                        <div className="font-semibold">接続・初期化</div>
                                        <div className="text-[13px] text-muted-foreground">
                                            状態: {statusLabel}
                                        </div>
                                        <div className="text-xs text-muted-foreground">
                                            局面: {position.label ?? position.sfen}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Button
                                            type="button"
                                            onClick={handleInitClick}
                                            disabled={busy || status === "init"}
                                            className="px-3"
                                        >
                                            init
                                        </Button>
                                        <Button
                                            type="button"
                                            onClick={resetLogs}
                                            disabled={logs.length === 0}
                                            variant="secondary"
                                            className="px-3"
                                        >
                                            ログクリア
                                        </Button>
                                    </div>
                                </div>
                            </section>

                            <section
                                className={cn(
                                    surfaceClassName,
                                    "p-3 bg-[linear-gradient(135deg,hsl(var(--card,0_0%_100%)),hsl(210_40%_98%))]",
                                )}
                            >
                                <div className="mb-2 font-semibold">デバッグ情報 (開発者向け)</div>
                                <div className="grid gap-2 text-xs [grid-template-columns:repeat(auto-fit,minmax(140px,1fr))]">
                                    <div className="rounded-md border border-border bg-background p-2">
                                        <div className={labelClassName}>アクティブスレッド</div>
                                        <div
                                            className={cn(
                                                "text-base font-semibold",
                                                threadInfo && threadInfo.activeThreads > 1
                                                    ? "text-[hsl(var(--success,142_76%_36%))]"
                                                    : "text-foreground",
                                            )}
                                        >
                                            {threadInfo?.activeThreads ?? "-"}
                                        </div>
                                    </div>
                                    <div className="rounded-md border border-border bg-background p-2">
                                        <div className={labelClassName}>最大スレッド</div>
                                        <div className="text-base font-semibold">
                                            {threadInfo?.maxThreads ?? "-"}
                                        </div>
                                    </div>
                                    <div className="rounded-md border border-border bg-background p-2">
                                        <div className={labelClassName}>ハードウェア並列数</div>
                                        <div className="text-base font-semibold">
                                            {threadInfo?.hardwareConcurrency ?? "-"}
                                        </div>
                                    </div>
                                    <div className="rounded-md border border-border bg-background p-2">
                                        <div className={labelClassName}>スレッド利用可能</div>
                                        <div
                                            className={cn(
                                                "text-sm font-semibold",
                                                threadInfo?.threadedAvailable
                                                    ? "text-[hsl(var(--success,142_76%_36%))]"
                                                    : "text-[hsl(0_72%_51%)]",
                                            )}
                                        >
                                            {threadInfo?.threadedAvailable ? "Yes" : "No"}
                                        </div>
                                    </div>
                                    <div className="rounded-md border border-border bg-background p-2">
                                        <div className={labelClassName}>最新 NPS</div>
                                        <div className="text-base font-semibold">
                                            {latestNps !== null ? latestNps.toLocaleString() : "-"}
                                        </div>
                                    </div>
                                    <div className="rounded-md border border-border bg-background p-2">
                                        <div className={labelClassName}>crossOriginIsolated</div>
                                        <div
                                            className={cn(
                                                "text-sm font-semibold",
                                                typeof crossOriginIsolated !== "undefined" &&
                                                    crossOriginIsolated
                                                    ? "text-[hsl(var(--success,142_76%_36%))]"
                                                    : "text-[hsl(0_72%_51%)]",
                                            )}
                                        >
                                            {typeof crossOriginIsolated !== "undefined"
                                                ? crossOriginIsolated
                                                    ? "true"
                                                    : "false"
                                                : "N/A"}
                                        </div>
                                    </div>
                                </div>
                                <div className="mt-2 text-[11px] text-muted-foreground">
                                    スレッド利用には crossOriginIsolated=true と SharedArrayBuffer
                                    が必要です
                                </div>
                            </section>

                            <section className={surfaceClassName}>
                                <div className="mb-2 font-semibold">探索パラメータ</div>
                                <div className={gridClassName}>
                                    <label
                                        htmlFor={LIMIT_INPUT_IDS.depth}
                                        className="flex flex-col gap-1"
                                    >
                                        <span className={labelClassName}>depth</span>
                                        <Input
                                            id={LIMIT_INPUT_IDS.depth}
                                            type="number"
                                            min={1}
                                            value={limits.depth}
                                            onChange={(e) =>
                                                setLimits({ ...limits, depth: e.target.value })
                                            }
                                            placeholder="例: 12"
                                            className={inputClassName}
                                        />
                                    </label>
                                    <label
                                        htmlFor={LIMIT_INPUT_IDS.byoyomi}
                                        className="flex flex-col gap-1"
                                    >
                                        <span className={labelClassName}>byoyomi (ms)</span>
                                        <Input
                                            id={LIMIT_INPUT_IDS.byoyomi}
                                            type="number"
                                            min={0}
                                            value={limits.byoyomi}
                                            onChange={(e) =>
                                                setLimits({ ...limits, byoyomi: e.target.value })
                                            }
                                            placeholder="例: 5000"
                                            className={inputClassName}
                                        />
                                    </label>
                                    <label
                                        htmlFor={LIMIT_INPUT_IDS.nodes}
                                        className="flex flex-col gap-1"
                                    >
                                        <span className={labelClassName}>nodes</span>
                                        <Input
                                            id={LIMIT_INPUT_IDS.nodes}
                                            type="number"
                                            min={0}
                                            value={limits.nodes}
                                            onChange={(e) =>
                                                setLimits({ ...limits, nodes: e.target.value })
                                            }
                                            placeholder="例: 100000"
                                            className={inputClassName}
                                        />
                                    </label>
                                    <label
                                        htmlFor={LIMIT_INPUT_IDS.movetime}
                                        className="flex flex-col gap-1"
                                    >
                                        <span className={labelClassName}>movetime (ms)</span>
                                        <Input
                                            id={LIMIT_INPUT_IDS.movetime}
                                            type="number"
                                            min={0}
                                            value={limits.movetime}
                                            onChange={(e) =>
                                                setLimits({ ...limits, movetime: e.target.value })
                                            }
                                            placeholder="例: 1000"
                                            className={inputClassName}
                                        />
                                    </label>
                                </div>
                                <label
                                    htmlFor={LIMIT_INPUT_IDS.ponder}
                                    className="mt-2 flex items-center gap-2"
                                >
                                    <input
                                        id={LIMIT_INPUT_IDS.ponder}
                                        type="checkbox"
                                        checked={limits.ponder}
                                        onChange={(e) =>
                                            setLimits({ ...limits, ponder: e.target.checked })
                                        }
                                    />
                                    <span className="text-[13px]">ponder を有効化</span>
                                </label>
                            </section>

                            <section className={surfaceClassName}>
                                <div className="mb-2 font-semibold">USI オプション</div>
                                <div className={gridClassName}>
                                    {USI_OPTIONS.map((opt) => (
                                        <div key={opt.name} className="flex flex-col gap-1">
                                            <label
                                                htmlFor={normalizeOptionId(opt.name)}
                                                className="text-[13px] font-semibold"
                                            >
                                                {opt.name}
                                            </label>
                                            <span className={labelClassName}>
                                                default {String(opt.defaultValue)}
                                                {opt.min !== undefined ? ` | min ${opt.min}` : ""}{" "}
                                                {opt.max !== undefined ? `| max ${opt.max}` : ""}
                                            </span>
                                            {opt.type === "check" ? (
                                                <div className="flex items-center gap-2">
                                                    <input
                                                        id={normalizeOptionId(opt.name)}
                                                        type="checkbox"
                                                        checked={optionValues[opt.name] === "true"}
                                                        onChange={(e) =>
                                                            setOptionValues({
                                                                ...optionValues,
                                                                [opt.name]: e.target.checked
                                                                    ? "true"
                                                                    : "false",
                                                            })
                                                        }
                                                    />
                                                    <span className="text-[13px]">ON / OFF</span>
                                                </div>
                                            ) : (
                                                <Input
                                                    id={normalizeOptionId(opt.name)}
                                                    type="number"
                                                    value={optionValues[opt.name] ?? ""}
                                                    min={opt.min}
                                                    max={opt.max}
                                                    onChange={(e) =>
                                                        setOptionValues({
                                                            ...optionValues,
                                                            [opt.name]: e.target.value,
                                                        })
                                                    }
                                                    className={inputClassName}
                                                />
                                            )}
                                            {opt.note ? (
                                                <span className={labelClassName}>{opt.note}</span>
                                            ) : null}
                                        </div>
                                    ))}
                                </div>
                                <div className="mt-3 font-semibold">カスタム setoption</div>
                                <div className="mt-1.5 grid gap-2 [grid-template-columns:1.2fr_1fr]">
                                    <Input
                                        placeholder="name"
                                        value={customOption.name}
                                        onChange={(e) =>
                                            setCustomOption({
                                                ...customOption,
                                                name: e.target.value,
                                            })
                                        }
                                        className={inputClassName}
                                    />
                                    <Input
                                        placeholder="value"
                                        value={customOption.value}
                                        onChange={(e) =>
                                            setCustomOption({
                                                ...customOption,
                                                value: e.target.value,
                                            })
                                        }
                                        className={inputClassName}
                                    />
                                </div>
                                <div className="mt-1 text-xs text-muted-foreground">
                                    追加の USI オプションを送る場合に使用します（型は自動推定）。
                                </div>
                            </section>

                            <section className={cn(surfaceClassName, "flex justify-end gap-2")}>
                                <Button
                                    type="button"
                                    onClick={handleStart}
                                    disabled={status === "searching" || busy}
                                    className="min-w-[140px] px-3.5"
                                >
                                    {status === "searching" ? "探索中…" : "search / start"}
                                </Button>
                                <Button
                                    type="button"
                                    onClick={handleStop}
                                    disabled={busy || status === "idle"}
                                    variant="secondary"
                                    className="min-w-[120px] px-3"
                                >
                                    stop
                                </Button>
                            </section>

                            <section
                                className={cn(surfaceClassName, "max-h-[280px] overflow-auto")}
                            >
                                <div className="flex items-center justify-between">
                                    <div className="font-semibold">ログ (最新が上)</div>
                                    <span className="text-xs text-muted-foreground">
                                        最大 {maxLogs} 件を保持
                                    </span>
                                </div>
                                <ul className="mt-2.5 flex flex-col gap-1.5">
                                    {logs.map((log) => (
                                        <li
                                            key={log.id}
                                            className="rounded-md border border-border bg-muted px-2.5 py-2"
                                        >
                                            <div className="mb-0.5 text-[11px] text-muted-foreground">
                                                {log.timestamp.toLocaleTimeString()}
                                            </div>
                                            <div className="font-mono text-[13px]">{log.text}</div>
                                        </li>
                                    ))}
                                </ul>
                            </section>
                        </div>
                    </DialogContent>
                </Dialog>
            </div>
        </div>
    );
}
