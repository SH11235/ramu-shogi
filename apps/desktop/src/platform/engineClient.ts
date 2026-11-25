import type { EngineOption, EngineSpeedEnvironment } from "@shogi/app-controller";
import { withNpsRecording } from "@shogi/app-controller";
import {
    createTauriBatchEngineClient,
    createTauriEngineClient,
    createTauriNnueStorage,
} from "@shogi/engine-tauri";

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

const recordSpeed = (client: ReturnType<typeof createRawClient>) =>
    withNpsRecording(client, {
        environment: desktopEngineSpeedEnvironment,
        resolveContentHash,
    });

export const createEngineClient = () => recordSpeed(createRawClient());

const createBatchClient = () => recordSpeed(createTauriBatchEngineClient());

export const builtinEngineOption = (maxParallel: number): EngineOption => ({
    id: "native",
    label: "内蔵エンジン",
    createClient: createEngineClient,
    kind: "internal",
    maxParallel: 1,
    batch: { createClient: createBatchClient, maxParallel },
});

// 計測はしない。アプリ全体で 1 つのエンジンを共有していて、評価関数は起動中に 1 回しか
// 読み込めないので、計測で別の評価関数を読むと対局・解析でその AI しか使えなくなる。
export const desktopSpeedSupport = { environment: desktopEngineSpeedEnvironment };
