import type { ReactElement } from "react";
import { Switch } from "../../switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../tooltip";

/**
 * 棋譜パネルの評価値表示トグル（凡例のツールチップ付き）。
 * 評価値が隠れているのにデータがあるときは、金色の印で目立たせる。
 */
export function KifuEvalToggle({
    showEval,
    evalDataExists,
    onShowEvalChange,
}: {
    showEval: boolean;
    evalDataExists: boolean;
    onShowEvalChange: (show: boolean) => void;
}): ReactElement {
    return (
        <label
            htmlFor="kifu-eval-toggle"
            className={`
                relative flex items-center gap-1.5 cursor-pointer
                px-2 py-1 rounded-md transition-all duration-200
                ${
                    evalDataExists && !showEval
                        ? "bg-wafuu-kin/10 hover:bg-wafuu-kin/20"
                        : "hover:bg-muted/50"
                }
            `}
        >
            {/* 評価値データ存在インジケーター */}
            {evalDataExists && !showEval && (
                <span
                    className="
                        absolute -top-1 -right-1
                        w-2.5 h-2.5 rounded-full
                        bg-wafuu-kin
                        animate-[pulse_2s_ease-in-out_infinite]
                        shadow-[0_0_6px_hsl(var(--wafuu-kin)/0.6)]
                    "
                    aria-hidden="true"
                />
            )}
            <span
                className={`
                    text-[12px] font-medium transition-colors
                    ${
                        evalDataExists && !showEval
                            ? "text-wafuu-kin"
                            : showEval
                              ? "text-foreground"
                              : "text-muted-foreground"
                    }
                `}
            >
                評価値
            </span>
            <Switch
                id="kifu-eval-toggle"
                checked={showEval}
                onCheckedChange={onShowEvalChange}
                aria-label="評価値を表示"
            />
            {/* 評価値の凡例インフォアイコン */}
            <Tooltip>
                <TooltipTrigger asChild>
                    <button
                        type="button"
                        className="
                            inline-flex items-center justify-center
                            w-4 h-4 rounded-full
                            text-[10px] text-muted-foreground
                            border border-muted-foreground/30
                            hover:bg-muted hover:text-foreground
                            cursor-help transition-colors
                            bg-transparent
                        "
                        aria-label="評価値の見方"
                    >
                        ?
                    </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-[220px]">
                    <div className="space-y-1.5 text-[11px]">
                        <div className="font-medium">評価値の見方</div>
                        <div className="space-y-0.5">
                            <div>
                                <span className="text-wafuu-shu">+値</span>
                                <span className="text-muted-foreground ml-1">☗先手有利</span>
                            </div>
                            <div>
                                <span className="text-wafuu-ai">-値</span>
                                <span className="text-muted-foreground ml-1">☖後手有利</span>
                            </div>
                        </div>
                        <div className="text-muted-foreground text-[10px] pt-1 border-t border-border">
                            各評価値にホバーで詳細表示
                        </div>
                    </div>
                </TooltipContent>
            </Tooltip>
        </label>
    );
}
