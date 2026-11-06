/**
 * rshogi の連続対局（tournament / selfplay）が書く JSONL の対局ログを読む。
 *
 * 1 行が 1 つの JSON で、`type` が `meta`（対局条件。先頭に 1 行）・`move`（1 手ごと）・
 * `result`（1 局の結果）のどれか。1 つのファイルに何局も入る。ほかの `type` の行は読み飛ばす。
 *
 * 評価値はログでは手番側から見た値なので、ここで先手から見た値に直す。
 */

/** 対局ログの 1 手に付いていた探索の情報。評価値は先手から見た値。 */
export interface SelfplayJsonlMoveInfo {
    /** その手を指したエンジンのラベル。 */
    engine?: string;
    elapsedMs?: number;
    evalCp?: number;
    /** 詰みを読んでいたときの、詰ます側と手数（手数の分からない詰みは null）。 */
    mate?: { winner: "sente" | "gote"; plies: number | null };
    depth?: number;
    seldepth?: number;
    nodes?: number;
    nps?: number;
    timeMs?: number;
    /** 読み筋（USI）。その手を指した後の局面から始まる。 */
    pv?: string[];
}

export interface SelfplayJsonlResult {
    /** `black_win` / `white_win` / `draw` など。 */
    outcome: string;
    /** `resign` / `sennichite` / `max_moves` など。 */
    reason: string;
    /** 勝ったエンジンのラベル。 */
    winner?: string;
}

export interface SelfplayJsonlGame {
    gameId: number;
    /** 開始局面（SFEN の 4 欄）。 */
    startSfen: string;
    /** 盤上で指された手（USI）。投了などの終局の応答は含まない。 */
    moves: string[];
    /** `moves` と同じ順。 */
    infos: SelfplayJsonlMoveInfo[];
    senteName?: string;
    goteName?: string;
    result?: SelfplayJsonlResult;
}

export interface SelfplayJsonlEngine {
    label?: string;
    path?: string;
    /** USI オプション（`Name=Value`）。 */
    options: string[];
}

export interface SelfplayJsonlMeta {
    /** 対局を始めた時刻（ログに書かれたまま）。 */
    timestamp?: string;
    /** 持ち時間・スレッド数など（`settings` の数値・文字列・真偽値の項目）。 */
    settings: Record<string, string | number | boolean>;
    black?: SelfplayJsonlEngine;
    white?: SelfplayJsonlEngine;
}

export interface SelfplayJsonlLog {
    meta?: SelfplayJsonlMeta;
    /** game_id の順。 */
    games: SelfplayJsonlGame[];
}

/** 指し手ではない、終局の応答（盤上の手には直さない）。 */
const TERMINAL_MOVES = new Set(["resign", "win", "timeout", "illegal", "none"]);

type JsonObject = Record<string, unknown>;

const isObject = (value: unknown): value is JsonObject =>
    typeof value === "object" && value !== null && !Array.isArray(value);

const str = (value: unknown): string | undefined =>
    typeof value === "string" && value !== "" ? value : undefined;

const num = (value: unknown): number | undefined =>
    typeof value === "number" && Number.isFinite(value) ? value : undefined;

/** 最初の空でない行（全文を分割せずに取り出す）。 */
const firstLine = (text: string): string | undefined => {
    let start = 0;
    while (start < text.length) {
        const end = text.indexOf("\n", start);
        const line = text.slice(start, end < 0 ? text.length : end).trim();
        if (line !== "") return line;
        if (end < 0) return undefined;
        start = end + 1;
    }
    return undefined;
};

/**
 * テキストが連続対局の JSONL らしいか（最初の行が `type` を持つ JSON のオブジェクト）。
 * 棋譜の形式の判別に使う。
 */
export function looksLikeSelfplayJsonl(text: string): boolean {
    const line = firstLine(text);
    if (!line?.startsWith("{")) return false;
    try {
        const value: unknown = JSON.parse(line);
        return isObject(value) && typeof value.type === "string";
    } catch {
        return false;
    }
}

const parseEngine = (cmd: JsonObject, side: "black" | "white"): SelfplayJsonlEngine | undefined => {
    const label = str(cmd[`label_${side}`]);
    const path = str(cmd[`path_${side}`]);
    const rawOptions = cmd[`usi_options_${side}`];
    const options = Array.isArray(rawOptions)
        ? rawOptions.filter((option): option is string => typeof option === "string")
        : [];
    if (!label && !path && options.length === 0) return undefined;
    return { label, path, options };
};

const parseMeta = (row: JsonObject): SelfplayJsonlMeta => {
    const settings: Record<string, string | number | boolean> = {};
    if (isObject(row.settings)) {
        for (const [key, value] of Object.entries(row.settings)) {
            if (
                typeof value === "string" ||
                typeof value === "boolean" ||
                (typeof value === "number" && Number.isFinite(value))
            ) {
                settings[key] = value;
            }
        }
    }
    const cmd = isObject(row.engine_cmd) ? row.engine_cmd : {};
    return {
        timestamp: str(row.timestamp),
        settings,
        black: parseEngine(cmd, "black"),
        white: parseEngine(cmd, "white"),
    };
};

/** `sfen_before` の手番の欄（`b` / `w`）。 */
const sideToMove = (sfen: string): "b" | "w" | undefined => {
    const turn = sfen.trim().split(/\s+/)[1];
    return turn === "b" || turn === "w" ? turn : undefined;
};

const parseInfo = (row: JsonObject, move: string, turn: "b" | "w"): SelfplayJsonlMoveInfo => {
    const info: SelfplayJsonlMoveInfo = {};
    const engine = str(row.engine);
    if (engine) info.engine = engine;
    const elapsedMs = num(row.elapsed_ms);
    if (elapsedMs !== undefined) info.elapsedMs = elapsedMs;
    const evalRow = isObject(row.eval) ? row.eval : undefined;
    if (!evalRow) return info;
    // ログの評価値は手番側から見た値。後手の手番では符号を反転して先手から見た値にする。
    const sign = turn === "b" ? 1 : -1;
    const mate = num(evalRow.score_mate);
    // 手数の分からない詰み（USI の `score mate +` / `score mate -`）は符号だけが残る。
    const mateSign = num(evalRow.score_mate_sign);
    const cp = num(evalRow.score_cp);
    const mover = turn === "b" ? "sente" : "gote";
    const other = turn === "b" ? "gote" : "sente";
    if (mate !== undefined && mate !== 0) {
        info.mate = { winner: mate > 0 ? mover : other, plies: Math.abs(mate) };
    } else if (mateSign !== undefined && mateSign !== 0) {
        info.mate = { winner: mateSign > 0 ? mover : other, plies: null };
    } else if (cp !== undefined) {
        // 後手の 0 を -0 にしない。
        info.evalCp = cp === 0 ? 0 : sign * cp;
    }
    for (const [key, field] of [
        ["depth", "depth"],
        ["seldepth", "seldepth"],
        ["nodes", "nodes"],
        ["nps", "nps"],
        ["timeMs", "time_ms"],
    ] as const) {
        const value = num(evalRow[field]);
        if (value !== undefined) info[key] = value;
    }
    if (Array.isArray(evalRow.pv)) {
        const pv = evalRow.pv.filter((m): m is string => typeof m === "string");
        // ログの読み筋は指した手から始まる。研究ノートの読み筋は指した後の局面から始めるので、先頭を落とす。
        // 先頭が指した手でない読み筋は指す前の局面からの読みなので、指した後の局面には付けない。
        const after = pv[0] === move ? pv.slice(1) : [];
        if (after.length > 0) info.pv = after;
    }
    return info;
};

/** 1 手の行のうち、組み立てに使う項目だけ（行全体は持たない）。 */
interface RawMove {
    ply: number;
    sfenBefore: string;
    turn: "b" | "w" | undefined;
    move: string;
    engine: string | undefined;
    timedOut: boolean;
    info: SelfplayJsonlMoveInfo | undefined;
}

/**
 * 連続対局の JSONL を読む。JSON として読めない行・必要な項目の欠けた `move` 行・同じ局の同じ手数・
 * 2 つ目の `meta`（ログを連結したもの）があれば、何行目かを添えて例外を投げる。ただし最後の行が
 * JSON として読めないときは、書き込みの途中（対局中のログ）とみなして読み飛ばす。
 * 手が盤上で指せるかは見ない（取り込む側で再生して確かめる）。
 */
export function parseSelfplayJsonl(text: string): SelfplayJsonlLog {
    let meta: SelfplayJsonlMeta | undefined;
    const movesById = new Map<number, RawMove[]>();
    const resultsById = new Map<number, JsonObject>();
    const lines = text.split(/\r?\n/);
    let lastIndex = lines.length - 1;
    while (lastIndex >= 0 && lines[lastIndex].trim() === "") lastIndex -= 1;
    for (const [index, rawLine] of lines.entries()) {
        const line = rawLine.trim();
        if (line === "") continue;
        let row: unknown;
        try {
            row = JSON.parse(line);
        } catch {
            if (index === lastIndex) continue;
            throw new Error(`${index + 1} 行目を JSON として読めません`);
        }
        if (!isObject(row))
            throw new Error(`${index + 1} 行目が JSON のオブジェクトではありません`);
        switch (row.type) {
            case "meta":
                if (meta !== undefined) {
                    throw new Error(
                        `${index + 1} 行目に 2 つ目の meta があります（ログを連結したものは読めません）`,
                    );
                }
                meta = parseMeta(row);
                continue;
            case "move": {
                const gameId = num(row.game_id);
                const ply = num(row.ply);
                const sfenBefore = str(row.sfen_before);
                const move = str(row.move_usi);
                if (gameId === undefined || ply === undefined || !sfenBefore || !move) {
                    throw new Error(
                        `${index + 1} 行目の move に game_id / ply / sfen_before / move_usi がありません`,
                    );
                }
                const list = movesById.get(gameId) ?? [];
                if (list.some((raw) => raw.ply === ply)) {
                    throw new Error(
                        `${index + 1} 行目: 第${gameId}局の ${ply} 手目が 2 回あります（ログを連結したものは読めません）`,
                    );
                }
                const turn = sideToMove(sfenBefore);
                list.push({
                    ply,
                    sfenBefore,
                    turn,
                    move,
                    engine: str(row.engine),
                    timedOut: row.timed_out === true,
                    info: turn ? parseInfo(row, move, turn) : undefined,
                });
                movesById.set(gameId, list);
                continue;
            }
            case "result": {
                const gameId = num(row.game_id);
                if (gameId !== undefined) resultsById.set(gameId, row);
                continue;
            }
            default:
                continue;
        }
    }

    const games: SelfplayJsonlGame[] = [];
    const ids = [...movesById.keys()].sort((a, b) => a - b);
    for (const gameId of ids) {
        const rawMoves = [...(movesById.get(gameId) ?? [])].sort((a, b) => a.ply - b.ply);
        const first = rawMoves[0];
        if (!first) continue;
        const moves: string[] = [];
        const infos: SelfplayJsonlMoveInfo[] = [];
        let senteName: string | undefined;
        let goteName: string | undefined;
        rawMoves.forEach((raw, index) => {
            // 行が欠けた・手番の壊れたログは、残りの手を別の手順として読んでしまうので断る。
            if (raw.ply !== first.ply + index) {
                throw new Error(`第${gameId}局の ${first.ply + index} 手目の行がありません`);
            }
            if (raw.turn === undefined) {
                throw new Error(`第${gameId}局の ${raw.ply} 手目の sfen_before に手番がありません`);
            }
            const previous = rawMoves[index - 1];
            if (previous && previous.turn === raw.turn) {
                throw new Error(`第${gameId}局の ${raw.ply} 手目の手番が前の手と同じです`);
            }
        });
        // 末尾の行が欠けていないか、結果の手数と照らす。結果の手数は最後に記録した手の手数と同じ
        // （応答なし・対局時間の上限で止めた局だけは、記録する前に止めた手のぶん 1 つ多い）。
        const resultRowForCheck = resultsById.get(gameId);
        const resultPlies = num(resultRowForCheck?.plies);
        const lastPly = rawMoves[rawMoves.length - 1]?.ply ?? 0;
        const reasonForCheck = resultRowForCheck?.reason;
        const slack = reasonForCheck === "watchdog" || reasonForCheck === "game_time_limit" ? 1 : 0;
        if (resultPlies !== undefined && lastPly + slack < resultPlies) {
            throw new Error(
                `第${gameId}局の末尾の手の行が欠けています（結果は ${resultPlies} 手、記録は ${lastPly} 手まで）`,
            );
        }
        for (const raw of rawMoves) {
            if (raw.turn === "b" && senteName === undefined) senteName = raw.engine;
            if (raw.turn === "w" && goteName === undefined) goteName = raw.engine;
            // 時間切れのあとに届いた手・終局の応答は、盤上の手にしない（そこで棋譜を終える）。
            if (raw.timedOut || TERMINAL_MOVES.has(raw.move) || !raw.info) break;
            moves.push(raw.move);
            infos.push(raw.info);
        }
        // 片方が一手も指さずに終わった局（初手で投了など）は、もう一方の名前を meta のラベルから補う。
        const labels = [meta?.black?.label, meta?.white?.label];
        if (senteName && !goteName) goteName = labels.find((label) => label && label !== senteName);
        if (goteName && !senteName) senteName = labels.find((label) => label && label !== goteName);
        const resultRow = resultsById.get(gameId);
        const outcome = str(resultRow?.outcome);
        const reason = str(resultRow?.reason);
        const winner = str(resultRow?.winner);
        games.push({
            gameId,
            startSfen: first.sfenBefore.trim(),
            moves,
            infos,
            ...(senteName ? { senteName } : {}),
            ...(goteName ? { goteName } : {}),
            ...(outcome && reason
                ? { result: { outcome, reason, ...(winner ? { winner } : {}) } }
                : {}),
        });
    }
    return { ...(meta ? { meta } : {}), games };
}
