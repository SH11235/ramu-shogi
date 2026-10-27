import type { KifuTree } from "@shogi/app-core";
import { useEffect, useRef, useState } from "react";
import type { BranchSummary } from "../utils/branchTreeUtils";

/** 表示モード */
export type KifuViewMode = "main" | "branches" | "selectedBranch";

/** 選択中の分岐情報 */
export interface SelectedBranch {
    /** 分岐のノードID */
    nodeId: string;
    /** タブ表示用のラベル */
    tabLabel: string;
}

interface UseKifuViewStateOptions {
    kifuTree?: KifuTree;
    branches: BranchSummary[];
    /** 最後に追加された分岐の情報（この分岐に直接遷移する） */
    lastAddedBranchInfo?: { ply: number; firstMove: string } | null;
    onLastAddedBranchHandled?: () => void;
    onSelectedBranchChange?: (branchNodeId: string | null) => void;
    onViewModeChange?: (mode: KifuViewMode) => void;
}

/**
 * 棋譜パネルの表示モード（本譜 / 分岐一覧 / 選択した分岐）と選択中の分岐を管理する。
 * 表示モードを変えたら親へ通知し、分岐の追加・消滅にも追従する。
 */
export function useKifuViewState({
    kifuTree,
    branches,
    lastAddedBranchInfo,
    onLastAddedBranchHandled,
    onSelectedBranchChange,
    onViewModeChange,
}: UseKifuViewStateOptions) {
    const [viewState, setViewState] = useState({
        viewMode: "main" as KifuViewMode,
        selectedBranch: null as SelectedBranch | null,
    });
    const { viewMode, selectedBranch } = viewState;

    const changeViewMode = (newMode: KifuViewMode) => {
        setViewState((prev) => ({ ...prev, viewMode: newMode }));
        onViewModeChange?.(newMode);
    };

    const selectBranch = (branch: BranchSummary) => {
        setViewState({
            viewMode: "selectedBranch",
            selectedBranch: { nodeId: branch.nodeId, tabLabel: branch.tabLabel },
        });
        onViewModeChange?.("selectedBranch");
    };

    // 同じ追加情報で何度も遷移しないよう、処理済みのものを覚えておく
    const processedBranchInfoRef = useRef<{ ply: number; firstMove: string } | null>(null);

    // 分岐が追加されたら直接「選択分岐」ビューに遷移
    useEffect(() => {
        if (!lastAddedBranchInfo) {
            processedBranchInfoRef.current = null;
            return;
        }

        if (
            processedBranchInfoRef.current &&
            processedBranchInfoRef.current.ply === lastAddedBranchInfo.ply &&
            processedBranchInfoRef.current.firstMove === lastAddedBranchInfo.firstMove
        ) {
            return;
        }

        // ply + firstMove で分岐を検索
        const branchInList = branches.find((b) => {
            if (b.ply !== lastAddedBranchInfo.ply) return false;
            const node = kifuTree?.nodes.get(b.nodeId);
            return node?.usiMove === lastAddedBranchInfo.firstMove;
        });

        if (branchInList) {
            processedBranchInfoRef.current = lastAddedBranchInfo;
            setViewState({
                viewMode: "selectedBranch",
                selectedBranch: {
                    nodeId: branchInList.nodeId,
                    tabLabel: branchInList.tabLabel,
                },
            });
            onViewModeChange?.("selectedBranch");
            onLastAddedBranchHandled?.();
        }
    }, [lastAddedBranchInfo, branches, kifuTree, onLastAddedBranchHandled, onViewModeChange]);

    // 分岐がなくなった場合は本譜ビューに戻す＆分岐状態をクリア
    useEffect(() => {
        if (branches.length === 0 && viewMode !== "main") {
            setViewState({ viewMode: "main", selectedBranch: null });
            onViewModeChange?.("main");
        }
    }, [branches.length, viewMode, onViewModeChange]);

    // 選択中の分岐を親に通知する（キーボードでの手送りがこの分岐に沿って進む）。
    // 選択分岐ビュー以外では null を渡し、本譜に沿って進ませる。
    useEffect(() => {
        const branchNodeId =
            viewMode === "selectedBranch" && selectedBranch ? selectedBranch.nodeId : null;
        onSelectedBranchChange?.(branchNodeId);
    }, [viewMode, selectedBranch, onSelectedBranchChange]);

    return { viewMode, selectedBranch, changeViewMode, selectBranch };
}
