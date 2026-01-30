/**
 * NavigationContext
 *
 * 棋譜ナビゲーション状態を管理するContext
 * - ナビゲーション状態（currentPly, totalPly等）
 * - ナビゲーションハンドラ（goBack, goForward等）
 * - 棋譜データ（kifMoves, evalHistory, positionHistory）
 * - 分岐関連の状態
 *
 * 変更頻度: 高（ユーザー操作ごと）
 */

import type { KifuTree, PositionState } from "@shogi/app-core";
import { createContext, type ReactNode, useContext } from "react";
import type { DisplaySettings } from "../types";
import type { EvalHistory, KifMove } from "../utils/kifFormat";
import type {
    KifuViewMode,
    NavigationContextValue,
    NavigationHandlers,
    NavigationState,
} from "./types";

const NavigationContext = createContext<NavigationContextValue | null>(null);

interface NavigationProviderProps {
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
    handleMoveDetailSelect: (move: KifMove | null, position: PositionState | null) => void;

    // 対局状態（ナビゲーション無効化用）
    isMatchRunning: boolean;

    children: ReactNode;
}

/**
 * 棋譜ナビゲーションコンテキストを提供するProvider
 */
export function NavigationProvider({
    navigationState,
    navigationHandlers,
    kifMoves,
    evalHistory,
    displayEvalHistory,
    positionHistory,
    kifuTree,
    selectedBranchNodeId,
    onSelectedBranchChange,
    branchMarkers,
    lastAddedBranchInfo,
    onLastAddedBranchHandled,
    handleAddPvAsBranch,
    handlePreviewPv,
    kifuViewMode,
    onViewModeChange,
    displaySettings,
    onDisplaySettingsChange,
    handlePlySelect,
    handleCopyKif,
    handleMoveDetailSelect,
    isMatchRunning,
    children,
}: NavigationProviderProps): ReactNode {
    const value: NavigationContextValue = {
        navigationState,
        navigationHandlers,
        kifMoves,
        evalHistory,
        displayEvalHistory,
        positionHistory,
        kifuTree,
        selectedBranchNodeId,
        onSelectedBranchChange,
        branchMarkers,
        lastAddedBranchInfo,
        onLastAddedBranchHandled,
        handleAddPvAsBranch,
        handlePreviewPv,
        kifuViewMode,
        onViewModeChange,
        displaySettings,
        onDisplaySettingsChange,
        handlePlySelect,
        handleCopyKif,
        handleMoveDetailSelect,
        isMatchRunning,
    };

    return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}

/**
 * 棋譜ナビゲーションコンテキストを取得するフック
 *
 * Provider の外で使用した場合はエラーをスロー。
 */
export function useNavigation(): NavigationContextValue {
    const ctx = useContext(NavigationContext);
    if (!ctx) {
        throw new Error("useNavigation must be used within a NavigationProvider");
    }
    return ctx;
}
