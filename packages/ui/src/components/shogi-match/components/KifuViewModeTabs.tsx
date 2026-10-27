import { cn } from "@shogi/design-system";
import type { ReactElement } from "react";
import type { KifuViewMode, SelectedBranch } from "../hooks/useKifuViewState";

/**
 * 棋譜パネルのビュー切り替えタブ（本譜 / 分岐一覧 / 選択した分岐）
 */
export function KifuViewModeTabs({
    viewMode,
    branchCount,
    selectedBranch,
    onChange,
    className,
}: {
    viewMode: KifuViewMode;
    branchCount: number;
    selectedBranch: SelectedBranch | null;
    onChange: (mode: KifuViewMode) => void;
    className?: string;
}): ReactElement {
    return (
        <div className={cn("flex border-b border-border", className)}>
            {/* 本譜タブ */}
            <button
                type="button"
                onClick={() => onChange("main")}
                className={`
                    flex-1 py-1.5 text-[12px] transition-all duration-150
                    relative
                    ${
                        viewMode === "main"
                            ? "text-wafuu-shu font-medium"
                            : "text-muted-foreground hover:text-foreground hover:bg-wafuu-washi"
                    }
                `}
            >
                本譜
                {viewMode === "main" && (
                    <span className="absolute bottom-[-1px] left-[20%] right-[20%] h-0.5 bg-wafuu-shu rounded-t" />
                )}
            </button>
            {/* 分岐一覧タブ */}
            <button
                type="button"
                onClick={() => onChange("branches")}
                className={`
                    flex-1 py-1.5 text-[12px] transition-all duration-150
                    relative
                    ${
                        viewMode === "branches"
                            ? "text-wafuu-shu font-medium"
                            : "text-muted-foreground hover:text-foreground hover:bg-wafuu-washi"
                    }
                `}
            >
                分岐一覧
                <span className="ml-1 text-[10px] text-muted-foreground">({branchCount})</span>
                {viewMode === "branches" && (
                    <span className="absolute bottom-[-1px] left-[20%] right-[20%] h-0.5 bg-wafuu-shu rounded-t" />
                )}
            </button>
            {/* 選択した分岐タブ（分岐が選択されている場合のみ表示） */}
            {selectedBranch && (
                <button
                    type="button"
                    onClick={() => onChange("selectedBranch")}
                    className={`
                        flex-1 py-1.5 text-[12px] transition-all duration-150
                        relative max-w-[40%] truncate
                        ${
                            viewMode === "selectedBranch"
                                ? "text-wafuu-shu font-medium"
                                : "text-muted-foreground hover:text-foreground hover:bg-wafuu-washi"
                        }
                    `}
                    title={selectedBranch.tabLabel}
                >
                    {selectedBranch.tabLabel}
                    {viewMode === "selectedBranch" && (
                        <span className="absolute bottom-[-1px] left-[20%] right-[20%] h-0.5 bg-wafuu-shu rounded-t" />
                    )}
                </button>
            )}
        </div>
    );
}
