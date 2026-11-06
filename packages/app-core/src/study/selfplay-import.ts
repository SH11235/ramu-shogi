/**
 * 連続対局の JSONL（`parseSelfplayJsonl`）の 1 局から研究ノートの文書を作る。
 *
 * 評価値・読み筋・消費時間は `source`（対局時の評価値）に、探索の深さ・ノード数などは
 * その手のコメントに、対局条件（持ち時間・エンジンと USI オプション・終局理由など）は `meta` に入れる。
 */

import type {
    SelfplayJsonlEngine,
    SelfplayJsonlGame,
    SelfplayJsonlMeta,
    SelfplayJsonlMoveInfo,
} from "../game/selfplay-jsonl";
import { createStudyDocumentFromMoves, type StudyImportAnnotation } from "./import";
import type { StudyDocument, StudyMeta, StudyOrigin } from "./types";
import { STUDY_LIMITS } from "./types";

/** `source.kind` に入れる出どころ。 */
export const SELFPLAY_JSONL_SOURCE_KIND = "selfplay_jsonl";

const REASON_LABEL: Record<string, string> = {
    resign: "投了",
    win: "入玉宣言",
    timeout: "時間切れ",
    sennichite: "千日手",
    illegal_move: "反則",
    no_bestmove: "指し手なし",
    max_moves: "最大手数",
    adjudication_draw: "判定で引き分け",
    game_time_limit: "対局時間の上限",
    cancelled: "中止",
    watchdog: "応答なし",
};

const OUTCOME_LABEL: Record<string, string> = {
    black_win: "先手の勝ち",
    white_win: "後手の勝ち",
    draw: "引き分け",
};

const RESULT_BY_OUTCOME: Record<string, string> = {
    black_win: "WIN_BLACK",
    white_win: "WIN_WHITE",
};

const formatInt = (value: number): string => Math.round(value).toLocaleString("en-US");

const formatSeconds = (ms: number): string => {
    const seconds = ms / 1000;
    return Number.isInteger(seconds) ? `${seconds}秒` : `${seconds.toFixed(1)}秒`;
};

/** 1 手の探索の情報を、コメントの 1 行にする（例: `▲base 深さ 31/62・ノード 545,354,529・…`）。 */
export function selfplayMoveComment(info: SelfplayJsonlMoveInfo, turn: "b" | "w"): string {
    const parts: string[] = [];
    if (info.depth !== undefined) {
        parts.push(`深さ ${info.depth}${info.seldepth !== undefined ? `/${info.seldepth}` : ""}`);
    }
    if (info.nodes !== undefined) parts.push(`ノード ${formatInt(info.nodes)}`);
    if (info.nps !== undefined) parts.push(`NPS ${formatInt(info.nps)}`);
    if (info.timeMs !== undefined) parts.push(`探索 ${formatSeconds(info.timeMs)}`);
    if (parts.length === 0) return "";
    const mark = turn === "b" ? "▲" : "△";
    return `${mark}${info.engine ?? ""} ${parts.join("・")}`;
}

const timeControlLabel = (settings: SelfplayJsonlMeta["settings"]): string | undefined => {
    const btime = settings.btime;
    if (typeof btime !== "number") return undefined;
    const wtime = typeof settings.wtime === "number" ? settings.wtime : btime;
    const binc = typeof settings.binc === "number" ? settings.binc : 0;
    const winc = typeof settings.winc === "number" ? settings.winc : binc;
    const byoyomi = typeof settings.byoyomi === "number" ? settings.byoyomi : 0;
    const side = (time: number, inc: number): string =>
        `${formatSeconds(time)}${inc > 0 ? `+${formatSeconds(inc)}` : ""}${byoyomi > 0 ? ` 秒読み${formatSeconds(byoyomi)}` : ""}`;
    const black = side(btime, binc);
    const white = side(wtime, winc);
    return black === white ? black : `先手 ${black} / 後手 ${white}`;
};

const searchSettingsLabel = (settings: SelfplayJsonlMeta["settings"]): string | undefined => {
    const parts: string[] = [];
    if (typeof settings.threads === "number") parts.push(`${settings.threads} スレッド`);
    if (typeof settings.hash_mb === "number") parts.push(`ハッシュ ${settings.hash_mb} MB`);
    if (typeof settings.max_moves === "number") parts.push(`最大 ${settings.max_moves} 手`);
    return parts.length > 0 ? parts.join("・") : undefined;
};

const baseName = (path: string | undefined): string | undefined =>
    path?.split(/[\\/]/).filter(Boolean).at(-1);

const engineFor = (
    meta: SelfplayJsonlMeta | undefined,
    label: string | undefined,
): SelfplayJsonlEngine | undefined => {
    if (!meta || !label) return undefined;
    if (meta.black?.label === label) return meta.black;
    if (meta.white?.label === label) return meta.white;
    return undefined;
};

/** 両エンジンの USI オプションのうち、値の違うもの（`base: X=1 / test: X=2`）。 */
const optionsDiffLabel = (
    a: SelfplayJsonlEngine,
    b: SelfplayJsonlEngine,
): { diff: string; common: string[] } => {
    const toMap = (options: string[]) =>
        new Map(options.map((option) => [option.split("=")[0] ?? option, option] as const));
    const mapA = toMap(a.options);
    const mapB = toMap(b.options);
    const names = [...new Set([...mapA.keys(), ...mapB.keys()])];
    const onlyA: string[] = [];
    const onlyB: string[] = [];
    const common: string[] = [];
    for (const name of names) {
        const optionA = mapA.get(name);
        const optionB = mapB.get(name);
        if (optionA !== undefined && optionA === optionB) {
            common.push(optionA);
            continue;
        }
        if (optionA !== undefined) onlyA.push(optionA);
        if (optionB !== undefined) onlyB.push(optionB);
    }
    const diff =
        onlyA.length + onlyB.length === 0
            ? "なし（両者同じ）"
            : `${a.label ?? "先手"}: ${onlyA.join(", ") || "（なし）"} / ${b.label ?? "後手"}: ${onlyB.join(", ") || "（なし）"}`;
    return { diff, common };
};

const utf8Bytes = (text: string): number => new TextEncoder().encode(text).length;

/** 上限に収まるよう、末尾を落として「…」を付ける。 */
const truncateUtf8 = (text: string, maxBytes: number): string => {
    if (utf8Bytes(text) <= maxBytes) return text;
    const budget = maxBytes - utf8Bytes("…");
    let used = 0;
    let kept = "";
    for (const char of text) {
        const size = utf8Bytes(char);
        if (used + size > budget) break;
        used += size;
        kept += char;
    }
    return `${kept}…`;
};

/** 1 局の対局条件と結果を、研究ノートの `meta` にする。 */
export function selfplayGameMeta(
    game: SelfplayJsonlGame,
    meta: SelfplayJsonlMeta | undefined,
    sourceName?: string,
): StudyMeta {
    const out: StudyMeta = {};
    if (game.senteName) out.blackName = game.senteName;
    if (game.goteName) out.whiteName = game.goteName;
    if (meta?.timestamp) out.playedAt = meta.timestamp;
    out.event = `連続対局 第${game.gameId}局${sourceName ? `（${sourceName}）` : ""}`;
    if (game.result) {
        const result = RESULT_BY_OUTCOME[game.result.outcome];
        if (result) out.result = result;
        const outcome = OUTCOME_LABEL[game.result.outcome] ?? game.result.outcome;
        const reason = REASON_LABEL[game.result.reason] ?? game.result.reason;
        out.termination = `${game.moves.length}手で${outcome}（${reason}）`;
    }
    if (meta) {
        const timeControl = timeControlLabel(meta.settings);
        if (timeControl) out.timeControl = timeControl;
        const search = searchSettingsLabel(meta.settings);
        if (search) out.searchSettings = search;
    }
    const sente = engineFor(meta, game.senteName);
    const gote = engineFor(meta, game.goteName);
    const senteEngine = baseName(sente?.path);
    const goteEngine = baseName(gote?.path);
    if (senteEngine) out.blackEngine = senteEngine;
    if (goteEngine) out.whiteEngine = goteEngine;
    if (sente && gote) {
        const { diff, common } = optionsDiffLabel(sente, gote);
        out.engineOptionsDiff = diff;
        if (common.length > 0) out.engineOptions = common.join(", ");
    }
    // meta 全体の上限に収まるよう、いちばん長くなりうる共通オプションを切り詰める。
    if (out.engineOptions) {
        const rest = utf8Bytes(JSON.stringify({ ...out, engineOptions: "" }));
        out.engineOptions = truncateUtf8(out.engineOptions, STUDY_LIMITS.metaBytes - rest - 64);
    }
    return out;
}

interface StudySelfplayImportInput {
    id: string;
    game: SelfplayJsonlGame;
    meta?: SelfplayJsonlMeta;
    origin: StudyOrigin;
    /** 取り込んだファイルの名前など。`event` に添える。 */
    sourceName?: string;
}

/**
 * 連続対局の 1 局から研究ノートの文書を作る。指し手が開始局面から指せるかは
 * `createStudyDocumentFromMoves` と同じく駒の有無までしか見ないので、先に手順を再生して確かめること。
 */
export function createStudyDocumentFromSelfplayGame(
    input: StudySelfplayImportInput,
): StudyDocument {
    const { game } = input;
    const startTurn = game.startSfen.split(/\s+/)[1] === "w" ? "w" : "b";
    const turnOf = (index: number): "b" | "w" =>
        (index % 2 === 0) === (startTurn === "b") ? "b" : "w";
    const annotations = game.infos.map((info): StudyImportAnnotation | null => {
        const score =
            info.mate !== undefined
                ? { kind: "mate" as const, winner: info.mate.winner, plies: info.mate.plies }
                : info.evalCp !== undefined
                  ? { kind: "cp" as const, value: info.evalCp }
                  : null;
        if (score === null && info.pv === undefined && info.elapsedMs === undefined) return null;
        return { score, pv: info.pv ?? null, elapsedMs: info.elapsedMs ?? null };
    });
    const comments = game.infos.map((info, index) => selfplayMoveComment(info, turnOf(index)));
    const names =
        game.senteName && game.goteName ? `${game.senteName} 対 ${game.goteName}` : "連続対局";
    return createStudyDocumentFromMoves({
        id: input.id,
        title: `${names}（第${game.gameId}局）`,
        origin: input.origin,
        startSfen: game.startSfen,
        moves: game.moves,
        annotations,
        comments,
        sourceKind: SELFPLAY_JSONL_SOURCE_KIND,
        meta: selfplayGameMeta(game, input.meta, input.sourceName),
    });
}
