import type { EngineEvent } from "@shogi/engine-client";
import { describe, expect, it, vi } from "vitest";
import {
    createEngineController,
    determineBestmoveAction,
    handleBestmove,
    handleInfoEvent,
} from "./engine-controller";

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
        await Promise.resolve();
        await Promise.resolve();
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

        await controller.command.prepare("sente");
        await controller.command.prepare("gote");

        expect(mockClient.init).toHaveBeenCalledTimes(1);
        expect(mockClient.search).not.toHaveBeenCalled();
        expect(controller.getState().engineReady.sente).toBe(true);

        // 準備済みなら対局開始時のターン開始で再初期化されない
        controller.command.syncContext({ matchRunning: true });
        await flushPromises();

        expect(mockClient.init).toHaveBeenCalledTimes(1);
        expect(mockClient.search).toHaveBeenCalledTimes(1);
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

        await expect(controller.command.prepare("sente")).resolves.toBeUndefined();

        expect(controller.getState().engineStatus.sente).toBe("error");
        expect(controller.getState().errorLogs[0]?.message).toContain("engine error");
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
