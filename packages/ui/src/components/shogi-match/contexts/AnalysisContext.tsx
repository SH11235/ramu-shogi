/**
 * AnalysisContext
 *
 * 分析機能を管理するContext
 * - 分析設定（並列数、解析時間）
 * - 分析用NNUE選択
 * - 分析状態（解析中、一括解析）
 * - 分析操作（単発解析、一括解析、分岐解析）
 *
 * 変更頻度: 中（分析実行時に更新）
 */

import type { NnueMeta, NnueSelection, PresetConfig } from "@shogi/app-core";
import type { ReactNode } from "react";
import { createContext, useContext } from "react";
import type { AnalysisSettings, AnalyzingState } from "../types";
import type { AnalysisContextValue, BatchAnalysisState } from "./types";

const AnalysisContext = createContext<AnalysisContextValue | null>(null);

interface AnalysisProviderProps {
    // 分析設定
    analysisSettings: AnalysisSettings;
    onAnalysisSettingsChange: (settings: AnalysisSettings) => void;

    // 分析用NNUE
    analysisNnueSelection: NnueSelection;
    onAnalysisNnueSelectionChange: (selection: NnueSelection) => void;
    nnueList: NnueMeta[];
    isNnueListLoading: boolean;
    presetConfigs: PresetConfig[];

    // 分析状態
    isAnalyzing: boolean;
    analyzingState: AnalyzingState;
    batchAnalysis: BatchAnalysisState | null;

    // 分析操作
    handleAnalyzePly: (ply: number) => void;
    handleAnalyzeHintPly: (ply: number) => void;
    handleStartBatchAnalysis: () => void;
    handleCancelBatchAnalysis: () => void;
    handleAnalyzeNode: (nodeId: string) => void;
    handleAnalyzeBranch: (branchNodeId: string) => void;
    handleStartTreeBatchAnalysis: (options?: { mainLineOnly?: boolean }) => void;

    children: ReactNode;
}

/**
 * 分析コンテキストを提供するProvider
 */
export function AnalysisProvider({
    analysisSettings,
    onAnalysisSettingsChange,
    analysisNnueSelection,
    onAnalysisNnueSelectionChange,
    nnueList,
    isNnueListLoading,
    presetConfigs,
    isAnalyzing,
    analyzingState,
    batchAnalysis,
    handleAnalyzePly,
    handleAnalyzeHintPly,
    handleStartBatchAnalysis,
    handleCancelBatchAnalysis,
    handleAnalyzeNode,
    handleAnalyzeBranch,
    handleStartTreeBatchAnalysis,
    children,
}: AnalysisProviderProps): ReactNode {
    const value: AnalysisContextValue = {
        analysisSettings,
        onAnalysisSettingsChange,
        analysisNnueSelection,
        onAnalysisNnueSelectionChange,
        nnueList,
        isNnueListLoading,
        presetConfigs,
        isAnalyzing,
        analyzingState,
        batchAnalysis,
        handleAnalyzePly,
        handleAnalyzeHintPly,
        handleStartBatchAnalysis,
        handleCancelBatchAnalysis,
        handleAnalyzeNode,
        handleAnalyzeBranch,
        handleStartTreeBatchAnalysis,
    };

    return <AnalysisContext.Provider value={value}>{children}</AnalysisContext.Provider>;
}

/**
 * 分析コンテキストを取得するフック
 *
 * Provider の外で使用した場合はエラーをスロー。
 */
export function useAnalysis(): AnalysisContextValue {
    const ctx = useContext(AnalysisContext);
    if (!ctx) {
        throw new Error("useAnalysis must be used within an AnalysisProvider");
    }
    return ctx;
}
