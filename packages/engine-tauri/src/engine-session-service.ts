import { invoke as tauriInvoke } from "@tauri-apps/api/core";

/**
 * 起動中エンジンセッションに対するオプション操作サービス。
 * sessionIdを外部から受け取り、setOption/sendButtonを実行する。
 * UI層がTauri IPCに直接依存しないための抽象化。
 */
export interface EngineSessionService {
    setOption(sessionId: string, name: string, value: string | number | boolean): Promise<void>;
    sendButton(sessionId: string, name: string): Promise<void>;
}

export function createEngineSessionService(): EngineSessionService {
    return {
        async setOption(
            sessionId: string,
            name: string,
            value: string | number | boolean,
        ): Promise<void> {
            await tauriInvoke("usi_engine_setoption", {
                session_id: sessionId,
                name,
                value: String(value),
            });
        },

        async sendButton(sessionId: string, name: string): Promise<void> {
            await tauriInvoke("usi_engine_send_button", {
                session_id: sessionId,
                name,
            });
        },
    };
}
