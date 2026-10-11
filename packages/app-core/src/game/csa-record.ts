/**
 * CSA 棋譜から指し手と、指し手ごとの付随情報 (消費時間・評価値・詰み・読み筋) を取り出す。
 *
 * 読む形式は次の 2 つ (どちらもコメントは直前の指し手のもの、評価値は先手視点)。
 * - wdoor 形式: 指し手行 → `T<秒>` 行 → `'** <評価値> <読み筋>` 行
 * - rshogi サーバー形式: `+7776FU,T4` → `'** <評価値> <読み筋>` 行
 *
 * コメントのマーカーは `'** ` と `'* ` の両方を受ける。
 */

import type { Player, PositionState } from "./board";
import { parseSingleCsaMove } from "./csa";
import { buildCsaStartPosition } from "./csa-position";

/**
 * 評価値がこの絶対値以上なら詰みとして扱う。
 * Floodgate 形のコメントは詰みを ±100000 で符号化する。
 */
export const CSA_MATE_EVAL_THRESHOLD = 100_000;

/** `'* <評価値> <読み筋>` / `'** <評価値> <読み筋>` コメント 1 行の解析結果。 */
export interface CsaEvalComment {
    /** 先頭の `'` を外したコメント本文。 */
    raw: string;
    /** 評価値 (先手視点、センチポーン)。評価値コメントでなければ undefined。 */
    evalCp?: number;
    /** 読み筋の CSA トークン列 (例: `["-3334FU", "+2726FU"]`)。無ければ undefined。 */
    pv?: string[];
}

/**
 * CSA のコメント行から評価値と読み筋を取り出す。
 *
 * 評価値が整数でないコメントや評価値コメントでない行は `raw` だけを返す。
 */
export function parseCsaEvalComment(line: string): CsaEvalComment {
    const withoutQuote = line.startsWith("'") ? line.slice(1) : line;
    const raw = withoutQuote.trim();
    const marker = raw.startsWith("**") ? 2 : raw.startsWith("*") ? 1 : 0;
    if (marker > 0) {
        const rest = raw.slice(marker).trim();
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
}

/** 1 手分の付随情報。 */
export interface CsaMoveAnnotation {
    /** 消費時間 (ミリ秒)。 */
    elapsedMs?: number;
    /** 評価値 (先手視点、センチポーン)。詰みのときは持たない。 */
    evalCp?: number;
    /** 詰みと読んだときの勝つ側。手数は CSA から分からないので持たない。 */
    mateWinner?: "sente" | "gote";
    /** 読み筋 (USI)。その手を指した後の局面から始まる。 */
    pv?: string[];
}

export interface CsaGameRecord {
    /**
     * 開始局面の SFEN。平手・先手番のときは `"startpos"`。
     * 駒落ち・途中局面 (持ち駒あり、後手番開始を含む) はその局面の SFEN。
     */
    startSfen: string;
    /** 指し手 (USI)。`startSfen` の局面から始まる。 */
    moves: string[];
    /** `moves` と同じ順・同じ長さ。何も付いていない手は undefined。 */
    annotations: (CsaMoveAnnotation | undefined)[];
    senteName?: string;
    goteName?: string;
    /** `'black_rate:` 行のレート。 */
    senteRate?: number;
    /** `'white_rate:` 行のレート。 */
    goteRate?: number;
}

/**
 * 1 行を文に分ける。CSA は `+7776FU,T4` のようにカンマで文を並べられる。
 * コメント (`'` 以降) はカンマを含みうるので分けない。
 */
const splitStatements = (line: string): string[] => {
    if (!/^[+\-T%]/.test(line)) return [line];
    const commentIndex = line.indexOf(",'");
    const head = commentIndex >= 0 ? line.slice(0, commentIndex) : line;
    const statements = head
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
    if (commentIndex >= 0) statements.push(line.slice(commentIndex + 1));
    return statements;
};

const parseRate = (line: string, prefix: string): number | undefined => {
    if (!line.startsWith(prefix)) return undefined;
    // `'black_rate:<名前>+<hash>:<数値>`。数値は最後の `:` の後ろ。
    const value = line.slice(line.lastIndexOf(":") + 1).trim();
    if (value.length === 0) return undefined;
    const rate = Number(value);
    return Number.isFinite(rate) ? rate : undefined;
};

/**
 * 読み筋の CSA トークン列を、指した後の局面 `afterMove` から始まる USI 列にする。
 *
 * 読み筋が指した手そのものから始まっている場合はその 1 手を落とす。
 * 途中で適用できないトークンに当たったら、そこまでを返す。
 */
const convertPvToUsi = (
    tokens: string[],
    playedToken: string,
    afterMove: PositionState,
): string[] | undefined => {
    let rest = tokens;
    if (rest.length > 0 && rest[0][0] === playedToken[0]) {
        if (rest[0].slice(0, 7) !== playedToken.slice(0, 7)) return undefined;
        rest = rest.slice(1);
    }
    const pv: string[] = [];
    let state = afterMove;
    for (const token of rest) {
        try {
            const applied = parseSingleCsaMove(token, state);
            if (!applied) break;
            pv.push(applied.move);
            state = applied.nextState;
        } catch {
            break;
        }
    }
    return pv.length > 0 ? pv : undefined;
};

interface PendingMove {
    token: string;
    usi: string;
    afterMove: PositionState;
    elapsedMs?: number;
    comment?: CsaEvalComment;
}

const toAnnotation = (pending: PendingMove): CsaMoveAnnotation | undefined => {
    const annotation: CsaMoveAnnotation = {};
    if (pending.elapsedMs !== undefined) annotation.elapsedMs = pending.elapsedMs;
    const evalCp = pending.comment?.evalCp;
    if (evalCp !== undefined) {
        if (evalCp >= CSA_MATE_EVAL_THRESHOLD) annotation.mateWinner = "sente";
        else if (evalCp <= -CSA_MATE_EVAL_THRESHOLD) annotation.mateWinner = "gote";
        else annotation.evalCp = evalCp;
        const pv = pending.comment?.pv
            ? convertPvToUsi(pending.comment.pv, pending.token, pending.afterMove)
            : undefined;
        if (pv) annotation.pv = pv;
    }
    return Object.keys(annotation).length > 0 ? annotation : undefined;
};

/**
 * CSA 棋譜全文を解析する。
 *
 * 開始局面は `PI` / `P1`〜`P9` / `P+`・`P-` / 手番行から組み立てる (平手以外も可)。
 * 解釈できない局面記述、解釈できない指し手行、盤面に適用できない指し手は例外にする
 * (途中までの誤った再生を返さない)。
 * 1 ファイルに複数局 (`/` 区切り) があるときは最初の 1 局だけを読む。
 */
export function parseCsaGameRecord(contents: string): CsaGameRecord {
    const record: CsaGameRecord = { startSfen: "startpos", moves: [], annotations: [] };
    const pendingMoves: PendingMove[] = [];
    const setupLines: string[] = [];
    let startTurn: Player | undefined;
    // 開始局面は最初の指し手 (または棋譜の終わり) で確定する。
    let state: PositionState | null = null;
    let ended = false;
    const resolveStart = (): PositionState => {
        const start = buildCsaStartPosition(setupLines, startTurn);
        record.startSfen = start.sfen;
        return start.position;
    };

    const lines = contents.split(/\r?\n/);
    outer: for (const rawLine of lines) {
        const line = rawLine.trim();
        if (line.length === 0) continue;
        for (const statement of splitStatements(line)) {
            if (statement === "/") break outer;
            if (statement.startsWith("'")) {
                const senteRate = parseRate(statement, "'black_rate:");
                if (senteRate !== undefined) record.senteRate = senteRate;
                const goteRate = parseRate(statement, "'white_rate:");
                if (goteRate !== undefined) record.goteRate = goteRate;
                const last = pendingMoves[pendingMoves.length - 1];
                if (!ended && last && last.comment === undefined) {
                    const comment = parseCsaEvalComment(statement);
                    if (comment.evalCp !== undefined) last.comment = comment;
                }
                continue;
            }
            if (ended) continue;
            if (statement.startsWith("%")) {
                // 終局コマンド。これ以降の `T` 行は指し手の消費時間ではない。
                ended = true;
                continue;
            }
            if (statement.startsWith("T")) {
                const last = pendingMoves[pendingMoves.length - 1];
                const match = /^T(\d+(?:\.\d+)?)$/.exec(statement);
                if (last && match && last.elapsedMs === undefined) {
                    last.elapsedMs = Math.round(Number(match[1]) * 1000);
                }
                continue;
            }
            if (statement === "+" || statement === "-") {
                if (state === null) startTurn = statement === "+" ? "sente" : "gote";
                continue;
            }
            if (statement.startsWith("+") || statement.startsWith("-")) {
                state ??= resolveStart();
                const applied = parseSingleCsaMove(statement, state);
                if (!applied) {
                    throw new Error(`CSA の指し手行を解釈できません: ${statement}`);
                }
                state = applied.nextState;
                pendingMoves.push({ token: statement, usi: applied.move, afterMove: state });
                continue;
            }
            if (pendingMoves.length > 0) continue;
            if (statement.startsWith("N+")) {
                record.senteName = statement.slice(2);
            } else if (statement.startsWith("N-")) {
                record.goteName = statement.slice(2);
            } else if (statement.startsWith("P")) {
                setupLines.push(statement);
            }
        }
    }

    if (state === null) resolveStart();
    for (const pending of pendingMoves) {
        record.moves.push(pending.usi);
        record.annotations.push(toAnnotation(pending));
    }
    return record;
}
