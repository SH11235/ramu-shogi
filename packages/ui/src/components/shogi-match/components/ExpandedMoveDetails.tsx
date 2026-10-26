import type {
    KifuTree,
    NnueMeta,
    NnueSelection,
    PositionState,
    PresetConfig,
} from "@shogi/app-core";
import { cn } from "@shogi/design-system";
import type { ReactElement } from "react";
import { NativeSelect } from "../../native-select";
import type { KifMove, PvEvalInfo } from "../utils/kifFormat";
import { getEvalTooltipInfo } from "../utils/kifFormat";
import {
    buildNnueOptions,
    parseNnueSelectionValue,
    toNnueSelectionValue,
    toOptionValue,
} from "../utils/nnueSelectionUtils";
import { formatElapsedTime } from "../utils/timeFormat";
import { PvCandidateItem } from "./PvCandidateItem";

/**
 * 展開された指し手の詳細表示コンポーネント
 */
export function ExpandedMoveDetails({
    move,
    position,
    onAddBranch,
    onPreview,
    onAnalyze,
    isAnalyzing,
    analyzingPly,
    kifuTree,
    analysisNnueSelection,
    onAnalysisNnueSelectionChange,
    nnueList,
    isNnueListLoading,
    presets,
    onCollapse,
    isOnMainLine = true,
    className,
}: {
    move: KifMove;
    position: PositionState;
    onAddBranch?: (ply: number, pv: string[]) => void;
    onPreview?: (ply: number, pv: string[], evalCp?: number, evalMate?: number) => void;
    onAnalyze?: (ply: number) => void;
    isAnalyzing?: boolean;
    analyzingPly?: number;
    kifuTree?: KifuTree;
    analysisNnueSelection?: NnueSelection;
    onAnalysisNnueSelectionChange?: (selection: NnueSelection) => void;
    nnueList?: NnueMeta[];
    isNnueListLoading?: boolean;
    presets?: PresetConfig[];
    onCollapse: () => void;
    /** 現在位置がメインライン上にあるか（falseの場合はPV分岐追加を無効化） */
    isOnMainLine?: boolean;
    className?: string;
}): ReactElement {
    // 複数PVがある場合はリストで表示、なければ従来の単一PVを使用
    const pvList: PvEvalInfo[] = (() => {
        const multiPv = (move.multiPvEvals ?? []).filter((pv) => pv?.pv && pv.pv.length > 0);
        if (multiPv.length > 0) {
            return multiPv;
        }
        if (move.pv && move.pv.length > 0) {
            return [
                {
                    multipv: 1,
                    evalCp: move.evalCp,
                    evalMate: move.evalMate,
                    depth: move.depth,
                    pv: move.pv,
                },
            ];
        }
        return [];
    })();

    // 評価値の詳細情報（ヘッダー用、最良の候補=multipv1のもの）
    const bestPv = pvList[0];
    const evalInfo = getEvalTooltipInfo(
        bestPv?.evalCp ?? move.evalCp,
        bestPv?.evalMate ?? move.evalMate,
        move.ply,
        bestPv?.depth ?? move.depth,
    );

    // この手数が解析中かどうか
    const isThisPlyAnalyzing = isAnalyzing && analyzingPly === move.ply;

    const hasPv = pvList.length > 0;
    const hasMultiplePv = pvList.length > 1;

    // NNUE選択肢を構築（プリセット + カスタムNNUE）
    const nnueOptions = buildNnueOptions({ presets, nnueList, isNnueListLoading });

    // 現在の選択値を計算
    const selectedValue = toNnueSelectionValue(analysisNnueSelection);

    const showNnueSelector = analysisNnueSelection !== undefined && !!onAnalysisNnueSelectionChange;

    return (
        <section
            className={cn(
                "p-3 rounded-lg bg-wafuu-washi border border-border shadow-sm animate-[slideDown_0.15s_ease-out]",
                className,
            )}
            aria-label={`${move.ply}手目の詳細`}
        >
            {/* ヘッダー: 評価値情報と閉じるボタン */}
            <div className="flex items-center justify-between mb-2 pb-2 border-b border-border">
                <div className="flex items-center gap-2">
                    <span className="text-[11px] text-muted-foreground">{move.ply}手目</span>
                    {move.elapsedMs !== undefined && (
                        <span className="text-[11px] text-muted-foreground">
                            消費 {formatElapsedTime(move.elapsedMs)}
                        </span>
                    )}
                    <span
                        className={`font-medium text-[13px] ${
                            evalInfo.advantage === "sente"
                                ? "text-wafuu-shu"
                                : evalInfo.advantage === "gote"
                                  ? "text-wafuu-ai"
                                  : ""
                        }`}
                    >
                        {evalInfo.description}
                    </span>
                    {hasMultiplePv && (
                        <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                            {pvList.length}候補
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <div className="text-muted-foreground text-[10px] space-x-1.5">
                        {evalInfo.detail && <span>{evalInfo.detail}</span>}
                        {evalInfo.depthText && <span>{evalInfo.depthText}</span>}
                    </div>
                    <button
                        type="button"
                        onClick={onCollapse}
                        className="
                            p-1 rounded hover:bg-muted
                            text-muted-foreground hover:text-foreground
                            transition-colors cursor-pointer
                            bg-transparent border-none
                        "
                        aria-label="閉じる"
                    >
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                        >
                            <polyline points="18 15 12 9 6 15" />
                        </svg>
                    </button>
                </div>
            </div>

            {/* 複数PV候補リスト */}
            {hasPv && (
                <div className="space-y-2">
                    {pvList.map((pv) => (
                        <PvCandidateItem
                            key={pv.multipv}
                            pv={pv}
                            position={position}
                            ply={move.ply}
                            onAddBranch={onAddBranch}
                            onPreview={onPreview}
                            isOnMainLine={isOnMainLine}
                            kifuTree={kifuTree}
                        />
                    ))}
                </div>
            )}

            {/* 解析ボタン */}
            {onAnalyze && (
                <div className={hasPv ? "pt-2 border-t border-border mt-2 space-y-2" : "space-y-2"}>
                    {!hasPv && (
                        <div className="text-[11px] text-muted-foreground mb-2">
                            読み筋がありません
                        </div>
                    )}
                    {showNnueSelector && (
                        <label className="flex flex-col gap-1 text-[10px] text-muted-foreground">
                            <span>分析に使うAI</span>
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
                        </label>
                    )}
                    <button
                        type="button"
                        onClick={() => onAnalyze(move.ply)}
                        disabled={isThisPlyAnalyzing}
                        className={`
                            w-full px-3 py-2 text-[12px]
                            disabled:opacity-50 disabled:cursor-not-allowed
                            rounded border border-border
                            transition-colors cursor-pointer
                            ${
                                hasPv
                                    ? "bg-muted hover:bg-muted/80 text-foreground"
                                    : "bg-primary text-primary-foreground hover:bg-primary/90"
                            }
                        `}
                    >
                        {isThisPlyAnalyzing ? (
                            <span>解析中...</span>
                        ) : (
                            <>
                                <span className="mr-1">{hasPv ? "🔄" : "🔍"}</span>
                                {hasPv ? "再解析する" : "この局面を解析する"}
                            </>
                        )}
                    </button>
                </div>
            )}
        </section>
    );
}
