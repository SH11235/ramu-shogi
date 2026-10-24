// 製品の createWasmEngineClient の詰み探索 (mate.solve) を、Worker と wasm を通して実ブラウザで確かめる。
// PLAYWRIGHT_CHANNEL (例: msedge) を指定すると、その channel のブラウザを使う。
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { createServer } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const server = await createServer({
    configFile: false,
    root,
    plugins: [
        {
            name: "mate-test-page",
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
                        res.end("<!doctype html><title>Mate client verification</title>");
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
    browser = await chromium.launch({
        headless: true,
        channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    });
    const page = await browser.newPage();
    page.on("response", (response) => {
        if (response.status() >= 400) console.error(response.status(), response.url());
    });
    page.on("pageerror", (error) => console.error(error));
    page.on("console", (message) => {
        if (message.type() === "error") console.error(message.text());
    });
    const base = `http://127.0.0.1:${server.httpServer.address().port}`;

    // 1 手詰め・王手の無い不詰・時間の上限で打ち切る大きな問題 (将棋図巧 第 1 番) を解く
    const solveAll = async ({ engineThreads, mateThreads }) => {
        const { createWasmEngineClient } = await import("/packages/engine-wasm/dist/index.js");
        const client = createWasmEngineClient({ logWarningsToConsole: true });
        client.subscribe((event) => {
            if (event.type === "error" && event.severity !== "warning")
                console.error(JSON.stringify(event));
        });
        const solve = async (sfen, params, onProgress) => {
            await client.loadPosition(sfen);
            return client.mate.solve({ threads: mateThreads, hashMb: 16, ...params }, onProgress);
        };
        try {
            await client.init({ threads: engineThreads, ttSizeMb: 4 });
            const modes = {};
            for (const mode of ["Speed", "Power"]) {
                const outcome = await solve("4k4/9/4P4/9/9/9/9/9/4K4 b G 1", {
                    mode,
                    timeMs: 10000,
                });
                if (outcome.result.kind !== "mate" || outcome.result.pv.join(" ") !== "G*5b")
                    throw new Error(`${mode}: ${JSON.stringify(outcome)}`);
                modes[mode] = outcome.nodes;
            }
            const noMate = await solve("4k4/9/9/9/9/9/9/9/4K4 b - 1", { timeMs: 10000 });
            if (noMate.result.kind !== "noMate") throw new Error(JSON.stringify(noMate));
            const progress = [];
            const zukou = await solve(
                "1pG1B4/Gs+P6/pP7/n1ls5/3k5/nL4+r1b/1+p1p+R4/1S7/2N5K b SP2gn2l11p 1",
                { mode: "Power", timeMs: 2500 },
                (p) => progress.push(p),
            );
            if (zukou.result.kind === "noMate" || zukou.result.kind === "unsupported")
                throw new Error(JSON.stringify(zukou));
            if (progress.length === 0 || zukou.elapsedMs > 8000)
                throw new Error(`progress ${progress.length}, elapsed ${zukou.elapsedMs}`);
            let rejected = false;
            try {
                await client.mate.solve({ mode: "Fast" });
            } catch {
                rejected = true;
            }
            if (!rejected) throw new Error("unknown mode accepted");
            // 詰み探索の後も通常の探索が動く
            await client.loadPosition("startpos");
            const bestmove = new Promise((resolve) => {
                const off = client.subscribe((event) => {
                    if (event.type === "bestmove") {
                        off();
                        resolve(event.move);
                    }
                });
            });
            await client.search({ limits: { maxDepth: 3 } });
            const move = await bestmove;
            return {
                isolated: crossOriginIsolated,
                backend: client.getBackendStatus(),
                engineThreads: client.getThreadInfo(),
                modes,
                zukou: { kind: zukou.result.kind, nodes: zukou.nodes, elapsedMs: zukou.elapsedMs },
                progress: progress.length,
                bestmove: move,
            };
        } finally {
            await client.dispose();
        }
    };

    await page.goto(base);
    const isolated = [];
    for (const [engineThreads, mateThreads] of [
        [1, 1],
        [4, 4],
    ]) {
        isolated.push(await page.evaluate(solveAll, { engineThreads, mateThreads }));
    }
    await page.goto(`${base}/nonisolated`);
    const fallback = await page.evaluate(solveAll, { engineThreads: 4, mateThreads: 4 });
    if (!isolated.every((r) => r.isolated) || fallback.isolated)
        throw new Error("isolation is not as expected");
    console.log(JSON.stringify({ isolated, fallback }, null, 2));
} finally {
    await browser?.close();
    await server.close();
}
