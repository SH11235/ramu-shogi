import {
    applyMoveWithState,
    createInitialPositionState,
    type PositionState,
    parseStudySfen,
} from "@shogi/app-core";
import type { EngineEvent, LoadPositionOptions } from "@shogi/engine-client";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useOnlineAnalysis } from "./useOnlineAnalysis";

const createClient = vi.hoisted(() => vi.fn());
vi.mock("../platform/wasm-engine-client", () => ({ createWebWasmEngineClient: createClient }));

function mockEngine() {
    const listeners = new Set<(event: EngineEvent) => void>();
    const cancel = vi.fn().mockResolvedValue(undefined);
    return {
        init: vi.fn().mockResolvedValue(undefined),
        setOption: vi.fn().mockResolvedValue(undefined),
        loadPosition: vi.fn().mockResolvedValue(undefined),
        loadNnue: vi.fn().mockResolvedValue(undefined),
        search: vi.fn().mockResolvedValue({ cancel }),
        dispose: vi.fn().mockResolvedValue(undefined),
        subscribe: vi.fn((listener: (event: EngineEvent) => void) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        }),
        emit(event: EngineEvent) {
            for (const listener of listeners) listener(event);
        },
        listeners,
        cancel,
    };
}

function deferred() {
    let resolve: () => void = () => undefined;
    const promise = new Promise<void>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

beforeEach(() => createClient.mockReset());
afterEach(cleanup);

describe("useOnlineAnalysis pass rights", () => {
    it.each([
        { sfen: "startpos", moves: [], expected: { sente: 1, gote: 1 } },
        { sfen: "startpos", moves: ["pass"], expected: { sente: 0, gote: 1 } },
        { sfen: "startpos", moves: ["7g7f", "pass"], expected: { sente: 1, gote: 0 } },
        { sfen: "startpos", moves: ["pass", "pass", "7g7f"], expected: { sente: 0, gote: 0 } },
        {
            sfen: "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1",
            moves: ["pass"],
            expected: { sente: 1, gote: 0 },
        },
    ])("初期局面 $sfen と $moves を一度だけ再生する", async ({ sfen, moves, expected }) => {
        const engine = mockEngine();
        createClient.mockReturnValue(engine);
        const { result } = renderHook(() => useOnlineAnalysis(12, 1000, { initialCount: 1 }));
        await act(async () => {
            await result.current.startAnalysis(sfen, moves);
        });
        expect(engine.loadPosition).toHaveBeenCalledWith(sfen, moves, {
            passRights: { sente: 1, gote: 1 },
        });
        const [start, replay, options] = engine.loadPosition.mock.calls[0] as [
            string,
            string[],
            LoadPositionOptions,
        ];
        let position: PositionState = {
            ...(start === "startpos" ? createInitialPositionState() : parseStudySfen(start)),
            passRights: options.passRights,
        };
        for (const move of replay) {
            const applied = applyMoveWithState(position, move);
            expect(applied.ok).toBe(true);
            position = applied.next;
        }
        expect(position.passRights).toEqual(expected);
        expect(engine.search).toHaveBeenCalledWith({ limits: { maxDepth: 12, movetimeMs: 1000 } });
    });

    it.each([undefined, null])("無効な設定ではパス権を渡さない", async (rights) => {
        const engine = mockEngine();
        createClient.mockReturnValue(engine);
        const { result } = renderHook(() => useOnlineAnalysis(null, 1000, rights));
        await act(async () => {
            await result.current.startAnalysis("startpos", ["7g7f"]);
        });
        expect(engine.loadPosition).toHaveBeenCalledWith("startpos", ["7g7f"], undefined);
    });
});

describe("useOnlineAnalysis lifecycle", () => {
    it("StrictModeのmountでは初期化せず、完了後のunmountで購読とclientを解放する", async () => {
        const engine = mockEngine();
        createClient.mockReturnValue(engine);
        const { result, unmount } = renderHook(() => useOnlineAnalysis(12, 1000), {
            wrapper: StrictMode,
        });
        expect(createClient).not.toHaveBeenCalled();
        await act(async () => {
            await result.current.startAnalysis("startpos", []);
        });
        expect(engine.init).toHaveBeenCalledTimes(1);
        expect(engine.search).toHaveBeenCalledTimes(1);
        act(() => engine.emit({ type: "bestmove", move: "7g7f" }));
        expect(result.current.isAnalyzing).toBe(false);
        unmount();
        await waitFor(() => expect(engine.dispose).toHaveBeenCalledTimes(1));
        expect(engine.listeners.size).toBe(0);
        expect(engine.cancel).not.toHaveBeenCalled();
    });

    it.each([
        "cancel",
        "unmount",
    ] as const)("初期化待ちの%s後に探索を始めない", async (operation) => {
        const engine = mockEngine();
        const entered = deferred();
        const gate = deferred();
        engine.init.mockImplementationOnce(async () => {
            entered.resolve();
            await gate.promise;
        });
        createClient.mockReturnValue(engine);
        const { result, unmount } = renderHook(() => useOnlineAnalysis(12, 1000));
        let starting = Promise.resolve();
        await act(async () => {
            starting = result.current.startAnalysis("startpos", []);
            await entered.promise;
        });
        let cancelling: Promise<void> | undefined;
        if (operation === "unmount") unmount();
        else
            act(() => {
                cancelling = result.current.cancelAnalysis();
            });
        await act(async () => {
            gate.resolve();
            await starting;
            await cancelling;
        });
        expect(engine.search).not.toHaveBeenCalled();
        expect(engine.setOption).not.toHaveBeenCalled();
        expect(engine.dispose).toHaveBeenCalledTimes(1);
        expect(engine.listeners.size).toBe(0);
    });

    it("探索handleの完了待ちをcancelするとclientを破棄して遅いイベントを無視する", async () => {
        const engine = mockEngine();
        const entered = deferred();
        const gate = deferred();
        engine.search.mockImplementationOnce(async () => {
            entered.resolve();
            await gate.promise;
            return { cancel: engine.cancel };
        });
        createClient.mockReturnValue(engine);
        const { result } = renderHook(() => useOnlineAnalysis(12, 1000));
        let starting = Promise.resolve();
        await act(async () => {
            starting = result.current.startAnalysis("startpos", []);
            await entered.promise;
        });
        const oldListener = engine.subscribe.mock.calls[0][0];
        let cancelling = Promise.resolve();
        act(() => {
            cancelling = result.current.cancelAnalysis();
        });
        await act(async () => {
            gate.resolve();
            await starting;
            await cancelling;
        });
        act(() => oldListener({ type: "info", scoreCp: 30, pv: ["7g7f"] }));
        expect(result.current.isAnalyzing).toBe(false);
        expect(result.current.topMoves).toEqual([]);
        expect(engine.dispose).toHaveBeenCalledTimes(1);
        expect(engine.listeners.size).toBe(0);
    });

    it("NNUE初期化に新しい解析が続いても選択したモデルを引き継ぐ", async () => {
        const first = mockEngine();
        const second = mockEngine();
        const entered = deferred();
        const gate = deferred();
        first.init.mockImplementationOnce(async () => {
            entered.resolve();
            await gate.promise;
        });
        createClient.mockReturnValueOnce(first).mockReturnValue(second);
        const { result } = renderHook(() => useOnlineAnalysis(12, 1000));
        let loading: Promise<void> | undefined;
        await act(async () => {
            loading = result.current.loadNnue?.("selected-network");
            await entered.promise;
        });
        let starting = Promise.resolve();
        act(() => {
            starting = result.current.startAnalysis("startpos", []);
        });
        await act(async () => {
            gate.resolve();
            await loading;
            await starting;
        });
        expect(first.dispose).toHaveBeenCalledTimes(1);
        expect(second.loadNnue).toHaveBeenCalledWith("selected-network", undefined);
        expect(second.search).toHaveBeenCalledTimes(1);
    });
});
