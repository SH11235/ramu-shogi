import type { UsageEvents } from "@shogi/ui/providers/UsageContext";
import { describe, expect, expectTypeOf, it } from "vitest";
import { parseUsageEvent, type UsageEventProps } from "../../worker/usage-events";
import { createUsageClient } from "./usage";
import { createUsageTracker } from "./usageTracker";

function setup() {
    const storage = new Map<string, string>();
    const sent: unknown[] = [];
    let clock = 1_000_000;
    const client = createUsageClient({
        hostname: "ramu-shogi.sh11235.com",
        search: "",
        referrer: "",
        storage: {
            getItem: (key) => storage.get(key) ?? null,
            setItem: (key, value) => void storage.set(key, value),
            removeItem: (key) => void storage.delete(key),
        },
        randomUUID: () => "3f2b8c1e-4d5a-4b6c-9d7e-0123456789ab",
        send: (_path, body) => sent.push(JSON.parse(body)),
    });
    const track = createUsageTracker(client, () => clock);
    return { track, sent, advance: (ms: number) => (clock += ms) };
}

const accepted = (body: unknown) =>
    parseUsageEvent(body, { aiNames: new Set(["material", "custom", "coco"]) });

describe("createUsageTracker", () => {
    it("対局の時間を開始から数えて終局に足す", () => {
        const { track, sent, advance } = setup();
        track("match_start", { players: "human_ai", ai: "coco", time: "byoyomi", start: "even" });
        advance(754_400);
        track("match_end", { result: "win", reason: "checkmate", plies: 101 });
        expect(sent[1]).toMatchObject({
            event: "match_end",
            props: { result: "win", reason: "checkmate", plies: 101, durationSec: 754 },
        });
    });

    it("開始を見ていない終局は 0 秒", () => {
        const { track, sent } = setup();
        track("match_end", { result: "loss", plies: 3 });
        expect(sent[0]).toMatchObject({ props: { durationSec: 0 } });
    });

    it("画面の部品から来るどのイベントも、Worker の検証に通る形で送る", () => {
        const { track, sent } = setup();
        track("match_start", { players: "ai_ai", ai: "material", time: "none", start: "handicap" });
        track("match_end", { result: "sente_win", reason: "time_expired", plies: 64 });
        track("hint_request", {});
        track("analysis_start", { kind: "batch" });
        track("kifu_import", { format: "csa" });
        track("kifu_export", { format: "usi" });
        track("nnue_download", { ai: "coco" });
        expect(sent).toHaveLength(7);
        expect(sent.filter((body) => accepted(body) === null)).toEqual([]);
    });

    it("画面の部品のイベントの型は、Worker が受け付ける項目に収まる", () => {
        expectTypeOf<UsageEvents["match_start"]>().toMatchTypeOf<UsageEventProps<"match_start">>();
        expectTypeOf<UsageEvents["match_end"] & { durationSec: number }>().toMatchTypeOf<
            UsageEventProps<"match_end">
        >();
        expectTypeOf<UsageEvents["analysis_start"]>().toMatchTypeOf<
            UsageEventProps<"analysis_start">
        >();
        expectTypeOf<UsageEvents["kifu_import"]>().toMatchTypeOf<UsageEventProps<"kifu_import">>();
        expectTypeOf<UsageEvents["kifu_export"]>().toMatchTypeOf<UsageEventProps<"kifu_export">>();
        expectTypeOf<UsageEvents["nnue_download"]>().toMatchTypeOf<
            UsageEventProps<"nnue_download">
        >();
    });

    it("画面の部品が送り得るすべての値を、Worker が受け付ける", () => {
        // Record のキーに並べるので、画面の部品の型に値を足すとここが型エラーになり、足し忘れない
        const results = {
            win: true,
            loss: true,
            draw: true,
            abort: true,
            sente_win: true,
            gote_win: true,
        } satisfies Record<UsageEvents["match_end"]["result"], true>;
        const reasons = {
            checkmate: true,
            resignation: true,
            time_expired: true,
            win_declaration: true,
            repetition: true,
            illegal_move: true,
            abort: true,
            other: true,
        } satisfies Record<NonNullable<UsageEvents["match_end"]["reason"]>, true>;
        const times = { none: true, byoyomi: true, fischer: true, sudden: true } satisfies Record<
            NonNullable<UsageEvents["match_start"]["time"]>,
            true
        >;
        const starts = { even: true, handicap: true, position: true } satisfies Record<
            NonNullable<UsageEvents["match_start"]["start"]>,
            true
        >;
        const players = { human_ai: true, ai_ai: true, human_human: true } satisfies Record<
            UsageEvents["match_start"]["players"],
            true
        >;
        const formats = {
            kif: true,
            ki2: true,
            csa: true,
            sfen: true,
            usi: true,
            url: true,
            other: true,
        } satisfies Record<UsageEvents["kifu_export"]["format"], true>;
        const kinds = { single: true, batch: true } satisfies Record<
            UsageEvents["analysis_start"]["kind"],
            true
        >;

        const { track, sent } = setup();
        for (const result of Object.keys(results) as (keyof typeof results)[]) {
            for (const reason of Object.keys(reasons) as (keyof typeof reasons)[]) {
                track("match_end", { result, reason, plies: 1 });
            }
        }
        for (const time of Object.keys(times) as (keyof typeof times)[]) {
            for (const start of Object.keys(starts) as (keyof typeof starts)[]) {
                for (const player of Object.keys(players) as (keyof typeof players)[]) {
                    track("match_start", { players: player, ai: "coco", time, start });
                }
            }
        }
        for (const format of Object.keys(formats) as (keyof typeof formats)[]) {
            track("kifu_import", { format });
            track("kifu_export", { format });
        }
        for (const kind of Object.keys(kinds) as (keyof typeof kinds)[]) {
            track("analysis_start", { kind });
        }
        expect(sent.length).toBeGreaterThan(0);
        expect(sent.filter((body) => accepted(body) === null)).toEqual([]);
    });
});
