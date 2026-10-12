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
// game/csa-move
export { applyCsaMoveStrict } from "./game/csa-move";
// game/csa-position
export type { CsaStartPosition } from "./game/csa-position";
export { parseCsaStartPosition } from "./game/csa-position";
// game/csa-record
export type { CsaEvalComment, CsaGameRecord, CsaMoveAnnotation } from "./game/csa-record";
export {
    CSA_MATE_EVAL_THRESHOLD,
    parseCsaEvalComment,
    parseCsaGameRecord,
} from "./game/csa-record";
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
    LayerStacksConfig,
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

export {
    encodeProgressCoefficients,
    PROGRESS_COEFFICIENTS_SIZE,
    validateLayerStacks,
} from "./nnue/layer-stacks";

// ============================================================
// study モジュール（研究ノート）
// ============================================================

// study/analysis
export type {
    StudyAnalysisCollector,
    StudyAnalysisCollectorOptions,
    StudyAnalysisCompletion,
    StudyAnalysisInfo,
    StudyLayerRef,
    StudyLayerSpecInput,
} from "./study/analysis";
export {
    buildStudyLayerDisplay,
    buildStudyLayerRefFromNnue,
    buildStudyLayerSpec,
    createStudyAnalysisCollector,
    createStudyLayerRef,
    STUDY_ALTERNATIVE_PV_LENGTH,
} from "./study/analysis";
// study/doc-diff
export { diffStudyDocuments } from "./study/doc-diff";
// study/highlights
export type { StudyHighlight, StudyHighlightKind } from "./study/highlights";
export {
    computeStudyHighlights,
    STUDY_BLUNDER_DROP,
    STUDY_DUBIOUS_DROP,
    STUDY_WIN_RATE_MODEL,
    STUDY_WIN_RATE_SCALE_CP,
    studyScoreToSenteWinRate,
} from "./study/highlights";
// study/ids
export {
    canonicalJSON,
    normalizeStudyStartSfen,
    studyChildNodeId,
    studyHash,
    studyLayerId,
    studyOriginKey,
    studyRootNodeId,
} from "./study/ids";
// study/import
export type {
    StudyCsaImportInput,
    StudyImportAnnotation,
    StudyImportInput,
    StudyKifuTreeImportInput,
} from "./study/import";
export {
    createStudyDocumentFromCsa,
    createStudyDocumentFromKifuTree,
    createStudyDocumentFromMoves,
    generateStudyId,
} from "./study/import";
// study/ops
export {
    applyStudyOp,
    applyStudyOps,
    compareStudyAnalysisPriority,
    isStudyUsiMove,
    mergeStudyComments,
    StudyOpError,
    sanitizeStudyPv,
    studyDocumentToOps,
} from "./study/ops";
// study/pass
export {
    applyStudyMoveWithState,
    isStudyPassMove,
    STUDY_PASS_MOVE,
    studyPassRightsForLine,
} from "./study/pass";
// study/score
export {
    kifuEvalToStudyScore,
    legacyEvalToStudyScore,
    STUDY_LEGACY_MATE_WITHOUT_PLY,
    studyScoreToKifuEval,
    studyScoreToLegacyEval,
} from "./study/score";
// study/sfen
export { parseStudySfen } from "./study/sfen";
// study/sha256
export { sha256Hex, utf8Encode } from "./study/sha256";
// study/tree-convert
export type {
    KifuTreeToStudyOptions,
    KifuTreeToStudyResult,
    StudyNodeIdIndex,
    StudyToKifuTreeOptions,
    StudyToKifuTreeResult,
} from "./study/tree-convert";
export {
    buildStudyNodeIdIndex,
    diffKifuTreeToStudyOps,
    kifuTreeToStudyTree,
    studyCandidateToKifuEval,
    studyDocumentToKifuTree,
    studyResultToKifuEvals,
} from "./study/tree-convert";
// study/types
export type {
    StudyAnalysisResult,
    StudyCandidate,
    StudyDocument,
    StudyEngineKind,
    StudyExecution,
    StudyLayer,
    StudyLayerDisplay,
    StudyLayerSpec,
    StudyLayerStacksSpec,
    StudyLimitName,
    StudyMeta,
    StudyNode,
    StudyOp,
    StudyOrigin,
    StudyOriginKind,
    StudyPlayer,
    StudyRules,
    StudyScore,
    StudySource,
    StudyTree,
} from "./study/types";
export { STANDARD_STUDY_RULES, STUDY_HIRATE_SFEN, STUDY_LIMITS } from "./study/types";
// study/validation
export {
    applyStudyOpsStrict,
    assertStudyAnalysisResult,
    assertStudyComment,
    assertStudyLayerDisplay,
    assertStudyLayerSpec,
    assertStudyOpInput,
    assertStudySource,
    assertStudyTitle,
    isBoundedStudyJson,
    isStudyStartSfen,
    isStudyUuid,
    STUDY_FREE_JSON_MAX_DEPTH,
    StudyLimitError,
    validateStudyDocument,
} from "./study/validation";
