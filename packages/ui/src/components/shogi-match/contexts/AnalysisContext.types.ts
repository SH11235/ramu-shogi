/**
 * AnalysisContext 型定義
 *
 * 解析コンテキストの型を定義
 */

import type { NnueMeta, NnueSelection, PresetConfig } from "@shogi/app-core";
import type { AnalysisSettings, AnalyzingState } from "../types";

/**
 * 一括解析状態
 */
export interface BatchAnalysisState {
    isRunning: boolean;
    currentIndex: number;
    totalCount: number;
    inProgress?: number[];
}

/**
 * 分析コンテキスト値
 *
 * 変更頻度: 中（分析実行時に更新）
 *
 * 責務:
 * - 解析設定の管理
 * - 単発解析・一括解析の実行
 * - 解析状態の追跡
 * - 解析用NNUE評価関数の選択
 */
export interface AnalysisContextValue {
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
    handleStartBatchAnalysis: () => void;
    handleCancelBatchAnalysis: () => void;
    handleAnalyzeNode: (nodeId: string) => void;
    handleAnalyzeBranch: (branchNodeId: string) => void;
    handleStartTreeBatchAnalysis: (options?: { mainLineOnly?: boolean }) => void;
}
