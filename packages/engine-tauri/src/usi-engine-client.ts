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

    return {
        async init(_opts?: EngineInitOptions): Promise<void> {
            sessionId = await tauriInvoke<string>("usi_engine_start", {
                registration_id: registrationId,
            });

            // Subscribe to session-scoped event channel
            const channel = `engine://usi/${sessionId}`;
            unlisten = await tauriListen<EngineEvent>(channel, (evt) => {
                emit(evt.payload);
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
            if (sessionId) {
                await tauriInvoke("usi_engine_quit", { session_id: sessionId }).catch(
                    () => undefined,
                );
                sessionId = null;
            }
            if (unlisten) {
                try {
                    unlisten();
                } catch {
                    // ignore
                }
                unlisten = null;
            }
            listeners.clear();
        },
    };
}
