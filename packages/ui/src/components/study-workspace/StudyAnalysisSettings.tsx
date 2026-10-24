/**
 * 解析の設定。
 *
 * 表示する解析結果の切り替え（内部でいう「解析レイヤー」）と、設定を変えた解析の開始を
 * 1 か所にまとめる。画面には「レイヤー」という語を出さず、「RAMU・1 秒」のように中身で見せる。
 * 設定の値と保存先は既存の検討モードと共通（時間・候補手の数・使う AI）。
 */

import { resolveWorkerCount, type StudyDocument } from "@shogi/app-core";
import { cn } from "@shogi/design-system";
import type { ReactElement } from "react";
import { Button } from "../button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../dialog";
import { NativeSelect } from "../native-select";
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
} from "../shogi-match/utils/threadOptions";
import { countStudyLayerResults } from "./studyView";
import type { StudyAnalysisSettingsForm } from "./useStudyAnalysis";

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
}

const MULTI_PV_OPTIONS = [1, 2, 3, 4, 5] as const;

const choiceClass = (selected: boolean): string =>
    cn(
        "rounded-md border px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected
            ? "border-wafuu-shu bg-wafuu-shu/10 font-medium text-wafuu-shu"
            : "border-border bg-background text-wafuu-sumi hover:bg-muted/60",
    );

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
    return (
        <div className="flex flex-col gap-5">
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
                                    selected
                                        ? "border-wafuu-shu bg-wafuu-shu/10"
                                        : "border-border hover:bg-muted/60",
                                )}
                            >
                                <input
                                    type="radio"
                                    name="study-display-layer"
                                    className="accent-wafuu-shu"
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

            <div className="flex flex-col gap-3">
                {doc.layers.length > 0 && (
                    <h3 className="text-sm font-medium text-wafuu-sumi">別の設定で解析する</h3>
                )}
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
                    <div className="flex flex-col gap-1">
                        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                            使う AI
                            <NativeSelect
                                value={toNnueSelectionValue(form.nnueSelection)}
                                onChange={(event) =>
                                    form.onNnueSelectionChange(
                                        parseNnueSelectionValue(event.target.value),
                                    )
                                }
                                className="text-sm"
                            >
                                <option value="material">簡易AI（駒得）</option>
                                {nnueOptions.map((option) => (
                                    <option
                                        key={toOptionValue(option)}
                                        value={toOptionValue(option)}
                                    >
                                        {option.label}
                                    </option>
                                ))}
                            </NativeSelect>
                        </label>
                        {onOpenNnueLibrary && (
                            <button
                                type="button"
                                onClick={onOpenNnueLibrary}
                                className="self-start text-xs text-wafuu-ai underline underline-offset-2 hover:text-wafuu-ai-light"
                            >
                                自分の評価関数（NNUE）を追加する
                            </button>
                        )}
                    </div>
                )}
                <fieldset className="flex flex-col gap-1">
                    <legend className="pb-1 text-xs text-muted-foreground">
                        1 局面あたりの時間
                    </legend>
                    <div className="flex flex-wrap gap-1.5">
                        {ANALYSIS_TIME_OPTIONS.map((option) => (
                            <button
                                key={option.value}
                                type="button"
                                aria-pressed={form.settings.batchAnalysisTimeMs === option.value}
                                onClick={() =>
                                    form.onSettingsChange({
                                        ...form.settings,
                                        batchAnalysisTimeMs: option.value,
                                    })
                                }
                                className={choiceClass(
                                    form.settings.batchAnalysisTimeMs === option.value,
                                )}
                            >
                                {option.label}
                            </button>
                        ))}
                    </div>
                </fieldset>
                <fieldset className="flex flex-col gap-1">
                    <legend className="pb-1 text-xs text-muted-foreground">
                        候補手の数（各局面で読む手の数）
                    </legend>
                    <div className="flex flex-wrap gap-1.5">
                        {MULTI_PV_OPTIONS.map((count) => (
                            <button
                                key={count}
                                type="button"
                                aria-pressed={form.settings.multiPv === count}
                                onClick={() =>
                                    form.onSettingsChange({ ...form.settings, multiPv: count })
                                }
                                className={choiceClass(form.settings.multiPv === count)}
                            >
                                {count}
                            </button>
                        ))}
                    </div>
                </fieldset>
                {/* 1 局面ずつしか解析できないエンジン（Desktop の内蔵エンジン）では、選ぶものが無い。 */}
                {form.maxParallel !== 1 && (
                    <fieldset className="flex flex-col gap-1">
                        <legend className="pb-1 text-xs text-muted-foreground">
                            同時に解析する局面の数（多いほど速く終わり、端末の負荷は上がります）
                        </legend>
                        <div className="flex flex-wrap gap-1.5">
                            {PARALLEL_WORKER_OPTIONS.filter(
                                (option) =>
                                    form.maxParallel === null || option.value <= form.maxParallel,
                            ).map((option) => (
                                <button
                                    key={option.value}
                                    type="button"
                                    aria-pressed={shownParallelWorkers === option.value}
                                    onClick={() =>
                                        form.onSettingsChange({
                                            ...form.settings,
                                            parallelWorkers: option.value,
                                        })
                                    }
                                    className={choiceClass(shownParallelWorkers === option.value)}
                                >
                                    {option.value === 0
                                        ? `自動（${Math.min(resolveWorkerCount(0), form.maxParallel ?? Number.POSITIVE_INFINITY)}）`
                                        : option.label}
                                </button>
                            ))}
                        </div>
                    </fieldset>
                )}
                <fieldset className="flex flex-col gap-2">
                    <legend className="pb-1 text-xs text-muted-foreground">
                        スレッド数（多いほど深く読め、端末の負荷は上がります）
                    </legend>
                    <label className="flex items-center justify-between gap-3 text-sm text-wafuu-sumi">
                        <span>
                            全体の解析
                            <span className="ml-1 text-xs text-muted-foreground">1 局面あたり</span>
                        </span>
                        <NativeSelect
                            value={String(
                                clampThreads(form.settings.batchAnalysisThreads, maxThreads),
                            )}
                            onChange={(event) =>
                                form.onSettingsChange({
                                    ...form.settings,
                                    batchAnalysisThreads: Number(event.target.value),
                                })
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
                    <label className="flex items-center justify-between gap-3 text-sm text-wafuu-sumi">
                        この局面を深く解析
                        <NativeSelect
                            value={String(
                                clampThreads(form.settings.deepAnalysisThreads, maxThreads),
                            )}
                            onChange={(event) =>
                                form.onSettingsChange({
                                    ...form.settings,
                                    deepAnalysisThreads: Number(event.target.value),
                                })
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
                    {form.maxParallel !== 1 && form.settings.batchAnalysisThreads > 1 && (
                        <p className="text-xs text-muted-foreground">
                            全体の解析は、同時に解析する局面の数 × スレッド数のスレッドを使います。
                        </p>
                    )}
                </fieldset>
                <p className="text-xs text-muted-foreground">
                    AI・時間・候補手の数のどれかを変えて解析すると、結果は別の解析結果として残り、あとから切り替えて見られます。
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
            </div>
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
                description="どの AI で、どれくらいの時間をかけて解析するかを決めます。"
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
                            どの AI で、どれくらいの時間をかけて解析するかを決めます。
                        </DialogDescription>
                    </DialogHeader>
                    <SettingsBody onOpenChange={onOpenChange} {...props} />
                </div>
            </DialogContent>
        </Dialog>
    );
}
