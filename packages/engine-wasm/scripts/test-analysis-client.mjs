// 製品の createWasmEngineClient と Worker キューを実ブラウザで通す。
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const require = createRequire(path.join(root, "apps/web/package.json"));
const { chromium } = require("@playwright/test");
const { createServer } = await import(pathToFileURL(require.resolve("vite")).href);
const server = await createServer({
    configFile: false,
    root,
    plugins: [
        {
            name: "analysis-test-page",
            configureServer(server) {
                server.middlewares.use((req, res, next) => {
                    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
                    res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
                    if (req.url === "/" || req.url === "/nonisolated") {
                        if (req.url === "/nonisolated") {
                            res.removeHeader("Cross-Origin-Opener-Policy");
                            res.removeHeader("Cross-Origin-Embedder-Policy");
                        }
                        res.setHeader("Content-Type", "text/html");
                        res.end("<!doctype html><title>Analysis client verification</title>");
                    } else next();
                });
            },
        },
    ],
    server: { host: "127.0.0.1", port: 0 },
});
await server.listen();
let browser;
try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    page.on("response", (response) => {
        if (response.status() >= 400) console.error(response.status(), response.url());
    });
    page.on("pageerror", (error) => console.error(error));
    page.on("console", (message) => {
        if (message.type() === "error") console.error(message.text());
    });
    const base = `http://127.0.0.1:${server.httpServer.address().port}`;
    await page.goto(base);
    const results = await page.evaluate(async () => {
        const { createWasmEngineClient } = await import("/packages/engine-wasm/dist/index.js");
        const results = [];
        for (const threads of [1, 2, 4]) {
            const client = createWasmEngineClient({ logWarningsToConsole: true });
            client.subscribe((event) => {
                if (event.type === "error") console.error(JSON.stringify(event));
            });
            try {
                await client.init({ threads, multiPv: 3, ttSizeMb: 4 });
                await client.setOption("MaterialLevel", 1);
                await client.loadPosition("startpos");
                if (!client.analysis.available())
                    throw new Error(
                        "analysis unavailable " +
                            JSON.stringify({
                                isolated: crossOriginIsolated,
                                status: client.getBackendStatus(),
                                threads: client.getThreadInfo(),
                            }),
                    );
                let run,
                    pausing = false;
                run = await client.analysis.start("session", { type: "unlimited" }, (info) => {
                    if (info.depth >= 2 && !pausing) {
                        pausing = true;
                        void run.pause();
                    }
                });
                const first = await run.finished;
                const depths = [];
                const next = await client.analysis.resume(
                    "session",
                    { type: "nodes", nodes: 5000 },
                    (info) => depths.push(info.depth),
                );
                await run.pause();
                const finished = await next.finished;
                if (finished.nodes < 5000 || depths.some((d) => d <= first.completedDepth))
                    throw new Error("invalid resume");
                await client.analysis.release();
                let rejected = false;
                try {
                    await client.analysis.resume("session", { type: "unlimited" }, () => {});
                } catch {
                    rejected = true;
                }
                if (!rejected) throw new Error("released session resumed");
                results.push({
                    threads,
                    depth: first.completedDepth,
                    resumedDepth: finished.completedDepth,
                    threadInfo: client.getThreadInfo(),
                });
            } finally {
                await client.dispose();
            }
        }
        return results;
    });
    await page.goto(`${base}/nonisolated`);
    const fallback = await page.evaluate(async () => {
        const { createWasmEngineClient } = await import("/packages/engine-wasm/dist/index.js");
        const client = createWasmEngineClient();
        try {
            await client.init({ threads: 1, ttSizeMb: 4 });
            return { isolated: crossOriginIsolated, analysis: client.analysis.available() };
        } finally {
            await client.dispose();
        }
    });
    if (fallback.isolated || fallback.analysis)
        throw new Error("nonshared capability is incorrect");
    console.log(JSON.stringify({ results, fallback }, null, 2));
} finally {
    await browser?.close();
    await server.close();
}
