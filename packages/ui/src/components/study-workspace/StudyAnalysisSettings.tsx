/**
 * 解析の設定。
 *
 * 表示する解析結果の切り替え（内部でいう「解析レイヤー」）と、解析ごとの設定を 1 か所にまとめる。
 * 画面には「レイヤー」という語を出さず、「RAMU・1 秒」のように中身で見せる。
 * 項目は効く解析ごとに段を分ける（全体の解析・この局面の読み・詰み探索）。使う AI だけは共通なので
 * 先頭に置き、効く解析を印で添える。設定の値と保存先は既存の検討モードと共通。
 */

import { detectParallelism, type StudyDocument } from "@shogi/app-core";
import { cn } from "@shogi/design-system";
import type { ReactElement, ReactNode } from "react";
import { useId } from "react";
import { Button } from "../button";
import { ChoiceGroup } from "../choice-group";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../dialog";
import { NativeSelect } from "../native-select";
import { BatchParallelismSelect } from "../shogi-match/components/BatchParallelismSelect";
import { BottomSheet } from "../shogi-match/components/BottomSheet";
import {
    buildNnueOptions,
    parseNnueSelectionValue,
    toNnueSelectionValue,
    toOptionValue,
} from "../shogi-match/utils/nnueSelectionUtils";
import {
    ANALYSIS_TIME_OPTIONS,
    buildThreadOptions,
    clampThreads,
    PARALLEL_WORKER_OPTIONS,
    resolveBatchWorkerCount,
    resolveThreadCount,
} from "../shogi-match/utils/threadOptions";
import { countStudyLayerResults } from "./studyView";
import type { StudyAnalysisSettingsForm } from "./useStudyAnalysis";
import { STUDY_MATE_TIME_MS, STUDY_SHORTEST_MATE_TIME_MS } from "./useStudyMate";

interface StudyAnalysisSettingsProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    isMobile: boolean;
    doc: StudyDocument;
    displayLayerId: string | null;
    onDisplayLayerChange: (layerId: string) => void;
    form: StudyAnalysisSettingsForm;
    /** いまの設定で解析したときの表示名。 */
    settingsLabel: string;
    /** 解析を始められるか（実行中・準備中は false）。 */
    canStart: boolean;
    onStartFull: () => void;
    onOpenNnueLibrary?: () => void;
    /** 詰み探索を使えるエンジンがあるか。無ければ詰み探索の段を出さない。 */
    mateSupported?: boolean;
    /** この局面を読んでいる途中か（変えた値が、いまの読みには効かないことを知らせる）。 */
    deepReading?: boolean;
}

const MULTI_PV_OPTIONS = [1, 2, 3, 4, 5].map((count) => ({ value: count, label: count }));

const formatLimit = (ms: number): string =>
    ms >= 60_000 ? `${ms / 60_000} 分` : `${ms / 1_000} 秒`;

/** 効く解析の印。`off` は、その解析には効かないことを示す（打ち消し線）。 */
function UsedBy({ items }: { items: { label: string; off?: boolean }[] }): ReactElement {
    return (
        <ul aria-label="効く解析" className="flex flex-wrap gap-1">
            {items.map((item) => (
                <li
                    key={item.label}
                    className={cn(
                        "rounded-full border border-border bg-wafuu-washi px-2 text-[11px] text-wafuu-sumi-light",
                        item.off && "text-muted-foreground line-through opacity-75",
                    )}
                >
                    {item.off ? <span className="sr-only">効かない: </span> : null}
                    {item.label}
                </li>
            ))}
        </ul>
    );
}

function Section({
    title,
    description,
    children,
}: {
    title: string;
    description: string;
    children: ReactNode;
}): ReactElement {
    const titleId = useId();
    return (
        <section
            aria-labelledby={titleId}
            className="flex flex-col gap-3 border-t border-border pt-4"
        >
            <div className="flex flex-col">
                <h3 id={titleId} className="text-sm font-medium text-wafuu-sumi">
                    {title}
                </h3>
                <p className="text-xs text-muted-foreground">{description}</p>
            </div>
            {children}
        </section>
    );
}

function FieldLabel({ label, defaultText }: { label: string; defaultText?: string }): ReactElement {
    return (
        <legend className="flex items-baseline gap-1.5 pb-1 text-xs text-muted-foreground">
            {label}
            {defaultText && (
                <span className="text-[11px] text-wafuu-sumi-light">{defaultText}</span>
            )}
        </legend>
    );
}

function SettingsBody({
    doc,
    displayLayerId,
    onDisplayLayerChange,
    form,
    settingsLabel,
    canStart,
    onStartFull,
    onOpenChange,
    onOpenNnueLibrary,
    mateSupported = false,
    deepReading = false,
}: Omit<StudyAnalysisSettingsProps, "open" | "isMobile">): ReactElement {
    const nnueOptions = buildNnueOptions({
        presets: form.presets,
        nnueList: form.nnueList,
        isNnueListLoading: form.isNnueListLoading,
    });
    const isExternalEngine =
        form.engines.find((engine) => engine.id === form.engineId)?.kind === "external";
    // 保存してある数がエンジンの上限を超えているときは、実際に使う数（上限）を選んだものとして見せる。
    const shownParallelWorkers =
        form.maxParallel === null
            ? form.settings.parallelWorkers
            : Math.min(form.settings.parallelWorkers, form.maxParallel);
    const maxThreads = form.maxThreads ?? undefined;
    const threadOptions = buildThreadOptions({ maxThreads, compact: true });
    // 全体の解析は局面ごとに並べて読むので、「自動」は使わず、1 局面あたりの数を選ぶ。
    const batchThreadOptions = threadOptions.filter((option) => option.value !== 0);
    const batchThreads = clampThreads(form.settings.batchAnalysisThreads, maxThreads);
    const showParallel = form.nativeBatchParallelism !== undefined || form.maxParallel !== 1;
    const workers = resolveBatchWorkerCount(
        form.settings.parallelWorkers,
        form.nativeBatchParallelism,
        form.maxParallel ?? undefined,
    );
    const deepThreads = resolveThreadCount(form.settings.deepAnalysisThreads, maxThreads);
    // 端末の上限で選択肢が減っているときだけ、その理由を書く（Web の wasm はコア数・メモリで上限がある）。
    const threadCapNote =
        maxThreads === undefined
            ? null
            : maxThreads <= 1
              ? "このブラウザでは 1 スレッドで読みます。"
              : maxThreads < detectParallelism().detectedConcurrency
                ? `この端末では ${maxThreads} スレッドまで使えます。`
                : null;
    const set = (patch: Partial<StudyAnalysisSettingsForm["settings"]>): void =>
        form.onSettingsChange({ ...form.settings, ...patch });
    return (
        <div className="flex flex-col gap-4">
            {doc.layers.length > 0 && (
                <fieldset className="flex flex-col gap-2">
                    <legend className="pb-2 text-sm font-medium text-wafuu-sumi">
                        表示する解析結果
                    </legend>
                    {doc.layers.map((layer) => {
                        const selected = layer.id === displayLayerId;
                        return (
                            <label
                                key={layer.id}
                                className={cn(
                                    "flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm",
                                    // 選んでいる項目は墨で示す（朱・藍は先手・後手の色に取っておく）。
                                    selected
                                        ? "border-wafuu-sumi bg-wafuu-washi-warm ring-1 ring-inset ring-wafuu-sumi"
                                        : "border-border hover:bg-wafuu-washi-warm",
                                )}
                            >
                                <input
                                    type="radio"
                                    name="study-display-layer"
                                    className="accent-wafuu-sumi"
                                    checked={selected}
                                    onChange={() => onDisplayLayerChange(layer.id)}
                                />
                                <span className="min-w-0 flex-1 truncate text-wafuu-sumi">
                                    {layer.display.label}
                                </span>
                                <span className="shrink-0 text-xs text-muted-foreground">
                                    {countStudyLayerResults(doc, layer)} 局面
                                </span>
                            </label>
                        );
                    })}
                </fieldset>
            )}

            <div
                className={cn(
                    "flex flex-col gap-3",
                    doc.layers.length > 0 && "border-t border-border pt-4",
                )}
            >
                {form.engines.length > 1 && (
                    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                        解析エンジン
                        <NativeSelect
                            value={form.engineId}
                            // 解析の準備中・実行中は切り替えさせない（切り替えると、その解析は止まる）。
                            disabled={!canStart}
                            onChange={(event) => form.onEngineIdChange(event.target.value)}
                            className="text-sm"
                        >
                            {form.engines.map((engine) => (
                                <option key={engine.id} value={engine.id}>
                                    {engine.label}
                                </option>
                            ))}
                        </NativeSelect>
                    </label>
                )}
                {isExternalEngine ? (
                    <p className="text-xs text-muted-foreground">
                        外部エンジンは、そのエンジンに設定されている
                        AI（評価関数）で解析します。結果は、エンジンの名前で残ります。
                    </p>
                ) : (
                    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                        使う AI
                        <NativeSelect
                            value={toNnueSelectionValue(form.nnueSelection)}
                            // 解析エンジンと同じく、解析の準備中・実行中は切り替えさせない。
                            disabled={!canStart}
                            onChange={(event) =>
                                form.onNnueSelectionChange(
                                    parseNnueSelectionValue(event.target.value),
                                )
                            }
                            className="text-sm"
                        >
                            <option value="material">簡易AI（駒得）</option>
                            {nnueOptions.map((option) => (
                                <option key={toOptionValue(option)} value={toOptionValue(option)}>
                                    {option.label}
                                </option>
                            ))}
                        </NativeSelect>
                    </label>
                )}
                <UsedBy
                    items={[
                        { label: "全体の解析" },
                        { label: "この局面の読み" },
                        ...(mateSupported ? [{ label: "詰み探索", off: true }] : []),
                    ]}
                />
                {!isExternalEngine && onOpenNnueLibrary && (
                    <button
                        type="button"
                        onClick={onOpenNnueLibrary}
                        className="self-start text-xs text-wafuu-ai underline underline-offset-2 hover:text-wafuu-ai-light"
                    >
                        自分の評価関数（NNUE）を追加する
                    </button>
                )}
            </div>

            <Section
                title="全体の解析"
                description="棋譜のすべての局面を、決めた時間ずつ読みます。"
            >
                <fieldset className="flex flex-col">
                    <FieldLabel label="1 局面あたりの時間" />
                    <ChoiceGroup
                        options={ANALYSIS_TIME_OPTIONS}
                        value={form.settings.batchAnalysisTimeMs}
                        onChange={(batchAnalysisTimeMs) => set({ batchAnalysisTimeMs })}
                        size="sm"
                    />
                </fieldset>
                <fieldset className="flex flex-col">
                    <FieldLabel label="候補手の数" defaultText="既定 1" />
                    <ChoiceGroup
                        options={MULTI_PV_OPTIONS}
                        value={form.settings.multiPv}
                        onChange={(multiPv) => set({ multiPv })}
                        size="sm"
                    />
                </fieldset>
                {showParallel && (
                    <fieldset className="flex flex-col">
                        <FieldLabel label="同時に解析する局面の数" />
                        {form.nativeBatchParallelism !== undefined ? (
                            <BatchParallelismSelect
                                limit={form.nativeBatchParallelism}
                                value={form.settings.parallelWorkers}
                                onChange={(parallelWorkers) => set({ parallelWorkers })}
                            />
                        ) : (
                            <ChoiceGroup
                                options={PARALLEL_WORKER_OPTIONS.filter(
                                    (option) =>
                                        form.maxParallel === null ||
                                        option.value <= form.maxParallel,
                                ).map((option) => ({
                                    value: option.value,
                                    label:
                                        option.value === 0
                                            ? `自動（${resolveBatchWorkerCount(0, undefined, form.maxParallel ?? undefined)}）`
                                            : option.label,
                                }))}
                                value={shownParallelWorkers}
                                onChange={(parallelWorkers) => set({ parallelWorkers })}
                                size="sm"
                            />
                        )}
                    </fieldset>
                )}
                <label className="flex items-center justify-between gap-3 text-sm text-wafuu-sumi">
                    <span>
                        スレッド数
                        <span className="ml-1 text-xs text-muted-foreground">1 局面あたり</span>
                    </span>
                    <NativeSelect
                        value={String(batchThreads)}
                        disabled={batchThreadOptions.length <= 1}
                        onChange={(event) =>
                            set({ batchAnalysisThreads: Number(event.target.value) })
                        }
                        className="w-32 text-sm"
                    >
                        {batchThreadOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                                {option.label}
                            </option>
                        ))}
                    </NativeSelect>
                </label>
                {showParallel && (
                    <p className="text-xs text-muted-foreground">
                        同時に {workers} 局面 × {batchThreads} スレッドで、多いときは合わせて{" "}
                        {workers * batchThreads} スレッドを使います。
                    </p>
                )}
                <p className="text-xs text-muted-foreground">
                    AI・時間・候補手の数のどれかを変えると、結果は別の解析結果として残り、あとから切り替えて見られます。
                </p>
                <Button
                    type="button"
                    disabled={!canStart}
                    onClick={() => {
                        onOpenChange(false);
                        onStartFull();
                    }}
                >
                    {settingsLabel}で全体を解析
                </Button>
            </Section>

            <Section
                title="この局面の読み"
                description="読み方の「読む」「パス」。決めた時間で止めずに、深く読みます。"
            >
                <fieldset className="flex flex-col">
                    <FieldLabel label="候補手の数" defaultText="既定 3" />
                    <ChoiceGroup
                        options={MULTI_PV_OPTIONS}
                        value={form.settings.deepMultiPv}
                        onChange={(deepMultiPv) => set({ deepMultiPv })}
                        size="sm"
                    />
                    <p className="pt-1 text-xs text-muted-foreground">
                        多いほど 2 番目以降の手も確かめられ、同じ時間で読める深さは浅くなります。
                    </p>
                </fieldset>
                <label className="flex items-center justify-between gap-3 text-sm text-wafuu-sumi">
                    スレッド数
                    <NativeSelect
                        value={String(clampThreads(form.settings.deepAnalysisThreads, maxThreads))}
                        disabled={threadOptions.length <= 2}
                        onChange={(event) =>
                            set({ deepAnalysisThreads: Number(event.target.value) })
                        }
                        className="w-32 text-sm"
                    >
                        {threadOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                                {option.label}
                            </option>
                        ))}
                    </NativeSelect>
                </label>
                {threadCapNote && <p className="text-xs text-muted-foreground">{threadCapNote}</p>}
                {deepReading && (
                    <p className="text-xs text-status-warning">
                        いま読んでいる局面には効きません。次に読み始めるときから使います。
                    </p>
                )}
            </Section>

            {mateSupported && (
                <Section
                    title="詰み探索"
                    description="詰みと最短手順を調べます。AI（評価関数）は使いません。"
                >
                    <dl className="flex flex-col gap-1 text-sm text-wafuu-sumi">
                        <div className="flex justify-between gap-3">
                            <dt>スレッド数</dt>
                            <dd className="tabular-nums text-wafuu-sumi-light">
                                この局面の読みと同じ（{deepThreads}）
                            </dd>
                        </div>
                        <div className="flex justify-between gap-3">
                            <dt>調べる時間</dt>
                            <dd className="tabular-nums text-wafuu-sumi-light">
                                {formatLimit(STUDY_MATE_TIME_MS)}まで・最短手順は{" "}
                                {formatLimit(STUDY_SHORTEST_MATE_TIME_MS)}まで
                            </dd>
                        </div>
                    </dl>
                </Section>
            )}
        </div>
    );
}

export function StudyAnalysisSettings({
    open,
    onOpenChange,
    ...props
}: StudyAnalysisSettingsProps): ReactElement {
    if (props.isMobile) {
        return (
            <BottomSheet
                open={open}
                onOpenChange={onOpenChange}
                title="解析の設定"
                description="使う AI と、解析ごとの読み方を決めます。"
                height="auto"
            >
                <SettingsBody onOpenChange={onOpenChange} {...props} />
            </BottomSheet>
        );
    }
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="w-[min(440px,calc(100%-24px))]" hasDescription>
                <div className="flex flex-col gap-4">
                    <DialogHeader>
                        <DialogTitle>解析の設定</DialogTitle>
                        <DialogDescription>
                            使う AI と、解析ごとの読み方を決めます。
                        </DialogDescription>
                    </DialogHeader>
                    <SettingsBody onOpenChange={onOpenChange} {...props} />
                </div>
            </DialogContent>
        </Dialog>
    );
}
