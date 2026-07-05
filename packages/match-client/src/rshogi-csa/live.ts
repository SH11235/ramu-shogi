/**
 * rshogi 進行中対局の WebSocket 観戦クライアント。
 *
 * `wss://<host>/ws/<gameId>/spectate` に接続して `%%MONITOR2ON <gameId>` を送り、
 * 以下のシーケンスを処理する:
 *
 * 1. `##[MONITOR2] BEGIN <id>` 受信 → snapshot バッファ開始
 * 2. `##[MONITOR2] END` 受信 → snapshot 完成。Game_Summary block の
 *    `Black/White_Time_Remaining_Ms:` から残時間を抽出して `onClock`、
 *    move 行を `parseCsaMoves` でフル再パースして `onSnapshot`
 * 3. snapshot 後の broadcast move 行は `parseSingleCsaMove` で 1 手ずつ apply
 *    し `onMove` を発火
 * 4. `%TORYO` / `%KACHI` / `%TIME_UP` / `#RESIGN` / `#TIME_UP` 等の終局コードで
 *    `onEnd` を発火し、reconnect 経路を停止
 *
 * auto-reconnect:
 * - normal close (code 1000) かつ `onEnd` 既発火 → reconnect しない
 *   (= 終局済 DO close 経路、サーバが意図的に閉じる)
 * - normal close (code 1000) かつ `onEnd` 未発火 → 保守的に reconnect
 * - abnormal close / network error → exponential backoff (1s/2s/4s/8s/max 30s) で
 *   reconnect
 *
 * server #548 (rshogi-csa-server-workers) は `extract_room_id_for_spectate` で
 * `<gameId>` 末尾の epoch suffix を剥がすため、URL に game_id をそのまま渡せば
 * room_id 形式に変換される。
 *
 * 注: 本モジュールは `@shogi/app-core` の CSA decode helper (`parseSingleCsaMove`)
 * に依存する。設計コメント v5 §6.4 に基づき、
 * 「snapshot block 内の moves をフル再パース」「broadcast move を 1 行ずつ
 * apply」を `subscribeRshogiLiveGame` 内に閉じ込めるための判断。一般的な WS
 * クライアント実装 (`createRoomClient` 等) は app-core に依存しないが、live
 * 観戦は本質的に CSA wire の解釈を含むため、`live.ts` に限り例外的に
 * `@shogi/app-core` を依存リストに加える。新たな CSA wire 解釈ロジックを
 * `match-client` 配下に増やす場合は、ドメインロジック専用パッケージ (例:
 * `@shogi/csa-parser`) への切り出しを検討すること。
 */

import {
    createInitialPositionState,
    type PositionState,
    parseSingleCsaMove,
} from "@shogi/app-core";
import type {
    RshogiClockKind,
    RshogiGameMeta,
    RshogiGameResult,
    RshogiGameResultKind,
    RshogiTimeControl,
} from "./client";

/**
 * Floodgate コメント (`'* <eval> <pv...>`) を解析した結果。
 *
 * spectator へは move 行 (`<token>,T<sec>`) の直後に、指した側のエンジンが付けた
 * コメントが独立した 1 行 (`'` で始まる) として届く。
 *
 * ## eval 符号規約 (rshogi `build_floodgate_comment` で確認済み)
 * サーバ (`crates/rshogi-csa-client/src/session.rs` `build_floodgate_comment`) は
 * エンジン自身の探索スコア `score_cp` (手番側視点 = 指した側から見て正が有利) を
 * `Black => cp, White => -cp` で **常に先手 (Black) 視点** に正規化してから
 * `* {score}` を書き出す。したがって wire 上の `evalCp` は「指した側がどちらでも」
 * 先手視点に固定された値であり、`+` が先手有利・`-` が後手有利を意味する。
 * (詰みは `±100000` のセンチネルとして符号化される。)
 */
export interface RshogiLiveComment {
    /** `'` を剥がしたコメント本文 (例: `* 123 +7776FU -3334FU`)。常に保持する。 */
    raw: string;
    /**
     * Floodgate 形 `* <整数>` から抽出した評価値 (先手視点、センチポーン)。
     * `+` = 先手有利、`-` = 後手有利。Floodgate 形でない/整数でないコメントは undefined。
     */
    evalCp?: number;
    /**
     * 読み筋 (PV) の CSA トークン列 (例: `["+7776FU", "-3334FU"]`)。
     * eval のみで PV が無いコメントや解析不能コメントでは undefined。
     */
    pv?: string[];
}

/**
 * snapshot 内の 1 手のメタ情報付きエントリ。
 * `moves` (USI 文字列配列) と同じ順序・同じ長さで並ぶ。
 */
export interface RshogiLiveMove {
    /** 手の USI 文字列 (`7g7f` / `P*5e` 等)。 */
    csaMove: string;
    /** 消費秒数 (`,T<sec>` 由来)。旧サーバは snapshot に T を載せないため 0。 */
    elapsedSec: number;
    /** 指した側のエンジンが付けた Floodgate コメント (無ければ undefined)。 */
    comment?: RshogiLiveComment;
}

/**
 * 観戦 snapshot (= snapshot block 完了時に client が保持する初期状態)。
 *
 * `RshogiGame` (静的 viewer の単局取得結果) と異なり、`csa` 全文ではなく
 * 「初期局面 + これまでの手 + 残時間」に decode 済みの構造体を返す。再接続時の
 * 冪等再適用も同じ構造体で表現される。
 */
export interface RshogiLiveSnapshot {
    /** 対局メタデータ (sente/gote 名、clock spec、開始時刻、event 等)。 */
    meta: RshogiGameMeta;
    /** これまでの手 (USI 文字列、`parseCsaMoves` 由来)。 */
    moves: string[];
    /**
     * `moves` と同順・同長の手ごとメタ情報 (消費秒 + コメント)。
     * 旧サーバでコメント/T が無くても要素は生成され、その場合 elapsedSec=0・
     * comment=undefined になる (= graceful degrade)。
     */
    moveDetails: RshogiLiveMove[];
    /** snapshot 末尾時点の `PositionState` (board + hands + turn + ply)。 */
    state: PositionState;
    /** snapshot 取得時点の残時間と手番。 */
    clocks: {
        /** 先手の本体残時間 (ms 粒度、秒読みは含まない)。 */
        sente: number;
        /** 後手の本体残時間 (ms 粒度、秒読みは含まない)。 */
        gote: number;
        /** wire 上の手番 (= server `current_turn()`)。 */
        sideToMove: "sente" | "gote";
    };
    /** 終局済 DO への接続時のみ最終結果を含む。 */
    finalResult?: RshogiGameResult;
}

/** broadcast move 1 手の到着イベント。 */
export interface RshogiLiveMoveEvent {
    /** 手の USI 文字列 (`7g7f` / `P*5e` 等)。 */
    csaMove: string;
    /** 消費秒数 (`,T<elapsed_sec>` の値)。秒数行が無ければ 0。 */
    elapsedSec: number;
}

/**
 * move コメント (`'* <eval> <pv...>`) の到着イベント。
 *
 * live stream ではコメント行が対応する move 行の直後に別行で届くため、`onMove` を
 * 即時発火する既存タイミングを崩さず、コメントは本コールバックで ply 紐付きで
 * 後追い配信する (設計案 (b))。`ply` は 1 始まりで、奇数=先手手番・偶数=後手手番。
 */
export interface RshogiLiveMoveCommentEvent {
    /** コメントが属する手の ply (1 始まり)。奇数=先手・偶数=後手の指し手。 */
    ply: number;
    /** 解析済みコメント (raw + eval + pv)。 */
    comment: RshogiLiveComment;
}

/** snapshot 受信時の clock 同期イベント。 */
export interface RshogiLiveClockEvent {
    remainingMs: { sente: number; gote: number };
    sideToMove: "sente" | "gote";
}

export type RshogiLiveConnectionState = "connecting" | "connected" | "reconnecting" | "closed";

export type RshogiLiveStaticFallbackReason =
    | "terminal-snapshot"
    | "reconnect-limit-reached"
    | "not-found";

export class RshogiLiveRoomFullError extends Error {
    constructor(message = "観戦者数が上限に達しているため、この対局を観戦できません") {
        super(message);
        this.name = "RshogiLiveRoomFullError";
    }
}

export interface RshogiLiveCallbacks {
    /** 初回 + 再接続時に毎回呼ばれる (state を全置換)。 */
    onSnapshot(snapshot: RshogiLiveSnapshot): void;
    /** 1 手 broadcast の到着。残り時間は本 callback には載せない (client 側 timer で計算)。 */
    onMove(event: RshogiLiveMoveEvent): void;
    /**
     * move コメント (eval / PV) の到着。live stream では move 行の直後に別行で届く。
     * 任意 callback (旧 consumer との後方互換のため optional)。
     */
    onMoveComment?(event: RshogiLiveMoveCommentEvent): void;
    /** clock countdown を再同期する任意 callback。snapshot 受信時のみ呼ばれる。 */
    onClock(event: RshogiLiveClockEvent): void;
    /** 終局検知。`onEnd` 発火後は reconnect 経路を停止する。 */
    onEnd(result: RshogiGameResult): void;
    /** WS 接続状態の通知。 */
    onConnectionState(state: RshogiLiveConnectionState): void;
    /** 解析・WS エラー通知 (致命的でないものも含む)。 */
    onError(err: Error): void;
    /**
     * live 接続では進行中表示を続けられないが、終局済棋譜として表示できる可能性が
     * 高いときに呼ばれる。consumer は `GET /api/v1/games/<id>` に切り替える。
     */
    onStaticFallbackRequested?(reason: RshogiLiveStaticFallbackReason): void;
}

export interface RshogiLiveSubscribeOptions {
    /**
     * rshogi 観戦 WS のベース URL (例: `wss://csa.rshogi.example.com`)。
     * 未指定時はモック (固定 snapshot を timer で再生) で動かす MVP 動作。
     */
    apiBaseUrl?: string;
    /** AbortController などからの中断に対応。 */
    signal?: AbortSignal;
    /** テスト用: WebSocket コンストラクタを差し替える。未指定時は `globalThis.WebSocket`。 */
    webSocketFactory?: (url: string) => WebSocket;
    /**
     * テスト用: setTimeout を差し替える。reconnect の遅延テストや
     * fake timer 制御に使う。
     */
    setTimeoutImpl?: typeof setTimeout;
    /** テスト用: clearTimeout を差し替える。 */
    clearTimeoutImpl?: typeof clearTimeout;
}

export interface RshogiLiveSession {
    /** WS を能動的に閉じ、reconnect 経路を停止する。 */
    disconnect(): void;
}

/** exponential backoff の遅延列 (ms)。最大 30s で頭打ち。 */
const RECONNECT_BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 30000] as const;

/**
 * reconnect 試行回数の上限。超えたら確定 closed にして再接続ループを止める。
 * attempt は `onopen` 即時ではなく「安定接続が継続した」ときだけリセットするため、
 * 終局済 DO の「接続成功→即 close」flap はこの回数で必ず収束する (= 無限に
 * reconnecting/connected を往復しない) 一方、安定観戦中の散発的な切断では累積上限に
 * 達しない。
 */
const MAX_RECONNECT_ATTEMPTS = RECONNECT_BACKOFF_MS.length;

/**
 * open がこの時間継続したら「安定接続」とみなして reconnectAttempt をリセットする。
 * これ未満で閉じる接続 (flap) はリセット対象にせず、backoff を単調増加させる。
 */
const STABLE_CONNECTION_MS = 30_000;

/**
 * `Game_Summary` block の `Total_Time:` `Byoyomi:` `Increment:` 等を
 * `RshogiTimeControl` 風の構造体に decode する。
 */
interface ParsedSummary {
    gameId?: string;
    senteName?: string;
    goteName?: string;
    /**
     * 持ち時間の単位。`Total_Time` / `Byoyomi` の解釈が単位ごとに変わる:
     * - `1sec`:  秒 (Countdown / Fischer)
     * - `1msec`: ミリ秒 (CountdownMsec)
     * - `1min`:  分 (StopWatch)
     */
    timeUnit?: "1sec" | "1msec" | "1min";
    totalTime?: number;
    byoyomi?: number;
    increment?: number;
    blackRemainingMs?: number;
    whiteRemainingMs?: number;
    toMove?: "sente" | "gote";
}

const parseGameSummaryLines = (summaryLines: string[]): ParsedSummary => {
    const out: ParsedSummary = {};
    for (const raw of summaryLines) {
        const line = raw.trim();
        const colonIdx = line.indexOf(":");
        if (colonIdx <= 0) continue;
        const key = line.slice(0, colonIdx);
        const value = line.slice(colonIdx + 1);
        switch (key) {
            case "Game_ID":
                out.gameId = value;
                break;
            case "Name+":
                out.senteName = value;
                break;
            case "Name-":
                out.goteName = value;
                break;
            case "Time_Unit":
                if (value === "1sec" || value === "1msec" || value === "1min") out.timeUnit = value;
                break;
            case "Total_Time": {
                const n = Number(value);
                if (Number.isFinite(n)) out.totalTime = n;
                break;
            }
            case "Byoyomi": {
                const n = Number(value);
                if (Number.isFinite(n)) out.byoyomi = n;
                break;
            }
            case "Increment": {
                const n = Number(value);
                if (Number.isFinite(n)) out.increment = n;
                break;
            }
            case "Black_Time_Remaining_Ms": {
                const n = Number(value);
                if (Number.isFinite(n)) out.blackRemainingMs = n;
                break;
            }
            case "White_Time_Remaining_Ms": {
                const n = Number(value);
                if (Number.isFinite(n)) out.whiteRemainingMs = n;
                break;
            }
            case "To_Move":
                if (value === "+") out.toMove = "sente";
                else if (value === "-") out.toMove = "gote";
                break;
            default:
                break;
        }
    }
    return out;
};

/**
 * `parseGameSummaryLines` の結果を `RshogiTimeControl` に変換する。
 *
 * ## kind 判定 (REST `decodeClock` の語彙に合わせる)
 * サーバの clock 方式は `BEGIN Time` セクションの `Time_Unit` + `Increment` /
 * `Byoyomi` の有無で一意に決まる (server `ClockSpec::format_time_section`)。
 * - `Increment` 行ありかつ 0 より大きい → `fischer` (Time_Unit は常に 1sec)
 * - `Time_Unit:1min`  → `stopwatch` (Total_Time / Byoyomi は分単位)
 * - `Time_Unit:1msec` → `countdown_msec` (Total_Time / Byoyomi は ms 単位)
 * - それ以外 (`Time_Unit:1sec` / 未指定) → `countdown`。`Byoyomi` が無い/0 の
 *   場合は sudden-death (byoyomiSeconds=0) として扱う。
 *
 * ## 単位換算
 * `mainSeconds` / `byoyomiSeconds` は Time_Unit に応じて秒へ正規化する:
 * - `1sec`:  秒そのまま
 * - `1msec`: ms → `round(/1000)`
 * - `1min`:  分 → `*60`
 * `byoyomiMilliseconds` は `1msec` のときだけ生 ms を保持する (ms 粒度の秒読み表示用)。
 */
const deriveTimeControl = (summary: ParsedSummary): RshogiTimeControl | undefined => {
    if (
        summary.totalTime === undefined &&
        summary.byoyomi === undefined &&
        summary.increment === undefined
    ) {
        return undefined;
    }
    const unit = summary.timeUnit;
    const toSeconds = (value: number | undefined): number => {
        if (value === undefined) return 0;
        if (unit === "1msec") return Math.round(value / 1000);
        if (unit === "1min") return value * 60;
        return value;
    };
    const hasPositiveIncrement = summary.increment != null && summary.increment > 0;
    const kind: RshogiClockKind = hasPositiveIncrement
        ? "fischer"
        : unit === "1min"
          ? "stopwatch"
          : unit === "1msec"
            ? "countdown_msec"
            : "countdown";
    return {
        kind,
        mainSeconds: toSeconds(summary.totalTime),
        byoyomiSeconds: toSeconds(summary.byoyomi),
        byoyomiMilliseconds: unit === "1msec" ? summary.byoyomi : undefined,
        incrementSeconds: hasPositiveIncrement ? summary.increment : undefined,
    };
};

/**
 * snapshot block の wire 行群を `RshogiLiveSnapshot` に decode する。
 *
 * snapshot 行群は以下の構造で並ぶ前提:
 * - `BEGIN Game_Summary` ... `END Game_Summary`
 * - move 行 (1 行 1 手、`+7776FU,T3` 形式)
 * - 終局済 DO の場合のみ末尾に `#RESIGN` / `#TIME_UP` 等の result_code 行
 *
 * `BEGIN MONITOR2` / `END MONITOR2` 行自体は本関数には渡らない契約。
 */
const decodeSnapshotBlock = (
    gameId: string,
    snapshotLines: string[],
): { snapshot: RshogiLiveSnapshot; finalResultLine?: string } => {
    const summaryLines: string[] = [];
    /** move 行を順に蓄積する (token + 消費秒 + 直後に来たコメント)。 */
    const moveEntries: { token: string; elapsedSec: number; comment?: RshogiLiveComment }[] = [];
    let resultCodeLine: string | undefined;
    let inSummary = false;
    for (const raw of snapshotLines) {
        const line = raw.trim();
        if (line.length === 0) continue;
        if (line === "BEGIN Game_Summary") {
            inSummary = true;
            continue;
        }
        if (line === "END Game_Summary") {
            inSummary = false;
            continue;
        }
        if (inSummary) {
            summaryLines.push(line);
            continue;
        }
        if (line.startsWith("+") || line.startsWith("-")) {
            // moves 行は `<token>,T<elapsed_sec>` 形式。USI 変換は `<token>` のみで行う。
            moveEntries.push({ token: line.split(",")[0], elapsedSec: extractElapsedSec(line) });
            continue;
        }
        if (line.startsWith("'")) {
            // `'` コメント行は直前の move 行に属する。move が未出現なら握り潰す。
            const last = moveEntries[moveEntries.length - 1];
            if (last) last.comment = parseLiveComment(line);
            continue;
        }
        if (line.startsWith("#")) {
            // `#RESIGN` / `#TIME_UP` 等の終局結果コード。snapshot 末尾にしか
            // 現れない契約だが、念のため最後に出現したものを採用する。
            resultCodeLine = line;
        }
    }

    const summary = parseGameSummaryLines(summaryLines);

    // moves (USI) と moveDetails を同じループで対にして構築する。
    // `parseCsaMovesWithState` は解析不能な手を skip して続行するため、moves 配列
    // だけ後から index 対応させると skip 以降の消費秒/コメントが 1 手ずれる。
    // entry 単位で parse し、失敗した entry は elapsedSec/comment ごと落とすことで
    // 両配列の index 対応を構造的に保証する (skip の挙動自体は従来と同じ)。
    let state = createInitialPositionState();
    const moves: string[] = [];
    const moveDetails: RshogiLiveMove[] = [];
    for (const entry of moveEntries) {
        const applied = parseSingleCsaMove(entry.token, state);
        if (!applied) continue;
        state = applied.nextState;
        moves.push(applied.move);
        moveDetails.push({
            csaMove: applied.move,
            elapsedSec: entry.elapsedSec,
            comment: entry.comment,
        });
    }

    const meta: RshogiGameMeta = {
        gameId: summary.gameId ?? gameId,
        senteName: summary.senteName ?? "",
        goteName: summary.goteName ?? "",
        timeControl: deriveTimeControl(summary),
    };

    const sideToMove: "sente" | "gote" = summary.toMove ?? state.turn;

    const snapshot: RshogiLiveSnapshot = {
        meta,
        moves,
        moveDetails,
        state,
        clocks: {
            sente: summary.blackRemainingMs ?? 0,
            gote: summary.whiteRemainingMs ?? 0,
            sideToMove,
        },
        finalResult: resultCodeLine
            ? decodeSnapshotResultCode(resultCodeLine, state.turn)
            : undefined,
    };

    return { snapshot, finalResultLine: resultCodeLine };
};

/**
 * `#RESIGN` / `#TIME_UP` 等の result_code 行から `RshogiGameResult` を導出する。
 *
 * サーバーの result_code は rshogi の primary_result_code と一致し、
 * `#RESIGN` / `#TIME_UP` / `#ILLEGAL_MOVE` / `#JISHOGI` /
 * `#OUTE_SENNICHITE` / `#SENNICHITE` / `#MAX_MOVES` / `#ABNORMAL` の集合。
 *
 * snapshot 末尾の result_code は「敗者視点」の理由として届く。
 * - `#RESIGN`: 手番側が投了 → 敗者 = `currentTurn`、勝者 = 反対側
 * - `#TIME_UP`: 手番側が時間切れ → 敗者 = `currentTurn`、勝者 = 反対側
 * - `#JISHOGI`: 手番側が入玉宣言成立 → 勝者 = `currentTurn`
 *   (`%KACHI` は手番側の宣言で、勝てば `#JISHOGI` info)
 * - 千日手系 / 中断系: winner なし
 *
 * `currentTurn` は「次に指す側 = 全手 replay 直後の `PositionState.turn`」を
 * 渡す契約 (snapshot 経路) または「`detectEndLine` 検知時点の手番」(live 経路)。
 */
export const decodeResultCode = (
    line: string,
    currentTurn: "sente" | "gote",
): RshogiGameResult | undefined => {
    const code = line.trim();
    let kind: RshogiGameResultKind | undefined;
    let endReason: string | undefined;
    let winnerSide: "current" | "opposite" | "draw" = "draw";
    switch (code) {
        case "#RESIGN":
            kind = "resignation";
            endReason = "RESIGN";
            winnerSide = "opposite";
            break;
        case "#TIME_UP":
            kind = "time_expired";
            endReason = "TIME_UP";
            winnerSide = "opposite";
            break;
        case "#JISHOGI":
            kind = "jishogi";
            endReason = "JISHOGI";
            winnerSide = "current";
            break;
        case "#OUTE_SENNICHITE":
            kind = "oute_sennichite";
            endReason = "OUTE_SENNICHITE";
            // 連続王手の千日手は王手をかけ続けた側 (= 直前手の指し手側 = `currentTurn` の反対) が反則負け。
            winnerSide = "current";
            break;
        case "#SENNICHITE":
            kind = "draw";
            endReason = "SENNICHITE";
            winnerSide = "draw";
            break;
        case "#MAX_MOVES":
            kind = "max_moves";
            endReason = "MAX_MOVES";
            winnerSide = "draw";
            break;
        case "#ILLEGAL_MOVE":
        case "#ILLEGAL":
            kind = "abort";
            endReason = "ILLEGAL";
            winnerSide = "draw";
            break;
        case "#ABNORMAL":
            kind = "abnormal";
            endReason = "ABNORMAL";
            winnerSide = "draw";
            break;
        default:
            return undefined;
    }
    let winner: "sente" | "gote" | undefined;
    if (winnerSide === "draw") {
        winner = undefined;
    } else if (winnerSide === "opposite") {
        winner = currentTurn === "sente" ? "gote" : "sente";
    } else {
        winner = currentTurn;
    }
    return { kind, winner, endReason };
};

// snapshot 限定の防御: 既知コード以外でも `#` 行なら terminal 扱いにして
// 再接続ループを防ぐ (将来サーバーに結果コードが増えた場合の再発防止)。
// broadcast 行は decodeResultCode を直接通るため、この緩い判定は適用されない。
const decodeSnapshotResultCode = (
    line: string,
    currentTurn: "sente" | "gote",
): RshogiGameResult | undefined => {
    const result = decodeResultCode(line, currentTurn);
    if (result) return result;
    const code = line.trim();
    if (!code.startsWith("#")) return undefined;
    return { kind: "abort", endReason: code.slice(1) || "UNKNOWN_RESULT_CODE" };
};

/**
 * 進行中対局の broadcast move 行 (`+7776FU,T3` / `+0055FU,T1` 等) から終局コード
 * (`%TORYO` / `%KACHI` / `%TIME_UP` / `##[GAME_END]`) を判別する。終局コードなら
 * 該当の `RshogiGameResult` を返す (winner 判定は `currentTurn` 由来)。
 */
const detectEndLine = (line: string, currentTurn: "sente" | "gote"): RshogiGameResult | null => {
    const trimmed = line.trim();
    if (trimmed === "%TORYO") {
        // 投了は手番側の宣言。手番側が敗者、相手が勝者。
        return {
            kind: "resignation",
            winner: currentTurn === "sente" ? "gote" : "sente",
            endReason: "RESIGN",
        };
    }
    if (trimmed === "%KACHI") {
        // 入玉宣言勝ちは手番側が勝者。
        return {
            kind: "jishogi",
            winner: currentTurn,
            endReason: "JISHOGI",
        };
    }
    if (trimmed === "%TIME_UP") {
        // 時間切れは手番側が敗者、相手が勝者。
        return {
            kind: "time_expired",
            winner: currentTurn === "sente" ? "gote" : "sente",
            endReason: "TIME_UP",
        };
    }
    // `#RESIGN` / `#TIME_UP` 等は server からの broadcast info (snapshot 末尾以外
    // でも live broadcast 中に届く可能性)。winner 判定は state.turn の反対手側。
    if (trimmed.startsWith("#")) {
        return decodeResultCode(trimmed, currentTurn) ?? null;
    }
    if (trimmed.startsWith("##[GAME_END]")) {
        // server 拡張行 (将来対応)。winner 不明なので abort 扱い。
        return { kind: "abort", endReason: trimmed };
    }
    return null;
};

/** broadcast move 行から `,T<elapsed_sec>` の値を抽出する (無ければ 0)。 */
const extractElapsedSec = (line: string): number => {
    const idx = line.indexOf(",T");
    if (idx < 0) return 0;
    const tail = line.slice(idx + 2);
    const n = Number(tail);
    return Number.isFinite(n) ? n : 0;
};

/**
 * spectator へ配信される Floodgate コメント行 (`'* <eval> <pv...>`) を解析する。
 *
 * - 先頭の CSA コメントマーカ `'` を剥がした本文を `raw` に保持する。
 * - Floodgate 標準形 `* <整数 eval> <pv の CSA トークン...>` を eval / pv に分解する。
 * - Floodgate 形でない・eval が整数でない等、解析不能なコメントは `raw` のみを
 *   残し `evalCp` / `pv` を undefined にする (任意コメントを握り潰さない)。
 *
 * eval の符号規約は {@link RshogiLiveComment} を参照 (常に先手視点、+ が先手有利)。
 */
const parseLiveComment = (line: string): RshogiLiveComment => {
    const withoutQuote = line.startsWith("'") ? line.slice(1) : line;
    const raw = withoutQuote.trim();
    if (raw.startsWith("*")) {
        const rest = raw.slice(1).trim();
        if (rest.length > 0) {
            const parts = rest.split(/\s+/);
            const evalNum = Number(parts[0]);
            if (Number.isInteger(evalNum)) {
                const pv = parts.slice(1);
                return { raw, evalCp: evalNum, pv: pv.length > 0 ? pv : undefined };
            }
        }
    }
    return { raw };
};

const isRoomFullText = (value: string): boolean => {
    const normalized = value.toLowerCase();
    // サーバ契約は close(1013, "room full") と MONITOR2 ERROR の "room full" のみ。
    // 将来マッチ範囲を広げる場合は、誤検知を避けるため根拠をコメントで明記する。
    return normalized.includes("room full");
};

const maybeRoomFullLineError = (line: string): RshogiLiveRoomFullError | null =>
    isRoomFullText(line) ? new RshogiLiveRoomFullError() : null;

const maybeRoomFullCloseError = (event: CloseEvent): RshogiLiveRoomFullError | null =>
    event.code === 1013 && isRoomFullText(event.reason) ? new RshogiLiveRoomFullError() : null;

/**
 * モック観戦 (apiBaseUrl 未指定かつ gameId が `mock-` で始まる場合) が配信する
 * 固定 snapshot の wire 行群。
 *
 * `##[MONITOR2] BEGIN/END` を含まない「snapshot block 本文」形式で、
 * {@link decodeSnapshotBlock} にそのまま渡せる。各 move 行の直後に Floodgate 形
 * コメント (`'* <cp> <pv...>`) を並べ、消費秒 (`,T<sec>`) も付与している。
 * eval は先手視点 (+ = 先手有利) で、序盤 (ply1-5) は先手有利 → ply6-10 で
 * 後手有利の連続下げ → ply11 以降で先手が挽回 → 最終手 (ply15) で詰み
 * センチネル `100000` に至る、という現実味のある評価値の振れを持たせている。
 * これによりサーバ無しでも評価値グラフ・棋譜評価値カラムをローカルで確認できる。
 *
 * `Game_ID` / `To_Move` はあえて省き、`meta.gameId` は購読時の gameId に、
 * `sideToMove` は全手 replay 後の手番 (= 後手) にフォールバックさせている。
 */
const MOCK_SNAPSHOT_LINES: string[] = [
    "BEGIN Game_Summary",
    "Protocol_Version:1.2",
    "Protocol_Mode:Server",
    "Format:Shogi 1.0",
    "Name+:先手デモエンジン",
    "Name-:後手デモエンジン",
    "Rematch_On_Draw:NO",
    // Fischer 方式 (Increment) にして、dev screenshot でも kind 判定 + 増分加算の
    // 新パス (viewer `applyMoveToClocks`) を素通しで確認できるようにする。
    "BEGIN Time",
    "Time_Unit:1sec",
    "Total_Time:600",
    "Increment:10",
    "Least_Time_Per_Move:0",
    "END Time",
    "BEGIN Position",
    "P1-KY-KE-GI-KI-OU-KI-GI-KE-KY",
    "P2 * -HI *  *  *  *  * -KA * ",
    "P3-FU-FU-FU-FU-FU-FU-FU-FU-FU",
    "P4 *  *  *  *  *  *  *  *  * ",
    "P5 *  *  *  *  *  *  *  *  * ",
    "P6 *  *  *  *  *  *  *  *  * ",
    "P7+FU+FU+FU+FU+FU+FU+FU+FU+FU",
    "P8 * +KA *  *  *  *  * +HI * ",
    "P9+KY+KE+GI+KI+OU+KI+GI+KE+KY",
    "+",
    "END Position",
    "Black_Time_Remaining_Ms:540000",
    "White_Time_Remaining_Ms:552000",
    "END Game_Summary",
    // ply1-5: 先手やや有利で推移
    "+7776FU,T3",
    "'* 30 -3334FU +2726FU",
    "-3334FU,T5",
    "'* 20 +2726FU -8384FU",
    "+2726FU,T2",
    "'* 45 -8384FU +2625FU",
    "-8384FU,T4",
    "'* 15 +2625FU -8485FU",
    "+2625FU,T3",
    "'* 60 -8485FU +6978KI",
    // ply6-10: 後手有利の連続下げ (先手視点で負値が続く)
    "-8485FU,T6",
    "'* -25 +6978KI -7162GI",
    "+6978KI,T8",
    "'* -40 -7162GI +8877KA",
    "-7162GI,T7",
    "'* -70 +8877KA -2233KA",
    "+8877KA,T9",
    "'* -55 -2233KA +7968GI",
    "-2233KA,T6",
    "'* -90 +7968GI -3132GI",
    // ply11-14: 先手が挽回
    "+7968GI,T10",
    "'* 35 -3132GI +3736FU",
    "-3132GI,T7",
    "'* 10 +3736FU -3435FU",
    "+3736FU,T4",
    "'* 80 -3435FU +3635FU",
    "-3435FU,T5",
    "'* 120 +3635FU",
    // ply15: 詰みセンチネル (先手が詰みを発見)
    "+3635FU,T3",
    "'* 100000",
];

/**
 * モック観戦セッションを開始する (apiBaseUrl 未指定かつ gameId が `mock-` で始まる場合のみ)。
 *
 * サーバへは接続せず、{@link MOCK_SNAPSHOT_LINES} を decode した固定 snapshot を
 * 1 回だけ配信する (broadcast move は流さない)。server 無しの開発・デモで live
 * viewer の評価値グラフ / 棋譜評価値カラムを表示するための経路。
 *
 * `disconnect()` / `signal` abort で保留中のタイマーを止め、`closed` を通知する。
 */
function startMockLiveGame(
    gameId: string,
    callbacks: RshogiLiveCallbacks,
    deps: {
        setTimeoutImpl: typeof setTimeout;
        clearTimeoutImpl: typeof clearTimeout;
        signal?: AbortSignal;
    },
): RshogiLiveSession {
    // 注意: `deps.setTimeoutImpl(...)` のようにオブジェクトのメソッドとして呼ぶと、
    // ブラウザ実装の window.setTimeout/clearTimeout は this が deps に束縛され
    // "Illegal invocation" を throw する (Node/happy-dom は this を見ないため
    // テストでは顕在化しない)。必ずローカル変数へ剥がして裸で呼ぶこと。
    const { setTimeoutImpl, clearTimeoutImpl } = deps;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const emit = (fn: () => void) => {
        try {
            fn();
        } catch (err) {
            try {
                callbacks.onError(
                    err instanceof Error ? err : new Error(`mock handler threw: ${String(err)}`),
                );
            } catch (handlerErr) {
                console.error("[rshogi live mock] onError handler threw", handlerErr);
            }
        }
    };

    const dispose = () => {
        if (disposed) return;
        disposed = true;
        if (timer !== null) {
            clearTimeoutImpl(timer);
            timer = null;
        }
        emit(() => callbacks.onConnectionState("closed"));
    };

    if (deps.signal) {
        if (deps.signal.aborted) {
            dispose();
            return { disconnect: () => {} };
        }
        deps.signal.addEventListener("abort", dispose, { once: true });
    }

    emit(() => callbacks.onConnectionState("connecting"));

    timer = setTimeoutImpl(() => {
        timer = null;
        if (disposed) return;
        emit(() => callbacks.onConnectionState("connected"));
        try {
            const { snapshot } = decodeSnapshotBlock(gameId, MOCK_SNAPSHOT_LINES);
            emit(() => callbacks.onSnapshot(snapshot));
            emit(() =>
                callbacks.onClock({
                    remainingMs: { sente: snapshot.clocks.sente, gote: snapshot.clocks.gote },
                    sideToMove: snapshot.clocks.sideToMove,
                }),
            );
        } catch (err) {
            emit(() =>
                callbacks.onError(
                    err instanceof Error
                        ? err
                        : new Error(`mock snapshot decode failed: ${String(err)}`),
                ),
            );
        }
    }, 0);

    return { disconnect: dispose };
}

/** モック観戦を有効にする gameId の prefix (apiBaseUrl 未指定時のみ有効)。 */
const MOCK_GAME_ID_PREFIX = "mock-";

/**
 * 進行中対局の WebSocket 観戦を開始する。
 *
 * `apiBaseUrl` 指定時は `wss://<host>/ws/<gameId>/spectate` に open する。
 * `apiBaseUrl` 未指定時は:
 * - gameId が `mock-` で始まる場合のみ、固定 snapshot を配信するモックで動く
 *   (サーバ無しの開発・デモ用の明示 opt-in 規約)。
 * - それ以外はエラー (`onError` + `closed`)。設定漏れ (VITE_RSHOGI_API_BASE 未設定
 *   等) の production ビルドが偽の対局を本物のように表示しないための防御。
 *
 * 戻り値の `disconnect()` で reconnect 経路を含めて完全停止する。`signal` を
 * 渡した場合は abort で同様に停止する。
 */
export function subscribeRshogiLiveGame(
    gameId: string,
    options: RshogiLiveSubscribeOptions,
    callbacks: RshogiLiveCallbacks,
): RshogiLiveSession {
    const setTimeoutImpl = options.setTimeoutImpl ?? setTimeout;
    const clearTimeoutImpl = options.clearTimeoutImpl ?? clearTimeout;
    if (!options.apiBaseUrl) {
        // モックは gameId の `mock-` prefix による明示 opt-in のみ。apiBaseUrl の
        // 設定漏れで実 gameId が来た場合は従来どおりエラーで閉じる (偽対局の防止)。
        if (gameId.startsWith(MOCK_GAME_ID_PREFIX)) {
            return startMockLiveGame(gameId, callbacks, {
                setTimeoutImpl,
                clearTimeoutImpl,
                signal: options.signal,
            });
        }
        try {
            callbacks.onConnectionState("connecting");
        } catch (handlerErr) {
            console.error("[rshogi live] onConnectionState handler threw", handlerErr);
        }
        try {
            callbacks.onError(
                new Error(
                    `subscribeRshogiLiveGame: apiBaseUrl is required for live spectate (mock mode is only for gameId with "${MOCK_GAME_ID_PREFIX}" prefix)`,
                ),
            );
        } catch (handlerErr) {
            console.error("[rshogi live] onError handler threw", handlerErr);
        }
        try {
            callbacks.onConnectionState("closed");
        } catch (handlerErr) {
            console.error("[rshogi live] onConnectionState handler threw", handlerErr);
        }
        return { disconnect: () => {} };
    }
    const wsFactory =
        options.webSocketFactory ??
        ((url: string) => new (globalThis.WebSocket as typeof WebSocket)(url));

    let ws: WebSocket | null = null;
    let disposed = false;
    /** 受信 line バッファ (改行で区切る前の partial 文字列)。 */
    let recvBuffer = "";
    /** snapshot 中に蓄積する行 (BEGIN〜END の間)。 */
    let snapshotLines: string[] = [];
    /** snapshot block 受信中フラグ。 */
    let inSnapshot = false;
    /** snapshot 受信完了後に保持する最新 PositionState。 */
    let liveState: PositionState = createInitialPositionState();
    /** 受信直後に手番側を判定するための補助 (snapshot 完了時に確定)。 */
    let liveTurn: "sente" | "gote" = "sente";
    /**
     * これまでに適用済みの手数 (= 直近手の ply、1 始まり)。snapshot で
     * `snapshot.moves.length` に確定し、broadcast move ごとに +1 する。
     * `'` コメント行を「直前 move」に紐付けるための ply として使う。
     */
    let liveMoveCount = 0;
    /** `onEnd` 発火済みフラグ (= reconnect 抑止)。 */
    let endFired = false;
    /** 指数 backoff の現在 attempt index。 */
    let reconnectAttempt = 0;
    /** スケジュール済 reconnect timer。 */
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    /**
     * connectionState を通知する。`disposed` 後でも `closed` だけは通知する契約
     * (= `disconnect()` から最終 closed 状態を通知する経路を維持する)。
     */
    const emitConnectionState = (state: RshogiLiveConnectionState) => {
        if (disposed && state !== "closed") return;
        try {
            callbacks.onConnectionState(state);
        } catch (err) {
            console.error("[rshogi live] onConnectionState handler threw", err);
        }
    };

    const emitError = (err: Error) => {
        if (disposed) return;
        try {
            callbacks.onError(err);
        } catch (handlerErr) {
            console.error("[rshogi live] onError handler threw", handlerErr);
        }
    };

    const requestStaticFallback = (reason: RshogiLiveStaticFallbackReason) => {
        if (disposed) return;
        try {
            callbacks.onStaticFallbackRequested?.(reason);
        } catch (err) {
            emitError(
                err instanceof Error
                    ? err
                    : new Error(`onStaticFallbackRequested handler threw: ${String(err)}`),
            );
        }
    };

    const closeAsRoomFull = (err: RshogiLiveRoomFullError) => {
        emitError(err);
        disposed = true;
        cancelReconnect();
        clearStableTimer();
        const currentWs = ws;
        ws = null;
        try {
            currentWs?.close(1000, "room full");
        } catch {
            // 失敗は無視
        }
        emitConnectionState("closed");
    };

    const cancelReconnect = () => {
        if (reconnectTimer !== null) {
            clearTimeoutImpl(reconnectTimer);
            reconnectTimer = null;
        }
    };

    /** 安定接続判定タイマー。open 継続が STABLE_CONNECTION_MS に達したら attempt をリセット。 */
    let stableTimer: ReturnType<typeof setTimeout> | null = null;
    const clearStableTimer = () => {
        if (stableTimer !== null) {
            clearTimeoutImpl(stableTimer);
            stableTimer = null;
        }
    };

    const scheduleReconnect = () => {
        if (disposed) return;
        // 上限到達: これ以上は再接続せず確定 closed にする (無限 flap を断ち切る)。
        // emitError は disposed 中は無視される契約なので、disposed を立てる前に通知する。
        if (reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
            requestStaticFallback("reconnect-limit-reached");
            emitError(new Error("再接続の上限に達したため観戦を終了しました"));
            disposed = true;
            emitConnectionState("closed");
            return;
        }
        const delayIdx = Math.min(reconnectAttempt, RECONNECT_BACKOFF_MS.length - 1);
        const delay = RECONNECT_BACKOFF_MS[delayIdx];
        reconnectAttempt += 1;
        emitConnectionState("reconnecting");
        reconnectTimer = setTimeoutImpl(() => {
            reconnectTimer = null;
            openSocket();
        }, delay);
    };

    const handleEndDetected = (result: RshogiGameResult) => {
        if (endFired) return;
        endFired = true;
        try {
            callbacks.onEnd(result);
        } catch (err) {
            console.error("[rshogi live] onEnd handler threw", err);
        }
    };

    const handleSnapshotComplete = () => {
        const lines = snapshotLines.slice();
        snapshotLines = [];
        inSnapshot = false;
        try {
            const { snapshot, finalResultLine } = decodeSnapshotBlock(gameId, lines);
            liveState = snapshot.state;
            liveTurn = snapshot.clocks.sideToMove;
            // ply カウンタを snapshot 手数に同期。以降の broadcast move で +1 され、
            // その値が後続 `'` コメント行の紐付け先 ply になる。
            liveMoveCount = snapshot.moves.length;
            try {
                callbacks.onSnapshot(snapshot);
            } catch (err) {
                emitError(
                    err instanceof Error
                        ? err
                        : new Error(`onSnapshot handler threw: ${String(err)}`),
                );
            }
            try {
                callbacks.onClock({
                    remainingMs: { sente: snapshot.clocks.sente, gote: snapshot.clocks.gote },
                    sideToMove: snapshot.clocks.sideToMove,
                });
            } catch (err) {
                emitError(
                    err instanceof Error ? err : new Error(`onClock handler threw: ${String(err)}`),
                );
            }
            // 終局済 DO に接続したケース: snapshot 内に result_code 行がある。
            if (finalResultLine && snapshot.finalResult) {
                requestStaticFallback("terminal-snapshot");
                handleEndDetected(snapshot.finalResult);
            }
        } catch (err) {
            emitError(
                err instanceof Error ? err : new Error(`snapshot decode failed: ${String(err)}`),
            );
        }
    };

    const handleLiveLine = (line: string) => {
        const trimmed = line.trim();
        if (trimmed.length === 0) return;
        // `'` コメント行は直前 move に属する。move / 終局判定より前に処理して、
        // 絶対に move 行・終局行として扱われないようにする (detectEndLine は `'`
        // に一致しないが、順序で確実に防御する)。
        if (trimmed.startsWith("'")) {
            // まだ 1 手も適用していない場合は紐付け先が無いので握り潰す。
            if (liveMoveCount >= 1 && callbacks.onMoveComment) {
                const comment = parseLiveComment(trimmed);
                try {
                    callbacks.onMoveComment({ ply: liveMoveCount, comment });
                } catch (err) {
                    emitError(
                        err instanceof Error
                            ? err
                            : new Error(`onMoveComment handler threw: ${String(err)}`),
                    );
                }
            }
            return;
        }
        // 終局検知 (move 行ではない場合)。
        const endResult = detectEndLine(trimmed, liveTurn);
        if (endResult) {
            handleEndDetected(endResult);
            return;
        }
        // move 行の処理 (`<token>,T<elapsed>` の `<token>` 部分のみ apply)。
        if (!(trimmed.startsWith("+") || trimmed.startsWith("-"))) {
            return;
        }
        const token = trimmed.split(",")[0];
        const elapsedSec = extractElapsedSec(trimmed);
        const applied = parseSingleCsaMove(token, liveState);
        if (!applied) {
            // wire 由来の move を decode できないのは内部不整合。エラー通知だけ
            // 出して以降の処理は続行する (= snapshot 再受信で復旧する想定)。
            emitError(new Error(`failed to apply broadcast move: ${trimmed}`));
            return;
        }
        liveState = applied.nextState;
        liveTurn = applied.nextState.turn;
        liveMoveCount += 1;
        try {
            callbacks.onMove({ csaMove: applied.move, elapsedSec });
        } catch (err) {
            emitError(
                err instanceof Error ? err : new Error(`onMove handler threw: ${String(err)}`),
            );
        }
    };

    const handleIncomingLine = (raw: string) => {
        const line = raw.replace(/\r$/, "");
        const trimmed = line.trim();
        if (trimmed.length === 0) return;
        // `##[MONITOR2] BEGIN <id>` で snapshot 開始。
        if (trimmed.startsWith("##[MONITOR2] BEGIN")) {
            inSnapshot = true;
            snapshotLines = [];
            return;
        }
        if (trimmed === "##[MONITOR2] END") {
            handleSnapshotComplete();
            return;
        }
        if (trimmed.startsWith("##[MONITOR2] NOT_FOUND")) {
            // server 側で active/finished のいずれにも一致しなかった。
            // reconnect しても結果は変わらないので close する。
            requestStaticFallback("not-found");
            emitError(new Error(`spectate target not found: ${trimmed}`));
            disposed = true;
            cancelReconnect();
            try {
                ws?.close(1000, "not found");
            } catch {
                // 失敗は無視
            }
            emitConnectionState("closed");
            return;
        }
        if (trimmed.startsWith("##[MONITOR2] ERROR")) {
            const roomFullError = maybeRoomFullLineError(trimmed);
            if (roomFullError) {
                closeAsRoomFull(roomFullError);
            }
            // room full 以外の MONITOR2 ERROR は一時的な警告として扱う。
            // snapshot / live line は継続して届く可能性があるため、ここでは接続を維持する。
            return;
        }
        if (inSnapshot) {
            snapshotLines.push(line);
            return;
        }
        handleLiveLine(line);
    };

    const flushBuffer = () => {
        let nlIdx = recvBuffer.indexOf("\n");
        while (nlIdx >= 0) {
            const line = recvBuffer.slice(0, nlIdx);
            recvBuffer = recvBuffer.slice(nlIdx + 1);
            handleIncomingLine(line);
            nlIdx = recvBuffer.indexOf("\n");
        }
    };

    const openSocket = () => {
        if (disposed) return;
        // apiBaseUrl 未指定は関数冒頭でモック経路に分岐済みのため、ここには到達しない。
        // 型の絞り込み (URL に string を渡す) のための防御ガード。
        const apiBaseUrl = options.apiBaseUrl;
        if (!apiBaseUrl) return;
        // `apiBaseUrl` は REST と共用で path (`/api/v1` 等) を含みうるが、観戦 WS は
        // ルート直下 (`/ws/<id>/spectate`) にあるため origin だけ使い path は捨てる。
        // scheme は https/wss→wss、http/ws→ws に揃える。
        const apiUrl = new URL(apiBaseUrl);
        const wsScheme =
            apiUrl.protocol === "https:" || apiUrl.protocol === "wss:" ? "wss:" : "ws:";
        const url = `${wsScheme}//${apiUrl.host}/ws/${encodeURIComponent(gameId)}/spectate`;
        emitConnectionState(reconnectAttempt > 0 ? "reconnecting" : "connecting");

        let socket: WebSocket;
        try {
            socket = wsFactory(url);
        } catch (err) {
            emitError(
                err instanceof Error
                    ? err
                    : new Error(`WebSocket constructor threw: ${String(err)}`),
            );
            scheduleReconnect();
            return;
        }
        ws = socket;
        recvBuffer = "";
        snapshotLines = [];
        inSnapshot = false;

        socket.onopen = () => {
            if (disposed || ws !== socket) return;
            // open 即時に reconnectAttempt をリセットしない。終局済 DO は「接続成功→
            // 即 close」を繰り返すため、即リセットすると backoff が 1s に戻り無限 flap
            // になる。代わりに STABLE_CONNECTION_MS だけ open が継続したら安定接続と
            // みなしてリセットし、安定観戦中の散発切断では累積上限に達しないようにする。
            clearStableTimer();
            stableTimer = setTimeoutImpl(() => {
                stableTimer = null;
                reconnectAttempt = 0;
            }, STABLE_CONNECTION_MS);
            emitConnectionState("connected");
            try {
                socket.send(`%%MONITOR2ON ${gameId}\n`);
            } catch (err) {
                emitError(
                    err instanceof Error
                        ? err
                        : new Error(`failed to send MONITOR2ON: ${String(err)}`),
                );
            }
        };

        socket.onmessage = (event: MessageEvent) => {
            if (disposed || ws !== socket) return;
            const data = event.data;
            if (typeof data === "string") {
                recvBuffer += data;
                if (!recvBuffer.endsWith("\n")) {
                    // wire は line-buffered だが念のため改行終端でなくても flush
                    // を試みる (改行があれば消費する)。
                }
                flushBuffer();
            }
        };

        socket.onerror = () => {
            if (disposed || ws !== socket) return;
            // onerror の Event には詳細が乗らないため代替メッセージで通知する。
            emitError(new Error("WebSocket error"));
        };

        socket.onclose = (event: CloseEvent) => {
            if (ws !== socket) return;
            ws = null;
            // 接続が閉じたので安定判定タイマーは無効化する (close から先は flap 扱い)。
            clearStableTimer();
            recvBuffer = "";
            snapshotLines = [];
            inSnapshot = false;
            if (disposed) {
                emitConnectionState("closed");
                return;
            }
            const roomFullError = maybeRoomFullCloseError(event);
            if (roomFullError) {
                closeAsRoomFull(roomFullError);
                return;
            }
            // `onEnd` 発火済の場合、close code に関わらず reconnect しない。
            // (終局済 DO へ再接続しても snapshot を再受信して onEnd を再発火する
            // だけで意味がなく、abnormal close 1006 等で reconnect ループに陥る
            // のを防ぐ。)
            if (endFired) {
                disposed = true;
                emitConnectionState("closed");
                return;
            }
            // 終局未確定な close (abnormal close / network error / 保守的 1000)
            // は backoff で reconnect。
            scheduleReconnect();
        };
    };

    // signal による中断対応
    if (options.signal) {
        if (options.signal.aborted) {
            disposed = true;
            emitConnectionState("closed");
            return { disconnect: () => {} };
        }
        options.signal.addEventListener(
            "abort",
            () => {
                if (disposed) return;
                disposed = true;
                cancelReconnect();
                clearStableTimer();
                if (ws) {
                    try {
                        ws.send("%%MONITOR2OFF\n");
                    } catch {
                        // 無視
                    }
                    try {
                        ws.close(1000, "aborted");
                    } catch {
                        // 無視
                    }
                }
                emitConnectionState("closed");
            },
            { once: true },
        );
    }

    openSocket();

    return {
        disconnect(): void {
            if (disposed) return;
            disposed = true;
            cancelReconnect();
            clearStableTimer();
            const socket = ws;
            ws = null;
            if (socket) {
                try {
                    if (socket.readyState === socket.OPEN) {
                        socket.send("%%MONITOR2OFF\n");
                    }
                } catch {
                    // send 失敗は無視 (close で同じ結果になる)
                }
                try {
                    socket.close(1000, "client disconnect");
                } catch {
                    // 無視
                }
            }
            emitConnectionState("closed");
        },
    };
}

// 内部関数も re-export することで unit テストから直接叩ける。
// (テスト外では使わない契約)
export const __test_internals = {
    decodeSnapshotBlock,
    deriveTimeControl,
    detectEndLine,
    extractElapsedSec,
    parseGameSummaryLines,
    parseLiveComment,
};
