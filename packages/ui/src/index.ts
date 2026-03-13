/**
 * @shogi/ui パッケージ公開 API
 *
 * 共通UIコンポーネント
 */

// ============================================================
// Hooks
// ============================================================

export {
    dispatchLocalStorageSyncEvent,
    LOCAL_STORAGE_SYNC_EVENT,
} from "./components/shogi-match/hooks/useLocalStorage";
export { useDevMode } from "./hooks/useDevMode";
export { useNnueStorage } from "./hooks/useNnueStorage";
export type { UseRoomConnectionOptions, UseRoomConnectionReturn } from "./hooks/useRoomConnection";
export { useRoomConnection } from "./hooks/useRoomConnection";
// ============================================================
// Components
// ============================================================

// AboutDialog
// alert-dialog
// button
// dialog

// engine-control-panel
export { EngineControlPanel } from "./components/engine-control-panel";
export type {
    PositionPreset,
    PositionPresetSelectorProps,
} from "./components/PositionPresetSelector";
// input
// popover
// position-preset-selector
export { POSITION_PRESETS, PositionPresetSelector } from "./components/PositionPresetSelector";
export type { ShogiBoardCell, ShogiBoardPiece } from "./components/shogi-board";
// shogi-board (online game 用)
export { ShogiBoard } from "./components/shogi-board";
export { BottomSheet } from "./components/shogi-match/components/BottomSheet";
export { HandPiecesDisplay } from "./components/shogi-match/components/HandPiecesDisplay";
export { KifuNavigationToolbar } from "./components/shogi-match/components/KifuNavigationToolbar";
export { boardToGrid } from "./components/shogi-match/utils/positionUtils";

// progress
// shogi-board

export type { AnalysisMoveResult, OnlineAnalysis } from "./components/online-game-view";

// online-game-view
export { OnlineGameView } from "./components/online-game-view";
export type { RemoteNnueFile, RemoteNnueManager } from "./components/nnue/types";
// shogi-match
export { ShogiMatch } from "./components/shogi-match";

// shogi-match/types
export type {
    AnalysisSettings,
    AnalysisSnapshotDraft,
    EngineOption,
} from "./components/shogi-match/types";
// spinner
// tooltip

// ============================================================
// Providers
// ============================================================

// NnueContext
export { NnueProvider } from "./providers/NnueContext";
