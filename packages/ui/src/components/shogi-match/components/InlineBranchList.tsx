import type { ReactElement } from "react";
import type { BranchSummary } from "../utils/branchTreeUtils";

/**
 * インライン分岐リスト（本譜ビューで分岐を展開表示）
 */
export function InlineBranchList({
    branches,
    onBranchClick,
    onAnalyzeBranch,
}: {
    branches: BranchSummary[];
    onBranchClick: (branch: BranchSummary) => void;
    onAnalyzeBranch?: (branchNodeId: string) => void;
}): ReactElement {
    return (
        <div className="ml-6 pl-2 border-l-2 border-wafuu-shu/30 my-0.5">
            {branches.map((branch, index) => {
                const isLast = index === branches.length - 1;
                return (
                    <div key={branch.nodeId} className="flex items-center gap-1 py-0.5">
                        {/* ツリー罫線 */}
                        <span className="text-[11px] text-muted-foreground/60 font-mono">
                            {isLast ? "└─" : "├─"}
                        </span>
                        {/* 分岐ボタン */}
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                onBranchClick(branch);
                            }}
                            className="
                                flex items-center gap-1.5
                                text-[12px] text-left
                                px-1.5 py-0.5 rounded
                                hover:bg-wafuu-washi
                                transition-colors cursor-pointer
                                bg-transparent border-none
                            "
                        >
                            <span className="font-medium text-wafuu-shu">{branch.displayText}</span>
                            <span className="text-[10px] text-muted-foreground">
                                ({branch.branchLength}手)
                            </span>
                        </button>
                        {/* 分岐解析ボタン */}
                        {onAnalyzeBranch && (
                            <button
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onAnalyzeBranch(branch.nodeId);
                                }}
                                className="text-[10px] px-1 py-0.5 rounded bg-muted hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                                title="この分岐を一括解析"
                            >
                                解析
                            </button>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
