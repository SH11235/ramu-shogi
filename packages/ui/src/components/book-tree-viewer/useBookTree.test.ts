import * as core from "@shogi/app-core";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useBookTree } from "./useBookTree";

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
});

it("作り直しとアンマウント後の通知を捨て、間引きタイマーを止める", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const book = core.parseBook("");
    const create = core.createBookTreeBuilder;
    const notifications: (() => void)[] = [];
    vi.spyOn(core, "createBookTreeBuilder").mockImplementation((options) => {
        notifications.push(options.onChange ?? (() => {}));
        return { ...create(options), start: () => Promise.resolve() };
    });
    const { result, rerender, unmount } = renderHook(
        ({ side }: { side: "sente" | "gote" }) => useBookTree(book, side, async () => []),
        { initialProps: { side: "sente" } },
    );
    act(() => notifications[0]());
    expect(vi.getTimerCount()).toBe(1);
    rerender({ side: "gote" });
    expect(vi.getTimerCount()).toBe(0);
    const current = result.current;
    await act(async () => {
        notifications[0]();
        await vi.advanceTimersByTimeAsync(100);
    });
    expect(result.current).toEqual(current);
    act(() => {
        notifications[1]();
        notifications[1]();
    });
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    act(() => notifications[1]());
    expect(vi.getTimerCount()).toBe(0);
});

it("大量の通知を間引き、公開済みのスナップショットを変更しない", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const book = core.parseBook("");
    const builder = core.createBookTreeBuilder({ book, side: "sente", legalMoves: async () => [] });
    let notify = () => {};
    vi.spyOn(core, "createBookTreeBuilder").mockImplementation((options) => {
        notify = options.onChange ?? (() => {});
        return { ...builder, start: () => Promise.resolve() };
    });
    const { result, unmount } = renderHook(() => useBookTree(book, "sente", async () => []));
    const initial = result.current.tree;
    const revision = result.current.revision;
    await act(async () => {
        for (let id = 1; id <= 30_000; id++) {
            builder.tree.nodes.push({
                ...builder.tree.nodes[0],
                id,
                key: String(id),
                children: [],
            });
            builder.tree.firstByKey.set(String(id), id);
            notify();
        }
    });
    expect(result.current.revision).toBe(revision);
    expect(initial?.nodes).toHaveLength(1);
    expect(initial?.firstByKey.size).toBe(1);
    await act(async () => vi.advanceTimersByTime(50));
    expect(result.current.revision).toBe(revision + 1);
    expect(result.current.tree?.nodes).toHaveLength(30_001);
    expect(initial?.nodes).toHaveLength(1);
    await act(async () => {
        builder.tree.building = false;
        notify();
    });
    expect(result.current.tree?.building).toBe(false);
    expect(result.current.revision).toBe(revision + 2);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
});
