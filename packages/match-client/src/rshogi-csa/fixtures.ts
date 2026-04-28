/**
 * rshogi CSA viewer 用の組み込みモック棋譜。
 *
 * NOTE: 本実装に差し替える際はこのファイルではなく `client.ts` の
 * `fetchRshogiGame` を fetch ベースに置き換える。
 * fixture 自体は MVP 動作確認・テスト用としてそのまま残す想定。
 */

import type { RshogiGame } from "./client";

const SAMPLE_1_CSA = [
    "V2.2",
    "N+RAMU_TP",
    "N-FFF-70k",
    "$EVENT:rshogi viewer mock sample",
    "$START_TIME:2026/04/29 19:00:00",
    "$TIME_LIMIT:00:10+30",
    "PI",
    "+",
    "+7776FU",
    "T8",
    "-3334FU",
    "T7",
    "+7968GI",
    "T9",
    "-8384FU",
    "T6",
    "+6878GI",
    "T5",
    "-8485FU",
    "T7",
    "%TORYO",
].join("\n");

const SAMPLE_2_CSA = [
    "V2.2",
    "N+PC1_save012",
    "N-RAMU_TP",
    "$EVENT:rshogi viewer mock sample 2",
    "$START_TIME:2026/04/30 21:00:00",
    "$TIME_LIMIT:00:05+15",
    "PI",
    "+",
    "+2726FU",
    "T6",
    "-8384FU",
    "T5",
    "+2625FU",
    "T7",
    "-8485FU",
    "T6",
    "%TORYO",
].join("\n");

export const MOCK_RSHOGI_GAMES: Record<string, RshogiGame> = {
    "sample-1": {
        meta: {
            gameId: "sample-1",
            senteName: "RAMU_TP",
            goteName: "FFF-70k",
            startedAt: "2026-04-29T10:00:00.000Z",
            endedAt: "2026-04-29T10:18:42.000Z",
            event: "rshogi viewer mock sample",
            timeControl: { mainSeconds: 600, byoyomiSeconds: 30 },
            result: { kind: "resignation", winner: "sente" },
        },
        csa: SAMPLE_1_CSA,
    },
    "sample-2": {
        meta: {
            gameId: "sample-2",
            senteName: "PC1_save012",
            goteName: "RAMU_TP",
            startedAt: "2026-04-30T12:00:00.000Z",
            endedAt: "2026-04-30T12:09:11.000Z",
            event: "rshogi viewer mock sample 2",
            timeControl: { mainSeconds: 300, byoyomiSeconds: 15 },
            result: { kind: "resignation", winner: "sente" },
        },
        csa: SAMPLE_2_CSA,
    },
};
