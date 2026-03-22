import { invoke as tauriInvoke } from "@tauri-apps/api/core";

export type PreviewSessionStatus =
    | { state: "idle" }
    | { state: "starting"; registrationId: string }
    | { state: "ready"; registrationId: string; sessionId: string }
    | { state: "error"; registrationId: string; sessionId?: string; error: string };

export interface PreviewSessionService {
    /** preview sessionを起動。既存sessionがあれば先に終了 */
    start(registrationId: string): Promise<string>;
    /** 起動中sessionにsetoptionを送信 */
    setOption(name: string, value: string | number | boolean): Promise<void>;
    /** 起動中sessionにbutton型setoptionを送信 */
    sendButton(name: string): Promise<void>;
    /** 現在のセッション状態を取得 */
    getStatus(): PreviewSessionStatus;
    /** セッションを終了 */
    dispose(): Promise<void>;
}

export function createPreviewSessionService(): PreviewSessionService {
    let status: PreviewSessionStatus = { state: "idle" };
    // 起動リクエストのインクリメンタルID。古い起動結果を無視するために使用
    let startRequestId = 0;

    const assertReady = (): string => {
        if (status.state !== "ready") {
            throw new Error("Preview session is not ready");
        }
        return status.sessionId;
    };

    const quitSession = async (sessionId: string): Promise<void> => {
        await tauriInvoke("usi_engine_quit", { session_id: sessionId }).catch(() => undefined);
    };

    const quitCurrent = async (): Promise<void> => {
        // startRequestIdを進めて、進行中の起動結果を無効化する
        ++startRequestId;
        if (status.state === "ready" || (status.state === "error" && status.sessionId)) {
            const sid = status.sessionId as string;
            status = { state: "idle" };
            await quitSession(sid);
        } else {
            status = { state: "idle" };
        }
    };

    return {
        async start(registrationId: string): Promise<string> {
            // 既存sessionがあれば先に終了
            await quitCurrent();

            const requestId = ++startRequestId;
            status = { state: "starting", registrationId };
            try {
                const sessionId = await tauriInvoke<string>("usi_engine_start", {
                    registration_id: registrationId,
                });
                // 起動完了時にrequestIdが古い場合は孤児セッションをquitして無視
                if (requestId !== startRequestId) {
                    await quitSession(sessionId);
                    throw new Error("Start request superseded");
                }
                status = { state: "ready", registrationId, sessionId };
                return sessionId;
            } catch (e) {
                // requestIdが古い場合は状態を更新しない
                if (requestId === startRequestId) {
                    const error = e instanceof Error ? e.message : String(e);
                    status = { state: "error", registrationId, error };
                }
                throw e;
            }
        },

        async setOption(name: string, value: string | number | boolean): Promise<void> {
            const sessionId = assertReady();
            try {
                await tauriInvoke("usi_engine_setoption", {
                    session_id: sessionId,
                    name,
                    value: String(value),
                });
            } catch (e) {
                // セッション切断等の場合はerrorに遷移（sessionIdを保持してdispose可能にする）
                if (status.state === "ready" && status.sessionId === sessionId) {
                    const error = e instanceof Error ? e.message : String(e);
                    status = {
                        state: "error",
                        registrationId: status.registrationId,
                        sessionId,
                        error,
                    };
                }
                throw e;
            }
        },

        async sendButton(name: string): Promise<void> {
            const sessionId = assertReady();
            try {
                await tauriInvoke("usi_engine_send_button", {
                    session_id: sessionId,
                    name,
                });
            } catch (e) {
                // セッション切断等の場合はerrorに遷移（sessionIdを保持してdispose可能にする）
                if (status.state === "ready" && status.sessionId === sessionId) {
                    const error = e instanceof Error ? e.message : String(e);
                    status = {
                        state: "error",
                        registrationId: status.registrationId,
                        sessionId,
                        error,
                    };
                }
                throw e;
            }
        },

        getStatus(): PreviewSessionStatus {
            return status;
        },

        async dispose(): Promise<void> {
            await quitCurrent();
        },
    };
}
