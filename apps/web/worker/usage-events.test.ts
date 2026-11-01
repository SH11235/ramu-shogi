// @vitest-environment node

import { describe, expect, it } from "vitest";
import { parseUsageEvent } from "./usage-events";

const DEVICE_ID = "3f2b8c1e-4d5a-4b6c-9d7e-0123456789ab";
const base = { v: 1, deviceId: DEVICE_ID };

describe("parseUsageEvent", () => {
    it("ルートの型を受け付け、無い項目は空文字で埋める", () => {
        expect(
            parseUsageEvent({ ...base, event: "page_view", props: { route: "/games/$gameId" } }),
        ).toEqual({
            deviceId: DEVICE_ID,
            event: "page_view",
            internal: false,
            loggedIn: false,
            texts: ["/games/$gameId", ""],
            numbers: [],
        });
    });

    it("項目の無いイベントは props を省ける", () => {
        expect(parseUsageEvent({ ...base, event: "hint_request", internal: true })?.internal).toBe(
            true,
        );
    });

    it("終局の項目を順に並べる", () => {
        const parsed = parseUsageEvent({
            ...base,
            event: "match_end",
            loggedIn: true,
            props: { result: "win", reason: "resign", plies: 87, durationSec: 900 },
        });
        expect(parsed?.texts).toEqual(["win", "resign"]);
        expect(parsed?.numbers).toEqual([87, 900]);
        expect(parsed?.loggedIn).toBe(true);
    });

    it.each([
        ["ID 入りの URL", "/games/abc123XYZ"],
        ["数字の区切り", "/games/123"],
        ["クエリ", "/play?sfen=x"],
        ["先頭のスラッシュ無し", "play"],
    ])("ルートが型でなければ弾く: %s", (_, route) => {
        expect(parseUsageEvent({ ...base, event: "page_view", props: { route } })).toBeNull();
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
    ])("不正な本文は null: %s", (_, body) => {
        expect(parseUsageEvent(body)).toBeNull();
    });
});
