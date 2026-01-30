import type { EngineControllerEvent, GameResult, NnueSelection, Player } from "@shogi/app-core";
import type { EngineEvent } from "@shogi/engine-client";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatEngineEventLog } from "./formatEngineEvent";
import { useEngineManager } from "./useEngineManager";

// テスト用のNnueSelection作成ヘルパー
const createNnueSelection = (nnueId: string | null): NnueSelection => ({
    presetKey: null,
    nnueId,
});

// テスト用のresolveNnueモック
const createMockResolveNnue = () =>
    vi.fn(async (selection: NnueSelection) =>
        selection.nnueId ? { nnueId: selection.nnueId, fvScale: 16 } : null,
    );

describe("formatEngineEventLog", () => {
    it("bestmove イベントを正しくフォーマットする", () => {
        const event: EngineEvent = {
            type: "bestmove",
            move: "7g7f",
        };
        const log: EngineControllerEvent = {
            id: 1,
            atMs: 0,
            side: "sente",
            engineId: "engine1",
            event,
        };
        const result = formatEngineEventLog(log);
        expect(result).toBe("[S:engine1] bestmove 7g7f");
    });

    it("info イベントを正しくフォーマットする（全フィールド）", () => {
        const event: EngineEvent = {
            type: "info",
            depth: 10,
            seldepth: 15,
            scoreCp: 150,
            nodes: 100000,
            nps: 50000,
            pv: ["7g7f", "3c3d", "2g2f"],
        };
        const log: EngineControllerEvent = {
            id: 2,
            atMs: 0,
            side: "gote",
            engineId: "engine2",
            event,
        };
        const result = formatEngineEventLog(log);
        expect(result).toBe(
            "[G:engine2] info depth 10 seldepth 15 score cp 150 nodes 100000 nps 50000 pv 7g7f 3c3d 2g2f",
        );
    });

    it("info イベントを正しくフォーマットする（一部フィールドのみ）", () => {
        const event: EngineEvent = {
            type: "info",
            depth: 5,
            scoreCp: -200,
        };
        const log: EngineControllerEvent = {
            id: 3,
            atMs: 0,
            side: "sente",
            engineId: "test",
            event,
        };
        const result = formatEngineEventLog(log);
        expect(result).toBe("[S:test] info depth 5 score cp -200");
    });

    it("info イベントで pv が空配列の場合は含めない", () => {
        const event: EngineEvent = {
            type: "info",
            depth: 3,
            pv: [],
        };
        const log: EngineControllerEvent = {
            id: 4,
            atMs: 0,
            side: "gote",
            engineId: "test",
            event,
        };
        const result = formatEngineEventLog(log);
        expect(result).toBe("[G:test] info depth 3");
    });

    it("info イベントでフィールドが undefined の場合は含めない", () => {
        const event: EngineEvent = {
            type: "info",
        };
        const log: EngineControllerEvent = {
            id: 5,
            atMs: 0,
            side: "sente",
            engineId: "engine",
            event,
        };
        const result = formatEngineEventLog(log);
        expect(result).toBe("[S:engine] info");
    });

    it("error イベントを正しくフォーマットする", () => {
        const event: EngineEvent = {
            type: "error",
            message: "Engine initialization failed",
        };
        const log: EngineControllerEvent = {
            id: 6,
            atMs: 0,
            side: "gote",
            engineId: "engine3",
            event,
        };
        const result = formatEngineEventLog(log);
        expect(result).toBe("[G:engine3] error: Engine initialization failed");
    });

    it("サイド無しのイベントは Analysis ラベルになる", () => {
        const event: EngineEvent = {
            type: "bestmove",
            move: "2g2f",
        };
        const log: EngineControllerEvent = {
            id: 7,
            atMs: 0,
            engineId: "analysis-engine",
            event,
        };
        expect(formatEngineEventLog(log)).toBe("[Analysis:analysis-engine] bestmove 2g2f");
    });
});

describe("useEngineManager", () => {
    const createMockClocksRef = () => ({
        current: {
            sente: { mainMs: 1000, byoyomiMs: 500 },
            gote: { mainMs: 1000, byoyomiMs: 500 },
            ticking: null as "sente" | "gote" | null,
            lastUpdatedAt: Date.now(),
        },
    });

    const createMockEngineClient = () => {
        const listeners = new Set<(event: EngineEvent) => void>();
        const subscribe = vi.fn((handler: (event: EngineEvent) => void) => {
            listeners.add(handler);
            return () => listeners.delete(handler);
        });
        const init = vi.fn().mockResolvedValue(undefined);
        const loadPosition = vi.fn().mockResolvedValue(undefined);
        const cancel = vi.fn().mockResolvedValue(undefined);
        const search = vi.fn().mockResolvedValue({ cancel });
        const stop = vi.fn().mockResolvedValue(undefined);
        const dispose = vi.fn().mockResolvedValue(undefined);
        const emit = (event: EngineEvent) => {
            for (const fn of listeners) {
                fn(event);
            }
        };

        return {
            client: {
                init,
                loadPosition,
                search,
                stop,
                setOption: vi.fn().mockResolvedValue(undefined),
                subscribe,
                dispose,
            },
            emit,
            search,
            loadPosition,
        };
    };

    const renderEngineHook = ({
        positionTurn,
        movesRef,
        onMoveFromEngine,
        onMatchEnd,
        sides,
        mockClient,
        clocksRef = createMockClocksRef(),
    }: {
        positionTurn: Player;
        movesRef: { current: string[] };
        onMoveFromEngine: (move: string) => void;
        onMatchEnd: (result: GameResult) => Promise<void>;
        sides: {
            sente: { role: "human" | "engine"; engineId?: string };
            gote: { role: "human" | "engine"; engineId?: string };
        };
        mockClient: ReturnType<typeof createMockEngineClient>;
        clocksRef?: ReturnType<typeof createMockClocksRef>;
    }) => {
        return renderHook(() =>
            useEngineManager({
                sides,
                engineOptions: [
                    {
                        id: "engine1",
                        label: "Engine 1",
                        createClient: () => mockClient.client,
                    },
                ],
                clocksRef,
                startSfen: "startpos",
                movesRef,
                positionTurn,
                isMatchRunning: true,
                positionReady: true,
                onMoveFromEngine,
                onMatchEnd,
                maxLogs: 10,
                senteNnueSelection: createNnueSelection(null),
                goteNnueSelection: createNnueSelection(null),
                resolveNnue: createMockResolveNnue(),
            }),
        );
    };

    afterEach(() => {
        vi.clearAllMocks();
    });

    it("エンジンを初期化し探索を開始する", async () => {
        const mockClient = createMockEngineClient();
        const movesRef = { current: [] as string[] };
        const onMoveFromEngine = vi.fn();
        const onMatchEnd = vi.fn().mockResolvedValue(undefined);

        const { result } = renderEngineHook({
            positionTurn: "sente",
            movesRef,
            onMoveFromEngine,
            onMatchEnd,
            sides: { sente: { role: "engine", engineId: "engine1" }, gote: { role: "human" } },
            mockClient,
        });

        await act(async () => {
            await Promise.resolve();
        });

        expect(mockClient.client.init).toHaveBeenCalledTimes(1);
        // init 時と探索開始時に局面を読み込む
        expect(mockClient.loadPosition).toHaveBeenCalledTimes(2);
        expect(mockClient.search).toHaveBeenCalledTimes(1);
        expect(result.current.engineStatus.sente).toBe("thinking");
        expect(result.current.engineReady.sente).toBe(true);
    });

    it("bestmove の通常手を適用してコールバックを呼び出す", async () => {
        const mockClient = createMockEngineClient();
        const movesRef = { current: [] as string[] };
        const onMoveFromEngine = vi.fn();
        const onMatchEnd = vi.fn().mockResolvedValue(undefined);

        const { result } = renderEngineHook({
            positionTurn: "sente",
            movesRef,
            onMoveFromEngine,
            onMatchEnd,
            sides: { sente: { role: "engine", engineId: "engine1" }, gote: { role: "human" } },
            mockClient,
        });

        await act(async () => {
            await Promise.resolve();
        });

        act(() => {
            mockClient.emit({ type: "bestmove", move: "7g7f" });
        });

        expect(onMoveFromEngine).toHaveBeenCalledWith("7g7f");
        expect(result.current.engineStatus.sente).toBe("idle");
    });

    it("bestmove の resign で対局終了コールバックを呼ぶ", async () => {
        const mockClient = createMockEngineClient();
        const movesRef = { current: [] as string[] };
        const onMoveFromEngine = vi.fn();
        const onMatchEnd = vi.fn().mockResolvedValue(undefined);

        renderEngineHook({
            positionTurn: "sente",
            movesRef,
            onMoveFromEngine,
            onMatchEnd,
            sides: { sente: { role: "engine", engineId: "engine1" }, gote: { role: "human" } },
            mockClient,
        });

        await act(async () => {
            await Promise.resolve();
        });

        act(() => {
            mockClient.emit({ type: "bestmove", move: "resign" });
        });

        expect(onMatchEnd).toHaveBeenCalledTimes(1);
        const gameResult = onMatchEnd.mock.calls[0][0] as GameResult;
        expect(gameResult.reason.kind).toBe("resignation");
    });
});

describe("useEngineManager - NNUE restart", () => {
    const createMockClocksRef = () => ({
        current: {
            sente: { mainMs: 1000, byoyomiMs: 500 },
            gote: { mainMs: 1000, byoyomiMs: 500 },
            ticking: null as "sente" | "gote" | null,
            lastUpdatedAt: Date.now(),
        },
    });

    const createMockEngineClient = () => {
        const listeners = new Set<(event: EngineEvent) => void>();
        const subscribe = vi.fn((handler: (event: EngineEvent) => void) => {
            listeners.add(handler);
            return () => listeners.delete(handler);
        });
        const init = vi.fn().mockResolvedValue(undefined);
        const loadPosition = vi.fn().mockResolvedValue(undefined);
        const cancel = vi.fn().mockResolvedValue(undefined);
        const search = vi.fn().mockResolvedValue({ cancel });
        const stop = vi.fn().mockResolvedValue(undefined);
        const dispose = vi.fn().mockResolvedValue(undefined);
        const reset = vi.fn().mockResolvedValue(undefined);
        const loadNnue = vi.fn().mockResolvedValue(undefined);

        return {
            client: {
                init,
                loadPosition,
                search,
                stop,
                setOption: vi.fn().mockResolvedValue(undefined),
                subscribe,
                dispose,
                reset,
                loadNnue,
            },
            init,
            reset,
            loadNnue,
            loadPosition,
        };
    };

    afterEach(() => {
        vi.clearAllMocks();
    });

    it("NNUE ID変更時、明示APIでエンジンを再起動する", async () => {
        const mockClient = createMockEngineClient();
        const movesRef = { current: [] as string[] };
        const onMoveFromEngine = vi.fn();
        const onMatchEnd = vi.fn().mockResolvedValue(undefined);
        const resolveNnue = createMockResolveNnue();

        // propsを安定化（毎レンダーで新しいオブジェクトを生成しない）
        const sides = {
            sente: { role: "engine" as const, engineId: "engine1" },
            gote: { role: "human" as const },
        };
        const engineOptions = [
            {
                id: "engine1",
                label: "Engine 1",
                createClient: () => mockClient.client,
            },
        ];
        const clocksRef = createMockClocksRef();
        const goteNnueSelection = createNnueSelection(null);

        const { result, rerender } = renderHook(
            ({ isMatchRunning }: { isMatchRunning: boolean }) =>
                useEngineManager({
                    sides,
                    engineOptions,
                    clocksRef,
                    startSfen: "startpos",
                    movesRef,
                    positionTurn: "sente",
                    isMatchRunning,
                    positionReady: true,
                    onMoveFromEngine,
                    onMatchEnd,
                    maxLogs: 10,
                    senteNnueSelection: createNnueSelection("nnue-1"),
                    goteNnueSelection,
                    resolveNnue,
                }),
            { initialProps: { isMatchRunning: true } },
        );

        // 初期化を待つ
        await act(async () => {
            await Promise.resolve();
        });

        // 初期状態を確認
        expect(mockClient.init).toHaveBeenCalled();
        const initCallCount = mockClient.init.mock.calls.length;

        // 対局を停止
        await act(async () => {
            rerender({ isMatchRunning: false });
        });

        // 明示APIでNNUE変更を反映（親コンポーネントと同じパターン）
        const newSelection = createNnueSelection("nnue-2");
        await act(async () => {
            await result.current.restartEngineForNnue("sente", newSelection);
        });

        // reset と init が追加で呼ばれることを確認
        expect(mockClient.reset).toHaveBeenCalled();
        expect(mockClient.init.mock.calls.length).toBeGreaterThan(initCallCount);
    });

    it("props変更だけでは自動再起動しない（明示API呼び出しが必要）", async () => {
        const mockClient = createMockEngineClient();
        const movesRef = { current: [] as string[] };
        const onMoveFromEngine = vi.fn();
        const onMatchEnd = vi.fn().mockResolvedValue(undefined);
        const resolveNnue = createMockResolveNnue();

        // propsを安定化（毎レンダーで新しいオブジェクトを生成しない）
        const sides = {
            sente: { role: "engine" as const, engineId: "engine1" },
            gote: { role: "human" as const },
        };
        const engineOptions = [
            {
                id: "engine1",
                label: "Engine 1",
                createClient: () => mockClient.client,
            },
        ];
        const clocksRef = createMockClocksRef();
        const goteNnueSelection = createNnueSelection(null);

        const { rerender } = renderHook(
            ({ senteNnueSelection }: { senteNnueSelection: NnueSelection | undefined }) =>
                useEngineManager({
                    sides,
                    engineOptions,
                    clocksRef,
                    startSfen: "startpos",
                    movesRef,
                    positionTurn: "sente",
                    isMatchRunning: false,
                    positionReady: true,
                    onMoveFromEngine,
                    onMatchEnd,
                    maxLogs: 10,
                    senteNnueSelection,
                    goteNnueSelection,
                    resolveNnue,
                }),
            { initialProps: { senteNnueSelection: undefined as NnueSelection | undefined } },
        );

        // 初期化を待つ
        await act(async () => {
            await Promise.resolve();
        });

        const resetCallCount = mockClient.reset.mock.calls.length;

        // undefined → NnueSelection(null) に変更（どちらも「NNUEなし」を意味）
        await act(async () => {
            rerender({ senteNnueSelection: createNnueSelection(null) });
        });

        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });

        // reset が追加で呼ばれないことを確認（props変更だけでは自動再起動しない）
        expect(mockClient.reset.mock.calls.length).toBe(resetCallCount);
    });
});

describe("useEngineManager - 明示API", () => {
    const createMockClocksRef = () => ({
        current: {
            sente: { mainMs: 1000, byoyomiMs: 500 },
            gote: { mainMs: 1000, byoyomiMs: 500 },
            ticking: null as "sente" | "gote" | null,
            lastUpdatedAt: Date.now(),
        },
    });

    const createMockEngineClient = () => {
        const listeners = new Set<(event: EngineEvent) => void>();
        const subscribe = vi.fn((handler: (event: EngineEvent) => void) => {
            listeners.add(handler);
            return () => listeners.delete(handler);
        });
        const init = vi.fn().mockResolvedValue(undefined);
        const loadPosition = vi.fn().mockResolvedValue(undefined);
        const cancel = vi.fn().mockResolvedValue(undefined);
        const search = vi.fn().mockResolvedValue({ cancel });
        const stop = vi.fn().mockResolvedValue(undefined);
        const dispose = vi.fn().mockResolvedValue(undefined);
        const reset = vi.fn().mockResolvedValue(undefined);
        const loadNnue = vi.fn().mockResolvedValue(undefined);

        return {
            client: {
                init,
                loadPosition,
                search,
                stop,
                setOption: vi.fn().mockResolvedValue(undefined),
                subscribe,
                dispose,
                reset,
                loadNnue,
            },
            init,
            reset,
            loadNnue,
            loadPosition,
            stop,
            dispose,
        };
    };

    afterEach(() => {
        vi.clearAllMocks();
    });

    it("disposeEngine を明示的に呼び出すとエンジンが破棄される", async () => {
        const mockClient = createMockEngineClient();
        const movesRef = { current: [] as string[] };
        const onMoveFromEngine = vi.fn();
        const onMatchEnd = vi.fn().mockResolvedValue(undefined);
        const resolveNnue = createMockResolveNnue();

        const sides = {
            sente: { role: "engine" as const, engineId: "engine1" },
            gote: { role: "human" as const },
        };
        const engineOptions = [
            {
                id: "engine1",
                label: "Engine 1",
                createClient: () => mockClient.client,
            },
        ];
        const clocksRef = createMockClocksRef();

        const { result } = renderHook(() =>
            useEngineManager({
                sides,
                engineOptions,
                clocksRef,
                startSfen: "startpos",
                movesRef,
                positionTurn: "sente",
                isMatchRunning: true,
                positionReady: true,
                onMoveFromEngine,
                onMatchEnd,
                maxLogs: 10,
                senteNnueSelection: createNnueSelection(null),
                goteNnueSelection: createNnueSelection(null),
                resolveNnue,
            }),
        );

        await act(async () => {
            await Promise.resolve();
        });

        // 明示的にdisposeEngineを呼び出す
        await act(async () => {
            await result.current.disposeEngine("sente");
        });

        // disposeが呼ばれたことを確認
        expect(mockClient.dispose).toHaveBeenCalled();
    });

    it("restartEngineForNnue を明示的に呼び出すとエンジンが再起動される", async () => {
        const mockClient = createMockEngineClient();
        const movesRef = { current: [] as string[] };
        const onMoveFromEngine = vi.fn();
        const onMatchEnd = vi.fn().mockResolvedValue(undefined);
        const resolveNnue = createMockResolveNnue();

        const sides = {
            sente: { role: "engine" as const, engineId: "engine1" },
            gote: { role: "human" as const },
        };
        const engineOptions = [
            {
                id: "engine1",
                label: "Engine 1",
                createClient: () => mockClient.client,
            },
        ];
        const clocksRef = createMockClocksRef();

        const { result, rerender } = renderHook(
            ({ isMatchRunning }: { isMatchRunning: boolean }) =>
                useEngineManager({
                    sides,
                    engineOptions,
                    clocksRef,
                    startSfen: "startpos",
                    movesRef,
                    positionTurn: "sente",
                    isMatchRunning,
                    positionReady: true,
                    onMoveFromEngine,
                    onMatchEnd,
                    maxLogs: 10,
                    senteNnueSelection: createNnueSelection("nnue-1"),
                    goteNnueSelection: createNnueSelection(null),
                    resolveNnue,
                }),
            { initialProps: { isMatchRunning: true } },
        );

        // エンジンを初期化
        await act(async () => {
            await Promise.resolve();
        });

        expect(mockClient.init).toHaveBeenCalled();
        const initCallCount = mockClient.init.mock.calls.length;

        // 対局を停止
        await act(async () => {
            rerender({ isMatchRunning: false });
        });

        // 明示的にrestartEngineForNnueを呼び出す（新しいselectionを渡す）
        const newSelection = createNnueSelection("nnue-2");
        await act(async () => {
            await result.current.restartEngineForNnue("sente", newSelection);
        });

        // resetとinitが追加で呼ばれたことを確認
        expect(mockClient.reset).toHaveBeenCalled();
        expect(mockClient.init.mock.calls.length).toBeGreaterThan(initCallCount);
    });

    it("restartEngineForNnue は対局中は無視される", async () => {
        const mockClient = createMockEngineClient();
        const movesRef = { current: [] as string[] };
        const onMoveFromEngine = vi.fn();
        const onMatchEnd = vi.fn().mockResolvedValue(undefined);
        const resolveNnue = createMockResolveNnue();

        const sides = {
            sente: { role: "engine" as const, engineId: "engine1" },
            gote: { role: "human" as const },
        };
        const engineOptions = [
            {
                id: "engine1",
                label: "Engine 1",
                createClient: () => mockClient.client,
            },
        ];
        const clocksRef = createMockClocksRef();

        const { result } = renderHook(() =>
            useEngineManager({
                sides,
                engineOptions,
                clocksRef,
                startSfen: "startpos",
                movesRef,
                positionTurn: "sente",
                isMatchRunning: true, // 対局中
                positionReady: true,
                onMoveFromEngine,
                onMatchEnd,
                maxLogs: 10,
                senteNnueSelection: createNnueSelection("nnue-1"),
                goteNnueSelection: createNnueSelection(null),
                resolveNnue,
            }),
        );

        await act(async () => {
            await Promise.resolve();
        });

        expect(mockClient.init).toHaveBeenCalled();
        const resetCallCount = mockClient.reset.mock.calls.length;

        // 対局中にrestartEngineForNnueを呼び出す（selectionを渡す）
        const newSelection = createNnueSelection("nnue-2");
        await act(async () => {
            await result.current.restartEngineForNnue("sente", newSelection);
        });

        // 対局中なのでresetは呼ばれない
        expect(mockClient.reset.mock.calls.length).toBe(resetCallCount);
    });
});
