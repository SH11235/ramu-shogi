import type { NnueMeta, NnueSelection, PresetConfig } from "@shogi/app-core";
import { detectParallelism, resolveWorkerCount } from "@shogi/app-core";
import type { ReactElement } from "react";
import { useState } from "react";
import { NativeSelect } from "../../native-select";
import { Popover, PopoverContent, PopoverTrigger } from "../../popover";
import type { AnalysisSettings } from "../types";
import {
    buildNnueOptions,
    parseNnueSelectionValue,
    toNnueSelectionValue,
    toOptionValue,
} from "../utils/nnueSelectionUtils";
import { ANALYSIS_TIME_OPTIONS, PARALLEL_WORKER_OPTIONS } from "../utils/threadOptions";

/** 解析対象の選択肢 */
type AnalysisTarget = "mainOnly" | "includeBranches";

/**
 * 一括解析ドロップダウン
 */
export function BatchAnalysisDropdown({
    movesWithoutPv,
    analysisSettings,
    onAnalysisSettingsChange,
    onStartBatchAnalysis,
    onStartTreeBatchAnalysis,
    hasBranches,
    isRunning,
    analysisNnueSelection,
    onAnalysisNnueSelectionChange,
    nnueList,
    isNnueListLoading,
    presets,
}: {
    movesWithoutPv: number;
    analysisSettings: AnalysisSettings;
    onAnalysisSettingsChange: (settings: AnalysisSettings) => void;
    onStartBatchAnalysis: () => void;
    onStartTreeBatchAnalysis?: (options?: { mainLineOnly?: boolean }) => void;
    hasBranches: boolean;
    isRunning?: boolean;
    analysisNnueSelection?: NnueSelection;
    onAnalysisNnueSelectionChange?: (selection: NnueSelection) => void;
    nnueList?: NnueMeta[];
    isNnueListLoading?: boolean;
    presets?: PresetConfig[];
}): ReactElement {
    const [isOpen, setIsOpen] = useState(false);
    const [analysisTarget, setAnalysisTarget] = useState<AnalysisTarget>("mainOnly");
    const parallelismConfig = detectParallelism();

    // NNUE選択肢を構築（プリセット + カスタムNNUE）
    const nnueOptions = buildNnueOptions({ presets, nnueList, isNnueListLoading });

    // 現在の選択値を計算
    const selectedValue = toNnueSelectionValue(analysisNnueSelection);

    const showNnueSelector = analysisNnueSelection !== undefined && !!onAnalysisNnueSelectionChange;

    const handleParallelWorkersChange = (value: number) => {
        onAnalysisSettingsChange({
            ...analysisSettings,
            parallelWorkers: value,
        });
    };

    const handleAnalysisTimeChange = (value: number) => {
        onAnalysisSettingsChange({
            ...analysisSettings,
            batchAnalysisTimeMs: value,
        });
    };

    const handleStart = () => {
        setIsOpen(false);
        if (analysisTarget === "includeBranches" && onStartTreeBatchAnalysis) {
            onStartTreeBatchAnalysis({ mainLineOnly: false });
        } else {
            onStartBatchAnalysis();
        }
    };

    const isDisabled = movesWithoutPv === 0 || isRunning === true;

    return (
        <Popover open={isOpen} onOpenChange={isDisabled ? undefined : setIsOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    disabled={isDisabled}
                    className={`relative w-7 h-7 flex items-center justify-center text-[14px] rounded border transition-colors duration-150 ${
                        isDisabled
                            ? "cursor-not-allowed opacity-40 bg-muted text-muted-foreground border-border"
                            : "cursor-pointer bg-primary/10 text-primary border-primary/30 hover:bg-primary/20"
                    }`}
                    aria-label={
                        isRunning
                            ? "一括解析中"
                            : isDisabled
                              ? "解析対象の手がありません"
                              : `一括解析: ${movesWithoutPv}手`
                    }
                >
                    ⚡
                </button>
            </PopoverTrigger>
            <PopoverContent side="bottom" align="end" className="w-64 p-3">
                <div className="space-y-3">
                    <div className="font-medium text-sm">一括解析</div>
                    <div className="text-xs text-muted-foreground">
                        読み筋がない{movesWithoutPv}手を解析します
                    </div>
                    {showNnueSelector && (
                        <div className="space-y-1.5">
                            <div className="text-xs font-medium text-foreground">分析NNUE</div>
                            <NativeSelect
                                value={selectedValue}
                                onChange={(e) =>
                                    onAnalysisNnueSelectionChange?.(
                                        parseNnueSelectionValue(e.target.value),
                                    )
                                }
                                wrapperClassName="w-full"
                                className="text-xs"
                            >
                                <option value="material">簡易AI（駒得）</option>
                                {nnueOptions.map((opt) => (
                                    <option key={toOptionValue(opt)} value={toOptionValue(opt)}>
                                        {opt.label}
                                    </option>
                                ))}
                            </NativeSelect>
                        </div>
                    )}

                    {/* 解析対象の選択（分岐がある場合のみ表示） */}
                    {hasBranches && onStartTreeBatchAnalysis && (
                        <div className="space-y-1.5">
                            <div className="text-xs font-medium text-foreground">解析対象</div>
                            <div className="flex gap-1 flex-wrap">
                                <button
                                    type="button"
                                    onClick={() => setAnalysisTarget("mainOnly")}
                                    className={`px-2 py-1 rounded text-xs transition-colors ${
                                        analysisTarget === "mainOnly"
                                            ? "bg-primary text-primary-foreground"
                                            : "bg-muted text-muted-foreground hover:bg-muted/80"
                                    }`}
                                >
                                    本譜のみ
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setAnalysisTarget("includeBranches")}
                                    className={`px-2 py-1 rounded text-xs transition-colors ${
                                        analysisTarget === "includeBranches"
                                            ? "bg-primary text-primary-foreground"
                                            : "bg-muted text-muted-foreground hover:bg-muted/80"
                                    }`}
                                >
                                    分岐を含む
                                </button>
                            </div>
                        </div>
                    )}

                    {/* 並列数設定 */}
                    <div className="space-y-1.5">
                        <div className="text-xs font-medium text-foreground">並列数</div>
                        <div className="flex gap-1 flex-wrap">
                            {PARALLEL_WORKER_OPTIONS.map((opt) => (
                                <button
                                    key={opt.value}
                                    type="button"
                                    onClick={() => handleParallelWorkersChange(opt.value)}
                                    className={`px-2 py-1 rounded text-xs transition-colors ${
                                        analysisSettings.parallelWorkers === opt.value
                                            ? "bg-primary text-primary-foreground"
                                            : "bg-muted text-muted-foreground hover:bg-muted/80"
                                    }`}
                                >
                                    {opt.value === 0 ? `自動(${resolveWorkerCount(0)})` : opt.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* 解析時間設定 */}
                    <div className="space-y-1.5">
                        <div className="text-xs font-medium text-foreground">1手あたり解析時間</div>
                        <div className="flex gap-1 flex-wrap">
                            {ANALYSIS_TIME_OPTIONS.map((opt) => (
                                <button
                                    key={opt.value}
                                    type="button"
                                    onClick={() => handleAnalysisTimeChange(opt.value)}
                                    className={`px-2 py-1 rounded text-xs transition-colors ${
                                        analysisSettings.batchAnalysisTimeMs === opt.value
                                            ? "bg-primary text-primary-foreground"
                                            : "bg-muted text-muted-foreground hover:bg-muted/80"
                                    }`}
                                >
                                    {opt.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* 候補手数（MultiPV）設定 */}
                    <div className="space-y-1.5">
                        <div className="text-xs font-medium text-foreground">候補手数</div>
                        <div className="flex gap-1 flex-wrap">
                            {[1, 2, 3, 4, 5].map((n) => (
                                <button
                                    key={n}
                                    type="button"
                                    onClick={() =>
                                        onAnalysisSettingsChange({
                                            ...analysisSettings,
                                            multiPv: n,
                                        })
                                    }
                                    className={`px-2 py-1 rounded text-xs transition-colors ${
                                        analysisSettings.multiPv === n
                                            ? "bg-primary text-primary-foreground"
                                            : "bg-muted text-muted-foreground hover:bg-muted/80"
                                    }`}
                                >
                                    {n}
                                </button>
                            ))}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                            各手で表示する候補の数
                        </div>
                    </div>

                    <div className="text-[10px] text-muted-foreground">
                        検出コア数: {parallelismConfig.detectedConcurrency}
                    </div>

                    {/* 開始ボタン */}
                    <button
                        type="button"
                        onClick={handleStart}
                        className="w-full py-2 rounded bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
                    >
                        解析開始
                    </button>
                </div>
            </PopoverContent>
        </Popover>
    );
}
