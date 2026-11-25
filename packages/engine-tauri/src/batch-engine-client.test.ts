import type { EngineEvent } from "@shogi/engine-client";
import { expect, it, vi } from "vitest";
import { createTauriBatchEngineClient, getNativeBatchParallelism } from "./index";

const { invoke, listen } = vi.hoisted(() => ({
    invoke: vi.fn(),
    listen: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@tauri-apps/api/core")>()),
    invoke,
    Channel: class {
        constructor(readonly onmessage: (event: EngineEvent) => void) {}
    },
}));
vi.mock("@tauri-apps/api/event", () => ({ listen }));

it("routes each worker and search separately, including a stale cancel", async () => {
    invoke.mockImplementation(async (command) =>
        command === "engine_thread_info"
            ? { activeThreads: 1, maxThreads: 96, hardwareConcurrency: 96, threadedAvailable: true }
            : undefined,
    );
    const first = createTauriBatchEngineClient();
    const second = createTauriBatchEngineClient();
    const firstListener = vi.fn();
    const secondListener = vi.fn();
    first.subscribe(firstListener);
    second.subscribe(secondListener);
    await Promise.all([first.init({ threads: 1 }), second.init({ threads: 1 })]);

    await first.loadPosition("startpos");
    await second.loadPosition("startpos", ["7g7f"], { passRights: { sente: 1, gote: 2 } });
    const positionCalls = invoke.mock.calls.filter(
        ([command]) => command === "engine_batch_position",
    );
    expect(positionCalls).toHaveLength(2);
    const firstId = positionCalls[0][1].workerId;
    const secondId = positionCalls[1][1].workerId;
    expect(firstId).not.toBe(secondId);
    expect(positionCalls[1][1]).toEqual({
        workerId: secondId,
        sfen: "startpos",
        moves: ["7g7f"],
        passRights: { sente: 1, gote: 2 },
    });

    const lastSearch = () => {
        const call = invoke.mock.lastCall;
        if (call?.[0] !== "engine_batch_search") throw new Error("Expected batch search IPC");
        return call[1] as { searchId: string; events: { onmessage: (event: EngineEvent) => void } };
    };
    const params = { limits: { maxDepth: 2 } };
    const old = await first.search(params);
    const { events: previousEvents, searchId: previousId } = lastSearch();
    previousEvents.onmessage({ type: "bestmove", move: "7g7f" });
    firstListener.mockClear();
    await first.search(params);
    const { events: currentEvents, searchId: currentId } = lastSearch();
    await second.search(params);
    const { events: secondEvents } = lastSearch();

    await old.cancel();
    expect(invoke.mock.lastCall).toEqual([
        "engine_batch_stop",
        { workerId: firstId, searchId: previousId },
    ]);
    expect(currentId).not.toBe(previousId);
    previousEvents.onmessage({ type: "info", scoreCp: 123 });
    secondEvents.onmessage({ type: "bestmove", move: "3c3d" });
    currentEvents.onmessage({ type: "bestmove", move: "2g2f" });
    expect(firstListener).toHaveBeenCalledExactlyOnceWith({ type: "bestmove", move: "2g2f" });
    expect(secondListener).toHaveBeenCalledExactlyOnceWith({ type: "bestmove", move: "3c3d" });
    expect(listen).not.toHaveBeenCalled();

    await first.dispose();
    expect(invoke.mock.lastCall).toEqual(["engine_batch_dispose", { workerId: firstId }]);
    expect(await getNativeBatchParallelism()).toBe(96);
});
