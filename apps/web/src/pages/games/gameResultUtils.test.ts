import type { GameRecordSummary } from "@shogi/api-contract";
import { describe, expect, it } from "vitest";
import { formatGameResult } from "./gameResultUtils";

function finishedGame(result: GameRecordSummary["result"]): GameRecordSummary {
    return {
        id: "game-1",
        roomId: null,
        publicId: null,
        source: "online_room",
        visibility: "private",
        status: "finished",
        result,
        finishedAt: null,
        createdAt: "2026-07-21T00:00:00.000Z",
        participants: [
            { seat: "b", userId: null, displayNameSnapshot: "Alice" },
            { seat: "w", userId: null, displayNameSnapshot: "Bob" },
        ],
    };
}

describe("formatGameResult", () => {
    it("連続王手の千日手は引き分けでなく、王手を掛けられた側の勝ちとして書く", () => {
        expect(formatGameResult(finishedGame({ winner: "w", reason: "oute_sennichite" }))).toBe(
            "Bob 勝ち (連続王手の千日手)",
        );
    });

    it("勝者の無い千日手は引き分けとして書く", () => {
        expect(formatGameResult(finishedGame({ winner: null, reason: "sennichite" }))).toBe(
            "引き分け (千日手)",
        );
    });
});
