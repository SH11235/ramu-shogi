import { createWasmEngineClient } from "@shogi/engine-wasm";

export const DEFAULT_WASM_THREADS = 4;

export function resolveWasmThreads(raw = import.meta.env.VITE_WASM_THREADS): number {
    if (typeof raw !== "string" || raw.trim() === "") return DEFAULT_WASM_THREADS;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_WASM_THREADS;
    return Math.trunc(parsed);
}

const wasmThreads = resolveWasmThreads();

export const createWebWasmEngineClient = () =>
    createWasmEngineClient({
        stopMode: "terminate",
        defaultInitOptions: { threads: wasmThreads },
        logWarningsToConsole: true,
    });
