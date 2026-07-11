import type {
    EngineClient,
    EngineEvent,
    EngineEventHandler,
    EngineInitOptions,
    LoadPositionOptions,
    SearchHandle,
    SearchParams,
} from "@shogi/engine-client";
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { listen as tauriListen } from "@tauri-apps/api/event";

interface UsiEngineClientOptions {
    registrationId: string;
}

/**
 * 外部USIエンジン用の EngineClient 実装。
 * init() で usi_engine_start を呼び、sessionId ベースで通信する。
 */
export function createUsiEngineClient(options: UsiEngineClientOptions): EngineClient {
    const { registrationId } = options;

    let sessionId: string | null = null;
    let unlisten: UnlistenFn | null = null;
    const listeners = new Set<EngineEventHandler>();

    const assertSession = (): string => {
        if (!sessionId) {
            throw new Error("Engine not initialized. Call init() first.");
        }
        return sessionId;
    };

    const emit = (event: EngineEvent) => {
        for (const handler of listeners) {
            handler(event);
        }
    };

    // init / dispose の並行呼び出しでセッションが取りこぼされないよう直列化する
    let opChain: Promise<unknown> = Promise.resolve();
    const runExclusive = <T>(fn: () => Promise<T>): Promise<T> => {
        const run = opChain.then(fn);
        opChain = run.then(
            () => undefined,
            () => undefined,
        );
        return run;
    };

    const dropListener = (): void => {
        if (!unlisten) return;
        try {
            unlisten();
        } catch {
            // ignore
        }
        unlisten = null;
    };

    // bestEffort=false では quit の失敗を伝播し、sessionId を保持したまま中断する
    // (識別子を失うと旧プロセスを回収できなくなるため)。Rust 側の quit は
    // 存在しない session_id にも Ok を返す冪等実装なので、失敗 = IPC 異常。
    // bestEffort=true (dispose 用) は終端操作として quit 失敗を無視し sessionId も
    // 消去する — dispose 後のクライアント再利用は想定せず、回収不能を許容する
    const closeSession = async (bestEffort: boolean): Promise<void> => {
        // quit に伴う旧チャネルの EOF エラーイベントを購読者へ流さないよう、
        // 購読解除を先に行う
        dropListener();
        if (sessionId) {
            const quit = tauriInvoke("usi_engine_quit", { session_id: sessionId });
            if (bestEffort) {
                await quit.catch(() => undefined);
            } else {
                await quit;
            }
            sessionId = null;
        }
    };

    return {
        // opts.threads は意図的に無視する。外部 USI エンジンのスレッド数は
        // エンジン登録時に保存したオプション (usi_engine_start が isready 前に適用)
        // を優先し、UI の自動解決値で無条件に上書きしない。厳格な USI エンジンは
        // isready 後の setoption を反映しないため、起動後に送っても保証がない
        async init(_opts?: EngineInitOptions): Promise<void> {
            await runExclusive(async () => {
                // 再初期化 (retry / restartForNnue 等) で呼ばれたとき、旧セッションを
                // quit せずに sessionId を上書きすると外部プロセスがリークする
                await closeSession(false);

                const newSessionId = await tauriInvoke<string>("usi_engine_start", {
                    registration_id: registrationId,
                });

                try {
                    // Subscribe to session-scoped event channel
                    const channel = `engine://usi/${newSessionId}`;
                    unlisten = await tauriListen<EngineEvent>(channel, (evt) => {
                        emit(evt.payload);
                    });
                } catch (error) {
                    // 購読に失敗したまま session を持つと誰もイベントを受け取れない。
                    // 起動済みプロセスを残さないよう片付けてから失敗させる
                    try {
                        await tauriInvoke("usi_engine_quit", { session_id: newSessionId });
                    } catch {
                        // quit まで失敗したら識別子を保持し、後続の dispose / 再 init で回収する
                        sessionId = newSessionId;
                    }
                    throw error;
                }
                sessionId = newSessionId;
            });
        },

        async loadPosition(
            sfen: string,
            moves?: string[],
            _options?: LoadPositionOptions,
        ): Promise<void> {
            const sid = assertSession();
            await tauriInvoke("usi_engine_position", {
                session_id: sid,
                sfen,
                moves: moves ?? [],
            });
        },

        async search(params: SearchParams): Promise<SearchHandle> {
            const sid = assertSession();
            await tauriInvoke("usi_engine_go", {
                session_id: sid,
                params: {
                    maxDepth: params.limits?.maxDepth,
                    nodes: params.limits?.nodes,
                    byoyomiMs: params.limits?.byoyomiMs,
                    movetimeMs: params.limits?.movetimeMs,
                    infinite: !params.limits,
                },
            });
            return {
                cancel: async () => {
                    await tauriInvoke("usi_engine_stop", { session_id: sid }).catch(
                        () => undefined,
                    );
                },
            };
        },

        async stop(): Promise<void> {
            const sid = assertSession();
            await tauriInvoke("usi_engine_stop", { session_id: sid });
        },

        async setOption(name: string, value: string | number | boolean): Promise<void> {
            const sid = assertSession();
            await tauriInvoke("usi_engine_setoption", {
                session_id: sid,
                name,
                value: String(value),
            });
        },

        async sendButton(name: string): Promise<void> {
            const sid = assertSession();
            await tauriInvoke("usi_engine_send_button", {
                session_id: sid,
                name,
            });
        },

        getSessionId(): string | null {
            return sessionId;
        },

        subscribe(handler: EngineEventHandler): () => void {
            listeners.add(handler);
            return () => {
                listeners.delete(handler);
            };
        },

        async dispose(): Promise<void> {
            await runExclusive(async () => {
                await closeSession(true);
                listeners.clear();
            });
        },
    };
}
