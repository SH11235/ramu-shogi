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
export type RshogiGameSourceWire = "kifu" | "floodgate" | "wdoor" | "upload";

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

const HIRATE_POSITION_LINES = [
    "P1-KY-KE-GI-KI-OU-KI-GI-KE-KY",
    "P2 * -HI *  *  *  *  * -KA * ",
    "P3-FU-FU-FU-FU-FU-FU-FU-FU-FU",
    "P4 *  *  *  *  *  *  *  *  * ",
    "P5 *  *  *  *  *  *  *  *  * ",
    "P6 *  *  *  *  *  *  *  *  * ",
    "P7+FU+FU+FU+FU+FU+FU+FU+FU+FU",
    "P8 * +KA *  *  *  *  * +HI * ",
    "P9+KY+KE+GI+KI+OU+KI+GI+KE+KY",
];

const WDOOR_SAMPLE_GAME_ID = "wdoor-20261009000001-0a1b2c3d4e";
const WDOOR_SAMPLE_ORIGIN_ID = "wdoor+floodgate-300-10F+RAMU+SampleEngine+20261009000001";
const UPLOAD_EVENT_GAME_ID = "upload-00112233445566aa";
const UPLOAD_PLAIN_GAME_ID = "upload-8899aabbccddeeff";

/**
 * wdoor 形式 (指し手行 → `T<秒>` 行 → `'** <評価値> <読み筋>` 行) のモック棋譜。
 * 評価値は先手視点。6 手目はコメントを欠かせてあり、最終手は詰みの符号化 (100000)。
 */
const WDOOR_SAMPLE_CSA = [
    "V2",
    "N+RAMU",
    "N-SampleEngine",
    "'Max_Moves:256",
    "'Increment:10",
    `$EVENT:${WDOOR_SAMPLE_ORIGIN_ID}`,
    "$START_TIME:2026/10/09 00:00:01",
    ...HIRATE_POSITION_LINES,
    "+",
    "'rating:RAMU+0123456789abcdef:SampleEngine+fedcba9876543210",
    "'black_rate:RAMU+0123456789abcdef:3512.0",
    "'white_rate:SampleEngine+fedcba9876543210:3447.0",
    "+7776FU",
    "T3",
    "'** 30 -3334FU +2726FU",
    "-3334FU",
    "T5",
    "'** 20 +2726FU -8384FU",
    "+2726FU",
    "T2",
    "'** 45 -8384FU +2625FU",
    "-8384FU",
    "T4",
    "'** 15 +2625FU -8485FU",
    "+2625FU",
    "T3",
    "'** 60 -8485FU +6978KI",
    "-8485FU",
    "T6",
    "+6978KI",
    "T8",
    "'** -40 -7162GI +8877KA",
    "-7162GI",
    "T7",
    "'** -70 +8877KA -2233KA",
    "+8877KA",
    "T9",
    "'** -55 -2233KA +7968GI",
    "-2233KA",
    "T6",
    "'** -90 +7968GI -3132GI",
    "+7968GI",
    "T10",
    "'** 35 -3132GI +3736FU",
    "-3132GI",
    "T7",
    "'** 10 +3736FU -3435FU",
    "+3736FU",
    "T4",
    "'** 80 -3435FU +3635FU",
    "-3435FU",
    "T5",
    "'** 120 +3635FU",
    "+3635FU",
    "T3",
    "'** 100000",
    "%TORYO",
    "T2",
    "'summary:toryo:RAMU win:SampleEngine lose",
    "'$END_TIME:2026/10/09 00:01:25",
].join("\n");

/**
 * rshogi サーバー形式 (`<指し手>,T<秒>` → `'** <評価値> <読み筋>`) のモック棋譜。
 * 自己対局の棋譜と同じく定跡局面から始まる: 角換わりの途中局面、双方が角を持ち、後手番。
 */
const UPLOAD_EVENT_CSA = [
    "V2.2",
    "N+SelfPlay-A",
    "N-SelfPlay-B",
    "$EVENT:サンプル大会",
    "$START_TIME:2026/10/08 20:00:00",
    "P1-KY-KE * -KI-OU * -GI-KE-KY",
    "P2 * -HI *  *  *  * -KI *  * ",
    "P3-FU * -FU-FU-FU-FU-GI-FU-FU",
    "P4 *  *  *  *  *  * -FU *  * ",
    "P5 * -FU *  *  *  *  * +FU * ",
    "P6 *  * +FU *  *  *  *  *  * ",
    "P7+FU+FU+GI+FU+FU+FU+FU * +FU",
    "P8 *  * +KI *  *  *  * +HI * ",
    "P9+KY+KE *  * +OU+KI+GI+KE+KY",
    "P+00KA",
    "P-00KA",
    "-",
    "-0055KA,T3",
    "'** -35 +2524FU -2324FU",
    "+2524FU,T4",
    "'** 60 -2324FU +2824HI",
    "-2324FU,T1",
    "'** 45 +2824HI",
    "+2824HI,T2",
    "'** 150",
    "%TORYO",
].join("\n");

/** 評価値コメントも消費時間も無い、指し手だけのモック棋譜。 */
const UPLOAD_PLAIN_CSA = [
    "V2.2",
    "N+LocalEngine-X",
    "N-LocalEngine-Y",
    "PI",
    "+",
    "+7776FU",
    "-8384FU",
    "+2726FU",
    "-8485FU",
    "%TORYO",
].join("\n");

// CSA の時刻は JST。epoch ms は UTC で組むので 9 時間引く。
const WDOOR_SAMPLE_STARTED_AT_MS = Date.UTC(2026, 9, 8, 15, 0, 1);
const WDOOR_SAMPLE_ENDED_AT_MS = Date.UTC(2026, 9, 8, 15, 1, 25);
const UPLOAD_EVENT_STARTED_AT_MS = Date.UTC(2026, 9, 8, 11, 0, 0);
const UPLOAD_EVENT_ENDED_AT_MS = Date.UTC(2026, 9, 8, 11, 0, 24);
const UPLOAD_PLAIN_STARTED_AT_MS = Date.UTC(2026, 9, 7, 3, 0, 0);
const UPLOAD_PLAIN_ENDED_AT_MS = Date.UTC(2026, 9, 7, 3, 5, 0);

const SAMPLE_1_STARTED_AT_MS = Date.UTC(2026, 3, 29, 10, 0, 0);
const SAMPLE_1_ENDED_AT_MS = Date.UTC(2026, 3, 29, 10, 18, 42);
const SAMPLE_2_STARTED_AT_MS = Date.UTC(2026, 3, 30, 12, 0, 0);
const SAMPLE_2_ENDED_AT_MS = Date.UTC(2026, 3, 30, 12, 9, 11);
const SAMPLE_3_STARTED_AT_MS = Date.UTC(2026, 3, 28, 11, 30, 0);
const SAMPLE_3_ENDED_AT_MS = Date.UTC(2026, 3, 28, 11, 47, 52);
const SAMPLE_4_STARTED_AT_MS = Date.UTC(2026, 3, 27, 13, 0, 0);
const SAMPLE_4_ENDED_AT_MS = Date.UTC(2026, 3, 27, 13, 12, 3);

export const MOCK_RSHOGI_GAMES: Record<string, RshogiGame> = {
    [WDOOR_SAMPLE_GAME_ID]: {
        meta: {
            gameId: WDOOR_SAMPLE_GAME_ID,
            senteName: "RAMU",
            goteName: "SampleEngine",
            startedAtMs: WDOOR_SAMPLE_STARTED_AT_MS,
            endedAtMs: WDOOR_SAMPLE_ENDED_AT_MS,
            event: "floodgate-300-10F",
            originUrl: `https://wdoor.c.u-tokyo.ac.jp/shogi/x/2026/10/09/${WDOOR_SAMPLE_ORIGIN_ID}.csa`,
            timeControl: {
                kind: "fischer",
                mainSeconds: 300,
                byoyomiSeconds: 0,
                incrementSeconds: 10,
            },
            result: { kind: "resignation", winner: "sente", endReason: "RESIGN" },
            source: "wdoor",
            movesCount: 15,
        },
        csa: WDOOR_SAMPLE_CSA,
    },
    [UPLOAD_EVENT_GAME_ID]: {
        meta: {
            gameId: UPLOAD_EVENT_GAME_ID,
            senteName: "SelfPlay-A",
            goteName: "SelfPlay-B",
            startedAtMs: UPLOAD_EVENT_STARTED_AT_MS,
            endedAtMs: UPLOAD_EVENT_ENDED_AT_MS,
            event: "サンプル大会",
            // 持ち時間を判定できない棋譜ではサーバーが clock を省略する。
            result: { kind: "resignation", winner: "sente", endReason: "RESIGN" },
            source: "upload",
            movesCount: 4,
        },
        csa: UPLOAD_EVENT_CSA,
    },
    [UPLOAD_PLAIN_GAME_ID]: {
        meta: {
            gameId: UPLOAD_PLAIN_GAME_ID,
            senteName: "LocalEngine-X",
            goteName: "LocalEngine-Y",
            startedAtMs: UPLOAD_PLAIN_STARTED_AT_MS,
            endedAtMs: UPLOAD_PLAIN_ENDED_AT_MS,
            result: { kind: "resignation", winner: "sente", endReason: "RESIGN" },
            source: "upload",
            movesCount: 4,
        },
        csa: UPLOAD_PLAIN_CSA,
    },
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
        event: meta.event,
        originUrl: meta.originUrl,
    };
};

/**
 * モック一覧 API の応答セット。新着順 (新→旧) に並べる。
 * 単局 fixture (wdoor / upload の 3 件と sample-1, sample-2) を含めつつ、
 * リスト UI を試せるよう数件追加する。
 */
export const MOCK_RSHOGI_GAME_LIST: RshogiGameSummary[] = [
    summaryFromMock(WDOOR_SAMPLE_GAME_ID),
    summaryFromMock(UPLOAD_EVENT_GAME_ID),
    summaryFromMock(UPLOAD_PLAIN_GAME_ID),
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
