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
export type { UseRshogiLiveGameListReturn } from "./hooks/useRshogiLiveGameList";
export { useRshogiLiveGameList } from "./hooks/useRshogiLiveGameList";
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
export { Popover, PopoverContent, PopoverTrigger } from "./components/popover";
export type { ShogiBoardCell, ShogiBoardPiece } from "./components/shogi-board";
// shogi-board (online game 用)
export { ShogiBoard } from "./components/shogi-board";
export { BottomSheet } from "./components/shogi-match/components/BottomSheet";
export { HandPiecesDisplay } from "./components/shogi-match/components/HandPiecesDisplay";
export { KifuNavigationToolbar } from "./components/shogi-match/components/KifuNavigationToolbar";
export { boardToGrid } from "./components/shogi-match/utils/positionUtils";

// progress
// shogi-board

export { listMockRshogiGameIds } from "@shogi/match-client";
export type { RemoteNnueFile, RemoteNnueManager } from "./components/nnue/types";
export type { AnalysisMoveResult, OnlineAnalysis } from "./components/online-game-view";
// online-game-view
export { OnlineGameView } from "./components/online-game-view";
export type { RshogiCsaGameListProps } from "./components/rshogi-csa-game-list";
// rshogi-csa-game-list
export { RshogiCsaGameList } from "./components/rshogi-csa-game-list";
export type { RshogiCsaLiveGameListProps } from "./components/rshogi-csa-live-game-list";
// rshogi-csa-live-game-list
export { RshogiCsaLiveGameList } from "./components/rshogi-csa-live-game-list";
export type { RshogiCsaLiveViewerProps } from "./components/rshogi-csa-live-viewer";
// rshogi-csa-live-viewer
export { RshogiCsaLiveViewer } from "./components/rshogi-csa-live-viewer";
export type { RshogiCsaViewerProps } from "./components/rshogi-csa-viewer";
// rshogi-csa-viewer
export { RshogiCsaViewer } from "./components/rshogi-csa-viewer";
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
