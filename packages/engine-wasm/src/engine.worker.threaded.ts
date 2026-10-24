import initWasm, {
    apply_moves as applyMoves,
    configure_layer_stacks as configureLayerStacks,
    dispose as disposeEngine,
    init as initEngine,
    initThreadPool as initThreadPoolWasm,
    load_model as loadModel,
    load_position as loadPosition,
    prepare_analysis as prepareAnalysis,
    release_analysis as releaseAnalysis,
    run_analysis as runAnalysis,
    search as runSearch,
    set_event_handler as setEventHandler,
    set_option as setOption,
    solve_mate as solveMate,
    stop as stopEngine,
} from "../pkg-threaded/engine_wasm.js";
import { createEngineWorker } from "./engine.worker.base";

type WasmExports = { memory?: WebAssembly.Memory };
type InitInput = Parameters<typeof initWasm>[0];

const initWasmWithCache = async (input?: InitInput) => {
    const exports = (await initWasm(input)) as WasmExports;
    return exports;
};

// wasm-bindgen-rayon's init_thread_pool returns a Promise that resolves
// when all worker threads are ready. This handles the async Worker creation
// that caused deadlocks with the previous wasm_thread approach.
const initThreadPool = async (poolSize: number) => {
    await initThreadPoolWasm(poolSize);
};

createEngineWorker({
    initWasm: initWasmWithCache,
    applyMoves,
    prepareAnalysis,
    runAnalysis,
    releaseAnalysis,
    solveMate,
    disposeEngine,
    initEngine,
    loadModel,
    configureLayerStacks,
    loadPosition,
    runSearch,
    setEventHandler,
    setOption,
    stopEngine,
    initThreadPool,
    defaultWasmModuleUrl: new URL("../pkg-threaded/engine_wasm_bg.wasm", import.meta.url),
});
