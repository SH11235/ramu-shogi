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
    EngineSearchLimit,
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
export { buildPassRightsOption, createEngineController } from "./engine-controller";
export type { EngineSpeedEnvironment, NnueSpeedStore } from "./engine-speed";
export {
    engineActivity,
    NNUE_SPEED_BENCHMARK_MS_PER_POSITION,
    NNUE_SPEED_BENCHMARK_POSITIONS,
    nnueSpeedStore,
    runNnueSpeedBenchmark,
    withNpsRecording,
} from "./engine-speed";
