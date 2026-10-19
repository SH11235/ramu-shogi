import { describe, expect, it, vi } from "vitest";
import { createAnalysisBridge } from "./analysisBridge";
import type { AnalysisCommand } from "./analysisProtocol";

function setup() {
    const commands: AnalysisCommand[] = [];
    const fail = vi.fn();
    const bridge = createAnalysisBridge({
        available: () => true,
        ready: async () => {},
        send: (command) => commands.push(command),
        release: async () => {},
        fail,
    });
    const buffer = new SharedArrayBuffer(4);
    const words = new Uint32Array(buffer);
    async function start(resume = false, id = 2) {
        const promise = (resume ? bridge.client.resume : bridge.client.start)(
            "session",
            { type: "unlimited" },
            vi.fn(),
        );
        await Promise.resolve();
        const command = commands.at(-1);
        if (command?.type !== "prepareAnalysis") throw new Error("expected prepare");
        words[0] = id;
        bridge.receive({
            type: "analysisPrepared",
            requestId: command.requestId,
            sessionId: "session",
            runId: id,
            address: 0,
            buffer,
        });
        return promise;
    }
    function finish(runId: number) {
        bridge.receive({
            type: "analysisFinished",
            result: {
                sessionId: "session",
                runId,
                reason: "paused",
                resumable: true,
                completedDepth: 3,
                nodes: 10,
                timeMs: 1,
                totalNodes: 10,
                totalTimeMs: 1,
                workerDepths: [[0, 3]],
            },
        });
    }
    return { bridge, words, start, finish, fail };
}

describe("analysis bridge", () => {
    it("uses atomic stop and ignores a stale cancellation after resume", async () => {
        const h = setup();
        const first = await h.start();
        const paused = first.pause();
        expect(h.words[0]).toBe(3);
        h.finish(2);
        await paused;
        const second = await h.start(true, 4);
        await first.pause();
        expect(h.words[0]).toBe(4);
        const done = second.pause();
        expect(h.words[0]).toBe(5);
        h.finish(4);
        await done;
    });
    it("ignores old finished events and rejects a lost session", async () => {
        const h = setup();
        const run = await h.start();
        h.finish(22);
        expect(h.bridge.busy()).toBe(true);
        h.bridge.invalidate("worker lost");
        await expect(run.finished).rejects.toThrow("worker lost");
        await expect(
            h.bridge.client.resume("session", { type: "unlimited" }, vi.fn()),
        ).rejects.toThrow();
    });
    it("rejects concurrent preparation", async () => {
        const h = setup();
        const first = h.start();
        await expect(
            h.bridge.client.start("other", { type: "unlimited" }, vi.fn()),
        ).rejects.toThrow();
        const run = await first;
        h.finish(2);
        await run.finished;
    });
    it("terminates on a stop timeout rather than reporting resumability", async () => {
        vi.useFakeTimers();
        try {
            const h = setup();
            const run = await h.start();
            const paused = run.pause();
            const rejected = expect(paused).rejects.toThrow();
            await vi.advanceTimersByTimeAsync(5000);
            await rejected;
            expect(h.fail).toHaveBeenCalledOnce();
            expect(h.bridge.busy()).toBe(false);
        } finally {
            vi.useRealTimers();
        }
    });
});
