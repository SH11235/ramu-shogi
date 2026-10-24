import type { EngineSpeedEnvironment } from "@shogi/app-controller";
import { withNpsRecording } from "@shogi/app-controller";
import { createWasmEngineClient, getWasmMaxThreads } from "@shogi/engine-wasm";
import { resolveBuiltinEngineIdentity } from "../lib/builtinEngine";
import { nnueStorage } from "./nnue-storage";

export const getWebWasmMaxThreads = (): number => getWasmMaxThreads();

export const DEFAULT_WASM_THREADS = 4;

export function resolveWasmThreads(raw = import.meta.env.VITE_WASM_THREADS): number {
    if (typeof raw !== "string" || raw.trim() === "") return DEFAULT_WASM_THREADS;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_WASM_THREADS;
    return Math.trunc(parsed);
}

const wasmThreads = resolveWasmThreads();

const builtinEngine = resolveBuiltinEngineIdentity();

export const webEngineSpeedEnvironment: EngineSpeedEnvironment = {
    engineVersion: `wasm:${builtinEngine.version ?? `app-${builtinEngine.appVersion}`}`,
    threaded:
        typeof crossOriginIsolated !== "undefined" &&
        crossOriginIsolated &&
        typeof SharedArrayBuffer !== "undefined",
};

const resolveContentHash = async (nnueId: string) =>
    (await nnueStorage.getMeta(nnueId))?.contentHashSha256 ?? null;

const createRawClient = () =>
    createWasmEngineClient({
        stopMode: "terminate",
        defaultInitOptions: { threads: wasmThreads },
        logWarningsToConsole: true,
    });

export const createWebWasmEngineClient = () =>
    withNpsRecording(createRawClient(), {
        environment: webEngineSpeedEnvironment,
        resolveContentHash,
    });

/** 「速さを測る」用。動いているエンジンとしては数えるが、対局での実測には入れない。 */
export const createWebSpeedBenchmarkClient = () =>
    withNpsRecording(createRawClient(), {
        environment: webEngineSpeedEnvironment,
        resolveContentHash,
        record: false,
    });
