/**
 * useUIState
 *
 * UI状態を統合するフック
 * - ビュー状態（盤面反転、棋譜表示モード）
 * - ダイアログ・パネル（PVプレビュー、手詳細）
 * - 分岐関連（選択中の分岐、最後に追加された分岐）
 * - 一括解析状態
 */

import type { PositionState } from "@shogi/app-core";
import { useState } from "react";
import type { KifuViewMode } from "../components/KifuPanel";

interface PvPreviewState {
    open: boolean;
    ply: number;
    pv: string[];
    startPosition: PositionState;
    evalCp?: number;
    evalMate?: number;
}

interface SelectedMoveDetailState {
    ply: number;
    position: PositionState;
}

interface LastAddedBranchInfo {
    ply: number;
    firstMove: string;
}

interface BatchAnalysisState {
    isRunning: boolean;
    currentIndex: number;
    totalCount: number;
    targetPlies: number[];
    inProgress?: number[];
}

interface UseUIStateResult {
    // ビュー状態
    flipBoard: boolean;
    setFlipBoard: (flip: boolean) => void;
    kifuViewMode: KifuViewMode;
    setKifuViewMode: (mode: KifuViewMode) => void;

    // PVプレビュー
    pvPreview: PvPreviewState | null;
    setPvPreview: (state: PvPreviewState | null) => void;

    // 手詳細
    selectedMoveDetailPly: SelectedMoveDetailState | null;
    setSelectedMoveDetailPly: (state: SelectedMoveDetailState | null) => void;

    // 分岐関連
    selectedBranchNodeId: string | null;
    setSelectedBranchNodeId: (id: string | null) => void;
    lastAddedBranchInfo: LastAddedBranchInfo | null;
    setLastAddedBranchInfo: (info: LastAddedBranchInfo | null) => void;

    // 一括解析
    batchAnalysis: BatchAnalysisState | null;
    setBatchAnalysis: (state: BatchAnalysisState | null) => void;
}

/**
 * UI状態を統合するフック
 */
export function useUIState(): UseUIStateResult {
    // ビュー状態
    const [flipBoard, setFlipBoard] = useState(false);
    const [kifuViewMode, setKifuViewMode] = useState<KifuViewMode>("main");

    // PVプレビュー
    const [pvPreview, setPvPreview] = useState<PvPreviewState | null>(null);

    // 手詳細
    const [selectedMoveDetailPly, setSelectedMoveDetailPly] =
        useState<SelectedMoveDetailState | null>(null);

    // 分岐関連
    const [selectedBranchNodeId, setSelectedBranchNodeId] = useState<string | null>(null);
    const [lastAddedBranchInfo, setLastAddedBranchInfo] = useState<LastAddedBranchInfo | null>(
        null,
    );

    // 一括解析
    const [batchAnalysis, setBatchAnalysis] = useState<BatchAnalysisState | null>(null);

    return {
        // ビュー状態
        flipBoard,
        setFlipBoard,
        kifuViewMode,
        setKifuViewMode,
        // PVプレビュー
        pvPreview,
        setPvPreview,
        // 手詳細
        selectedMoveDetailPly,
        setSelectedMoveDetailPly,
        // 分岐関連
        selectedBranchNodeId,
        setSelectedBranchNodeId,
        lastAddedBranchInfo,
        setLastAddedBranchInfo,
        // 一括解析
        batchAnalysis,
        setBatchAnalysis,
    };
}
