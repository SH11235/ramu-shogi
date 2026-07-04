/**
 * rshogi CSA viewer 用の組み込みモック棋譜。
 *
 * baseUrl 未指定時の MVP 動作 / テストの既定値として使う。
 * decode 層が呼ばれないため、ここでは「decode 後」の TS 型 (camelCase + epoch_ms) で直接定義する。
 */

import type { RshogiGame, RshogiGameSummary, RshogiLiveGameSummary } from "./client";

/** 一覧 API の `result_kind` (wire) リテラル。 */
export type RshogiResultKindWire = "WIN_BLACK" | "WIN_WHITE" | "DRAW" | "ABORT";

/**
 * 一覧 API の `end_reason` (wire) リテラル。サーバ実装
 * (rshogi-csa-server-workers games_index.rs::classify_result) と一致させる。
 */
export type RshogiEndReasonWire =
    | "RESIGN"
    | "TIME_UP"
    | "ILLEGAL"
    | "JISHOGI"
    | "OUTE_SENNICHITE"
    | "SENNICHITE"
    | "MAX_MOVES"
    | "ABNORMAL";

/** 一覧 API の `clock.kind` (wire) リテラル。 */
export type RshogiClockKindWire = "fischer" | "countdown" | "countdown_msec" | "stopwatch";

/** 一覧 API の `source` (wire) リテラル。 */
export type RshogiGameSourceWire = "kifu" | "floodgate";

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

const SAMPLE_1_STARTED_AT_MS = Date.UTC(2026, 3, 29, 10, 0, 0);
const SAMPLE_1_ENDED_AT_MS = Date.UTC(2026, 3, 29, 10, 18, 42);
const SAMPLE_2_STARTED_AT_MS = Date.UTC(2026, 3, 30, 12, 0, 0);
const SAMPLE_2_ENDED_AT_MS = Date.UTC(2026, 3, 30, 12, 9, 11);
const SAMPLE_3_STARTED_AT_MS = Date.UTC(2026, 3, 28, 11, 30, 0);
const SAMPLE_3_ENDED_AT_MS = Date.UTC(2026, 3, 28, 11, 47, 52);
const SAMPLE_4_STARTED_AT_MS = Date.UTC(2026, 3, 27, 13, 0, 0);
const SAMPLE_4_ENDED_AT_MS = Date.UTC(2026, 3, 27, 13, 12, 3);

export const MOCK_RSHOGI_GAMES: Record<string, RshogiGame> = {
    "sample-1": {
        meta: {
            gameId: "sample-1",
            senteName: "RAMU_TP",
            goteName: "FFF-70k",
            startedAtMs: SAMPLE_1_STARTED_AT_MS,
            endedAtMs: SAMPLE_1_ENDED_AT_MS,
            event: "rshogi viewer mock sample",
            timeControl: {
                kind: "fischer",
                mainSeconds: 600,
                byoyomiSeconds: 30,
                incrementSeconds: 5,
            },
            result: { kind: "resignation", winner: "sente", endReason: "RESIGN" },
            source: "kifu",
            movesCount: 9,
        },
        csa: SAMPLE_1_CSA,
    },
    "sample-2": {
        meta: {
            gameId: "sample-2",
            senteName: "PC1_save012",
            goteName: "RAMU_TP",
            startedAtMs: SAMPLE_2_STARTED_AT_MS,
            endedAtMs: SAMPLE_2_ENDED_AT_MS,
            event: "rshogi viewer mock sample 2",
            timeControl: {
                kind: "countdown",
                mainSeconds: 300,
                byoyomiSeconds: 15,
            },
            result: { kind: "resignation", winner: "sente", endReason: "RESIGN" },
            source: "kifu",
            movesCount: 7,
        },
        csa: SAMPLE_2_CSA,
    },
};

const summaryFromMock = (gameId: string): RshogiGameSummary => {
    const mock = MOCK_RSHOGI_GAMES[gameId];
    if (!mock) {
        throw new Error(`unknown mock rshogi game id: ${gameId}`);
    }
    const { meta } = mock;
    return {
        gameId: meta.gameId,
        senteName: meta.senteName,
        goteName: meta.goteName,
        startedAtMs: meta.startedAtMs,
        endedAtMs: meta.endedAtMs,
        timeControl: meta.timeControl,
        result: meta.result,
        movesCount: meta.movesCount,
        source: meta.source,
    };
};

/**
 * モック一覧 API の応答セット。新着順 (新→旧) に並べる。
 * 単局 fixture (sample-1, sample-2) を含めつつ、リスト UI を試せるよう数件追加する。
 */
export const MOCK_RSHOGI_GAME_LIST: RshogiGameSummary[] = [
    summaryFromMock("sample-2"),
    summaryFromMock("sample-1"),
    {
        gameId: "sample-3",
        senteName: "GreatBlue",
        goteName: "RAMU_TP",
        startedAtMs: SAMPLE_3_STARTED_AT_MS,
        endedAtMs: SAMPLE_3_ENDED_AT_MS,
        timeControl: {
            kind: "fischer",
            mainSeconds: 300,
            byoyomiSeconds: 0,
            incrementSeconds: 10,
        },
        result: { kind: "time_expired", winner: "gote", endReason: "TIME_UP" },
        movesCount: 84,
        source: "floodgate",
    },
    {
        gameId: "sample-4",
        senteName: "RAMU_TP",
        goteName: "Tester99",
        startedAtMs: SAMPLE_4_STARTED_AT_MS,
        endedAtMs: SAMPLE_4_ENDED_AT_MS,
        timeControl: {
            kind: "stopwatch",
            mainSeconds: 0,
            byoyomiSeconds: 60,
        },
        result: { kind: "draw", endReason: "SENNICHITE" },
        movesCount: 124,
        source: "kifu",
    },
];

const LIVE_1_STARTED_AT_MS = Date.UTC(2026, 3, 30, 13, 0, 0);
const LIVE_2_STARTED_AT_MS = Date.UTC(2026, 3, 30, 12, 45, 0);
const LIVE_3_STARTED_AT_MS = Date.UTC(2026, 3, 30, 12, 30, 0);

/**
 * モック進行中対局一覧 (`GET /api/v1/games/live`) の応答セット。開始が新しい順。
 *
 * 終局済一覧 (`MOCK_RSHOGI_GAME_LIST`) と異なり、進行中対局には `result` /
 * `endedAtMs` / `movesCount` が存在しない (サーバ側 `LiveGamesIndexEntry` の
 * wire に無いフィールドは decode 後も持たない)。baseUrl 未指定時の MVP 動作 /
 * テストの既定値として使う。
 */
export const MOCK_RSHOGI_LIVE_GAME_LIST: RshogiLiveGameSummary[] = [
    {
        gameId: "live-lobby-cross-fischer-1777400000000",
        senteName: "RAMU_TP",
        goteName: "Challenger-A",
        startedAtMs: LIVE_1_STARTED_AT_MS,
        timeControl: {
            kind: "fischer",
            mainSeconds: 600,
            byoyomiSeconds: 0,
            incrementSeconds: 10,
        },
        source: "kifu",
    },
    {
        gameId: "live-lobby-countdown-1777399100000",
        senteName: "PC1_save012",
        goteName: "RAMU_TP",
        startedAtMs: LIVE_2_STARTED_AT_MS,
        timeControl: {
            kind: "countdown",
            mainSeconds: 300,
            byoyomiSeconds: 30,
        },
        source: "kifu",
    },
    {
        gameId: "live-floodgate-1777398200000",
        senteName: "GreatBlue",
        goteName: "FFF-70k",
        startedAtMs: LIVE_3_STARTED_AT_MS,
        timeControl: {
            kind: "fischer",
            mainSeconds: 900,
            byoyomiSeconds: 0,
            incrementSeconds: 5,
        },
        source: "floodgate",
    },
];
