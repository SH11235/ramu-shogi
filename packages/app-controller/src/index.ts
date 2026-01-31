/**
 * @shogi/app-controller パッケージ公開 API
 *
 * エンジン制御、状態管理、ライフサイクル管理
 */

// ============================================================
// Types
// ============================================================

export type {
    AnalysisRequest,
    EngineClockState,
    EngineController,
    EngineControllerActiveSearch,
    EngineControllerBestmoveHandlerParams,
    EngineControllerBestmoveParams,
    EngineControllerBestmoveResult,
    EngineControllerCallbacks,
    EngineControllerCommand,
    EngineControllerDependencies,
    EngineControllerErrorLog,
    EngineControllerEvent,
    EngineControllerInfoHandlerParams,
    EngineControllerPosition,
    EngineControllerSearchState,
    EngineControllerSides,
    EngineControllerState,
    EngineControllerSyncContext,
    EngineErrorDetails,
    EngineOption,
    EngineStatus,
    PassRightsSettings,
    SideRole,
    SideSetting,
} from "./engine-controller";

// ============================================================
// Functions
// ============================================================

export {
    createEngineController,
    determineBestmoveAction,
    handleBestmove,
    handleInfoEvent,
} from "./engine-controller";
