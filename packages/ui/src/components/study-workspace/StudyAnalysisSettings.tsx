/**
 * 解析の設定。
 *
 * 表示する解析結果の切り替え（内部でいう「解析レイヤー」）と、設定を変えた解析の開始を
 * 1 か所にまとめる。画面には「レイヤー」という語を出さず、「RAMU・1 秒」のように中身で見せる。
 * 設定の値と保存先は既存の検討モードと共通（時間・候補手の数・使う AI）。
 */

import type { StudyDocument } from "@shogi/app-core";
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
import { ANALYSIS_TIME_OPTIONS } from "../shogi-match/utils/threadOptions";
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
    isMobile,
}: Omit<StudyAnalysisSettingsProps, "open">): ReactElement {
    const nnueOptions = buildNnueOptions({
        presets: form.presets,
        nnueList: form.nnueList,
        isNnueListLoading: form.isNnueListLoading,
    });
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
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                    使う AI
                    <NativeSelect
                        value={toNnueSelectionValue(form.nnueSelection)}
                        onChange={(event) =>
                            form.onNnueSelectionChange(parseNnueSelectionValue(event.target.value))
                        }
                        className={isMobile ? "text-base" : "text-sm"}
                    >
                        <option value="material">簡易AI（駒得）</option>
                        {nnueOptions.map((option) => (
                            <option key={toOptionValue(option)} value={toOptionValue(option)}>
                                {option.label}
                            </option>
                        ))}
                    </NativeSelect>
                </label>
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
            <BottomSheet open={open} onOpenChange={onOpenChange} title="解析の設定" height="auto">
                <SettingsBody onOpenChange={onOpenChange} {...props} />
            </BottomSheet>
        );
    }
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="w-[min(440px,calc(100%-24px))]">
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
