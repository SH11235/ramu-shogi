/**
 * NavigationContext 型定義
 *
 * 棋譜ナビゲーションコンテキストの型を定義
 */

import type { KifuTree, PositionState } from "@shogi/app-core";
import type { DisplaySettings } from "../types";
import type { EvalHistory, KifMove } from "../utils/kifFormat";

/**
 * ナビゲーション状態
 */
export interface NavigationState {
    currentPly: number;
    totalPly: number;
    isRewound: boolean;
    canGoForward: boolean;
    hasBranches: boolean;
    currentBranchIndex: number;
    branchCount: number;
    isOnMainLine: boolean;
}

/**
 * ナビゲーションハンドラ
 */
export interface NavigationHandlers {
    goBack: () => void;
    goForward: (branchNodeId?: string) => void;
    goToStart: () => void;
    goToEnd: () => void;
    switchBranch: (index: number) => void;
    promoteCurrentLine: () => void;
    goToNodeById: (nodeId: string) => void;
    switchBranchAtNode: (parentNodeId: string, branchIndex: number) => void;
}

/**
 * 棋譜表示モード
 */
export type KifuViewMode = "main" | "branches" | "selectedBranch";

/**
 * 棋譜ナビゲーションコンテキスト値
 *
 * 変更頻度: 高（ユーザー操作ごと）
 *
 * 責務:
 * - 棋譜の前後移動、分岐切り替え
 * - 棋譜ツリーの管理
 * - 評価値履歴の管理
 * - 棋譜表示モードの切り替え
 */
export interface NavigationContextValue {
    // ナビゲーション状態
    navigationState: NavigationState;
    navigationHandlers: NavigationHandlers;

    // 棋譜データ
    kifMoves: KifMove[];
    evalHistory: EvalHistory[];
    displayEvalHistory: EvalHistory[];
    positionHistory: PositionState[];
    kifuTree?: KifuTree;

    // 分岐関連
    selectedBranchNodeId: string | null;
    onSelectedBranchChange: (branchNodeId: string | null) => void;
    branchMarkers: Map<number, number>;
    /** AI 解析使用マーカー（ply -> 使用したシート一覧） */
    analysisMarkers: Array<{ seat: "b" | "w"; ply: number }>;
    lastAddedBranchInfo: { ply: number; firstMove: string } | null;
    onLastAddedBranchHandled: () => void;
    handleAddPvAsBranch: (ply: number, pv: string[]) => void;
    handlePreviewPv: (ply: number, pv: string[], evalCp?: number, evalMate?: number) => void;

    // 表示モード
    kifuViewMode: KifuViewMode;
    onViewModeChange: (mode: KifuViewMode) => void;

    // 表示設定
    displaySettings: DisplaySettings;
    onDisplaySettingsChange: (updater: (prev: DisplaySettings) => DisplaySettings) => void;

    // 手の選択
    handlePlySelect: (ply: number) => void;
    handleCopyKif: () => string;
    handleExportJsonl: () => Promise<void>;
    handleMoveDetailSelect: (move: KifMove | null, position: PositionState | null) => void;

    // 対局状態（ナビゲーション無効化用）
    isMatchRunning: boolean;
}
