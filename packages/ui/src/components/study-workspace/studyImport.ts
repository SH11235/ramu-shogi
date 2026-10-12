/**
 * 貼り付け・ファイルの棋譜テキストを、研究ノートを作る材料にする。
 *
 * 形式の判別と解析は既存の棋譜取り込み（`kifuImport` / `kifParser`）と同じものを使う。
 * 指し手の無い入力（局面だけ）も受け付ける（その局面から検討を始めるノートになる）。
 * 変則ルール（パス）の手を含む棋譜は研究ノートにできない。
 */

import {
    isStudyUsiMove,
    kifuEvalToStudyScore,
    normalizeStudyStartSfen,
    parseCsaGameRecord,
    type StudyImportAnnotation,
} from "@shogi/app-core";
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
        try {
            const record = parseCsaGameRecord(text);
            assertStandardMoves(record.moves);
        } catch (error) {
            throw new Error(
                `CSA の解析に失敗しました: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
        return { kind: "csa", csa: text };
    }
    if (format === "kif") {
        const result = parseKif(text);
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
        isPosition = sfen !== "" && normalizeStudyStartSfen(sfen) !== "";
    } catch {
        isPosition = false;
    }
    if (!isPosition) {
        throw new Error("棋譜の形式を判別できませんでした（CSA / KIF / SFEN に対応）");
    }
    assertStandardMoves(moves);
    return { kind: "moves", startSfen: sfen, moves };
}
