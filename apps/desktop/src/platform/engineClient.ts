import type { EngineSpeedEnvironment } from "@shogi/app-controller";
import { withNpsRecording } from "@shogi/app-controller";
import { createTauriEngineClient, createTauriNnueStorage } from "@shogi/engine-tauri";

// Tauri版のストレージは同期的に初期化可能
export const nnueStorage = createTauriNnueStorage();

const rshogiCoreVersion = import.meta.env.VITE_RSHOGI_CORE_VERSION?.trim();

const desktopEngineSpeedEnvironment: EngineSpeedEnvironment = {
    engineVersion: `native:${rshogiCoreVersion || `app-${import.meta.env.VITE_APP_VERSION?.trim() || "0.0.0"}`}`,
    threaded: true,
};

const resolveContentHash = async (nnueId: string) =>
    (await nnueStorage.getMeta(nnueId))?.contentHashSha256 ?? null;

const createRawClient = () =>
    createTauriEngineClient({
        stopMode: "terminate",
        useMockOnError: false,
        debug: true,
    });

export const createEngineClient = () =>
    withNpsRecording(createRawClient(), {
        environment: desktopEngineSpeedEnvironment,
        resolveContentHash,
    });

/** 「速さを測る」用。動いているエンジンとしては数えるが、対局での実測には入れない。 */
const createSpeedBenchmarkClient = () =>
    withNpsRecording(createRawClient(), {
        environment: desktopEngineSpeedEnvironment,
        resolveContentHash,
        record: false,
    });

export const desktopSpeedSupport = {
    environment: desktopEngineSpeedEnvironment,
    createBenchmarkClient: createSpeedBenchmarkClient,
};
