/**
 * 棋譜の取り込み (貼り付け・ファイル) で使う純粋関数。
 *
 * 形式の自動判別 (CSA / KIF / SFEN)、ファイルの文字コード判別、
 * CSA の付随情報から検討用データへの変換を置く。サーバーには何も送らない。
 */

import { type CsaMoveAnnotation, parseCsaGameRecord } from "@shogi/app-core";
import type { ReviewMoveEval } from "../hooks/useKifuImportExport";
import { MATE_WITHOUT_PLY } from "./kifFormat";
import { type KifMoveData, parseKif, parseSfen } from "./kifParser";

/** SFEN (開始局面 + 指し手) を盤面へ取り込むコールバック。 */
export type ImportSfenHandler = (
    sfen: string,
    moves: string[],
    options?: {
        moveData?: (ReviewMoveEval | undefined)[];
        /** 棋譜に書かれていた対局者名（CSA の `N+` / `N-`）。 */
        players?: { sente?: string; gote?: string };
    },
) => Promise<void>;

/** KIF を盤面へ取り込むコールバック。 */
export type ImportKifHandler = (
    moves: string[],
    moveData: KifMoveData[],
    startSfen?: string,
) => Promise<void>;

/** 読み込む棋譜ファイルの大きさの上限。棋譜は大きくても数百 KB なので 2MB で足りる。 */
export const MAX_KIFU_FILE_BYTES = 2 * 1024 * 1024;

/** ファイル選択で受け付ける拡張子。 */
export const KIFU_FILE_ACCEPT = ".csa,.kif,.kifu,.sfen,.txt";

/**
 * CSA の付随情報を `initialReview.moveData` / `importSfen` の形にする。
 * 詰みは手数が分からないので、手数不明の詰み (±Infinity) として渡す。
 */
export function csaAnnotationsToMoveData(
    annotations: (CsaMoveAnnotation | undefined)[],
): (ReviewMoveEval | undefined)[] {
    return annotations.map((annotation) => {
        if (!annotation) return undefined;
        const data: ReviewMoveEval = {};
        if (annotation.elapsedMs !== undefined) data.elapsedMs = annotation.elapsedMs;
        if (annotation.evalCp !== undefined) data.evalCp = annotation.evalCp;
        if (annotation.mateWinner !== undefined) {
            data.evalMate =
                annotation.mateWinner === "sente" ? MATE_WITHOUT_PLY : -MATE_WITHOUT_PLY;
        }
        if (annotation.pv) data.pv = annotation.pv;
        return data;
    });
}

type KifuTextFormat = "csa" | "kif" | "sfen";

const CSA_MOVE_LINE = /^[+-]\d{4}[A-Z]{2}(?:,.*)?$/m;
const CSA_HEADER_LINE = /^(?:V\d[\d.]*|PI|P[1-9][ +\-*A-Z]*|N[+-].*)$/m;
/**
 * CSA の開始局面の行。指し手も `V` 行も無い「局面だけ」の CSA をこれで見分ける。
 * - `PI` (平手。`PI82HI22KA` のような駒落ち指定つきも)
 * - `P1`〜`P9` (1 マス 3 文字の一括表現: ` * ` か `+FU` / `-KY`)
 * - `P+` / `P-` (駒別表現: `63FU`、持ち駒 `00KA`、`00AL`)
 * 行全体がこの形のときだけ一致する。SFEN の盤面は `/` で区切るので一致しない。
 */
const CSA_SETUP_LINE =
    /^(?:PI(?:\d{2}[A-Z]{2})*|P[1-9](?: \* ?|[+-][A-Z]{2}){1,9}|P[+-](?:\d{2}[A-Z]{2})+)[ \t]*$/m;

/** 貼り付け・ファイルのテキストがどの形式かを判別する。 */
export function detectKifuTextFormat(text: string): KifuTextFormat {
    const normalized = text.replace(/\r\n?/g, "\n");
    // CSA は指し手行 (`+7776FU`) が決め手。指し手の無い棋譜はヘッダーか局面の行で見る。
    if (CSA_MOVE_LINE.test(normalized)) return "csa";
    const looksLikeKif =
        /#KIF|手数----|開始日時|終了日時|手合割|開始局面|先手：|後手：|持ち時間|表題|棋戦/.test(
            normalized,
        ) ||
        /[▲△☗☖]/.test(normalized) ||
        /[１２３４５６７８９1-9][一二三四五六七八九].*(歩|香|桂|銀|金|角|飛|玉|王|と|馬|龍|竜)/.test(
            normalized,
        );
    if (looksLikeKif) return "kif";
    if (/^V\d/m.test(normalized) && CSA_HEADER_LINE.test(normalized)) return "csa";
    if (CSA_SETUP_LINE.test(normalized)) return "csa";
    return "sfen";
}

/**
 * 棋譜テキストを判別して取り込む。失敗時は利用者向けの文言で例外を投げる。
 * CSA は評価値・読み筋・消費時間も一緒に取り込む。
 */
export async function importKifuText(
    text: string,
    handlers: { onImportSfen: ImportSfenHandler; onImportKif: ImportKifHandler },
): Promise<void> {
    if (!text.trim()) {
        throw new Error("入力が空です");
    }
    const format = detectKifuTextFormat(text);
    if (format === "csa") {
        let record: ReturnType<typeof parseCsaGameRecord>;
        try {
            record = parseCsaGameRecord(text);
        } catch (error) {
            throw new Error(
                `CSA の解析に失敗しました: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
        // 開始局面は平手なら "startpos"、駒落ち・途中局面ならその SFEN。
        await handlers.onImportSfen(record.startSfen, record.moves, {
            moveData: csaAnnotationsToMoveData(record.annotations),
            // 対局者名が書かれている棋譜だけ渡す（無い棋譜では、従来と同じ引数のままにする）。
            ...(record.senteName || record.goteName
                ? { players: { sente: record.senteName, gote: record.goteName } }
                : {}),
        });
        return;
    }
    if (format === "kif") {
        const result = parseKif(text);
        if (!result.success) {
            throw new Error(result.error ?? "KIFのパースに失敗しました");
        }
        await handlers.onImportKif(result.moves, result.moveData, result.startSfen);
        return;
    }
    const { sfen, moves } = parseSfen(text);
    if (!sfen) {
        throw new Error("SFENの形式が正しくありません");
    }
    await handlers.onImportSfen(sfen, moves);
}

/**
 * 棋譜ファイルの中身を文字列にする。
 *
 * UTF-8 として正しく読めればそれを使い、読めなければ Shift_JIS として読む
 * (KIF / CSA は Shift_JIS で保存されていることが多い)。先頭の BOM は落とす。
 */
export function decodeKifuFileBytes(bytes: ArrayBuffer | Uint8Array): string {
    try {
        return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
        return new TextDecoder("shift_jis").decode(bytes);
    }
}
