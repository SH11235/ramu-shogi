// 実ブラウザ・生成 Wasm・実 Rayon helper で協調停止と再開を確認する。
// node packages/engine-wasm/scripts/test-resume.mjs [NNUE ファイル]
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const require = createRequire(path.join(root, "apps/web/package.json"));
const { chromium } = require("@playwright/test");
const model = process.argv[2];
const workerSource = `
import initWasm, * as engine from '/packages/engine-wasm/pkg-threaded/engine_wasm.js';
let exports, active;
onmessage = async ({data: command}) => {
 try {
  if (command.type === 'init') {
   exports = await initWasm();
   if (command.threads > 1) await engine.initThreadPool(command.threads - 1);
   engine.init({ threads: command.threads, ttSizeMb: 4, evalHashSizeMb: 1, multiPv: command.multiPv });
   if (command.model) engine.load_model(new Uint8Array(await (await fetch('/model')).arrayBuffer()));
   else engine.set_option('MaterialLevel', 1);
   engine.load_position('startpos', []);
   engine.set_event_handler(info => { if (info.type === 'info') postMessage({type:'analysisInfo', ...active, info}); });
   postMessage({type:'ready'});
  } else if (command.type === 'prepareAnalysis') {
   const descriptor = engine.prepare_analysis(command.resume, command.budget);
   postMessage({type:'analysisPrepared', requestId:command.requestId, sessionId:command.sessionId, ...descriptor, buffer: exports.memory.buffer});
  } else if (command.type === 'runAnalysis') {
   active = {sessionId:command.sessionId, runId:command.runId};
   const result = engine.run_analysis(command.runId);
   postMessage({type:'analysisFinished', result:{...result, sessionId:command.sessionId, memoryBytes:exports.memory.buffer.byteLength}});
  } else if (command.type === 'releaseAnalysis') { engine.release_analysis(); }
 } catch (error) { postMessage({type:'analysisError', message:command.type+": "+String(error.stack ?? error)}); }
};
`;
const server = createServer(async (req, res) => {
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    try {
        const url = new URL(req.url, "http://localhost");
        if (url.pathname === "/") {
            res.setHeader("Content-Type", "text/html");
            res.end("<!doctype html><title>Resume verification</title>");
            return;
        }
        if (url.pathname === "/worker.js") {
            res.setHeader("Content-Type", "text/javascript");
            res.end(workerSource);
            return;
        }
        let filename =
            url.pathname === "/model" && model
                ? path.resolve(model)
                : path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
        if (url.pathname !== "/model" && !filename.startsWith(root + path.sep)) {
            res.writeHead(403).end();
            return;
        }
        if ((await stat(filename)).isDirectory()) filename = path.join(filename, "engine_wasm.js");
        res.setHeader(
            "Content-Type",
            filename.endsWith(".wasm") ? "application/wasm" : "text/javascript",
        );
        res.end(await readFile(filename));
    } catch (error) {
        res.writeHead(404).end(String(error));
    }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    page.on("console", (message) => {
        if (message.type() === "error" || message.text().startsWith("resume-case"))
            console.error(message.text());
    });
    page.on("pageerror", (error) => console.error("browser error:", error));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const results = await page.evaluate(
        async ({ model }) => {
            const { createAnalysisBridge } = await import(
                "/packages/engine-wasm/dist/analysisBridge.js"
            );
            const results = [];
            for (const threads of [1, 2, 4, 8])
                for (const multiPv of [1, 3]) {
                    console.log("resume-case", threads, multiPv);
                    const worker = new Worker("/worker.js", { type: "module" });
                    try {
                        await new Promise((resolve, reject) => {
                            const timeout = setTimeout(
                                () => reject(new Error("init timeout")),
                                30000,
                            );
                            worker.onerror = (error) => {
                                clearTimeout(timeout);
                                reject(new Error(error.message));
                            };
                            worker.onmessage = ({ data }) => {
                                if (data.type === "ready") {
                                    clearTimeout(timeout);
                                    resolve();
                                } else if (data.type === "analysisError") {
                                    clearTimeout(timeout);
                                    reject(new Error(data.message));
                                }
                            };
                            worker.postMessage({ type: "init", threads, multiPv, model });
                        });
                        const bridge = createAnalysisBridge({
                            available: () => true,
                            ready: async () => {},
                            send: (command) => worker.postMessage(command),
                            release: async () => {},
                            fail: () => worker.terminate(),
                        });
                        worker.onmessage = ({ data }) => bridge.receive(data);
                        let run, pauseStarted, pauseResult;
                        run = await bridge.client.start(
                            "session",
                            { type: "time", milliseconds: 2000 },
                            (info) => {
                                if (info.depth >= 2 && pauseStarted === undefined) {
                                    pauseStarted = performance.now();
                                    pauseResult = run.pause();
                                }
                            },
                        );
                        const first = await run.finished;
                        if (pauseResult) await pauseResult;
                        if (first.completedDepth < 1 || first.reason !== "paused")
                            throw new Error(`initial pause failed: ${JSON.stringify(first)}`);
                        const latency = performance.now() - pauseStarted;
                        const depths = [];
                        const resumed = await bridge.client.resume(
                            "session",
                            { type: "nodes", nodes: 5000 },
                            (info) => depths.push(info.depth),
                        );
                        await run.pause(); // 古い cancel は現実行へ影響しない。
                        const next = await resumed.finished;
                        if (next.nodes < 5000)
                            throw new Error(`final nodes undercount: ${next.nodes}`);
                        if (next.reason !== "budgetReached")
                            throw new Error(`resume budget failed: ${JSON.stringify(next)}`);
                        if (depths.some((depth) => depth <= first.completedDepth))
                            throw new Error("old depth emitted");
                        if (next.totalNodes !== first.totalNodes + next.nodes)
                            throw new Error("wrong cumulative nodes");
                        let repeated = next;
                        for (let attempt = 0; attempt < 10; attempt++) {
                            const previous = repeated;
                            const continued = await bridge.client.resume(
                                "session",
                                { type: "nodes", nodes: 1000 },
                                (info) => {
                                    if (info.depth <= previous.completedDepth)
                                        throw new Error("repeated old depth");
                                },
                            );
                            repeated = await continued.finished;
                            if (repeated.totalNodes !== previous.totalNodes + repeated.nodes)
                                throw new Error("repeated total mismatch");
                            if (repeated.workerDepths.length !== threads)
                                throw new Error("worker ownership changed");
                        }
                        results.push({
                            threads,
                            multiPv,
                            model,
                            latencyMs: latency,
                            firstDepth: first.completedDepth,
                            nextDepth: next.completedDepth,
                            nodes: next.nodes,
                            workerDepths: next.workerDepths,
                            memoryBytes: next.memoryBytes,
                            memoryAfterTenResumes: repeated.memoryBytes,
                        });
                        console.log("resume-case-result", JSON.stringify(results.at(-1)));
                    } finally {
                        worker.terminate();
                    }
                }
            return results;
        },
        { model: Boolean(model) },
    );
    assert.equal(results.length, 8);
    console.log(JSON.stringify({ browser: browser.version(), results }, null, 2));
} finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
}
