/**
 * 貼り付け・ファイルの棋譜テキストを、研究ノートを作る材料にする。
 *
 * 形式の判別と解析は既存の棋譜取り込み（`kifuImport` / `kifParser`）と同じものを使う。
 * 指し手の無い入力（局面だけ）も受け付ける（その局面から検討を始めるノートになる）。指し手が
 * あれば手順の再生で局面も確かめられるが、局面だけのときは確かめる機会が無いので、ここで
 * 局面として成り立つこと（`studyStartPositionError`）を確かめる。
 * 変則ルール（パス）の手を含む棋譜は研究ノートにできない。
 */

import {
    isStudyUsiMove,
    kifuEvalToStudyScore,
    normalizeStudyStartSfen,
    parseCsaGameRecord,
    parseStudySfen,
    type StudyImportAnnotation,
} from "@shogi/app-core";
import { validateEditedPosition } from "../shogi-match/utils/boardUtils";
import { parseKif, parseSfen } from "../shogi-match/utils/kifParser";
import { detectKifuTextFormat } from "../shogi-match/utils/kifuImport";

/** 研究ノートを作る材料。 */
export type StudyKifuSource =
    /** CSA 棋譜の全文（対局者名・評価値・読み筋・消費時間ごと取り込む）。 */
    | { kind: "csa"; csa: string }
    /** 開始局面と本譜の手順（KIF・SFEN）。 */
    | {
          kind: "moves";
          startSfen: string;
          moves: string[];
          /** `moves` と同じ順の、棋譜に付いていた評価値・消費時間。無ければ省略。 */
          annotations?: (StudyImportAnnotation | null)[];
          /** `annotations` の出どころ（`source.kind`）。 */
          sourceKind?: string;
      };

/**
 * 指し手の無いノートの開始局面が、局面として成り立つかを確かめる。基準は対局画面の局面編集と
 * 同じ（玉が先手・後手に 1 枚ずつ、駒は一組の枚数まで）。二歩などは見ない。
 * 成り立てば null、成り立たなければ理由。
 */
export function studyStartPositionError(startSfen: string): string | null {
    try {
        return validateEditedPosition(parseStudySfen(normalizeStudyStartSfen(startSfen)));
    } catch {
        return "局面を読み取れませんでした。";
    }
}

/** 局面だけの入力を、研究ノートの材料にする。局面として成り立たなければ断る。 */
const positionOnlySource = (startSfen: string): StudyKifuSource => {
    const reason = studyStartPositionError(startSfen);
    if (reason) throw new Error(`この局面は研究ノートにできません: ${reason}`);
    return { kind: "moves", startSfen: normalizeStudyStartSfen(startSfen), moves: [] };
};

/** CSA の局面の行（`PI`・`P1`〜`P9`・`P+`・`P-`）があるか。行の分け方は CSA の解析と同じ。 */
const hasCsaPositionLine = (text: string): boolean =>
    text
        .split(/\r?\n/)
        .filter((line) => !line.trimStart().startsWith("'"))
        .flatMap((line) => line.split(","))
        .some((statement) => /^P(?:I|[1-9]|[+-])/.test(statement.trim()));

/** KIF の、指し手ではない行（空行・コメント・見出し・手数の区切り・「まで〜」）か。 */
const isKifNonMoveLine = (line: string): boolean => {
    const trimmed = line.trim();
    return (
        trimmed === "" ||
        trimmed.startsWith("#") ||
        trimmed.startsWith("*") ||
        trimmed.startsWith("手数") ||
        trimmed.startsWith("まで") ||
        // 見出し（「先手：〜」など）。指し手の行の消費時間（`0:00`）を見出しと取り違えないよう、
        // 数字・記号で始まる行と、コロンの前に空白がある行は見出しにしない。
        /^[^\d０-９\s▲△☗☖][^：:\s]*[：:]/.test(trimmed)
    );
};

/**
 * KIF が「開始局面だけ」の入力か。開始局面が明示されていて、指し手ではない行しか無いとき。
 * それ以外の行がある（指し手らしい行があるのに 1 つも読めなかった）棋譜は、局面だけの入力と
 * しては扱わない（指し手を黙って捨てない）。
 */
const isKifPositionOnly = (text: string): boolean =>
    /^\s*開始局面[：:]/m.test(text) && text.split(/\r?\n/).every(isKifNonMoveLine);

const assertStandardMoves = (moves: readonly string[]): void => {
    const index = moves.findIndex((move) => !isStudyUsiMove(move));
    if (index >= 0) {
        throw new Error(
            `${index + 1} 手目（${moves[index]}）は研究ノートにできない手です（パスなどの変則ルールには対応していません）`,
        );
    }
};

/**
 * 棋譜テキストを判別して、研究ノートの材料にする。失敗時は利用者向けの文言で例外を投げる。
 */
export function parseKifuTextForStudy(text: string): StudyKifuSource {
    if (!text.trim()) {
        throw new Error("入力が空です");
    }
    const format = detectKifuTextFormat(text);
    if (format === "csa") {
        let record: ReturnType<typeof parseCsaGameRecord>;
        try {
            record = parseCsaGameRecord(text);
            assertStandardMoves(record.moves);
        } catch (error) {
            throw new Error(
                `CSA の解析に失敗しました: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
        if (record.moves.length === 0) {
            // 局面の行も無い（対局者名などの見出しだけ）ものは、棋譜として読めていない。
            if (!hasCsaPositionLine(text)) throw new Error("指し手がありません");
            return positionOnlySource(record.startSfen);
        }
        return { kind: "csa", csa: text };
    }
    if (format === "kif") {
        const result = parseKif(text);
        // 開始局面だけが書かれていれば、その局面から始めるノートにする。
        if (result.moves.length === 0 && result.startSfen && isKifPositionOnly(text)) {
            return positionOnlySource(result.startSfen);
        }
        if (!result.success) {
            throw new Error(result.error ?? "KIF の解析に失敗しました");
        }
        assertStandardMoves(result.moves);
        const annotations = result.moveData.map((data): StudyImportAnnotation | null => {
            // KIF の評価値コメントは先手視点。
            const score = kifuEvalToStudyScore(
                { scoreCp: data.evalCp, scoreMate: data.evalMate, normalized: true },
                "sente",
            );
            if (score === null && data.elapsedMs === undefined) return null;
            return { score, elapsedMs: data.elapsedMs ?? null };
        });
        return {
            kind: "moves",
            startSfen: result.startSfen ?? "startpos",
            moves: result.moves,
            ...(annotations.some((annotation) => annotation !== null)
                ? { annotations, sourceKind: "kif" }
                : {}),
        };
    }
    const { sfen, moves } = parseSfen(text);
    // CSA でも KIF でもない入力は SFEN として読む。開始局面として読めなければ、棋譜ではない。
    let isPosition = false;
    try {
        isPosition = sfen !== "" && parseStudySfen(normalizeStudyStartSfen(sfen)) !== null;
    } catch {
        isPosition = false;
    }
    if (!isPosition) {
        throw new Error("棋譜の形式を判別できませんでした（CSA / KIF / SFEN に対応）");
    }
    if (moves.length === 0) return positionOnlySource(sfen);
    assertStandardMoves(moves);
    return { kind: "moves", startSfen: sfen, moves };
}
