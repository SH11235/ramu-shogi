import type { EngineClient, EngineEventHandler } from "@shogi/engine-client";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useEnginePool } from "./useEnginePool";

const jobs = Array.from({ length: 4 }, (_, i) => ({
    ply: i + 1,
    sfen: "startpos",
    moves: [],
    timeMs: 100,
    depth: 2,
}));

function engineFactory(external = false) {
    let active = 0;
    let peak = 0;
    const clients: EngineClient[] = [];
    const createClient = () => {
        const listeners = new Set<EngineEventHandler>();
        const client: EngineClient = {
            init: vi.fn().mockResolvedValue(undefined),
            loadPosition: vi.fn().mockResolvedValue(undefined),
            setOption: vi.fn().mockResolvedValue(undefined),
            stop: vi.fn().mockResolvedValue(undefined),
            dispose: vi.fn().mockResolvedValue(undefined),
            ...(external ? {} : { reset: vi.fn().mockResolvedValue(undefined) }),
            subscribe(handler) {
                listeners.add(handler);
                return () => listeners.delete(handler);
            },
            async search() {
                active++;
                peak = Math.max(peak, active);
                const timer = setTimeout(() => {
                    active--;
                    for (const listener of listeners) listener({ type: "bestmove", move: "7g7f" });
                }, 10);
                return {
                    async cancel() {
                        clearTimeout(timer);
                    },
                };
            },
        };
        clients.push(client);
        return client;
    };
    return {
        clients,
        createClient,
        getPeak: () => peak,
        resetPeak: () => {
            peak = 0;
        },
    };
}

describe("useEnginePool", () => {
    it("同じモデルでも並列数を1→4→1へ変更した次回解析でプールを作り直す", async () => {
        const factory = engineFactory();
        const onComplete = vi.fn();
        const { result, rerender, unmount } = renderHook(
            ({ count }) =>
                useEnginePool({
                    createClient: factory.createClient,
                    workerCount: count,
                    onComplete,
                }),
            { initialProps: { count: 1 } },
        );
        for (const [round, count] of [1, 4, 1].entries()) {
            rerender({ count });
            factory.resetPeak();
            act(() => result.current.start(jobs));
            await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(round + 1));
            expect(factory.getPeak()).toBe(count);
        }
        expect(factory.clients).toHaveLength(6);
        for (const client of factory.clients)
            expect(client.init).toHaveBeenCalledWith({ threads: 1, usiThreads: 1 });
        for (const client of factory.clients.slice(0, 5))
            expect(client.dispose).toHaveBeenCalledTimes(1);
        unmount();
    });

    it("外部USIにもThreads=1を適用して局面並列と探索並列の重複を防ぐ", async () => {
        const factory = engineFactory(true);
        const onComplete = vi.fn();
        const { result, unmount } = renderHook(() =>
            useEnginePool({ createClient: factory.createClient, workerCount: 2, onComplete }),
        );
        act(() => result.current.start(jobs));
        await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
        for (const client of factory.clients)
            expect(client.init).toHaveBeenCalledWith({ threads: 1, usiThreads: 1 });
        unmount();
    });
});
