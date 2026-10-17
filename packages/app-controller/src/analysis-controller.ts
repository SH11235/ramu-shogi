import type {
    AnalysisBudget,
    AnalysisFinished,
    AnalysisRun,
    EngineClient,
    EngineInfoEvent,
} from "@shogi/engine-client";

/** 局面履歴まで含めた対話解析の対象。設定変更時は controller 自体を作り直す。 */
export interface AnalysisTarget {
    nodeId: string;
    sfen: string;
    moves: string[];
}

export interface InteractiveAnalysisState {
    phase:
        | "idle"
        | "preparing"
        | "running"
        | "stopping"
        | "paused"
        | "unsupported"
        | "error"
        | "disposed";
    selected: AnalysisTarget | null;
    retained: AnalysisTarget | null;
    following: boolean;
    canResume: boolean;
    error: string | null;
}

export interface InteractiveAnalysisOptions {
    /** この controller が専有する client。通常探索や全体解析と同時使用しない。 */
    createClient: () => EngineClient;
    /** 初回開始時に一度だけ NNUE・Threads・Hash・MultiPV 等を設定する。 */
    prepare: (client: EngineClient) => Promise<void>;
    onState: (state: InteractiveAnalysisState) => void;
    onInfo: (target: AnalysisTarget, sessionId: string, info: EngineInfoEvent) => void;
    onFinished: (target: AnalysisTarget, result: AnalysisFinished) => void;
    createSessionId?: () => string;
}

const copyTarget = (target: AnalysisTarget): AnalysisTarget => ({
    ...target,
    moves: [...target.moves],
});
const keyOf = (target: AnalysisTarget | null): string =>
    JSON.stringify(target ? [target.nodeId, target.sfen, target.moves] : null);
interface RetainedSession {
    target: AnalysisTarget;
    sessionId: string;
    resumable: boolean;
}

/**
 * 対話解析の操作を直列化する。選択だけでは起動せず、開始後だけ局面に追従する。
 * 停止・非表示化は追従を解除し、再表示だけでは再開しない。離脱時は dispose を待つ。
 */
export function createAnalysisController(options: InteractiveAnalysisOptions) {
    let client: EngineClient | null = null;
    let initialized = false;
    let selected: AnalysisTarget | null = null;
    let retained: RetainedSession | null = null;
    let active: { run: AnalysisRun; session: RetainedSession; preserveFollowing: boolean } | null =
        null;
    let infoGeneration = 0;
    let following = false;
    let disposed = false;
    let phase: InteractiveAnalysisState["phase"] = "idle";
    let error: string | null = null;
    let budget: AnalysisBudget = { type: "unlimited" };
    let queue = Promise.resolve();

    const state = (): InteractiveAnalysisState => ({
        phase,
        selected: selected ? copyTarget(selected) : null,
        retained: retained ? copyTarget(retained.target) : null,
        following,
        canResume:
            !!retained?.resumable &&
            keyOf(selected) === keyOf(retained.target) &&
            !active &&
            phase === "paused",
        error,
    });
    const emit = () => options.onState(state());
    const finish = (current: NonNullable<typeof active>, result: AnalysisFinished) => {
        if (active !== current) return;
        active = null;
        infoGeneration += 1;
        current.session.resumable = result.resumable;
        phase = "paused";
        // 別局面への切り替え途中の停止完了では、追従要求を消さない。
        if (!current.preserveFollowing) following = false;
        options.onFinished(copyTarget(current.session.target), result);
        emit();
    };
    const stop = async (preserveFollowing = false) => {
        const current = active;
        if (!current) return;
        current.preserveFollowing = preserveFollowing;
        phase = "stopping";
        emit();
        const result = await current.run.pause();
        finish(current, result);
    };
    const reconcile = async () => {
        if (disposed) {
            await stop();
            await client?.dispose();
            client = null;
            retained = null;
            phase = "disposed";
            emit();
            return;
        }
        if (!following || !selected) {
            await stop();
            if (phase !== "unsupported" && phase !== "error") phase = retained ? "paused" : "idle";
            emit();
            return;
        }
        if (active && keyOf(active.session.target) === keyOf(selected)) return;
        await stop(true);
        if (!following || disposed || !selected) return;
        phase = "preparing";
        emit();
        client ??= options.createClient();
        if (!initialized) {
            await options.prepare(client);
            initialized = true;
        }
        if (!following || disposed || !selected) return;
        const analysis = client.analysis;
        if (!analysis?.available()) {
            following = false;
            phase = "unsupported";
            emit();
            return;
        }
        const target = copyTarget(selected);
        const resume = !!retained?.resumable && keyOf(retained.target) === keyOf(target);
        if (!resume) {
            await analysis.release();
            retained = null;
            if (!following || disposed || keyOf(selected) !== keyOf(target)) return;
            await client.loadPosition(target.sfen, [...target.moves]);
            if (!following || disposed || keyOf(selected) !== keyOf(target)) return;
            retained = {
                target,
                sessionId: (options.createSessionId ?? (() => crypto.randomUUID()))(),
                resumable: false,
            };
        }
        const session = retained;
        if (!session) return;
        const generation = ++infoGeneration;
        const onInfo = (info: EngineInfoEvent) => {
            if (
                !disposed &&
                generation === infoGeneration &&
                retained === session &&
                keyOf(selected) === keyOf(session.target)
            ) {
                options.onInfo(copyTarget(session.target), session.sessionId, info);
            }
        };
        const run = await (resume ? analysis.resume : analysis.start)(
            session.sessionId,
            budget,
            onInfo,
        );
        const current = { run, session, preserveFollowing: false };
        active = current;
        phase = "running";
        emit();
        void run.finished
            .then((result) => finish(current, result))
            .catch((cause: unknown) => {
                if (active === current)
                    void enqueue(async () => {
                        if (active === current) await fail(cause);
                    });
            });
        // prepare/start を待つ間の停止・離脱を、ハンドル取得後ただちに反映する。
        if (disposed || !following || keyOf(selected) !== keyOf(session.target))
            await stop(!disposed && following);
    };
    const fail = async (cause: unknown) => {
        following = false;
        active = null;
        infoGeneration += 1;
        retained = null;
        initialized = false;
        const failedClient = client;
        client = null;
        try {
            await failedClient?.dispose();
        } finally {
            phase = disposed ? "disposed" : "error";
            error = cause instanceof Error ? cause.message : String(cause);
            emit();
        }
    };
    const enqueue = (action = reconcile): Promise<void> => {
        queue = queue.then(action).catch(fail);
        return queue;
    };
    return {
        getState: state,
        select(target: AnalysisTarget | null): Promise<void> {
            if (disposed) return queue;
            selected = target ? copyTarget(target) : null;
            emit();
            return enqueue();
        },
        /** 同じ局面に再開状態があれば続き、なければ新規解析を開始する。 */
        start(additionalBudget: AnalysisBudget = { type: "unlimited" }): Promise<void> {
            if (disposed || !selected) return queue;
            budget = { ...additionalBudget };
            following = true;
            error = null;
            return enqueue();
        },
        pause(): Promise<void> {
            following = false;
            return enqueue();
        },
        setVisible(visible: boolean): Promise<void> {
            if (!visible) following = false;
            return enqueue();
        },
        dispose(): Promise<void> {
            disposed = true;
            following = false;
            return enqueue();
        },
    };
}
