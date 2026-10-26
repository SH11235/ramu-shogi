/**
 * @shogi/ui パッケージ公開 API
 *
 * 共通UIコンポーネント
 */

// ============================================================
// Hooks
// ============================================================

export { useIsMobile } from "./components/shogi-match/hooks/useMediaQuery";
export { useDevMode } from "./hooks/useDevMode";
export { useRoomConnection } from "./hooks/useRoomConnection";

// ============================================================
// Components
// ============================================================

export { BookTreeViewer } from "./components/book-tree-viewer/BookTreeViewer";
export { ConnectionLostNotice } from "./components/connection-lost-notice";
export { EngineControlPanel } from "./components/engine-control-panel";
export { NnueLibrary } from "./components/nnue-library/NnueLibrary";
export { NnueLibraryDialog } from "./components/nnue-library/NnueLibraryDialog";
export type { NnueAccountFile, NnueAccountStore } from "./components/nnue-library/types";
export type { AnalysisMoveResult, OnlineAnalysis } from "./components/online-game-view";
export { OnlineGameView } from "./components/online-game-view";
export {
    onlineStartSfenProblem,
    PositionPresetSelector,
} from "./components/PositionPresetSelector";
export type { RshogiGameBrowserSearch } from "./components/rshogi-csa-game-browser";
export { RshogiCsaGameBrowser } from "./components/rshogi-csa-game-browser";
export { RshogiCsaLiveViewer } from "./components/rshogi-csa-live-viewer";
export { RshogiCsaViewer } from "./components/rshogi-csa-viewer";
export type { PlayFromPosition } from "./components/rshogi-play-from-position";
export { ShogiMatch } from "./components/shogi-match";
export { StoredBoardPatternProvider } from "./components/shogi-match/hooks/useBoardPattern";
export type { EngineOption } from "./components/shogi-match/types";
export { StaticBoardView } from "./components/static-board-view";
// study-workspace（研究ノートの画面）
export type {
    StudyCommentDraft,
    StudyWorkspaceProps,
    StudyWorkspaceViewState,
} from "./components/study-workspace";
export { StudyWorkspace } from "./components/study-workspace";

// ============================================================
// Providers
// ============================================================

export { NnueProvider } from "./providers/NnueContext";
