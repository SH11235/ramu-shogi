// apps/web/worker/api.ts
// REST API ルーティング（T-101 で本実装予定）

export interface Env {
    ASSETS: Fetcher;
    NNUE_BUCKET: R2Bucket;
    ROOM: DurableObjectNamespace;
}

/**
 * /api/* リクエストを処理する
 * T-101: POST /api/rooms、GET /api/rooms/:roomId
 * T-102: GET /api/rooms/:roomId/ws（WebSocket アップグレード）
 */
export async function handleApiRequest(
    request: Request,
    env: Env,
    _ctx: ExecutionContext,
): Promise<Response | null> {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (!pathname.startsWith("/api/")) {
        return null;
    }

    // GET /api/rooms/:roomId/ws → DO にルーティング
    const wsMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/ws$/);
    if (wsMatch && request.headers.get("Upgrade") === "websocket") {
        const roomId = wsMatch[1];
        const id = env.ROOM.idFromName(roomId);
        const stub = env.ROOM.get(id);
        return stub.fetch(request);
    }

    // /api/rooms/* → DO にルーティング（REST API）
    const roomsMatch = pathname.match(/^\/api\/rooms(\/.*)?$/);
    if (roomsMatch) {
        // T-101 で実装予定: roomId が指定されている場合は DO にルーティング
        const roomPath = roomsMatch[1] ?? "";
        const roomIdMatch = roomPath.match(/^\/([^/]+)(?:\/.*)?$/);
        if (roomIdMatch) {
            const roomId = roomIdMatch[1];
            const id = env.ROOM.idFromName(roomId);
            const stub = env.ROOM.get(id);
            return stub.fetch(request);
        }

        // POST /api/rooms（ルーム作成）
        if (request.method === "POST" && pathname === "/api/rooms") {
            return new Response(
                JSON.stringify({ error: "NOT_IMPLEMENTED", message: "T-101 で実装予定" }),
                { status: 501, headers: { "Content-Type": "application/json" } },
            );
        }
    }

    return new Response(JSON.stringify({ error: "NOT_FOUND" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
    });
}
