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
        const loadNnue = vi.fn().mockResolvedValue(undefined);
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
                loadNnue,
                search,
                stop,
                setOption,
                subscribe,
                dispose,
                ...(reset ? { reset } : {}),
            },
            emit,
            subscribe,
            init,
            loadPosition,
            loadNnue,
            search,
            reset,
            stop,
            dispose,
            cancel,
            setOption,
            listeners,
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

    const deferred = () => {
        let resolve: () => void = () => undefined;
        const promise = new Promise<void>((done) => {
            resolve = done;
        });
        return { promise, resolve };
    };

    const createGameLifecycleFixture = (side: "sente" | "gote") => {
        const mock = createMockEngineClient({ withReset: true });
        const resolveNnue = vi.fn().mockResolvedValue({ nnueId: "network", fvScale: 16 });
        const callbacks = {
            onMoveFromEngine: vi.fn(),
            onMatchEnd: vi.fn().mockResolvedValue(undefined),
            onEvalUpdate: vi.fn(),
            onLiveInfo: vi.fn(),
        };
        const createClient = vi.fn().mockReturnValue(mock.client);
        const controller = createEngineController({
            createClient,
            getClockState: createClockState,
            now: Date.now,
            resolveNnue,
            callbacks,
        });
        controller.command.syncContext({
            sides: {
                sente: { role: "human" },
                gote: { role: "human" },
                [side]: { role: "engine", engineId: "engine", skillLevel: { skillLevel: 10 } },
            },
            nnueSelections: { [side]: { nnueId: "network", presetKey: null } },
            position: { startSfen: "startpos", moves: [], turn: side, ready: true },
        });
        const callCounts = () => [
            mock.reset?.mock.calls.length,
            mock.init.mock.calls.length,
            resolveNnue.mock.calls.length,
            mock.loadNnue.mock.calls.length,
            mock.setOption.mock.calls.length,
            mock.loadPosition.mock.calls.length,
            mock.search.mock.calls.length,
        ];
        return { controller, mock, resolveNnue, createClient, callbacks, callCounts };
    };

    const blockGameStage = (
        fixture: ReturnType<typeof createGameLifecycleFixture>,
        stage:
            | "reset"
            | "init"
            | "resolveNnue"
            | "loadNnue"
            | "fvScale"
            | "skillLevel"
            | "loadPosition",
    ) => {
        const entered = deferred();
        const gate = deferred();
        const block = async () => {
            entered.resolve();
            await gate.promise;
        };
        if (stage === "fvScale" || stage === "skillLevel") {
            fixture.mock.setOption.mockImplementation(async (name: string) => {
                if (name === (stage === "fvScale" ? "FV_SCALE" : "Skill Level")) await block();
            });
        } else if (stage === "resolveNnue") {
            fixture.resolveNnue.mockImplementationOnce(async () => {
                await block();
                return { nnueId: "network", fvScale: 16 };
            });
        } else {
            fixture.mock[stage]?.mockImplementationOnce(block);
        }
        return { entered, gate };
    };

    describe.each(["sente", "gote"] as const)("%s の対局エンジン破棄", (side) => {
        it.each([
            "init",
            "resolveNnue",
            "loadNnue",
            "fvScale",
            "skillLevel",
            "loadPosition",
        ] as const)("%s 待機中のdisposeAllは後続操作と遅延イベントを無効化する", async (stage) => {
            const fixture = createGameLifecycleFixture(side);
            const { controller, mock, callbacks, callCounts } = fixture;
            const { entered, gate } = blockGameStage(fixture, stage);
            const preparing = controller.command.prepare(side);
            await entered.promise;
            const callsAtDispose = callCounts();
            const lateEvent = mock.subscribe.mock.calls[0][0];
            const disposing = controller.command.disposeAll();
            lateEvent({ type: "info", scoreCp: 100 });
            lateEvent({ type: "bestmove", move: "7g7f" });
            lateEvent({ type: "error", message: "late error" });
            expect(controller.getState().eventLogs).toEqual([]);
            expect(controller.getState().errorLogs).toEqual([]);
            for (const callback of Object.values(callbacks))
                expect(callback).not.toHaveBeenCalled();
            gate.resolve();
            await expect(preparing).resolves.toBe(false);
            await disposing;
            expect(callCounts()).toEqual(callsAtDispose);
            expect(mock.dispose).toHaveBeenCalledTimes(1);
            expect(mock.listeners.size).toBe(0);
            expect(controller.getState().engineReady[side]).toBe(false);
            expect(controller.getClientForSide(side)).toBeNull();
        });

        it("キュー待ちのprepareはdisposeでclientを生成せず終了する", async () => {
            const { controller, createClient } = createGameLifecycleFixture(side);
            const preparing = controller.command.prepare(side);
            const disposing = controller.command.dispose(side);
            await expect(preparing).resolves.toBe(false);
            await disposing;
            expect(createClient).not.toHaveBeenCalled();
        });

        it("dispose直後のprepareは新しいclientで初期化を共有する", async () => {
            const fixture = createGameLifecycleFixture(side);
            const { controller, mock, createClient, callbacks } = fixture;
            const { entered, gate } = blockGameStage(fixture, "init");
            const preparing = controller.command.prepare(side);
            await entered.promise;
            const oldEvent = mock.subscribe.mock.calls[0][0];
            const next = createMockEngineClient();
            const nextEntered = deferred();
            const nextGate = deferred();
            next.init.mockImplementationOnce(async () => {
                nextEntered.resolve();
                await nextGate.promise;
            });
            createClient.mockReturnValue(next.client);
            const disposing = controller.command.disposeAll();
            const restarting = controller.command.prepare(side);
            gate.resolve();
            await nextEntered.promise;
            const shared = controller.command.prepare(side);
            nextGate.resolve();
            await expect(preparing).resolves.toBe(false);
            await disposing;
            await expect(restarting).resolves.toBe(true);
            await expect(shared).resolves.toBe(true);
            expect(mock.loadNnue).not.toHaveBeenCalled();
            expect(mock.dispose).toHaveBeenCalledTimes(1);
            expect(next.init).toHaveBeenCalledTimes(1);
            expect(next.loadNnue).toHaveBeenCalledTimes(1);
            expect(controller.getClientForSide(side)).toBe(next.client);
            oldEvent({ type: "info", scoreCp: 1 });
            expect(callbacks.onEvalUpdate).not.toHaveBeenCalled();
            next.emit({ type: "info", scoreCp: 2 });
            expect(callbacks.onEvalUpdate).toHaveBeenCalledTimes(1);
            await controller.command.disposeAll();
        });

        it("init中のdispose後に対局を再開すると新しい世代だけが探索する", async () => {
            const fixture = createGameLifecycleFixture(side);
            const { controller, mock, createClient } = fixture;
            const { entered, gate } = blockGameStage(fixture, "init");
            controller.command.setMatchRunning(true);
            await entered.promise;
            const next = createMockEngineClient();
            createClient.mockReturnValue(next.client);
            const disposing = controller.command.disposeAll();
            controller.command.setMatchRunning(true);
            gate.resolve();
            await disposing;
            await controller.command.prepare(side);
            await flushPromises();
            expect(mock.search).not.toHaveBeenCalled();
            expect(mock.dispose).toHaveBeenCalledTimes(1);
            expect(next.init).toHaveBeenCalledTimes(1);
            expect(next.search).toHaveBeenCalledTimes(1);
            await controller.command.disposeAll();
        });
    });

    it.each([
        "reset",
        "init",
        "resolveNnue",
        "loadNnue",
        "fvScale",
        "skillLevel",
        "loadPosition",
    ] as const)("再初期化の%s待機中もdisposeAllで後続操作を止める", async (stage) => {
        const fixture = createGameLifecycleFixture("sente");
        const { controller, mock, callCounts } = fixture;
        await controller.command.prepare("sente");
        const { entered, gate } = blockGameStage(fixture, stage);
        const restarting = controller.command.restartForNnue("sente");
        await entered.promise;
        const callsAtDispose = callCounts();
        const disposing = controller.command.disposeAll();
        gate.resolve();
        await Promise.all([restarting, disposing]);
        expect(callCounts()).toEqual(callsAtDispose);
        expect(mock.dispose).toHaveBeenCalledTimes(1);
        expect(controller.getState().engineReady.sente).toBe(false);
        expect(controller.getState().isEngineRestarting).toBe(false);
    });

    it("dispose後に失敗したinitはエラーを通知しない", async () => {
        const fixture = createGameLifecycleFixture("sente");
        const { controller, mock } = fixture;
        const gate = deferred();
        const entered = deferred();
        mock.init.mockImplementationOnce(async () => {
            entered.resolve();
            await gate.promise;
            throw new Error("late init failure");
        });
        const preparing = controller.command.prepare("sente");
        await entered.promise;
        const disposing = controller.command.disposeAll();
        gate.resolve();
        await expect(preparing).resolves.toBe(false);
        await disposing;
        expect(controller.getState().errorLogs).toEqual([]);
        expect(controller.getState().engineStatus.sente).toBe("idle");
    });

    it("init中にキューへ積んだスレッド変更もdisposeで無効化する", async () => {
        const fixture = createGameLifecycleFixture("sente");
        const { controller, mock } = fixture;
        const { entered, gate } = blockGameStage(fixture, "init");
        const preparing = controller.command.prepare("sente");
        await entered.promise;
        controller.command.syncContext({ engineThreads: { sente: 2, gote: 2 } });
        const disposing = controller.command.disposeAll();
        gate.resolve();
        await Promise.all([preparing, disposing]);
        expect(mock.setOption).not.toHaveBeenCalled();
    });

    it.each([
        "loadPosition",
        "search",
    ] as const)("対局探索の%s待機中にdisposeしても検索と通知が復活しない", async (stage) => {
        const { controller, mock, callbacks } = createGameLifecycleFixture("sente");
        await controller.command.prepare("sente");
        const entered = deferred();
        const gate = deferred();
        mock[stage].mockImplementationOnce(async () => {
            entered.resolve();
            await gate.promise;
            if (stage === "search") return { cancel: mock.cancel };
        });
        controller.command.setMatchRunning(true);
        await entered.promise;
        const disposing = controller.command.disposeAll();
        const oldEvent = mock.subscribe.mock.calls[0][0];
        gate.resolve();
        await disposing;
        await flushPromises();
        oldEvent({ type: "bestmove", move: "7g7f" });
        expect(callbacks.onMoveFromEngine).not.toHaveBeenCalled();
        expect(mock.search).toHaveBeenCalledTimes(stage === "search" ? 1 : 0);
        expect(mock.cancel).not.toHaveBeenCalled();
        expect(mock.dispose).toHaveBeenCalledTimes(1);
        expect(controller.getClientForSide("sente")).toBeNull();
    });

    it.each([
        "cancel",
        "setOption",
        "loadPosition",
        "search",
    ] as const)("準備済み解析の%s待機中に新要求が来ても同じclientとNNUEを再利用する", async (stage) => {
        const mock = createMockEngineClient();
        const createClient = vi.fn().mockReturnValue(mock.client);
        const resolveNnue = vi.fn().mockResolvedValue({ nnueId: "network", fvScale: 16 });
        const controller = createEngineController({
            createClient,
            getClockState: createClockState,
            now: Date.now,
            resolveNnue,
        });
        controller.command.setAnalysisNnueSelection({ nnueId: "network", presetKey: null });
        const request = { engineId: "engine", sfen: "startpos", moves: [], ply: 0 };
        await controller.command.startAnalysis(request);
        const entered = deferred();
        const gate = deferred();
        mock[stage].mockImplementationOnce(async () => {
            entered.resolve();
            await gate.promise;
            if (stage === "search") return { cancel: mock.cancel };
        });
        const superseded = controller.command.startAnalysis({ ...request, ply: 1 });
        await entered.promise;
        const latest = controller.command.startAnalysis({ ...request, ply: 2 });
        gate.resolve();
        await Promise.all([superseded, latest]);
        expect(createClient).toHaveBeenCalledTimes(1);
        expect(mock.init).toHaveBeenCalledTimes(1);
        expect(mock.loadNnue).toHaveBeenCalledTimes(1);
        expect(mock.dispose).not.toHaveBeenCalled();
        expect(mock.search).toHaveBeenCalledTimes(stage === "search" ? 3 : 2);
        expect(controller.getState().isAnalyzing).toBe(true);
        await controller.command.disposeAll();
        expect(mock.dispose).toHaveBeenCalledTimes(1);
    });

    it.each([
        "init",
        "loadNnue",
    ] as const)("解析の%s中に置き換えたclientは再利用せず最新要求用に作り直す", async (stage) => {
        const first = createMockEngineClient();
        const next = createMockEngineClient();
        const entered = deferred();
        const gate = deferred();
        first[stage].mockImplementationOnce(async () => {
            entered.resolve();
            await gate.promise;
        });
        const createClient = vi.fn().mockReturnValueOnce(first.client).mockReturnValue(next.client);
        const controller = createEngineController({
            createClient,
            getClockState: createClockState,
            now: Date.now,
            resolveNnue: async () => ({ nnueId: "network", fvScale: 16 }),
        });
        controller.command.setAnalysisNnueSelection({ nnueId: "network", presetKey: null });
        const request = { engineId: "engine", sfen: "startpos", moves: [], ply: 0 };
        const superseded = controller.command.startAnalysis(request);
        await entered.promise;
        const latest = controller.command.startAnalysis({ ...request, ply: 1 });
        gate.resolve();
        await Promise.all([superseded, latest]);
        expect(first.dispose).toHaveBeenCalledTimes(1);
        expect(first.search).not.toHaveBeenCalled();
        expect(next.init).toHaveBeenCalledTimes(1);
        expect(next.loadNnue).toHaveBeenCalledTimes(1);
        expect(next.search).toHaveBeenCalledTimes(1);
        await controller.command.disposeAll();
    });

    it.each([
        "loadPosition",
        "search",
    ] as const)("解析の%sが置換後に失敗したclientは最新要求へ再利用しない", async (stage) => {
        const first = createMockEngineClient();
        const next = createMockEngineClient();
        const createClient = vi.fn().mockReturnValueOnce(first.client).mockReturnValue(next.client);
        const controller = createEngineController({
            createClient,
            getClockState: createClockState,
            now: Date.now,
            resolveNnue: async () => null,
        });
        const request = { engineId: "engine", sfen: "startpos", moves: [], ply: 0 };
        await controller.command.startAnalysis(request);
        const entered = deferred();
        const gate = deferred();
        first[stage].mockImplementationOnce(async () => {
            entered.resolve();
            await gate.promise;
            throw new Error("stale engine failure");
        });
        const superseded = controller.command.startAnalysis({ ...request, ply: 1 });
        await entered.promise;
        const latest = controller.command.startAnalysis({ ...request, ply: 2 });
        gate.resolve();
        await Promise.all([superseded, latest]);
        expect(first.dispose).toHaveBeenCalledTimes(1);
        expect(next.init).toHaveBeenCalledTimes(1);
        expect(next.search).toHaveBeenCalledTimes(1);
        expect(controller.getState().errorLogs).toEqual([]);
        await controller.command.disposeAll();
    });

    it("disposeを持たないclientでは破棄後に届いた検索handleをcancelする", async () => {
        const { controller, mock, createClient } = createGameLifecycleFixture("sente");
        createClient.mockReturnValue({ ...mock.client, dispose: undefined });
        await controller.command.prepare("sente");
        const entered = deferred();
        const gate = deferred();
        mock.search.mockImplementationOnce(async () => {
            entered.resolve();
            await gate.promise;
            return { cancel: mock.cancel };
        });
        controller.command.setMatchRunning(true);
        await entered.promise;
        await controller.command.disposeAll();
        gate.resolve();
        await flushPromises();
        expect(mock.cancel).toHaveBeenCalledTimes(1);
        expect(mock.dispose).not.toHaveBeenCalled();
    });

    it.each([
        "init",
        "resolveNnue",
        "loadNnue",
        "setOption",
        "loadPosition",
        "search",
    ] as const)("%s の完了待ちをcancelすると後続探索を開始せずclientを解放する", async (stage) => {
        const mock = createMockEngineClient();
        const entered = deferred();
        const gate = deferred();
        const resolveNnue = vi.fn().mockResolvedValue({ nnueId: "network", fvScale: 16 });
        const blocked = stage === "resolveNnue" ? resolveNnue : mock[stage];
        blocked.mockImplementationOnce(async () => {
            entered.resolve();
            await gate.promise;
            if (stage === "resolveNnue") return { nnueId: "network", fvScale: 16 };
            if (stage === "search") return { cancel: mock.cancel };
        });
        const controller = createEngineController({
            createClient: () => mock.client,
            getClockState: createClockState,
            now: Date.now,
            resolveNnue,
        });
        controller.command.setAnalysisNnueSelection({ nnueId: "network", presetKey: null });
        const starting = controller.command.startAnalysis({
            engineId: "engine",
            sfen: "startpos",
            moves: [],
            ply: 0,
        });
        await entered.promise;
        const cancelling = controller.command.cancelAnalysis();
        expect(controller.getState().isAnalyzing).toBe(false);
        gate.resolve();
        await Promise.all([starting, cancelling]);
        expect(mock.search).toHaveBeenCalledTimes(stage === "search" ? 1 : 0);
        expect(mock.dispose).toHaveBeenCalledTimes(1);
        expect(mock.listeners.size).toBe(0);
        expect(controller.getAnalysisClient()).toBeNull();
    });

    it("初期化中のdisposeAll後も同じcontrollerで新しい解析を開始できる", async () => {
        const first = createMockEngineClient();
        const second = createMockEngineClient();
        const entered = deferred();
        const gate = deferred();
        first.init.mockImplementationOnce(async () => {
            entered.resolve();
            await gate.promise;
        });
        const createClient = vi
            .fn()
            .mockReturnValueOnce(first.client)
            .mockReturnValue(second.client);
        const controller = createEngineController({
            createClient,
            getClockState: createClockState,
            now: Date.now,
            resolveNnue: async () => null,
        });
        const request = { engineId: "engine", sfen: "startpos", moves: [], ply: 0 };
        const starting = controller.command.startAnalysis(request);
        await entered.promise;
        const disposing = controller.command.disposeAll();
        const restarting = controller.command.startAnalysis(request);
        gate.resolve();
        await Promise.all([starting, disposing, restarting]);
        expect(first.dispose).toHaveBeenCalledTimes(1);
        expect(first.search).not.toHaveBeenCalled();
        expect(second.init).toHaveBeenCalledTimes(1);
        expect(second.search).toHaveBeenCalledTimes(1);
        expect(controller.getAnalysisClient()).toBe(second.client);
        await controller.command.disposeAll();
        expect(second.dispose).toHaveBeenCalledTimes(1);
        expect(second.cancel).not.toHaveBeenCalled();
        expect(second.listeners.size).toBe(0);
    });

    it("解析完了後のdisposeAllは購読とclientを解放する", async () => {
        const mock = createMockEngineClient();
        const controller = createEngineController({
            createClient: () => mock.client,
            getClockState: createClockState,
            now: Date.now,
            resolveNnue: async () => null,
        });
        await controller.command.startAnalysis({
            engineId: "engine",
            sfen: "startpos",
            moves: [],
            ply: 0,
        });
        mock.emit({ type: "bestmove", move: "7g7f" });
        await controller.command.disposeAll();
        expect(mock.dispose).toHaveBeenCalledTimes(1);
        expect(mock.cancel).not.toHaveBeenCalled();
        expect(mock.listeners.size).toBe(0);
        expect(controller.getAnalysisClient()).toBeNull();
    });

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

    it("手番側の持ち時間切れ後も btime 0 を渡す", async () => {
        const mockClient = createMockEngineClient();
        const controller = createEngineController({
            createClient: () => mockClient.client,
            getClockState: () => ({
                sente: { mainMs: 0, byoyomiMs: 1_000 },
                gote: { mainMs: 8_000, byoyomiMs: 1_000 },
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
            limits: { btimeMs: 0, wtimeMs: 8_000, byoyomiMs: 800 },
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

    it("初期化中のdisposeは実行中の呼び出しを待ち、局面は読み込まない", async () => {
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
        await flushPromises();
        expect(mockClient.init).toHaveBeenCalledTimes(1);
        const disposing = controller.command.dispose("sente");
        expect(mockClient.dispose).not.toHaveBeenCalled();
        resolveInit?.();

        await expect(preparing).resolves.toBe(false);
        await disposing;

        expect(mockClient.dispose).toHaveBeenCalledTimes(1);
        expect(mockClient.loadPosition).not.toHaveBeenCalled();
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

    it("解析の 1 局面の探索が終わるごとに、先手視点の結果を 1 回だけ通知する", async () => {
        const analysisClient = createMockEngineClient();
        const onAnalysisComplete = vi.fn();
        const onEvalUpdate = vi.fn();
        const controller = createEngineController({
            createClient: (_engineId) => analysisClient.client,
            getClockState: createClockState,
            now: () => Date.now(),
            resolveNnue: async () => null,
            callbacks: {
                onMoveFromEngine: vi.fn(),
                onMatchEnd: vi.fn(),
                onEvalUpdate,
                onAnalysisComplete,
            },
        });
        const layer = {
            layerId: "layer-1",
            spec: {
                version: 1 as const,
                engine: { kind: "wasm" as const, name: "rshogi", version: "0.8.1" },
                evaluation: {
                    nnueSha256: null,
                    fvScale: null,
                    progressSha256: null,
                    layerStacks: null,
                },
                limits: { timeMs: 1000, depth: 15, nodes: null },
                multiPv: 2,
                rules: { variant: "standard" as const },
            },
            display: { label: "RAMU・1 秒" },
        };

        await controller.command.startAnalysis({
            engineId: "engine1",
            sfen: "startpos",
            moves: ["7g7f"],
            ply: 1,
            multiPv: 2,
            nodeId: "node-1",
            sideToMove: "gote",
            layer,
        });
        await flushPromises();

        analysisClient.emit({ type: "info", depth: 10, scoreCp: 30, multipv: 1, pv: ["3c3d"] });
        analysisClient.emit({ type: "info", depth: 10, scoreCp: 10, multipv: 2, pv: ["8c8d"] });
        analysisClient.emit({
            type: "info",
            depth: 15,
            seldepth: 22,
            scoreCp: -120,
            multipv: 1,
            pv: ["3c3d", "2g2f"],
            nodes: 123456,
            timeMs: 1002,
        });
        // 途中経過では通知しない。
        expect(onAnalysisComplete).not.toHaveBeenCalled();
        expect(onEvalUpdate).toHaveBeenCalledTimes(3);

        analysisClient.emit({ type: "bestmove", move: "3c3d" });
        expect(onAnalysisComplete).toHaveBeenCalledTimes(1);
        const completion = onAnalysisComplete.mock.calls[0][0];
        expect(completion).toMatchObject({ runtimeNodeId: "node-1", ply: 1, layer });
        expect(completion.result).toMatchObject({
            completion: "completed",
            depth: 15,
            nodes: 123456,
            timeMs: 1002,
            execution: { parallelWorkers: 1, hashMb: null },
            candidates: [
                {
                    rank: 1,
                    // 後手番の局面で手番側 -120 = 先手視点 +120。
                    score: { kind: "cp", value: 120 },
                    depth: 15,
                    seldepth: 22,
                    pv: ["3c3d", "2g2f"],
                },
                { rank: 2, score: { kind: "cp", value: -10 }, depth: 10, pv: ["8c8d"] },
            ],
        });
        expect(completion.result.runId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-/);

        // 次の探索は別の runId で、前の探索の候補を継ぎ足さない。
        await controller.command.startAnalysis({
            engineId: "engine1",
            sfen: "startpos",
            moves: [],
            ply: 0,
            sideToMove: "sente",
        });
        await flushPromises();
        analysisClient.emit({ type: "info", depth: 8, scoreCp: 40, multipv: 1, pv: ["7g7f"] });
        analysisClient.emit({ type: "bestmove", move: "7g7f" });
        expect(onAnalysisComplete).toHaveBeenCalledTimes(2);
        const second = onAnalysisComplete.mock.calls[1][0];
        expect(second).toMatchObject({ runtimeNodeId: null, ply: 0, layer: null });
        expect(second.result.candidates).toEqual([
            { rank: 1, score: { kind: "cp", value: 40 }, depth: 8, seldepth: null, pv: ["7g7f"] },
        ]);
        expect(second.result.runId).not.toBe(completion.result.runId);
    });

    it("手番を指定しない解析（既存の画面）では終了を通知せず、中断は aborted で通知する", async () => {
        const analysisClient = createMockEngineClient();
        const onAnalysisComplete = vi.fn();
        const controller = createEngineController({
            createClient: (_engineId) => analysisClient.client,
            getClockState: createClockState,
            now: () => Date.now(),
            resolveNnue: async () => null,
            callbacks: { onMoveFromEngine: vi.fn(), onMatchEnd: vi.fn(), onAnalysisComplete },
        });

        await controller.command.startAnalysis({
            engineId: "engine1",
            sfen: "startpos",
            moves: [],
            ply: 0,
        });
        await flushPromises();
        analysisClient.emit({ type: "info", depth: 8, scoreCp: 40, multipv: 1 });
        analysisClient.emit({ type: "bestmove", move: "7g7f" });
        expect(onAnalysisComplete).not.toHaveBeenCalled();

        await controller.command.startAnalysis({
            engineId: "engine1",
            sfen: "startpos",
            moves: [],
            ply: 0,
            sideToMove: "sente",
        });
        await flushPromises();
        analysisClient.emit({ type: "info", depth: 6, scoreCp: 25, multipv: 1 });
        await controller.command.cancelAnalysis();
        expect(onAnalysisComplete).toHaveBeenCalledTimes(1);
        expect(onAnalysisComplete.mock.calls[0][0].result).toMatchObject({
            completion: "aborted",
            depth: 6,
            candidates: [{ rank: 1, score: { kind: "cp", value: 25 } }],
        });
        // 評価値が 1 つも届かなかった探索は通知しない。
        await controller.command.startAnalysis({
            engineId: "engine1",
            sfen: "startpos",
            moves: [],
            ply: 0,
            sideToMove: "sente",
        });
        await flushPromises();
        analysisClient.emit({ type: "bestmove", move: "resign" });
        expect(onAnalysisComplete).toHaveBeenCalledTimes(1);
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
        expect(mockClient.cancel).not.toHaveBeenCalled();
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
