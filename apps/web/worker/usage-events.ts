// 利用状況のイベントの送信形式と検証。画面側（送信）と Worker（受信）の両方から使うので、
// 実行環境の API に依存しない純粋な関数だけを置く。

export const USAGE_EVENTS_PATH = "/usage";
export const USAGE_SCHEMA_VERSION = 1;
export const USAGE_MAX_BODY_BYTES = 2048;

const DEVICE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;
// ルートは TanStack Router のルートの型（`/games/$gameId`）で送る。固定の区切りに数字を許さないのは、
// 型ではなく実際の URL（ID 入り）が送られてきたときに弾くため
const ROUTE_SEGMENT = /^(\$[A-Za-z]+|[a-z]+(-[a-z]+)*)$/;

const isName = (value: string) => NAME.test(value);
const isHost = (value: string) => value.length <= 253 && HOST.test(value);
const isRoute = (value: string) =>
    value === "/" ||
    (value.length <= 128 &&
        value.startsWith("/") &&
        value
            .slice(1)
            .split("/")
            .every((segment) => ROUTE_SEGMENT.test(segment)));
const oneOf =
    (...values: readonly string[]) =>
    (value: string) =>
        values.includes(value);

type TextField = { key: string; valid: (value: string) => boolean; required?: true };
type NumberField = { key: string; max: number };
type EventSpec = { text: readonly TextField[]; numbers: readonly NumberField[] };

const KIFU_FORMATS = oneOf("kif", "ki2", "csa", "sfen", "usi", "url", "other");

const EVENT_SPECS = {
    page_view: {
        text: [
            { key: "route", valid: isRoute, required: true },
            { key: "referrer", valid: isHost },
        ],
        numbers: [],
    },
    match_start: {
        text: [
            { key: "players", valid: oneOf("human_ai", "ai_ai", "human_human"), required: true },
            { key: "ai", valid: isName },
            { key: "time", valid: oneOf("none", "byoyomi", "fischer", "sudden") },
            { key: "start", valid: oneOf("even", "handicap", "position") },
        ],
        numbers: [],
    },
    match_end: {
        text: [
            {
                key: "result",
                valid: oneOf("win", "loss", "draw", "abort", "sente_win", "gote_win"),
                required: true,
            },
            { key: "reason", valid: isName },
        ],
        numbers: [
            { key: "plies", max: 10_000 },
            { key: "durationSec", max: 864_000 },
        ],
    },
    hint_request: { text: [], numbers: [] },
    analysis_start: {
        text: [{ key: "kind", valid: oneOf("single", "batch"), required: true }],
        numbers: [],
    },
    study_create: {
        text: [{ key: "where", valid: oneOf("local", "server"), required: true }],
        numbers: [],
    },
    kifu_import: { text: [{ key: "format", valid: KIFU_FORMATS, required: true }], numbers: [] },
    kifu_export: { text: [{ key: "format", valid: KIFU_FORMATS, required: true }], numbers: [] },
    online_room: {
        text: [{ key: "action", valid: oneOf("create", "join"), required: true }],
        numbers: [],
    },
    nnue_download: { text: [{ key: "ai", valid: isName, required: true }], numbers: [] },
} as const satisfies Record<string, EventSpec>;

type UsageEventName = keyof typeof EVENT_SPECS;

/** 検証済みのイベント。`texts` と `numbers` はイベントごとの項目の順に並び、無い項目は空文字 */
type ParsedUsageEvent = {
    deviceId: string;
    event: UsageEventName;
    internal: boolean;
    loggedIn: boolean;
    texts: string[];
    numbers: number[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

const hasOwn = (record: Record<string, unknown>, key: string) => Object.hasOwn(record, key);

/**
 * 本文 `{ v, deviceId, event, internal?, loggedIn?, props? }` を検証する。`props` に置けるのは
 * イベントごとに決めた項目だけ。知らないイベント・知らない項目・形の違う値が 1 つでもあれば null を返す
 * （どこかの不具合で棋譜や ID などが紛れ込んでも、そのまま書き込まないため）。
 */
export function parseUsageEvent(body: unknown): ParsedUsageEvent | null {
    if (!isRecord(body) || body.v !== USAGE_SCHEMA_VERSION) return null;
    const { deviceId, event, internal, loggedIn } = body;
    if (typeof deviceId !== "string" || !DEVICE_ID.test(deviceId)) return null;
    if (typeof event !== "string" || !hasOwn(EVENT_SPECS, event)) return null;
    if (internal !== undefined && typeof internal !== "boolean") return null;
    if (loggedIn !== undefined && typeof loggedIn !== "boolean") return null;

    const props = body.props ?? {};
    if (!isRecord(props)) return null;
    const spec: EventSpec = EVENT_SPECS[event as UsageEventName];
    const known = new Set([...spec.text, ...spec.numbers].map((field) => field.key));
    if (Object.keys(props).some((key) => !known.has(key))) return null;

    const texts: string[] = [];
    for (const field of spec.text) {
        const value = hasOwn(props, field.key) ? props[field.key] : undefined;
        if (value === undefined) {
            if (field.required) return null;
            texts.push("");
            continue;
        }
        if (typeof value !== "string" || !field.valid(value)) return null;
        texts.push(value);
    }

    const numbers: number[] = [];
    for (const field of spec.numbers) {
        const value = hasOwn(props, field.key) ? props[field.key] : undefined;
        if (
            typeof value !== "number" ||
            !Number.isInteger(value) ||
            value < 0 ||
            value > field.max
        ) {
            return null;
        }
        numbers.push(value);
    }

    return {
        deviceId,
        event: event as UsageEventName,
        internal: internal === true,
        loggedIn: loggedIn === true,
        texts,
        numbers,
    };
}
