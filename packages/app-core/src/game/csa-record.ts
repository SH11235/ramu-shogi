/**
 * CSA 棋譜から指し手と、指し手ごとの付随情報 (消費時間・評価値・詰み・読み筋) を取り出す。
 *
 * 読む形式は次の 3 つ (評価値はどれも先手視点)。
 * - wdoor 形式: 指し手行 → `T<秒>` 行 → `'** <評価値> <読み筋>` 行
 * - rshogi サーバー形式: `+7776FU,T4` → `'** <評価値> <読み筋>` 行
 * - 旧 `csa_client` 形式: `'* <評価値> <読み筋>` 行 → 指し手行 → `T<秒>` 行
 *
 * 評価値コメントがどの指し手のものかは、行ごとに次の規則で決める
 * (1 ファイルに混在していてもこの規則どおり)。
 * - 指し手行に `,'*` で連結されたコメント → その指し手
 * - 独立行の `'**` (星 2 つ) → 直前の指し手
 * - 独立行の `'*` (星 1 つ) → 次の指し手
 */

import type { Player, PositionState } from "./board";
import { applyCsaMoveStrict } from "./csa-move";
import { buildCsaStartPosition } from "./csa-position";

/**
 * 評価値がこの絶対値以上なら詰みとして扱う。
 * Floodgate 形のコメントは詰みを ±100000 で符号化する。
 *
 * これ未満の大きな値 (31998 など) を詰みと推測することはしない。エンジンごとに表現が
 * 違い、断定できないため。そうした値は評価値のまま渡し、グラフ側の上限で頭打ちにする。
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
            const applied = applyCsaMoveStrict(token, state);
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

/** これ以降は対局後の記録 (終局理由など) で、指し手のコメントではない。 */
const isPostGameComment = (statement: string): boolean =>
    statement.startsWith("'summary:") ||
    statement.startsWith("'ILLEGAL_MOVE") ||
    statement.startsWith("'$END_TIME");

/**
 * CSA 棋譜全文を解析する。
 *
 * 開始局面は `PI` / `P1`〜`P9` / `P+`・`P-` / 手番行から組み立てる (平手以外も可)。
 * 解釈できない局面記述、解釈できない指し手行、局面に照らして指せない指し手
 * (駒コードの不一致、駒の動きとして不可能な手、持ち駒に無い駒打ち、王手放置など) は
 * 行番号つきの例外にする (途中までの誤った再生を返さない)。
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
    // 独立行の `'*` (旧 csa_client 形式)。次の指し手に付ける。
    let commentForNextMove: CsaEvalComment | undefined;
    const resolveStart = (): PositionState => {
        const start = buildCsaStartPosition(setupLines, startTurn);
        record.startSfen = start.sfen;
        return start.position;
    };

    const lines = contents.split(/\r?\n/);
    outer: for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const line = lines[lineIndex].trim();
        if (line.length === 0) continue;
        const isCommentLine = line.startsWith("'");
        for (const statement of splitStatements(line)) {
            if (statement === "/") break outer;
            if (statement.startsWith("'")) {
                const senteRate = parseRate(statement, "'black_rate:");
                if (senteRate !== undefined) record.senteRate = senteRate;
                const goteRate = parseRate(statement, "'white_rate:");
                if (goteRate !== undefined) record.goteRate = goteRate;
                if (isPostGameComment(statement)) {
                    ended = true;
                    commentForNextMove = undefined;
                }
                if (ended) continue;
                const comment = parseCsaEvalComment(statement);
                if (comment.evalCp === undefined) continue;
                if (isCommentLine && !statement.startsWith("'**")) {
                    commentForNextMove ??= comment;
                    continue;
                }
                // 指し手行に連結されたコメントと、独立行の `'**` は直前の指し手のもの。
                const last = pendingMoves[pendingMoves.length - 1];
                if (last && last.comment === undefined) last.comment = comment;
                continue;
            }
            if (ended) continue;
            if (statement.startsWith("%")) {
                // 終局コマンド。これ以降の `T` 行やコメントは指し手のものではない。
                ended = true;
                commentForNextMove = undefined;
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
                let applied: ReturnType<typeof applyCsaMoveStrict>;
                try {
                    applied = applyCsaMoveStrict(statement, state);
                } catch (error) {
                    throw new Error(
                        `${lineIndex + 1} 行目の指し手を適用できません: ${statement} (${
                            error instanceof Error ? error.message : String(error)
                        })`,
                    );
                }
                state = applied.nextState;
                pendingMoves.push({
                    token: statement,
                    usi: applied.move,
                    afterMove: state,
                    comment: commentForNextMove,
                });
                commentForNextMove = undefined;
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
