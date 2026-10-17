import {
    type AnalysisFinished,
    createMockEngineClient,
    type EngineInfoEvent,
} from "@shogi/engine-client";
import { describe, expect, it, vi } from "vitest";
import { type AnalysisTarget, createAnalysisController } from "./analysis-controller";

const target = (nodeId: string): AnalysisTarget => ({
    nodeId,
    sfen: "startpos",
    moves: nodeId === "A" ? [] : ["7g7f"],
});
const deferred = <T>() => {
    let resolve!: (value: T) => void;
    let reject!: (cause: unknown) => void;
    const promise = new Promise<T>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
};
const setup = (prepare = vi.fn(async () => {})) => {
    const client = createMockEngineClient();
    const runs: Array<{
        complete: () => void;
        emit: (info: EngineInfoEvent) => void;
        pause: ReturnType<typeof vi.fn>;
    }> = [];
    const launch = vi.fn(
        async (sessionId: string, _budget: unknown, onInfo: (info: EngineInfoEvent) => void) => {
            const done = deferred<AnalysisFinished>();
            const runId = runs.length * 2 + 2;
            const result: AnalysisFinished = {
                sessionId,
                runId,
                reason: "paused",
                resumable: true,
                completedDepth: 3,
                nodes: 10,
                timeMs: 1,
                totalNodes: 10,
                totalTimeMs: 1,
                workerDepths: [[0, 3]],
            };
            const pause = vi.fn(async () => {
                done.resolve(result);
                return result;
            });
            runs.push({
                pause,
                emit: onInfo,
                complete: () => done.resolve({ ...result, reason: "budgetReached" }),
            });
            return { sessionId, runId, pause, finished: done.promise };
        },
    );
    client.analysis = {
        available: () => true,
        start: launch,
        resume: vi.fn((...args: Parameters<typeof launch>) => launch(...args)),
        release: vi.fn(async () => {}),
    };
    client.loadPosition = vi.fn(client.loadPosition);
    client.dispose = vi.fn(client.dispose);
    const onInfo = vi.fn();
    const onFinished = vi.fn();
    let id = 0;
    const controller = createAnalysisController({
        createClient: () => client,
        prepare,
        onInfo,
        onFinished,
        onState: vi.fn(),
        createSessionId: () => `session-${++id}`,
    });
    return { controller, client, runs, prepare, onInfo, onFinished, launch };
};

describe("対話解析 controller", () => {
    it("開始ハンドルを待つ間の停止要求を失わない", async () => {
        const { controller, client, runs, launch } = setup();
        const gate = deferred<void>();
        const starting = vi.fn(async (...args: Parameters<typeof launch>) => {
            await gate.promise;
            return launch(...args);
        });
        if (!client.analysis) throw new Error("missing analysis");
        client.analysis.start = starting;
        await controller.select(target("A"));
        const start = controller.start();
        await vi.waitFor(() => expect(starting).toHaveBeenCalled());
        const pause = controller.pause();
        gate.resolve();
        await Promise.all([start, pause]);
        expect(runs[0].pause).toHaveBeenCalledTimes(1);
        expect(controller.getState().phase).toBe("paused");
        await controller.dispose();
    });

    it("同じノードでも履歴が変われば新規探索にする", async () => {
        const { controller, client } = setup();
        await controller.select(target("A"));
        await controller.start();
        await controller.pause();
        await controller.select({ ...target("A"), moves: ["7g7f"] });
        expect(controller.getState().canResume).toBe(false);
        await controller.start();
        expect(client.analysis?.resume).not.toHaveBeenCalled();
        expect(client.loadPosition).toHaveBeenCalledTimes(2);
        await controller.dispose();
    });

    it("停止に失敗したら再開不可にしてエンジンを破棄する", async () => {
        const { controller, client, runs } = setup();
        await controller.select(target("A"));
        await controller.start();
        runs[0].pause.mockRejectedValue(new Error("stop timeout"));
        await controller.pause();
        expect(controller.getState().phase).toBe("error");
        expect(controller.getState().canResume).toBe(false);
        expect(client.dispose).toHaveBeenCalledTimes(1);
        await controller.dispose();
    });

    it("選択だけでは開始せず、停止後の閲覧で保持状態を捨てない", async () => {
        const { controller, client, prepare } = setup();
        await controller.select(target("A"));
        expect(prepare).not.toHaveBeenCalled();
        await controller.start();
        await controller.pause();
        await controller.select(target("B"));
        expect(controller.getState().retained?.nodeId).toBe("A");
        expect(controller.getState().canResume).toBe(false);
        await controller.select(target("A"));
        expect(controller.getState().canResume).toBe(true);
        await controller.start({ type: "nodes", nodes: 100 });
        expect(client.analysis?.resume).toHaveBeenCalledWith(
            "session-1",
            { type: "nodes", nodes: 100 },
            expect.any(Function),
        );
        expect(client.loadPosition).toHaveBeenCalledTimes(1);
        await controller.dispose();
    });

    it("実行中だけ最新の選択局面へ追従し、古い結果を表示しない", async () => {
        const { controller, runs, onInfo, onFinished, client } = setup();
        await controller.select(target("A"));
        await controller.start();
        const b = controller.select(target("B"));
        const c = controller.select(target("C"));
        await Promise.all([b, c]);
        expect(runs[0].pause).toHaveBeenCalledTimes(1);
        expect(client.loadPosition).toHaveBeenCalledTimes(2);
        expect(controller.getState().retained?.nodeId).toBe("C");
        expect(controller.getState().phase).toBe("running");
        runs[0].emit({ type: "info", depth: 99 });
        expect(onInfo).not.toHaveBeenCalled();
        expect(onFinished).toHaveBeenCalledTimes(1);
        await controller.dispose();
    });

    it("再開後に旧runのinfoを無視し、順位ごとの新infoはそのまま渡す", async () => {
        const { controller, runs, onInfo } = setup();
        await controller.select(target("A"));
        await controller.start();
        await controller.pause();
        await controller.start();
        runs[0].emit({ type: "info", depth: 99 });
        runs[1].emit({ type: "info", depth: 4, multipv: 2 });
        expect(onInfo).toHaveBeenCalledTimes(1);
        expect(onInfo.mock.calls[0][2].depth).toBe(4);
        await controller.dispose();
    });

    it("非表示で停止し、再表示だけでは再開しない", async () => {
        const { controller, launch } = setup();
        await controller.select(target("A"));
        await controller.start();
        await controller.setVisible(false);
        await controller.setVisible(true);
        expect(controller.getState().phase).toBe("paused");
        expect(launch).toHaveBeenCalledTimes(1);
        await controller.dispose();
    });

    it("予算終了で止まり、局面移動だけでは勝手に再開しない", async () => {
        const { controller, runs, launch } = setup();
        await controller.select(target("A"));
        await controller.start({ type: "time", milliseconds: 100 });
        runs[0].complete();
        await Promise.resolve();
        await controller.select(target("B"));
        expect(controller.getState().following).toBe(false);
        expect(launch).toHaveBeenCalledTimes(1);
        await controller.dispose();
    });

    it("準備中に離脱したら探索せず資源を解放する", async () => {
        const gate = deferred<void>();
        const { controller, launch, client, prepare } = setup(vi.fn(() => gate.promise));
        await controller.select(target("A"));
        const starting = controller.start();
        await vi.waitFor(() => expect(prepare).toHaveBeenCalled());
        const leaving = controller.dispose();
        gate.resolve();
        await Promise.all([starting, leaving]);
        expect(launch).not.toHaveBeenCalled();
        expect(client.dispose).toHaveBeenCalledTimes(1);
        expect(controller.getState().phase).toBe("disposed");
    });

    it("未対応環境では再開対応を偽装しない", async () => {
        const { controller, client, launch } = setup();
        client.analysis = undefined;
        await controller.select(target("A"));
        await controller.start();
        expect(controller.getState().phase).toBe("unsupported");
        expect(launch).not.toHaveBeenCalled();
        await controller.dispose();
    });
});
