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
    EngineController,
    EngineControllerErrorLog,
    EngineControllerEvent,
    EngineControllerState,
    EngineErrorDetails,
    EngineOption,
    EngineStatus,
    PassRightsSettings,
    SideSetting,
} from "./engine-controller";

// ============================================================
// Functions
// ============================================================

export type {
    AnalysisTarget,
    InteractiveAnalysisOptions,
    InteractiveAnalysisState,
} from "./analysis-controller";
export { createAnalysisController } from "./analysis-controller";
export { createEngineController } from "./engine-controller";
