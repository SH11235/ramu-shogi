import { cn } from "@shogi/design-system";
import type { ReactElement } from "react";
import type { BranchSummary, FlatTreeNode } from "../utils/branchTreeUtils";
import { formatEval } from "../utils/kifFormat";
import { getEvalClassName } from "../utils/kifuEvalClassName";

/** ネストされた分岐のインデント幅（px） */
const NEST_INDENT_PX = 16;

/**
 * 分岐一覧ビュー
 */
export function KifuBranchListView({
    branches,
    selectedNodeId,
    onSelectBranch,
    className,
}: {
    branches: BranchSummary[];
    selectedNodeId?: string;
    onSelectBranch: (branch: BranchSummary) => void;
    className?: string;
}): ReactElement {
    return (
        <div
            className={cn(
                "max-h-[var(--kifu-panel-max-h,70vh)] overflow-auto [scrollbar-gutter:stable]",
                className,
            )}
        >
            {branches.length === 0 ? (
                <div className="text-[13px] text-muted-foreground text-center py-4">
                    分岐がありません
                </div>
            ) : (
                <div className="space-y-1">
                    {branches.map((branch) => (
                        <button
                            key={branch.nodeId}
                            type="button"
                            onClick={() => onSelectBranch(branch)}
                            className={`
                                w-full text-left px-3 py-2 rounded-lg
                                border border-border
                                transition-all duration-150
                                hover:bg-wafuu-washi hover:border-wafuu-shu/30
                                ${selectedNodeId === branch.nodeId ? "bg-wafuu-kin/10 border-wafuu-kin/30" : "bg-card"}
                            `}
                            style={{
                                marginLeft: branch.nestLevel * NEST_INDENT_PX,
                            }}
                        >
                            <div className="flex items-center justify-between gap-2">
                                <div className="flex flex-col gap-0.5">
                                    {branch.parentPath && (
                                        <span className="text-[10px] text-muted-foreground">
                                            {branch.parentPath}
                                        </span>
                                    )}
                                    <div className="flex items-center gap-2">
                                        <span className="text-[11px] text-muted-foreground min-w-[2.5rem]">
                                            {branch.ply + 1}手目
                                        </span>
                                        <span className="text-[13px] font-medium">
                                            {branch.displayText}
                                        </span>
                                    </div>
                                </div>
                                <span className="text-[10px] text-muted-foreground">
                                    {branch.branchLength}手
                                </span>
                            </div>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

/**
 * 選択した分岐の手順ビュー（本譜の手から分岐の終わりまで）
 */
export function KifuSelectedBranchView({
    branchNodeId,
    moves,
    showEval,
    analyzingPly,
    onNodeClick,
    onAnalyzeNode,
    onAnalyzeBranch,
    className,
}: {
    branchNodeId: string;
    moves: FlatTreeNode[];
    showEval: boolean;
    analyzingPly?: number;
    onNodeClick?: (nodeId: string) => void;
    onAnalyzeNode?: (nodeId: string) => void;
    onAnalyzeBranch?: (branchNodeId: string) => void;
    className?: string;
}): ReactElement {
    const branchMoveCount = moves.filter((n) => n.nestLevel > 0).length;

    return (
        <div className={className}>
            {/* 分岐ヘッダー: 解析ボタン（分岐部分が1手以上ある場合のみ表示） */}
            {onAnalyzeBranch && branchMoveCount > 0 && (
                <div className="flex items-center justify-between gap-2 px-2 py-1.5 mb-1 bg-wafuu-washi rounded-lg border border-border">
                    <span className="text-[11px] text-muted-foreground">
                        {branchMoveCount}手の分岐
                    </span>
                    <button
                        type="button"
                        onClick={() => onAnalyzeBranch(branchNodeId)}
                        className="
                            px-3 py-1 text-[11px] font-medium
                            bg-primary text-primary-foreground
                            hover:bg-primary/90
                            rounded transition-colors cursor-pointer
                        "
                    >
                        この分岐を解析
                    </button>
                </div>
            )}
            <div className="max-h-[var(--kifu-panel-branch-max-h,calc(70vh-40px))] overflow-auto [scrollbar-gutter:stable]">
                {moves.length === 0 ? (
                    <div className="text-[13px] text-muted-foreground text-center py-4">
                        分岐データがありません
                    </div>
                ) : (
                    moves.map((node, index) => {
                        const isCurrent = node.isCurrent;
                        const evalText = showEval
                            ? formatEval(node.evalCp, node.evalMate, node.ply)
                            : "";
                        const isBranchPart = node.nestLevel > 0;
                        // 分岐開始点かどうか（前の手が本譜で現在が分岐）
                        const isBranchStart =
                            isBranchPart && index > 0 && moves[index - 1].nestLevel === 0;

                        return (
                            <div key={node.nodeId}>
                                {/* 分岐開始の区切り線 */}
                                {isBranchStart && (
                                    <div className="flex items-center gap-2 my-1.5 px-1">
                                        <div className="flex-1 h-px bg-wafuu-shu/30" />
                                        <span className="text-[10px] text-wafuu-shu">
                                            {node.ply}手目から分岐
                                        </span>
                                        {onAnalyzeBranch && (
                                            <button
                                                type="button"
                                                className="text-[10px] px-1.5 py-0.5 rounded bg-wafuu-shu/15 hover:bg-wafuu-shu/30 text-wafuu-shu transition-colors"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    onAnalyzeBranch(node.nodeId);
                                                }}
                                                title="この分岐の全手を一括解析"
                                            >
                                                分岐を解析
                                            </button>
                                        )}
                                        <div className="flex-1 h-px bg-wafuu-shu/30" />
                                    </div>
                                )}
                                <div
                                    role="option"
                                    aria-selected={isCurrent}
                                    className={`
                                        grid grid-cols-[32px_1fr_auto_auto] gap-1 items-center px-1 py-0.5 text-[13px] font-mono tabular-nums rounded
                                        cursor-pointer hover:bg-accent/50
                                        ${isCurrent ? "bg-accent" : ""}
                                        ${isBranchPart ? "border-l-2 border-wafuu-shu/50 ml-1" : ""}
                                    `}
                                    onClick={() => onNodeClick?.(node.nodeId)}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter" || e.key === " ") {
                                            e.preventDefault();
                                            onNodeClick?.(node.nodeId);
                                        }
                                    }}
                                    tabIndex={0}
                                >
                                    <span className="text-right text-xs text-muted-foreground">
                                        {node.ply}
                                    </span>
                                    <span className="font-medium">{node.displayText}</span>
                                    {showEval && evalText && (
                                        <span className={getEvalClassName(node)}>{evalText}</span>
                                    )}
                                    {/* 解析ボタン */}
                                    {onAnalyzeNode && analyzingPly !== node.ply && (
                                        <button
                                            type="button"
                                            className="text-[10px] px-1.5 py-0.5 rounded bg-muted hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onAnalyzeNode(node.nodeId);
                                            }}
                                            title={evalText ? "この手を再解析" : "この手を解析"}
                                        >
                                            {evalText ? "再解析" : "解析"}
                                        </button>
                                    )}
                                    {analyzingPly === node.ply && (
                                        <span className="text-[10px] text-muted-foreground animate-pulse">
                                            解析中...
                                        </span>
                                    )}
                                </div>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
}
