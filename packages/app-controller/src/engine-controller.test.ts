import type { EngineEvent } from "@shogi/engine-client";
import { describe, expect, it, vi } from "vitest";
import {
    accumulateSearchStats,
    createEngineController,
    determineBestmoveAction,
    handleBestmove,
    handleInfoEvent,
} from "./engine-controller";

describe("accumulateSearchStats", () => {
    it("multipv 1 の各フィールドを last-wins で累積する", () => {
        const first = accumulateSearchStats(
            {},
            {
                type: "info",
                depth: 10,
                nodes: 100,
                scoreCp: 20,
            },
        );
        expect(accumulateSearchStats(first, { type: "info", depth: 12, nps: 5000 })).toEqual({
            depth: 12,
            nodes: 100,
            scoreCp: 20,
            nps: 5000,
        });
    });

    it("通常評価と詰み評価は排他で保持する", () => {
        const cpThenMate = accumulateSearchStats(
            accumulateSearchStats({}, { type: "info", depth: 10, scoreCp: 50 }),
            { type: "info", depth: 15, scoreMate: 5 },
        );
        expect(cpThenMate).toEqual({ depth: 15, scoreMate: 5 });

        const mateThenCp = accumulateSearchStats(
            accumulateSearchStats({}, { type: "info", scoreMate: -3 }),
            { type: "info", scoreCp: -120 },
        );
        expect(mateThenCp).toEqual({ scoreCp: -120 });
    });

    it("multipv 2 以上を無視する", () => {
        const current = { depth: 10, scoreCp: 20 };
        expect(accumulateSearchStats(current, { type: "info", multipv: 2, depth: 99 })).toBe(
            current,
        );
    });
});

describe("determineBestmoveAction", () => {
    it("通常の手の場合、apply_moveアクションを返す", () => {
        const result = determineBestmoveAction({
            move: "7g7f",
            side: "sente",
            engineId: "engine1",
            activeSearch: { side: "sente", engineId: "engine1" },
            movesCount: 5,
        });

        expect(result.action).toBe("apply_move");
        expect(result.move).toBe("7g7f");
        expect(result.shouldClearActive).toBe(true);
        expect(result.shouldUpdateRequestPly).toBe(true);
    });

    it("win トークンの場合、end_matchアクションを返す", () => {
        const result = determineBestmoveAction({
            move: "win",
            side: "sente",
            engineId: "engine1",
            activeSearch: { side: "sente", engineId: "engine1" },
            movesCount: 5,
        });

        expect(result.action).toBe("end_match");
        expect(result.gameResult?.reason.kind).toBe("win_declaration");
        expect(result.shouldClearActive).toBe(true);
        expect(result.shouldUpdateRequestPly).toBe(true);
    });

    it("resign トークンの場合、end_matchアクションを返す", () => {
        const result = determineBestmoveAction({
            move: "resign",
            side: "sente",
            engineId: "engine1",
            activeSearch: { side: "sente", engineId: "engine1" },
            movesCount: 5,
        });

        expect(result.action).toBe("end_match");
        expect(result.gameResult?.reason.kind).toBe("resignation");
        expect(result.shouldClearActive).toBe(true);
    });

    it("none トークンの場合、end_matchアクションを返す", () => {
        const result = determineBestmoveAction({
            move: "none",
            side: "gote",
            engineId: "engine1",
            activeSearch: { side: "gote", engineId: "engine1" },
            movesCount: 5,
        });

        expect(result.action).toBe("end_match");
        expect(result.gameResult?.reason.kind).toBe("checkmate");
        expect(result.shouldClearActive).toBe(true);
    });

    it("activeSearchが一致しない場合、skipアクションを返す", () => {
        const result = determineBestmoveAction({
            move: "7g7f",
            side: "sente",
            engineId: "engine1",
            activeSearch: { side: "gote", engineId: "engine1" },
            movesCount: 5,
        });

        expect(result.action).toBe("skip");
        expect(result.shouldClearActive).toBe(false);
        expect(result.shouldUpdateRequestPly).toBe(false);
    });

    it("activeSearchがnullの場合、skipアクションを返す", () => {
        const result = determineBestmoveAction({
            move: "7g7f",
            side: "sente",
            engineId: "engine1",
            activeSearch: null,
            movesCount: 5,
        });

        expect(result.action).toBe("skip");
        expect(result.shouldClearActive).toBe(false);
    });

    it("engineIdが一致しない場合、skipアクションを返す", () => {
        const result = determineBestmoveAction({
            move: "7g7f",
            side: "sente",
            engineId: "engine1",
            activeSearch: { side: "sente", engineId: "engine2" },
            movesCount: 5,
        });

        expect(result.action).toBe("skip");
        expect(result.shouldClearActive).toBe(false);
    });

    it("大文字小文字を区別せずにトークンを判定する", () => {
        const resultWin = determineBestmoveAction({
            move: "WIN",
            side: "sente",
            engineId: "engine1",
            activeSearch: { side: "sente", engineId: "engine1" },
            movesCount: 5,
        });

        expect(resultWin.action).toBe("end_match");
        expect(resultWin.gameResult?.reason.kind).toBe("win_declaration");

        const resultResign = determineBestmoveAction({
            move: "RESIGN",
            side: "gote",
            engineId: "engine1",
            activeSearch: { side: "gote", engineId: "engine1" },
            movesCount: 5,
        });

        expect(resultResign.action).toBe("end_match");
        expect(resultResign.gameResult?.reason.kind).toBe("resignation");
    });

    it("空白を含む手をトリムする", () => {
        const result = determineBestmoveAction({
            move: "  7g7f  ",
            side: "sente",
            engineId: "engine1",
            activeSearch: { side: "sente", engineId: "engine1" },
            movesCount: 5,
        });

        expect(result.action).toBe("apply_move");
        expect(result.move).toBe("7g7f");
    });
});

describe("handleBestmove", () => {
    it("bestmove イベントで通常手を適用する", () => {
        const onMoveFromEngine = vi.fn();
        const onMatchEnd = vi.fn().mockResolvedValue(undefined);
        const onError = vi.fn();
        const event: EngineEvent = { type: "bestmove", move: "7g7f" };

        const result = handleBestmove(event, {
            side: "sente",
            engineId: "engine1",
            activeSearch: { side: "sente", engineId: "engine1" },
            movesCount: 3,
            onMoveFromEngine,
            onMatchEnd,
            onError,
        });

        expect(result?.action).toBe("apply_move");
        expect(onMoveFromEngine).toHaveBeenCalledWith("7g7f");
        expect(onMatchEnd).not.toHaveBeenCalled();
        expect(onError).not.toHaveBeenCalled();
    });

    it("bestmove resign で対局終了を通知する", async () => {
        const onMoveFromEngine = vi.fn();
        const onMatchEnd = vi.fn().mockResolvedValue(undefined);
        const onError = vi.fn();
        const event: EngineEvent = { type: "bestmove", move: "resign" };

        const result = handleBestmove(event, {
            side: "sente",
            engineId: "engine1",
            activeSearch: { side: "sente", engineId: "engine1" },
            movesCount: 12,
            onMoveFromEngine,
            onMatchEnd,
            onError,
        });

        expect(result?.action).toBe("end_match");
        expect(onMoveFromEngine).not.toHaveBeenCalled();
        expect(onMatchEnd).toHaveBeenCalledTimes(1);
        await Promise.resolve();
        expect(onError).not.toHaveBeenCalled();
    });
});

describe("handleInfoEvent", () => {
    it("評価値がある info のみ callback を呼ぶ", () => {
        const onEvalUpdate = vi.fn();
        const event: EngineEvent = { type: "info", scoreCp: 123 };
        handleInfoEvent(event, { onEvalUpdate, ply: 5 });
        expect(onEvalUpdate).toHaveBeenCalledWith(5, event);
    });

    it("評価値がない info は無視する", () => {
        const onEvalUpdate = vi.fn();
        const event: EngineEvent = { type: "info", depth: 5 };
        handleInfoEvent(event, { onEvalUpdate, ply: 2 });
        expect(onEvalUpdate).not.toHaveBeenCalled();
    });
});

describe("createEngineController", () => {
    const createMockEngineClient = (options?: { initError?: Error; withReset?: boolean }) => {
        const listeners = new Set<(event: EngineEvent) => void>();
        const subscribe = vi.fn((handler: (event: EngineEvent) => void) => {
            listeners.add(handler);
            return () => listeners.delete(handler);
        });
        const init = options?.initError
            ? vi.fn().mockRejectedValue(options.initError)
            : vi.fn().mockResolvedValue(undefined);
        const loadPosition = vi.fn().mockResolvedValue(undefined);
        const cancel = vi.fn().mockResolvedValue(undefined);
        const search = vi.fn().mockResolvedValue({ cancel });
        const stop = vi.fn().mockResolvedValue(undefined);
        const dispose = vi.fn().mockResolvedValue(undefined);
        const setOption = vi.fn().mockResolvedValue(undefined);
        const reset = options?.withReset ? vi.fn().mockResolvedValue(undefined) : undefined;
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
                setOption,
                subscribe,
                dispose,
                ...(reset ? { reset } : {}),
            },
            emit,
            init,
            loadPosition,
            search,
            reset,
            stop,
            dispose,
        };
    };

    const createClockState = () => ({
        sente: { mainMs: 1000, byoyomiMs: 500 },
        gote: { mainMs: 1000, byoyomiMs: 500 },
        lastUpdatedAt: Date.now(),
        ticking: null as "sente" | "gote" | null,
    });

    const flushPromises = async () => {
        for (let i = 0; i < 10; i++) {
            await Promise.resolve();
        }
    };

    it("エンジンを初期化し探索を開始する", async () => {
        const mockClient = createMockEngineClient();
        const onMoveFromEngine = vi.fn();
        const onMatchEnd = vi.fn().mockResolvedValue(undefined);
        const controller = createEngineController({
            createClient: (_engineId) => mockClient.client,
            getClockState: createClockState,
            now: () => Date.now(),
            resolveNnue: async () => null,
            callbacks: { onMoveFromEngine, onMatchEnd },
        });

        controller.command.syncContext({
            sides: {
                sente: { role: "engine", engineId: "engine1" },
                gote: { role: "human" },
            },
            position: {
                startSfen: "startpos",
                moves: [],
                turn: "sente",
                ready: true,
            },
            matchRunning: true,
        });

        await controller.command.startTurn("sente");
        await flushPromises();

        expect(mockClient.init).toHaveBeenCalledTimes(1);
        expect(mockClient.loadPosition).toHaveBeenCalledTimes(2);
        expect(mockClient.search).toHaveBeenCalledTimes(1);
        expect(controller.getState().engineStatus.sente).toBe("thinking");
        expect(controller.getState().engineReady.sente).toBe(true);
    });

    it("後手の探索に両者の残り持ち時間を渡す", async () => {
        const mockClient = createMockEngineClient();
        const controller = createEngineController({
            createClient: () => mockClient.client,
            getClockState: () => ({
                sente: { mainMs: 12_000, byoyomiMs: 1_000 },
                gote: { mainMs: 8_000, byoyomiMs: 1_000 },
                lastUpdatedAt: 1_000,
                ticking: "gote",
            }),
            now: () => 2_500,
            resolveNnue: async () => null,
            callbacks: { onMoveFromEngine: vi.fn(), onMatchEnd: vi.fn() },
        });
        controller.command.syncContext({
            sides: { sente: { role: "human" }, gote: { role: "engine", engineId: "engine1" } },
            position: { startSfen: "startpos", moves: [], turn: "gote", ready: true },
            matchRunning: true,
        });

        await controller.command.startTurn("gote");
        await flushPromises();

        expect(mockClient.search).toHaveBeenCalledWith({
            limits: { btimeMs: 12_000, wtimeMs: 6_500, byoyomiMs: 1_000 },
            ponder: false,
        });
    });

    it("純秒読みでは btime/wtime を渡さない", async () => {
        const mockClient = createMockEngineClient();
        const controller = createEngineController({
            createClient: () => mockClient.client,
            getClockState: () => ({
                sente: { mainMs: 0, byoyomiMs: 1_000 },
                gote: { mainMs: 0, byoyomiMs: 1_000 },
                lastUpdatedAt: 1_000,
                ticking: "sente",
            }),
            now: () => 1_200,
            resolveNnue: async () => null,
            callbacks: { onMoveFromEngine: vi.fn(), onMatchEnd: vi.fn() },
        });
        controller.command.syncContext({
            sides: { sente: { role: "engine", engineId: "engine1" }, gote: { role: "human" } },
            position: { startSfen: "startpos", moves: [], turn: "sente", ready: true },
            matchRunning: true,
        });

        await controller.command.startTurn("sente");
        await flushPromises();

        expect(mockClient.search).toHaveBeenCalledWith({
            limits: { byoyomiMs: 800 },
            ponder: false,
        });
    });

    it("bestmove の通常手でコールバックを呼ぶ", async () => {
        const mockClient = createMockEngineClient();
        const onMoveFromEngine = vi.fn();
        const onMatchEnd = vi.fn().mockResolvedValue(undefined);
        const controller = createEngineController({
            createClient: (_engineId) => mockClient.client,
            getClockState: createClockState,
            now: () => Date.now(),
            resolveNnue: async () => null,
            callbacks: { onMoveFromEngine, onMatchEnd },
        });

        controller.command.syncContext({
            sides: {
                sente: { role: "engine", engineId: "engine1" },
                gote: { role: "human" },
            },
            position: {
                startSfen: "startpos",
                moves: [],
                turn: "sente",
                ready: true,
            },
            matchRunning: true,
        });

        await controller.command.startTurn("sente");
        await flushPromises();

        mockClient.emit({ type: "bestmove", move: "7g7f" });

        expect(onMoveFromEngine).toHaveBeenCalledWith("7g7f");
        expect(controller.getState().engineStatus.sente).toBe("idle");
    });

    it("prepare でエンジンを初期化するが探索は開始しない", async () => {
        const mockClient = createMockEngineClient();
        const controller = createEngineController({
            createClient: (_engineId) => mockClient.client,
            getClockState: createClockState,
            now: () => Date.now(),
            resolveNnue: async () => null,
            callbacks: { onMoveFromEngine: vi.fn(), onMatchEnd: vi.fn() },
        });

        controller.command.syncContext({
            sides: {
                sente: { role: "engine", engineId: "engine1" },
                gote: { role: "human" },
            },
            position: {
                startSfen: "startpos",
                moves: [],
                turn: "sente",
                ready: true,
            },
            matchRunning: false,
        });

        await expect(controller.command.prepare("sente")).resolves.toBe(true);
        await expect(controller.command.prepare("gote")).resolves.toBe(true);

        expect(mockClient.init).toHaveBeenCalledTimes(1);
        expect(mockClient.search).not.toHaveBeenCalled();
        expect(controller.getState().engineReady.sente).toBe(true);

        // 準備済みなら対局開始時のターン開始で再初期化されない
        controller.command.syncContext({ matchRunning: true });
        await flushPromises();

        expect(mockClient.init).toHaveBeenCalledTimes(1);
        expect(mockClient.search).toHaveBeenCalledTimes(1);
    });

    it("スレッド設定 0 (自動) は推奨値で init する", async () => {
        vi.stubGlobal("navigator", { hardwareConcurrency: 8 });
        try {
            const mockClient = createMockEngineClient();
            const controller = createEngineController({
                createClient: (_engineId) => mockClient.client,
                getClockState: createClockState,
                now: () => Date.now(),
                resolveNnue: async () => null,
                callbacks: { onMoveFromEngine: vi.fn(), onMatchEnd: vi.fn() },
            });

            controller.command.syncContext({
                sides: {
                    sente: { role: "engine", engineId: "engine1" },
                    gote: { role: "human" },
                },
                position: {
                    startSfen: "startpos",
                    moves: [],
                    turn: "sente",
                    ready: true,
                },
                matchRunning: false,
                engineThreads: { sente: 0, gote: 0 },
            });

            await controller.command.prepare("sente");

            expect(mockClient.init).toHaveBeenCalledWith({ threads: 4 });
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it("自動と同値の明示指定への変更では再初期化せず、異なる値では再初期化する", async () => {
        vi.stubGlobal("navigator", { hardwareConcurrency: 8 });
        try {
            const mockClient = createMockEngineClient({ withReset: true });
            const controller = createEngineController({
                createClient: (_engineId) => mockClient.client,
                getClockState: createClockState,
                now: () => Date.now(),
                resolveNnue: async () => null,
                callbacks: { onMoveFromEngine: vi.fn(), onMatchEnd: vi.fn() },
            });

            controller.command.syncContext({
                sides: {
                    sente: { role: "engine", engineId: "engine1" },
                    gote: { role: "human" },
                },
                position: {
                    startSfen: "startpos",
                    moves: [],
                    turn: "sente",
                    ready: true,
                },
                matchRunning: false,
                engineThreads: { sente: 0, gote: 0 },
            });
            await controller.command.prepare("sente");
            expect(mockClient.init).toHaveBeenCalledTimes(1);

            // 自動 (推奨 4) → 明示 4: 実効値が同じなので再初期化しない
            controller.command.syncContext({ engineThreads: { sente: 4, gote: 4 } });
            await flushPromises();
            expect(mockClient.init).toHaveBeenCalledTimes(1);
            expect(mockClient.reset).not.toHaveBeenCalled();

            // 明示 4 → 明示 2: 実効値が変わるので再初期化する
            controller.command.syncContext({ engineThreads: { sente: 2, gote: 2 } });
            await flushPromises();
            expect(mockClient.reset).toHaveBeenCalledTimes(1);
            expect(mockClient.init).toHaveBeenCalledTimes(2);
            expect(mockClient.init).toHaveBeenLastCalledWith({ threads: 2 });
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it("reset を持たないクライアントのスレッド変更は再初期化せず setOption で反映する", async () => {
        vi.stubGlobal("navigator", { hardwareConcurrency: 8 });
        try {
            const mockClient = createMockEngineClient();
            const controller = createEngineController({
                createClient: (_engineId) => mockClient.client,
                getClockState: createClockState,
                now: () => Date.now(),
                resolveNnue: async () => null,
                callbacks: { onMoveFromEngine: vi.fn(), onMatchEnd: vi.fn() },
            });

            controller.command.syncContext({
                sides: {
                    sente: { role: "engine", engineId: "engine1" },
                    gote: { role: "human" },
                },
                position: {
                    startSfen: "startpos",
                    moves: [],
                    turn: "sente",
                    ready: true,
                },
                matchRunning: false,
                engineThreads: { sente: 0, gote: 0 },
            });
            await controller.command.prepare("sente");
            expect(mockClient.init).toHaveBeenCalledTimes(1);

            controller.command.syncContext({ engineThreads: { sente: 2, gote: 2 } });
            await flushPromises();

            // 外部 USI 相当: init し直すとセッションが張り直されるため setoption で反映
            expect(mockClient.init).toHaveBeenCalledTimes(1);
            expect(mockClient.client.setOption).toHaveBeenCalledWith("Threads", 2);
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it("reset を持たないクライアントでは自動→推奨値と同値の明示変更でも setOption が届く", async () => {
        vi.stubGlobal("navigator", { hardwareConcurrency: 8 });
        try {
            const mockClient = createMockEngineClient();
            const controller = createEngineController({
                createClient: (_engineId) => mockClient.client,
                getClockState: createClockState,
                now: () => Date.now(),
                resolveNnue: async () => null,
                callbacks: { onMoveFromEngine: vi.fn(), onMatchEnd: vi.fn() },
            });

            controller.command.syncContext({
                sides: {
                    sente: { role: "engine", engineId: "engine1" },
                    gote: { role: "human" },
                },
                position: {
                    startSfen: "startpos",
                    moves: [],
                    turn: "sente",
                    ready: true,
                },
                matchRunning: false,
                engineThreads: { sente: 0, gote: 0 },
            });
            await controller.command.prepare("sente");

            // 外部 USI 相当では自動 = 登録時設定 (推奨値とは限らない) のため、
            // 推奨値 4 と同値の明示 4 への変更も no-op にせず setoption を送る
            controller.command.syncContext({ engineThreads: { sente: 4, gote: 4 } });
            await flushPromises();
            expect(mockClient.client.setOption).toHaveBeenCalledWith("Threads", 4);
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it("初期化中のスレッド変更は init 完了後に setOption で適用される", async () => {
        vi.stubGlobal("navigator", { hardwareConcurrency: 8 });
        try {
            const mockClient = createMockEngineClient();
            let resolveInit: (() => void) | undefined;
            mockClient.init.mockImplementation(
                () =>
                    new Promise<void>((resolve) => {
                        resolveInit = resolve;
                    }),
            );
            const controller = createEngineController({
                createClient: (_engineId) => mockClient.client,
                getClockState: createClockState,
                now: () => Date.now(),
                resolveNnue: async () => null,
                callbacks: { onMoveFromEngine: vi.fn(), onMatchEnd: vi.fn() },
            });

            controller.command.syncContext({
                sides: {
                    sente: { role: "engine", engineId: "engine1" },
                    gote: { role: "human" },
                },
                position: {
                    startSfen: "startpos",
                    moves: [],
                    turn: "sente",
                    ready: true,
                },
                matchRunning: false,
                engineThreads: { sente: 0, gote: 0 },
            });
            const preparing = controller.command.prepare("sente");
            await flushPromises();

            // init in-flight のままスレッド設定を変更
            controller.command.syncContext({ engineThreads: { sente: 2, gote: 2 } });
            expect(mockClient.client.setOption).not.toHaveBeenCalledWith("Threads", 2);

            resolveInit?.();
            await preparing;
            await flushPromises();

            expect(mockClient.client.setOption).toHaveBeenCalledWith("Threads", 2);
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it("スレッド変更の setOption 失敗はエラーログに記録される", async () => {
        vi.stubGlobal("navigator", { hardwareConcurrency: 8 });
        try {
            const mockClient = createMockEngineClient();
            const controller = createEngineController({
                createClient: (_engineId) => mockClient.client,
                getClockState: createClockState,
                now: () => Date.now(),
                resolveNnue: async () => null,
                callbacks: { onMoveFromEngine: vi.fn(), onMatchEnd: vi.fn() },
            });

            controller.command.syncContext({
                sides: {
                    sente: { role: "engine", engineId: "engine1" },
                    gote: { role: "human" },
                },
                position: {
                    startSfen: "startpos",
                    moves: [],
                    turn: "sente",
                    ready: true,
                },
                matchRunning: false,
                engineThreads: { sente: 0, gote: 0 },
            });
            await controller.command.prepare("sente");

            mockClient.client.setOption.mockRejectedValueOnce(new Error("no session"));
            controller.command.syncContext({ engineThreads: { sente: 2, gote: 2 } });
            await flushPromises();

            expect(
                controller
                    .getState()
                    .errorLogs.some((log) => log.message.includes("スレッド数の適用に失敗")),
            ).toBe(true);
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it("prepare の init 失敗は error 状態とエラーログに記録され throw しない", async () => {
        const mockClient = createMockEngineClient({ initError: new Error("init failed") });
        const controller = createEngineController({
            createClient: (_engineId) => mockClient.client,
            getClockState: createClockState,
            now: () => Date.now(),
            resolveNnue: async () => null,
            callbacks: { onMoveFromEngine: vi.fn(), onMatchEnd: vi.fn() },
        });

        controller.command.syncContext({
            sides: {
                sente: { role: "engine", engineId: "engine1" },
                gote: { role: "human" },
            },
            position: {
                startSfen: "startpos",
                moves: [],
                turn: "sente",
                ready: true,
            },
            matchRunning: false,
        });

        await expect(controller.command.prepare("sente")).resolves.toBe(false);

        expect(controller.getState().engineStatus.sente).toBe("error");
        expect(controller.getState().errorLogs[0]?.message).toContain("engine error");
    });

    it("prepare 中にターン開始が発火しても初期化を共有し探索が始まる", async () => {
        const mockClient = createMockEngineClient();
        let resolveInit: (() => void) | undefined;
        mockClient.init.mockImplementation(
            () =>
                new Promise<void>((resolve) => {
                    resolveInit = resolve;
                }),
        );
        const controller = createEngineController({
            createClient: (_engineId) => mockClient.client,
            getClockState: createClockState,
            now: () => Date.now(),
            resolveNnue: async () => null,
            callbacks: { onMoveFromEngine: vi.fn(), onMatchEnd: vi.fn() },
        });

        controller.command.syncContext({
            sides: {
                sente: { role: "engine", engineId: "engine1" },
                gote: { role: "human" },
            },
            position: {
                startSfen: "startpos",
                moves: [],
                turn: "sente",
                ready: true,
            },
            matchRunning: false,
        });

        const preparing = controller.command.prepare("sente");
        // init 未完了のうちに対局開始 → maybeStartTurn が発火
        controller.command.syncContext({ matchRunning: true });
        await flushPromises();
        expect(mockClient.search).not.toHaveBeenCalled();
        resolveInit?.();

        await expect(preparing).resolves.toBe(true);
        await flushPromises();

        expect(mockClient.init).toHaveBeenCalledTimes(1);
        expect(mockClient.search).toHaveBeenCalledTimes(1);
    });

    it("初期化中の dispose は初期化完了後に直列実行される", async () => {
        const mockClient = createMockEngineClient();
        let resolveInit: (() => void) | undefined;
        mockClient.init.mockImplementation(
            () =>
                new Promise<void>((resolve) => {
                    resolveInit = resolve;
                }),
        );
        const controller = createEngineController({
            createClient: (_engineId) => mockClient.client,
            getClockState: createClockState,
            now: () => Date.now(),
            resolveNnue: async () => null,
            callbacks: { onMoveFromEngine: vi.fn(), onMatchEnd: vi.fn() },
        });

        controller.command.syncContext({
            sides: {
                sente: { role: "engine", engineId: "engine1" },
                gote: { role: "human" },
            },
            position: {
                startSfen: "startpos",
                moves: [],
                turn: "sente",
                ready: true,
            },
            matchRunning: false,
        });

        const preparing = controller.command.prepare("sente");
        const disposing = controller.command.dispose("sente");
        await flushPromises();
        expect(mockClient.dispose).not.toHaveBeenCalled();
        resolveInit?.();

        await expect(preparing).resolves.toBe(true);
        await disposing;

        expect(mockClient.dispose).toHaveBeenCalledTimes(1);
        // dispose は in-flight init (loadPosition まで) の完了を待ってから実行される
        expect(mockClient.dispose.mock.invocationCallOrder[0]).toBeGreaterThan(
            mockClient.loadPosition.mock.invocationCallOrder[0] ?? 0,
        );
        expect(controller.getState().engineReady.sente).toBe(false);
    });

    it("init 失敗時に error 状態とエラーログを残す", async () => {
        const mockClient = createMockEngineClient({ initError: new Error("init failed") });
        const controller = createEngineController({
            createClient: (_engineId) => mockClient.client,
            getClockState: createClockState,
            now: () => Date.now(),
            resolveNnue: async () => null,
            callbacks: { onMoveFromEngine: vi.fn(), onMatchEnd: vi.fn() },
        });

        controller.command.syncContext({
            sides: {
                sente: { role: "engine", engineId: "engine1" },
                gote: { role: "human" },
            },
            position: {
                startSfen: "startpos",
                moves: [],
                turn: "sente",
                ready: true,
            },
            matchRunning: true,
        });

        await controller.command.startTurn("sente");
        await flushPromises();

        expect(controller.getState().engineStatus.sente).toBe("error");
        expect(controller.getState().errorLogs[0]?.message).toContain("engine error");
    });

    it("解析フローで探索開始と終了を反映する", async () => {
        const analysisClient = createMockEngineClient();
        const controller = createEngineController({
            createClient: (_engineId) => analysisClient.client,
            getClockState: createClockState,
            now: () => Date.now(),
            resolveNnue: async () => null,
            callbacks: { onMoveFromEngine: vi.fn(), onMatchEnd: vi.fn() },
        });

        await controller.command.startAnalysis({
            engineId: "engine1",
            sfen: "startpos",
            moves: [],
            ply: 0,
        });

        await flushPromises();

        expect(controller.getState().isAnalyzing).toBe(true);
        expect(analysisClient.init).toHaveBeenCalled();
        expect(analysisClient.loadPosition).toHaveBeenCalled();
        expect(analysisClient.search).toHaveBeenCalled();

        analysisClient.emit({ type: "bestmove", move: "resign" });
        expect(controller.getState().isAnalyzing).toBe(false);
    });

    it("dispose で破棄が呼ばれ stop は呼ばれない", async () => {
        const mockClient = createMockEngineClient();
        const controller = createEngineController({
            createClient: (_engineId) => mockClient.client,
            getClockState: createClockState,
            now: () => Date.now(),
            resolveNnue: async () => null,
            callbacks: { onMoveFromEngine: vi.fn(), onMatchEnd: vi.fn() },
        });

        controller.command.syncContext({
            sides: {
                sente: { role: "engine", engineId: "engine1" },
                gote: { role: "human" },
            },
            position: {
                startSfen: "startpos",
                moves: [],
                turn: "sente",
                ready: true,
            },
            matchRunning: true,
        });

        await controller.command.startTurn("sente");
        await flushPromises();

        await controller.command.dispose("sente");

        // dispose は Worker を terminate するため stop() を呼ばない設計
        // (理由は engine-controller.ts の disposeEngineForSide 実装コメント参照)
        expect(mockClient.stop).not.toHaveBeenCalled();
        expect(mockClient.dispose).toHaveBeenCalled();
        expect(controller.getState().engineReady.sente).toBe(false);
    });

    it("retry で reset と init が再実行される", async () => {
        const mockClient = createMockEngineClient({ withReset: true });
        const controller = createEngineController({
            createClient: (_engineId) => mockClient.client,
            getClockState: createClockState,
            now: () => Date.now(),
            resolveNnue: async () => null,
            callbacks: { onMoveFromEngine: vi.fn(), onMatchEnd: vi.fn() },
        });

        controller.command.syncContext({
            sides: {
                sente: { role: "engine", engineId: "engine1" },
                gote: { role: "human" },
            },
            position: {
                startSfen: "startpos",
                moves: [],
                turn: "sente",
                ready: true,
            },
            matchRunning: true,
        });

        await controller.command.startTurn("sente");
        await flushPromises();

        const initCallCount = mockClient.init.mock.calls.length;
        await controller.command.retry("sente");

        expect(mockClient.reset).toHaveBeenCalled();
        expect(mockClient.init.mock.calls.length).toBeGreaterThan(initCallCount);
    });
});
