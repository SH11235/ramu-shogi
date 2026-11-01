import {
    parseUsageEvent,
    USAGE_EVENTS_PATH,
    USAGE_FIXED_AI_NAMES,
    USAGE_MAX_BODY_BYTES,
    USAGE_SCHEMA_VERSION,
} from "./usage-events";

export type UsageEnv = {
    /** 利用状況のイベントの書き込み先。無い環境（ローカル開発など）では受け取って捨てる */
    USAGE_EVENTS?: AnalyticsEngineDataset;
    USAGE_RATE_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
    /** 配布 AI の manifest の置き場。AI の名前の検証に使う */
    NNUE_BUCKET?: Pick<R2Bucket, "get">;
};

// manifest の配信と同じく 5 分で読み直す。配布 AI を足したとき、deploy なしで受け付けるようにするため
const AI_NAMES_TTL_MS = 5 * 60 * 1000;
const aiNamesCache = new WeakMap<object, { names: ReadonlySet<string>; expiresAt: number }>();

async function loadAiNames(env: UsageEnv): Promise<ReadonlySet<string>> {
    const bucket = env.NNUE_BUCKET;
    if (!bucket) return new Set(USAGE_FIXED_AI_NAMES);
    const cached = aiNamesCache.get(bucket);
    if (cached && cached.expiresAt > Date.now()) return cached.names;

    const names = new Set(USAGE_FIXED_AI_NAMES);
    // manifest が読めないときも、AI の名前を持たないイベントは書けるように固定の名前だけで続ける
    let manifest: unknown;
    try {
        manifest = await (await bucket.get("manifest.json"))?.json();
    } catch {
        return names;
    }
    const presets =
        typeof manifest === "object" && manifest !== null && "presets" in manifest
            ? manifest.presets
            : null;
    if (Array.isArray(presets)) {
        for (const preset of presets) {
            if (typeof preset?.presetKey === "string") names.add(preset.presetKey);
        }
    }
    aiNamesCache.set(bucket, { names, expiresAt: Date.now() + AI_NAMES_TTL_MS });
    return names;
}

const MAX_TEXT_FIELDS = 4;
const MAX_NUMBER_FIELDS = 2;

// 送り手は sendBeacon で、応答を読まない。受け付けなかった理由を返すと、不正な送信を試す側に
// 手掛かりを与えるだけなので、POST には常に 204 を返す
const accepted = () =>
    new Response(null, { status: 204, headers: { "cache-control": "no-store" } });

// 画面側で自動操作と分からなかったヘッドレスの Chrome も、集計から除けるよう internal にする
const isHeadless = (userAgent: string) => /HeadlessChrome/.test(userAgent);

function deviceType(userAgent: string): string {
    if (/iPad|Tablet|Android(?!.*Mobile)/i.test(userAgent)) return "tablet";
    if (/Mobi|iPhone|Android/i.test(userAgent)) return "mobile";
    return "desktop";
}

async function readBody(request: Request): Promise<string | null> {
    const declared = Number(request.headers.get("content-length") ?? "0");
    if (declared > USAGE_MAX_BODY_BYTES || !request.body) return null;
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > USAGE_MAX_BODY_BYTES) {
            await reader.cancel();
            return null;
        }
        chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return new TextDecoder().decode(bytes);
}

/**
 * POST /usage を受けて Analytics Engine に 1 行書く。集計の SQL は列の位置で読むので、並びを変えるときは
 * USAGE_SCHEMA_VERSION を上げる。
 * - indexes: [端末 ID]（サンプリングが端末単位になり、人数が崩れない）
 * - blobs: [イベント, 国, 端末の種類, internal, loggedIn, 項目 1〜4, スキーマの版]
 * - doubles: [数値の項目 1〜2]（数値の項目を持たないイベントは 0）
 * IP と User-Agent の文字列は書かない。
 */
export async function handleUsageRequest(
    request: Request,
    env: UsageEnv,
): Promise<Response | null> {
    const url = new URL(request.url);
    if (url.pathname !== USAGE_EVENTS_PATH) return null;
    if (request.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
    }
    try {
        await recordUsageEvent(request, env, url);
    } catch {
        // ページを閉じる途中の送信では本文の読み取りが切れることがある。計測の取りこぼしで済むので
        // 例外の中身は記録せず、件数だけ分かるようにする
        console.warn(JSON.stringify({ event: "usage_event_failed" }));
    }
    return accepted();
}

async function recordUsageEvent(request: Request, env: UsageEnv, url: URL): Promise<void> {
    const dataset = env.USAGE_EVENTS;
    if (!dataset) return;

    const origin = request.headers.get("Origin");
    if (origin !== null && origin !== url.origin) return;

    if (env.USAGE_RATE_LIMITER) {
        const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
        const { success } = await env.USAGE_RATE_LIMITER.limit({ key: ip });
        if (!success) return;
    }

    const text = await readBody(request);
    if (text === null) return;
    let json: unknown;
    try {
        json = JSON.parse(text);
    } catch {
        return;
    }
    const parsed = parseUsageEvent(json, { aiNames: await loadAiNames(env) });
    if (!parsed) return;

    const texts = [...parsed.texts, ...Array(MAX_TEXT_FIELDS).fill("")].slice(0, MAX_TEXT_FIELDS);
    const numbers = [...parsed.numbers, ...Array(MAX_NUMBER_FIELDS).fill(0)].slice(
        0,
        MAX_NUMBER_FIELDS,
    );
    const country = (request.cf?.country as string | undefined) ?? "XX";
    const userAgent = request.headers.get("User-Agent") ?? "";
    dataset.writeDataPoint({
        indexes: [parsed.deviceId],
        blobs: [
            parsed.event,
            country,
            deviceType(userAgent),
            parsed.internal || isHeadless(userAgent) ? "1" : "0",
            parsed.loggedIn ? "1" : "0",
            ...texts,
            `v${USAGE_SCHEMA_VERSION}`,
        ],
        doubles: numbers,
    });
}
