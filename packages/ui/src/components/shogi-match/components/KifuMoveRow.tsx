import type { ReactElement, Ref } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../tooltip";
import type { KifMove } from "../utils/kifFormat";
import { formatEval, getEvalTooltipInfo } from "../utils/kifFormat";
import { getEvalClassName } from "../utils/kifuEvalClassName";

/**
 * 評価値ツールチップの内容
 */
function EvalTooltipContent({
    evalCp,
    evalMate,
    ply,
    depth,
}: {
    evalCp?: number;
    evalMate?: number;
    ply: number;
    depth?: number;
}): ReactElement {
    const info = getEvalTooltipInfo(evalCp, evalMate, ply, depth);

    return (
        <div className="space-y-1">
            <div
                className={`font-medium ${
                    info.advantage === "sente"
                        ? "text-wafuu-shu"
                        : info.advantage === "gote"
                          ? "text-wafuu-ai"
                          : ""
                }`}
            >
                {info.description}
            </div>
            <div className="text-muted-foreground text-[10px] space-x-2">
                {info.detail && <span>{info.detail}</span>}
                {info.depthText && <span>{info.depthText}</span>}
            </div>
        </div>
    );
}

interface KifuMoveRowProps {
    move: KifMove;
    isCurrent: boolean;
    /** 巻き戻し中で、今の局面より先の手か */
    isPastCurrent?: boolean;
    showEval: boolean;
    /** この手に分岐があるか */
    hasBranch?: boolean;
    branchCount?: number;
    isBranchesExpanded: boolean;
    /** AI 解析を使った側 */
    analysisSeats?: Set<"b" | "w">;
    /** 読み筋・解析の詳細を開けるか */
    canExpand: boolean;
    isDetailExpanded: boolean;
    /** 詳細を行の下ではなく外部のウィンドウに出すか（開閉の状態を行で持たない） */
    detailInWindow: boolean;
    rowRef?: Ref<HTMLDivElement>;
    onSelect: () => void;
    onToggleBranches: () => void;
    onToggleDetail: () => void;
}

/**
 * 本譜ビューの 1 手分の行
 */
export function KifuMoveRow({
    move,
    isCurrent,
    isPastCurrent,
    showEval,
    hasBranch,
    branchCount,
    isBranchesExpanded,
    analysisSeats,
    canExpand,
    isDetailExpanded,
    detailInWindow,
    rowRef,
    onSelect,
    onToggleBranches,
    onToggleDetail,
}: KifuMoveRowProps): ReactElement {
    const evalText = showEval ? formatEval(move.evalCp, move.evalMate, move.ply) : "";
    const detailToggleLabel = `${move.ply}手目の読み筋を${isDetailExpanded ? "閉じる" : "開く"}`;
    const rowClassName = `grid grid-cols-[32px_1fr_auto_auto] gap-1 items-center px-1 py-0.5 text-[13px] font-mono tabular-nums rounded ${
        isCurrent ? "bg-accent" : ""
    } ${isDetailExpanded ? "bg-accent/70" : ""}`;

    return (
        <div
            ref={rowRef}
            role="option"
            aria-selected={isCurrent}
            className={`${rowClassName} w-full text-left cursor-pointer hover:bg-accent/50`}
            onClick={onSelect}
            onKeyDown={(e) => {
                // 行の中のボタン（▾・分岐）での操作は、そのボタンに任せる。
                // 伝播は止めない（矢印キーでの手送りや Esc が document で受ける）。
                if (e.target !== e.currentTarget) return;
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect();
                }
            }}
            tabIndex={0}
        >
            <span
                className={`text-right text-xs ${isPastCurrent ? "text-muted-foreground/50" : "text-muted-foreground"}`}
            >
                {move.ply}
                {hasBranch && (
                    <button
                        type="button"
                        className="ml-0.5 text-wafuu-shu cursor-pointer hover:opacity-70 bg-transparent border-none p-0"
                        onClick={(e) => {
                            e.stopPropagation();
                            onToggleBranches();
                        }}
                        title={`${branchCount}つの分岐を${isBranchesExpanded ? "閉じる" : "開く"}`}
                    >
                        {isBranchesExpanded ? "▼" : "◆"}
                    </button>
                )}
            </span>
            {/* AI 解析使用マーカー */}
            {analysisSeats && (
                <span className="flex items-center gap-0.5 ml-0.5">
                    {analysisSeats.has("b") && (
                        <span
                            className="text-[9px] text-wafuu-shu leading-none"
                            title="先手がAI解析を使用"
                        >
                            ▲
                        </span>
                    )}
                    {analysisSeats.has("w") && (
                        <span
                            className="text-[9px] text-wafuu-ai leading-none"
                            title="後手がAI解析を使用"
                        >
                            △
                        </span>
                    )}
                </span>
            )}
            <span className={`font-medium ${isPastCurrent ? "text-muted-foreground/50" : ""}`}>
                {move.displayText}
            </span>
            {showEval && evalText && (
                <Tooltip>
                    <TooltipTrigger asChild>
                        <span
                            className={`${getEvalClassName(move)} ${isPastCurrent ? "opacity-50" : ""}`}
                        >
                            {evalText}
                        </span>
                    </TooltipTrigger>
                    {!isDetailExpanded && (
                        <TooltipContent side="left" className="max-w-[200px]">
                            <EvalTooltipContent
                                evalCp={move.evalCp}
                                evalMate={move.evalMate}
                                ply={move.ply}
                                depth={move.depth}
                            />
                        </TooltipContent>
                    )}
                </Tooltip>
            )}
            {/* 展開可能インジケータ */}
            {canExpand && (
                <button
                    type="button"
                    className={`cursor-pointer rounded border-none bg-transparent px-1.5 text-[10px] leading-4 hover:bg-accent hover:text-foreground ${isPastCurrent ? "text-muted-foreground/30" : "text-muted-foreground/60"}`}
                    onClick={(e) => {
                        e.stopPropagation();
                        onToggleDetail();
                    }}
                    aria-label={detailToggleLabel}
                    aria-expanded={detailInWindow ? undefined : isDetailExpanded}
                    title={detailToggleLabel}
                >
                    <span
                        className={`inline-block transition-transform duration-150 ${isDetailExpanded ? "rotate-180" : ""}`}
                    >
                        ▾
                    </span>
                </button>
            )}
        </div>
    );
}
