// apps/web/worker/room-do.ts
// Durable Object 本体（T-102 で本実装予定）

/**
 * RoomDO - 1 部屋 = 1 Durable Object インスタンス
 * T-102: WebSocket 接続基盤・join フローを実装予定
 * T-103: 指し手処理を実装予定
 * T-104: 時計管理を実装予定
 * T-105: 再接続を実装予定
 * T-106: 千日手判定を実装予定
 */
export class RoomDO implements DurableObject {
    private state: DurableObjectState;

    constructor(state: DurableObjectState, _env: unknown) {
        this.state = state;
    }

    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);

        // WebSocket アップグレード（T-102 で実装予定）
        if (request.headers.get("Upgrade") === "websocket") {
            return new Response("WebSocket support coming in T-102", { status: 501 });
        }

        // REST API（T-101/T-102 で実装予定）
        if (url.pathname.endsWith("/info")) {
            const roomId = await this.state.storage.get<string>("roomId");
            if (!roomId) {
                return new Response(JSON.stringify({ error: "ROOM_NOT_FOUND" }), {
                    status: 404,
                    headers: { "Content-Type": "application/json" },
                });
            }
            return new Response(JSON.stringify({ error: "NOT_IMPLEMENTED" }), {
                status: 501,
                headers: { "Content-Type": "application/json" },
            });
        }

        return new Response(JSON.stringify({ error: "NOT_FOUND" }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
        });
    }

    async alarm(): Promise<void> {
        // T-104: タイムアウト処理を実装予定
    }
}
