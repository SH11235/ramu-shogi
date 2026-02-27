// REST API: POST /api/rooms, GET /api/rooms/:roomId

// Cloudflare Workers Rate Limiting API の型定義
interface RateLimiter {
    limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
    ASSETS: Fetcher;
    NNUE_BUCKET: R2Bucket;
    ROOM: DurableObjectNamespace;
    /** POST /api/rooms の IP ごとのレート制限。wrangler.toml で設定 */
    ROOM_RATE_LIMITER?: RateLimiter;
}

// ─── バリデーション ──────────────────────────────────────────────────────

interface TimeControlSettings {
    type: "byoyomi" | "fischer";
    initialMs: number;
    byoyomiMs?: number;
    fischerIncrementMs?: number;
}

interface PassRightsConfig {
    initialCount: number;
}

interface AiSupportPlayerSettings {
    mode: "unlimited" | "limited";
    limitCount: number | null;
}

interface AiSupportSettings {
    b: AiSupportPlayerSettings;
    w: AiSupportPlayerSettings;
    searchDepth: number | null;
    searchTimeMs: number | null;
}

export interface RoomSettings {
    startSfen: string;
    timeControl: TimeControlSettings;
    passRights: PassRightsConfig | null;
    aiSupport: AiSupportSettings | null;
}

const HANDICAP_SFENS = new Set(["handicap:bishop", "handicap:rook", "handicap:rook-bishop"]);

function isValidSfen(sfen: string): boolean {
    if (sfen === "startpos") return true;
    if (HANDICAP_SFENS.has(sfen)) return true;
    // SFEN 形式の簡易チェック: "x/x/x/x/x/x/x/x/x [bw] "
    return /^[a-zA-Z0-9+]+\/[a-zA-Z0-9+]+\/[a-zA-Z0-9+]+\/[a-zA-Z0-9+]+\/[a-zA-Z0-9+]+\/[a-zA-Z0-9+]+\/[a-zA-Z0-9+]+\/[a-zA-Z0-9+]+\/[a-zA-Z0-9+]+ [bw]/.test(
        sfen,
    );
}

function validateTimeControl(tc: unknown): tc is TimeControlSettings {
    if (!tc || typeof tc !== "object") return false;
    const t = tc as Record<string, unknown>;
    if (t.type !== "byoyomi" && t.type !== "fischer") return false;
    if (typeof t.initialMs !== "number" || t.initialMs < 0 || !Number.isInteger(t.initialMs))
        return false;
    if (t.type === "byoyomi") {
        if (
            t.byoyomiMs !== undefined &&
            (typeof t.byoyomiMs !== "number" || t.byoyomiMs < 0 || !Number.isInteger(t.byoyomiMs))
        )
            return false;
    }
    if (t.type === "fischer") {
        if (
            t.fischerIncrementMs !== undefined &&
            (typeof t.fischerIncrementMs !== "number" ||
                t.fischerIncrementMs < 0 ||
                !Number.isInteger(t.fischerIncrementMs))
        )
            return false;
    }
    return true;
}

function validateSettings(settings: unknown): RoomSettings | { error: string } {
    if (!settings || typeof settings !== "object") {
        return { error: "settings is required" };
    }
    const s = settings as Record<string, unknown>;

    // startSfen
    if (typeof s.startSfen !== "string" || !isValidSfen(s.startSfen)) {
        return { error: "Invalid startSfen" };
    }

    // timeControl
    if (!validateTimeControl(s.timeControl)) {
        return { error: "Invalid timeControl. initialMs must be >= 0" };
    }

    // passRights（省略可）
    if (s.passRights !== null && s.passRights !== undefined) {
        const pr = s.passRights as Record<string, unknown>;
        if (
            typeof pr.initialCount !== "number" ||
            pr.initialCount < 0 ||
            !Number.isInteger(pr.initialCount)
        ) {
            return { error: "Invalid passRights.initialCount" };
        }
    }

    // aiSupport（省略可）
    if (s.aiSupport !== null && s.aiSupport !== undefined) {
        const ai = s.aiSupport as Record<string, unknown>;
        for (const seat of ["b", "w"] as const) {
            const ps = ai[seat] as Record<string, unknown> | undefined;
            if (!ps || (ps.mode !== "unlimited" && ps.mode !== "limited")) {
                return { error: `Invalid aiSupport.${seat}.mode` };
            }
            if (
                ps.mode === "limited" &&
                (typeof ps.limitCount !== "number" ||
                    ps.limitCount < 1 ||
                    !Number.isInteger(ps.limitCount))
            ) {
                return { error: `Invalid aiSupport.${seat}.limitCount` };
            }
        }
    }

    return {
        startSfen: s.startSfen as string,
        timeControl: s.timeControl as TimeControlSettings,
        passRights: (s.passRights as PassRightsConfig) ?? null,
        aiSupport: (s.aiSupport as AiSupportSettings) ?? null,
    };
}

// ─── roomId 生成 ─────────────────────────────────────────────────────────

function generateRoomId(): string {
    const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    const buffer = new Uint8Array(6);
    crypto.getRandomValues(buffer);
    return Array.from(buffer)
        .map((b) => chars[b % chars.length])
        .join("");
}

// ─── ヘルパー ────────────────────────────────────────────────────────────

function apiErrorResponse(status: number, error: string, message?: string): Response {
    return new Response(JSON.stringify({ error, ...(message ? { message } : {}) }), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

function jsonResponse(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

// ─── エンドポイント ──────────────────────────────────────────────────────

/**
 * POST /api/rooms: ルームを作成して { roomId, shareUrl } を返す
 */
async function handleCreateRoom(request: Request, env: Env): Promise<Response> {
    // IP ごとのレート制限チェック
    if (env.ROOM_RATE_LIMITER) {
        const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
        const { success } = await env.ROOM_RATE_LIMITER.limit({ key: ip });
        if (!success) {
            return apiErrorResponse(
                429,
                "RATE_LIMITED",
                "Too many room creation requests. Please try again later.",
            );
        }
    }

    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return apiErrorResponse(400, "INVALID_REQUEST", "Invalid JSON body");
    }

    const settingsResult = validateSettings((body as Record<string, unknown>)?.settings);
    if ("error" in settingsResult) {
        return apiErrorResponse(400, "INVALID_SETTINGS", settingsResult.error);
    }

    const roomId = generateRoomId();
    const id = env.ROOM.idFromName(roomId);
    const stub = env.ROOM.get(id);

    // DO を初期化
    const initRequest = new Request("https://room.do/init", {
        method: "POST",
        body: JSON.stringify({ roomId, settings: settingsResult }),
        headers: { "Content-Type": "application/json" },
    });
    const initResponse = await stub.fetch(initRequest);
    if (!initResponse.ok) {
        return apiErrorResponse(500, "CREATE_FAILED", "Failed to create room");
    }

    const origin = new URL(request.url).origin;
    const shareUrl = `${origin}/online/${roomId}`;

    return jsonResponse({ roomId, shareUrl });
}

/**
 * GET /api/rooms/:roomId: ルーム情報を返す（DO に転送）
 */
async function handleGetRoom(roomId: string, request: Request, env: Env): Promise<Response> {
    const id = env.ROOM.idFromName(roomId);
    const stub = env.ROOM.get(id);
    return stub.fetch(request);
}

// ─── エントリポイント ────────────────────────────────────────────────────

/**
 * /api/* リクエストを処理する
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

    // GET /api/rooms/:roomId/ws → DO にルーティング（WebSocket アップグレード）
    const wsMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/ws$/);
    if (wsMatch && request.headers.get("Upgrade") === "websocket") {
        const roomId = wsMatch[1];
        const id = env.ROOM.idFromName(roomId);
        const stub = env.ROOM.get(id);
        return stub.fetch(request);
    }

    // POST /api/rooms → ルーム作成
    if (request.method === "POST" && pathname === "/api/rooms") {
        return handleCreateRoom(request, env);
    }

    // GET /api/rooms/:roomId → ルーム情報取得
    const roomGetMatch = pathname.match(/^\/api\/rooms\/([^/]+)$/);
    if (roomGetMatch && request.method === "GET") {
        return handleGetRoom(roomGetMatch[1], request, env);
    }

    return apiErrorResponse(404, "NOT_FOUND", "API endpoint not found");
}
