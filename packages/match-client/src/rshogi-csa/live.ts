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
 */

import {
    createInitialPositionState,
    type PositionState,
    parseCsaMovesWithState,
    parseSingleCsaMove,
} from "@shogi/app-core";
import type { RshogiGameMeta, RshogiGameResult, RshogiGameResultKind } from "./client";

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

/** snapshot 受信時の clock 同期イベント。 */
export interface RshogiLiveClockEvent {
    remainingMs: { sente: number; gote: number };
    sideToMove: "sente" | "gote";
}

export type RshogiLiveConnectionState = "connecting" | "connected" | "reconnecting" | "closed";

export interface RshogiLiveCallbacks {
    /** 初回 + 再接続時に毎回呼ばれる (state を全置換)。 */
    onSnapshot(snapshot: RshogiLiveSnapshot): void;
    /** 1 手 broadcast の到着。残り時間は本 callback には載せない (client 側 timer で計算)。 */
    onMove(event: RshogiLiveMoveEvent): void;
    /** clock countdown を再同期する任意 callback。snapshot 受信時のみ呼ばれる。 */
    onClock(event: RshogiLiveClockEvent): void;
    /** 終局検知。`onEnd` 発火後は reconnect 経路を停止する。 */
    onEnd(result: RshogiGameResult): void;
    /** WS 接続状態の通知。 */
    onConnectionState(state: RshogiLiveConnectionState): void;
    /** 解析・WS エラー通知 (致命的でないものも含む)。 */
    onError(err: Error): void;
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
 * `Game_Summary` block の `Total_Time:` `Byoyomi:` `Increment:` 等を
 * `RshogiTimeControl` 風の構造体に decode する。
 */
interface ParsedSummary {
    gameId?: string;
    senteName?: string;
    goteName?: string;
    timeUnit?: "1sec" | "1msec";
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
                if (value === "1sec" || value === "1msec") out.timeUnit = value;
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
    const moveLines: string[] = [];
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
            moveLines.push(line);
            continue;
        }
        if (line.startsWith("#")) {
            // `#RESIGN` / `#TIME_UP` 等の終局結果コード。snapshot 末尾にしか
            // 現れない契約だが、念のため最後に出現したものを採用する。
            resultCodeLine = line;
        }
    }

    const summary = parseGameSummaryLines(summaryLines);

    // moves 行は `<token>,T<elapsed_sec>` 形式。USI 変換は `<token>` のみで行う。
    const movesText = moveLines.map((l) => l.split(",")[0]).join("\n");
    const initial = createInitialPositionState();
    const { moves, state } = parseCsaMovesWithState(movesText, initial);

    const meta: RshogiGameMeta = {
        gameId: summary.gameId ?? gameId,
        senteName: summary.senteName ?? "",
        goteName: summary.goteName ?? "",
        timeControl:
            summary.totalTime !== undefined || summary.byoyomi !== undefined
                ? {
                      mainSeconds:
                          summary.timeUnit === "1msec"
                              ? Math.round((summary.totalTime ?? 0) / 1000)
                              : (summary.totalTime ?? 0),
                      byoyomiSeconds:
                          summary.timeUnit === "1msec"
                              ? Math.round((summary.byoyomi ?? 0) / 1000)
                              : (summary.byoyomi ?? 0),
                      byoyomiMilliseconds:
                          summary.timeUnit === "1msec" ? summary.byoyomi : undefined,
                      incrementSeconds: summary.increment,
                  }
                : undefined,
    };

    const sideToMove: "sente" | "gote" = summary.toMove ?? state.turn;

    const snapshot: RshogiLiveSnapshot = {
        meta,
        moves,
        state,
        clocks: {
            sente: summary.blackRemainingMs ?? 0,
            gote: summary.whiteRemainingMs ?? 0,
            sideToMove,
        },
        finalResult: resultCodeLine ? decodeResultCode(resultCodeLine, state.turn) : undefined,
    };

    return { snapshot, finalResultLine: resultCodeLine };
};

/**
 * `#RESIGN` / `#TIME_UP` 等の result_code 行から `RshogiGameResult` を導出する。
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
const decodeResultCode = (
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
 * 進行中対局の WebSocket 観戦を開始する。
 *
 * `apiBaseUrl` 未指定時はサーバ接続を行わず、固定 snapshot を即時配信する MVP
 * 動作。`apiBaseUrl` 指定時は `wss://<host>/ws/<gameId>/spectate` に open する。
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

    const cancelReconnect = () => {
        if (reconnectTimer !== null) {
            clearTimeoutImpl(reconnectTimer);
            reconnectTimer = null;
        }
    };

    const scheduleReconnect = () => {
        if (disposed) return;
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
        if (!options.apiBaseUrl) {
            // モック動作: 接続を張らずに固定 snapshot を擬似配信する。
            emitError(
                new Error(
                    "subscribeRshogiLiveGame: apiBaseUrl is required for live spectate (no mock implementation in MVP)",
                ),
            );
            disposed = true;
            emitConnectionState("closed");
            return;
        }
        const base = options.apiBaseUrl.replace(/\/+$/, "");
        // `apiBaseUrl` は HTTPS スキーム (例: `https://csa.example.com`) で渡される
        // 想定。WebSocket スキームに揃える。
        const wsBase = base.replace(/^http(s?):\/\//i, (_m, s) => `ws${s ?? ""}://`);
        const url = `${wsBase}/ws/${encodeURIComponent(gameId)}/spectate`;
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
            reconnectAttempt = 0;
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

        socket.onclose = () => {
            if (ws !== socket) return;
            ws = null;
            recvBuffer = "";
            snapshotLines = [];
            inSnapshot = false;
            if (disposed) {
                emitConnectionState("closed");
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
    detectEndLine,
    extractElapsedSec,
    parseGameSummaryLines,
};
