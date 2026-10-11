import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
    configure_layer_stacks,
    detect_nnue_format,
    init,
    initSync,
    load_model,
    search,
    set_event_handler,
    set_option,
} from "../pkg/engine_wasm.js";

// Usage: node scripts/smoke-nnue.mjs model.bin [kingrank9|progresskpabs|progresskpabsq16] [buckets] [progress.bin] [fvScale]
const [modelPath, bucketMode, buckets, coefficientPath, fvScale = "28"] = process.argv.slice(2);
if (!modelPath) throw new Error("Specify a model file");
if (!Number.isInteger(Number(fvScale)) || Number(fvScale) < 1 || Number(fvScale) > 100)
    throw new Error("FV_SCALE must be an integer between 1 and 100");
initSync({ module: readFileSync(new URL("../pkg/engine_wasm_bg.wasm", import.meta.url)) });
init({ ttSizeMb: 16, threads: 1 });
const bytes = readFileSync(modelPath);
const format = detect_nnue_format(bytes.subarray(0, 1024), BigInt(bytes.length));
configure_layer_stacks(
    bucketMode
        ? {
              bucketMode,
              progressBuckets: buckets ? Number(buckets) : undefined,
              progressCoeffBase64: coefficientPath
                  ? readFileSync(coefficientPath).toString("base64")
                  : undefined,
          }
        : undefined,
);
load_model(bytes);
set_option("FV_SCALE", Number(fvScale));
const events = [];
set_event_handler((event) => events.push(event));
search({ limits: { maxDepth: 2 } });
const bestmove = events.find((event) => event.type === "bestmove");
assert.ok(bestmove && bestmove.move !== "resign", "Expected a move from the initial position");
assert.ok(!events.some((event) => event.type === "error"), "Engine reported an error");
console.log(JSON.stringify({ format, fvScale: Number(fvScale), bestmove }));
