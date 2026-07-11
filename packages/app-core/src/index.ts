/**
 * @shogi/app-core パッケージ公開 API
 *
 * 完全に依存なし（純粋なドメインロジック）
 * - game: 局面/棋譜処理
 * - nnue: NNUE 管理
 * - engine: エンジン設定
 */

// ============================================================
// game モジュール
// ============================================================

// game/board
export type {
    BoardState,
    Hands,
    LastMove,
    PassRightsState,
    Piece,
    PieceType,
    Player,
    PositionState,
    Square,
} from "./game/board";

export {
    applyMove,
    applyMoveWithState,
    BOARD_FILES,
    BOARD_RANKS,
    boardFromMoves,
    boardToMatrix,
    canPass,
    cloneBoard,
    createEmptyHands,
    createInitialBoard,
    createInitialPositionState,
    deriveLastMove,
    getAllSquares,
    isPassMove,
    parseMove,
    replayMoves,
} from "./game/board";
// game/csa
export {
    buildBoardFromCsa,
    movesToCsa,
    parseCsaMoves,
    parseCsaMovesWithState,
    parseSingleCsaMove,
} from "./game/csa";
// game/kifu-tree
export type {
    AddMoveOptions,
    KifuEval,
    KifuNode,
    KifuTree,
    MoveSearchStats,
    PreferredPathCache,
} from "./game/kifu-tree";
export {
    addMove,
    createKifuTree,
    createPreferredPathCache,
    findNodeByPlyInCurrentPath,
    findNodeByPlyInMainLine,
    getBranchInfo,
    getCurrentNode,
    getMainLineMoves,
    getMainLineTotalPly,
    getMovesToCurrent,
    getPathToNode,
    goBack,
    goForward,
    goToEnd,
    goToNode,
    goToPly,
    goToStart,
    hasBranchAtCurrent,
    isRewound,
    promoteToMainLine,
    setNodeComment,
    setNodeEval,
    setNodeMultiPvEval,
    switchBranch,
    truncateFromCurrent,
} from "./game/kifu-tree";
// game/position-service
export type {
    BoardStateJson,
    PositionService,
    ReplayResult,
    ReplayResultJson,
} from "./game/position-service";
export {
    boardJsonToPositionState,
    positionStateToBoardJson,
} from "./game/position-service";
// game/position-service-registry
export {
    getPositionService,
    setPositionServiceFactory,
} from "./game/position-service-registry";
// game/result
export type { GameResult } from "./game/result";
export {
    getReasonText,
    getWinnerLabel,
} from "./game/result";

// ============================================================
// nnue モジュール
// ============================================================

// nnue/constants
export {
    NNUE_DB_NAME,
    NNUE_DB_VERSION,
    NNUE_HEADER_SIZE,
    NNUE_MAX_SIZE_BYTES,
    NNUE_PROGRESS_THROTTLE_MS,
} from "./nnue/constants";
// nnue/errors
export {
    getNnueErrorMessage,
    NnueError,
} from "./nnue/errors";

// nnue/preset-manager
export type {
    PresetManager,
    PresetWithStatus,
} from "./nnue/preset-manager";

export {
    createPresetManager,
    downloadPreset,
    fetchPresetManifest,
    getAllPresetStatuses,
    getPresetStatus,
} from "./nnue/preset-manager";

// nnue/storage
export type {
    NnueStorage,
    NnueStorageCapabilities,
} from "./nnue/storage";
// nnue/types
export type {
    NnueDownloadProgress,
    NnueFormat,
    NnueMeta,
    NnueSelection,
    PresetConfig,
    PresetManifest,
    PresetStatus,
    PresetUpdate,
    ResolvedNnue,
} from "./nnue/types";
export {
    createDefaultNnueSelection,
    DEFAULT_PRESET_KEY,
    NONE_NNUE_SELECTION,
} from "./nnue/types";

// nnue/utils
export { generateNnueId } from "./nnue/utils";

// ============================================================
// engine モジュール
// ============================================================

// engine/parallelism
export {
    detectParallelism,
    resolveWorkerCount,
} from "./engine/parallelism";
