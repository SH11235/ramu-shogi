import type {
    AnalysisBudget,
    AnalysisClient,
    AnalysisFinished,
    AnalysisRun,
    EngineInfoEvent,
} from "@shogi/engine-client";
import type { AnalysisCommand, AnalysisMessage } from "./analysisProtocol";

/** 同期 Wasm 探索中にも host から停止できる、実行世代付きの接続。 */
export function createAnalysisBridge(deps: {
    available(): boolean;
    ready(): Promise<void>;
    send(command: AnalysisCommand): void;
    release(): Promise<void>;
    fail(): void;
}) {
    let serial = 0;
    let epoch = 0;
    let preparing = false;
    let retained: string | null = null;
    let active: {
        sessionId: string;
        runId: number;
        buffer: SharedArrayBuffer;
        address: number;
        resolve(value: AnalysisFinished): void;
        reject(error: Error): void;
        info(info: EngineInfoEvent): void;
        finished: Promise<AnalysisFinished>;
    } | null = null;
    let pending: {
        id: string;
        resolve(message: Extract<AnalysisMessage, { type: "analysisPrepared" }>): void;
        reject(error: Error): void;
    } | null = null;
    const invalidate = (reason: string) => {
        epoch += 1;
        const error = new Error(reason);
        retained = null;
        pending?.reject(error);
        pending = null;
        active?.reject(error);
        active = null;
    };
    const receive = (message: AnalysisMessage) => {
        switch (message.type) {
            case "analysisPrepared":
                if (pending?.id === message.requestId) {
                    pending.resolve(message);
                    pending = null;
                }
                break;
            case "analysisInfo":
                if (active?.sessionId === message.sessionId && active.runId === message.runId) {
                    try {
                        active.info(message.info);
                    } catch (error) {
                        invalidate(String(error));
                        deps.fail();
                    }
                }
                break;
            case "analysisFinished":
                if (
                    active?.sessionId === message.result.sessionId &&
                    active.runId === message.result.runId
                ) {
                    retained = message.result.resumable ? active.sessionId : null;
                    active.resolve(message.result);
                    active = null;
                }
                break;
            case "analysisError":
                invalidate(message.message);
                break;
        }
    };
    const run = async (
        resume: boolean,
        sessionId: string,
        budget: AnalysisBudget,
        info: (info: EngineInfoEvent) => void,
    ): Promise<AnalysisRun> => {
        if (!sessionId || preparing || active || pending)
            throw new Error("解析を停止してから開始してください");
        if (budget.type !== "unlimited") {
            const amount = budget.type === "time" ? budget.milliseconds : budget.nodes;
            if (!Number.isSafeInteger(amount) || amount <= 0)
                throw new Error("解析上限は正の整数で指定してください");
        }
        if (resume && retained !== sessionId) throw new Error("再開できる解析状態がありません");
        if (!deps.available())
            throw new Error("解析を利用する前に共有メモリエンジンを初期化してください");
        preparing = true;
        const startedEpoch = epoch;
        try {
            await deps.ready();
            if (startedEpoch !== epoch) throw new Error("解析の準備中に状態が失われました");
            if (!deps.available())
                throw new Error("この環境は解析の協調停止・再開に対応していません");
            const id = `analysis-${++serial}`;
            let preparationTimer: ReturnType<typeof setTimeout> | undefined;
            let prepared: Extract<AnalysisMessage, { type: "analysisPrepared" }>;
            try {
                prepared = await new Promise<
                    Extract<AnalysisMessage, { type: "analysisPrepared" }>
                >((resolve, reject) => {
                    pending = { id, resolve, reject };
                    preparationTimer = setTimeout(() => {
                        invalidate("解析準備がタイムアウトしました");
                        deps.fail();
                    }, 10000);
                    try {
                        deps.send({
                            type: "prepareAnalysis",
                            requestId: id,
                            sessionId,
                            resume,
                            budget,
                        });
                    } catch (error) {
                        pending = null;
                        reject(error);
                    }
                });
            } finally {
                clearTimeout(preparationTimer);
            }
            if (startedEpoch !== epoch) throw new Error("解析の準備中に状態が失われました");
            if (
                !(prepared.buffer instanceof SharedArrayBuffer) ||
                !Number.isInteger(prepared.address) ||
                prepared.address < 0 ||
                prepared.address % 4 !== 0 ||
                prepared.address + 4 > prepared.buffer.byteLength ||
                !Number.isInteger(prepared.runId) ||
                prepared.runId <= 0 ||
                prepared.runId % 2 !== 0
            ) {
                invalidate("解析停止ハンドルが不正です");
                deps.fail();
                throw new Error("解析停止ハンドルが不正です");
            }
            let resolveFinished!: (value: AnalysisFinished) => void;
            let rejectFinished!: (error: Error) => void;
            const finished = new Promise<AnalysisFinished>((resolve, reject) => {
                resolveFinished = resolve;
                rejectFinished = reject;
            });
            // 呼出側が pause だけを待つ場合も未処理 rejection にしない。
            void finished.catch(() => {});
            const current = {
                ...prepared,
                resolve: resolveFinished,
                reject: rejectFinished,
                info,
                finished,
            };
            active = current;
            retained = sessionId;
            try {
                deps.send({ type: "runAnalysis", sessionId, runId: current.runId });
            } catch (error) {
                invalidate(String(error));
                throw error;
            }
            return {
                sessionId,
                runId: current.runId,
                finished,
                async pause() {
                    if (active !== current) return finished;
                    const view = new Uint32Array(current.buffer);
                    Atomics.compareExchange(
                        view,
                        current.address / 4,
                        current.runId,
                        current.runId | 1,
                    );
                    let timer: ReturnType<typeof setTimeout> | undefined;
                    try {
                        return await Promise.race([
                            finished,
                            new Promise<never>((_, reject) => {
                                timer = setTimeout(() => {
                                    invalidate(
                                        "解析の停止がタイムアウトしました。再開状態を破棄しました",
                                    );
                                    deps.fail();
                                    reject(new Error("解析停止タイムアウト"));
                                }, 5000);
                            }),
                        ]);
                    } finally {
                        clearTimeout(timer);
                    }
                },
            };
        } finally {
            preparing = false;
        }
    };
    const client: AnalysisClient = {
        available: deps.available,
        start: (sessionId, budget, info) => run(false, sessionId, budget, info),
        resume: (sessionId, budget, info) => run(true, sessionId, budget, info),
        async release() {
            if (preparing || active || pending)
                throw new Error("停止完了後に解析状態を解放してください");
            preparing = true;
            retained = null;
            try {
                await deps.release();
            } finally {
                preparing = false;
            }
        },
    };
    return {
        client,
        receive,
        invalidate,
        busy: () => preparing || active !== null || pending !== null,
    };
}
