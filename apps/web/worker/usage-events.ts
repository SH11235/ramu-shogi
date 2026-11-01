// 利用状況のイベントの送信形式と検証。画面側（送信）と Worker（受信）の両方から使うので、
// 実行環境の API に依存しない純粋な関数だけを置く。

export const USAGE_EVENTS_PATH = "/usage";
export const USAGE_SCHEMA_VERSION = 1;
export const USAGE_MAX_BODY_BYTES = 2048;

const DEVICE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

/**
 * 受け付けるルートの型（`apps/web/src/router.tsx` の `path` と一致させる。食い違いはテストで検出する）。
 * 文字の形ではなく完全一致で見るのは、ID 入りの実際の URL が紛れても書き込まないため。
 */
export const USAGE_ROUTES: readonly string[] = [
    "/",
    "/auth",
    "/book-viewer",
    "/dog-sounds",
    "/games",
    "/games/$gameId",
    "/games/$gameId/review",
    "/nnue",
    "/online",
    "/online/$roomId",
    "/online/create",
    "/play",
    "/privacy",
    "/public/games",
    "/public/games/$publicId",
    "/rshogi-viewer",
    "/rshogi-viewer/$gameId",
    "/rshogi-viewer/live",
    "/rshogi-viewer/live/$gameId",
    "/rshogi-viewer/players",
    "/rshogi-viewer/players/$playerId",
    "/studies",
    "/studies/$studyId",
    "/studies/new",
];

/** 配布 AI 以外の対局相手。`material` は組み込みの駒得 AI、`custom` は利用者が入れた NNUE */
export const USAGE_FIXED_AI_NAMES: readonly string[] = ["material", "custom"];

/** 検証に使う、その時点の値の集合 */
type UsageContext = { aiNames: ReadonlySet<string> };

const isAi = (value: string, context: UsageContext) => context.aiNames.has(value);
const isHost = (value: string) => value.length <= 253 && HOST.test(value);
const isRoute = (value: string) => USAGE_ROUTES.includes(value);
const oneOf =
    (...values: readonly string[]) =>
    (value: string) =>
        values.includes(value);

type TextField = {
    key: string;
    valid: (value: string, context: UsageContext) => boolean;
    required?: true;
};
// 数値の項目は常に必須（0 と「無い」を集計で区別できないため、省略を認めない）
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
            { key: "ai", valid: isAi },
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
            {
                key: "reason",
                valid: oneOf(
                    "checkmate",
                    "resignation",
                    "time_expired",
                    "win_declaration",
                    "repetition",
                    "illegal_move",
                    "abort",
                    "other",
                ),
            },
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
    nnue_download: { text: [{ key: "ai", valid: isAi, required: true }], numbers: [] },
} as const satisfies Record<string, EventSpec>;

export type UsageEventName = keyof typeof EVENT_SPECS;

type TextFieldsOf<E extends UsageEventName> = (typeof EVENT_SPECS)[E]["text"][number];
type RequiredTextKey<E extends UsageEventName> = Extract<
    TextFieldsOf<E>,
    { required: true }
>["key"];
type OptionalTextKey<E extends UsageEventName> = Exclude<
    TextFieldsOf<E>["key"],
    RequiredTextKey<E>
>;
type NumberKey<E extends UsageEventName> = (typeof EVENT_SPECS)[E]["numbers"][number]["key"];

/** イベントごとに送れる項目。画面側はこの型で送り、Worker の検証と食い違わないようにする */
export type UsageEventProps<E extends UsageEventName> = { [K in RequiredTextKey<E>]: string } & {
    [K in OptionalTextKey<E>]?: string;
} & { [K in NumberKey<E>]: number };

const TOP_LEVEL_KEYS = new Set(["v", "deviceId", "event", "internal", "loggedIn", "props"]);

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
 * （どこかの不具合で棋譜や ID などが紛れ込んでも、そのまま書き込まないため）。自由な文字列は受け付けず、
 * AI の名前も `context.aiNames` にあるものだけ。
 */
export function parseUsageEvent(body: unknown, context: UsageContext): ParsedUsageEvent | null {
    if (!isRecord(body) || body.v !== USAGE_SCHEMA_VERSION) return null;
    if (Object.keys(body).some((key) => !TOP_LEVEL_KEYS.has(key))) return null;
    const { deviceId, event, internal, loggedIn } = body;
    if (typeof deviceId !== "string" || !DEVICE_ID.test(deviceId)) return null;
    if (typeof event !== "string" || !hasOwn(EVENT_SPECS, event)) return null;
    if (internal !== undefined && typeof internal !== "boolean") return null;
    if (loggedIn !== undefined && typeof loggedIn !== "boolean") return null;

    const props = body.props === undefined ? {} : body.props;
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
        if (typeof value !== "string" || !field.valid(value, context)) return null;
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
