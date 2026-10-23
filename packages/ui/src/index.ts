/**
 * @shogi/ui パッケージ公開 API
 *
 * 共通UIコンポーネント
 */

// ============================================================
// Hooks
// ============================================================

export { NnueLibrary } from "./components/nnue-library/NnueLibrary";
export type { NnueAccountFile, NnueAccountStore } from "./components/nnue-library/types";
// 一括解析（研究ノートの画面でも使う）
export type { AnalysisJob, EnginePoolHandle } from "./components/shogi-match/hooks/useEnginePool";
export { useEnginePool } from "./components/shogi-match/hooks/useEnginePool";
export {
    dispatchLocalStorageSyncEvent,
    LOCAL_STORAGE_SYNC_EVENT,
} from "./components/shogi-match/hooks/useLocalStorage";
export { useIsMobile } from "./components/shogi-match/hooks/useMediaQuery";
export type { TreeAnalysisJob } from "./components/shogi-match/utils/branchTreeUtils";
export { collectTreeAnalysisJobs } from "./components/shogi-match/utils/branchTreeUtils";
export { useDevMode } from "./hooks/useDevMode";
export { useNnueStorage } from "./hooks/useNnueStorage";
export type { UseRoomConnectionOptions, UseRoomConnectionReturn } from "./hooks/useRoomConnection";
export { useRoomConnection } from "./hooks/useRoomConnection";

// ============================================================
// Components
// ============================================================

export { BookTreeViewer } from "./components/book-tree-viewer/BookTreeViewer";

// engine-control-panel
export { EngineControlPanel } from "./components/engine-control-panel";
export type {
    PositionPreset,
    PositionPresetSelectorProps,
} from "./components/PositionPresetSelector";
// input
// popover
// position-preset-selector
export {
    onlineStartSfenProblem,
    POSITION_PRESETS,
    PositionPresetSelector,
} from "./components/PositionPresetSelector";
export { Popover, PopoverContent, PopoverTrigger } from "./components/popover";
// AboutDialog
// alert-dialog
// button
// dialog
export {
    Sheet,
    SheetClose,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
} from "./components/sheet";
export type { ShogiBoardCell, ShogiBoardPiece } from "./components/shogi-board";
// shogi-board (online game 用)
export { ShogiBoard } from "./components/shogi-board";
export { BottomSheet } from "./components/shogi-match/components/BottomSheet";
export { HandPiecesDisplay } from "./components/shogi-match/components/HandPiecesDisplay";
export { KifuNavigationToolbar } from "./components/shogi-match/components/KifuNavigationToolbar";
export {
    decodeSnapshotEvalMateReviver,
    encodeSnapshotEvalMateReplacer,
} from "./components/shogi-match/utils/kifFormat";
export { boardToGrid } from "./components/shogi-match/utils/positionUtils";
// study-workspace（研究ノートの画面）
export type {
    StudyCommentDraft,
    StudyWorkspaceProps,
    StudyWorkspaceViewState,
} from "./components/study-workspace";
export { StudyWorkspace } from "./components/study-workspace";
export type { StudyCommentDraftChange } from "./components/study-workspace/StudyCommentBox";
export type { StudyWorkspaceSaveStatus } from "./components/study-workspace/StudySaveStatus";
export type { StudyEngineIdentity } from "./components/study-workspace/useStudyAnalysis";
// surface-theme (Portal 脱出 UI への局所テーマ伝搬)
export type { SurfaceTheme } from "./components/surface-theme";
export { SurfaceThemeProvider, useSurfaceTheme } from "./components/surface-theme";

// progress
// shogi-board

export { listMockRshogiGameIds } from "@shogi/match-client";
export { ConnectionLostNotice } from "./components/connection-lost-notice";
export type { RemoteNnueFile, RemoteNnueManager } from "./components/nnue/types";
export type { AnalysisMoveResult, OnlineAnalysis } from "./components/online-game-view";
// online-game-view
export { OnlineGameView } from "./components/online-game-view";
export type {
    RshogiCsaGameBrowserProps,
    RshogiGameBrowserSearch,
} from "./components/rshogi-csa-game-browser";
// rshogi-csa-game-browser
export { RshogiCsaGameBrowser } from "./components/rshogi-csa-game-browser";
export type { RshogiCsaLiveViewerProps } from "./components/rshogi-csa-live-viewer";
// rshogi-csa-live-viewer
export { RshogiCsaLiveViewer } from "./components/rshogi-csa-live-viewer";
export type { RshogiCsaViewerProps } from "./components/rshogi-csa-viewer";
// rshogi-csa-viewer
export { RshogiCsaViewer } from "./components/rshogi-csa-viewer";
export type { PlayFromPosition } from "./components/rshogi-play-from-position";
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
