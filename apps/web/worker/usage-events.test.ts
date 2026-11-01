// @vitest-environment node

import { describe, expect, it } from "vitest";
import { parseUsageEvent } from "./usage-events";

const parse = (body: unknown) =>
    parseUsageEvent(body, { aiNames: new Set(["material", "custom", "coco"]) });

const DEVICE_ID = "3f2b8c1e-4d5a-4b6c-9d7e-0123456789ab";
const base = { v: 1, deviceId: DEVICE_ID };

describe("parseUsageEvent", () => {
    it("ルートの型を受け付け、無い項目は空文字で埋める", () => {
        expect(parse({ ...base, event: "page_view", props: { route: "/games/$gameId" } })).toEqual({
            deviceId: DEVICE_ID,
            event: "page_view",
            internal: false,
            loggedIn: false,
            texts: ["/games/$gameId", ""],
            numbers: [],
        });
    });

    it("項目の無いイベントは props を省ける", () => {
        expect(parse({ ...base, event: "hint_request", internal: true })?.internal).toBe(true);
    });

    it("終局の項目を順に並べる", () => {
        const parsed = parse({
            ...base,
            event: "match_end",
            loggedIn: true,
            props: { result: "win", reason: "resignation", plies: 87, durationSec: 900 },
        });
        expect(parsed?.texts).toEqual(["win", "resignation"]);
        expect(parsed?.numbers).toEqual([87, 900]);
        expect(parsed?.loggedIn).toBe(true);
    });

    it.each([
        ["ID 入りの URL", "/games/abc123XYZ"],
        ["数字の区切り", "/games/123"],
        ["小文字だけの ID", "/rshogi-viewer/players/alice"],
        ["末尾のスラッシュ", "/games/"],
        ["クエリ", "/play?sfen=x"],
        ["先頭のスラッシュ無し", "play"],
    ])("ルートが型でなければ弾く: %s", (_, route) => {
        expect(parse({ ...base, event: "page_view", props: { route } })).toBeNull();
    });

    it.each([
        ["版の違い", { ...base, v: 2, event: "hint_request" }],
        ["UUID でない端末 ID", { v: 1, deviceId: "user@example.com", event: "hint_request" }],
        ["知らないイベント", { ...base, event: "keystroke" }],
        [
            "知らない項目",
            { ...base, event: "hint_request", props: { sfen: "lnsgkgsnl/9/9/9/9/9/9/9/9 b - 1" } },
        ],
        ["必須の項目が無い", { ...base, event: "analysis_start", props: {} }],
        ["列挙に無い値", { ...base, event: "analysis_start", props: { kind: "deep" } }],
        [
            "数値の項目が文字列",
            { ...base, event: "match_end", props: { result: "win", plies: "87", durationSec: 1 } },
        ],
        [
            "数値の項目が範囲外",
            { ...base, event: "match_end", props: { result: "win", plies: -1, durationSec: 1 } },
        ],
        ["数値の項目が無い", { ...base, event: "match_end", props: { result: "win" } }],
        ["フラグが真偽値でない", { ...base, event: "hint_request", internal: "yes" }],
        ["props が配列", { ...base, event: "hint_request", props: [] }],
        ["プロトタイプの名前のイベント", { ...base, event: "toString" }],
        ["トップレベルの知らない項目", { ...base, event: "hint_request", sfen: "startpos" }],
        ["props が null", { ...base, event: "hint_request", props: null }],
        [
            "列挙に無い終局の理由",
            {
                ...base,
                event: "match_end",
                props: { result: "win", reason: "user-42", plies: 1, durationSec: 1 },
            },
        ],
        ["AI 名が文字列でない", { ...base, event: "nnue_download", props: { ai: 1 } }],
    ])("不正な本文は null: %s", (_, body) => {
        expect(parse(body)).toBeNull();
    });

    it("一覧にある AI の名前は受け付ける", () => {
        const parsed = parse({
            ...base,
            event: "match_start",
            props: { players: "human_ai", ai: "coco", time: "byoyomi", start: "even" },
        });
        expect(parsed?.texts).toEqual(["human_ai", "coco", "byoyomi", "even"]);
    });

    it.each([
        ["UUID", DEVICE_ID],
        ["一覧に無い名前", "alice"],
    ])("一覧に無い AI 名は書かず、other に置き換えてイベントは残す: %s", (_, ai) => {
        expect(parse({ ...base, event: "nnue_download", props: { ai } })?.texts).toEqual(["other"]);
        expect(
            parse({ ...base, event: "match_start", props: { players: "human_ai", ai } })?.texts,
        ).toEqual(["human_ai", "other", "", ""]);
    });
});
