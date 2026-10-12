/**
 * 実行時の評価値と保存用の評価値（`StudyScore`、常に先手視点）の変換。
 *
 * 実行時の `KifuEval` は `normalized` フラグで「先手視点」と「手番側視点（エンジン出力）」が
 * 混在する。保存の境界でここを通し、先手視点に揃える。手番側視点の値の向きは、解析した局面の
 * 実際の手番（`sideToMove`）で決める。手数の偶奇には頼らない（後手番から始まる棋譜でずれるため）。
 */

import type { Player } from "../game/board";
import type { KifuEval } from "../game/kifu-tree";
import type { StudyScore } from "./types";

/**
 * 既存 API（`analysis-snapshots` など）が「手数不明の詰み」を表すのに使う値。
 * `evalMate = ±100000`。符号は勝つ側（先手視点）。
 */
export const STUDY_LEGACY_MATE_WITHOUT_PLY = 100_000;

const opponentOf = (player: Player): Player => (player === "sente" ? "gote" : "sente");

/** 手数不明の詰み（実行時の ±Infinity、既存 API の ±100000 以上）なら null、それ以外は手数。 */
const matePlies = (mate: number): number | null => {
    const abs = Math.abs(mate);
    if (!Number.isFinite(abs) || abs >= STUDY_LEGACY_MATE_WITHOUT_PLY) return null;
    return Math.round(abs);
};

const cpScore = (value: number): StudyScore => {
    const rounded = Math.round(value);
    // -0 を 0 にする。
    return { kind: "cp", value: rounded === 0 ? 0 : rounded };
};

/**
 * 実行時の `KifuEval` を保存用の評価値にする。評価値が無ければ null（0 で代用しない）。
 *
 * @param evalData 実行時の評価値
 * @param sideToMove 解析した局面（そのノードの手を指した後の局面）の手番
 */
export function kifuEvalToStudyScore(
    evalData: Pick<KifuEval, "scoreCp" | "scoreMate" | "normalized"> | null | undefined,
    sideToMove: Player,
): StudyScore | null {
    if (!evalData) return null;
    const { scoreCp, scoreMate } = evalData;
    const alreadySente = evalData.normalized === true;

    if (scoreMate !== undefined && scoreMate !== null && !Number.isNaN(scoreMate)) {
        if (alreadySente) {
            // 先手視点で 0 手の詰みは、どちらが勝ちか決められない。
            if (scoreMate === 0) return null;
            return {
                kind: "mate",
                winner: scoreMate > 0 ? "sente" : "gote",
                plies: matePlies(scoreMate),
            };
        }
        // エンジン出力（手番側視点）。`mate 0` は手番側が既に詰んでいる。
        const winner = scoreMate > 0 ? sideToMove : opponentOf(sideToMove);
        return { kind: "mate", winner, plies: matePlies(scoreMate) };
    }

    if (scoreCp !== undefined && scoreCp !== null && Number.isFinite(scoreCp)) {
        const sign = alreadySente || sideToMove === "sente" ? 1 : -1;
        return cpScore(scoreCp * sign);
    }

    return null;
}

/**
 * 保存用の評価値を実行時の `KifuEval` の評価値部分にする（先手視点、`normalized: true`）。
 * 手数不明の詰みは実行時の表現（±Infinity）にする。
 */
export function studyScoreToKifuEval(
    score: StudyScore | null,
): Pick<KifuEval, "scoreCp" | "scoreMate" | "normalized"> | undefined {
    if (!score) return undefined;
    if (score.kind === "cp") return { scoreCp: score.value, normalized: true };
    const sign = score.winner === "sente" ? 1 : -1;
    if (score.plies === null) {
        return { scoreMate: sign * Number.POSITIVE_INFINITY, normalized: true };
    }
    // 先手視点の 0 手の詰みは符号で勝者を表せないので、手数不明として渡す。
    if (score.plies === 0) {
        return { scoreMate: sign * Number.POSITIVE_INFINITY, normalized: true };
    }
    return { scoreMate: sign * score.plies, normalized: true };
}

/**
 * 既存 API の評価値（先手視点の `evalCp` / `evalMate`。`evalMate = ±100000` は手数不明の詰み）を
 * 保存用の評価値にする。
 */
export function legacyEvalToStudyScore(legacy: {
    evalCp?: number | null;
    evalMate?: number | null;
}): StudyScore | null {
    return kifuEvalToStudyScore(
        {
            scoreCp: legacy.evalCp ?? undefined,
            scoreMate: legacy.evalMate ?? undefined,
            normalized: true,
        },
        "sente",
    );
}

/** 保存用の評価値を既存 API の表現にする。手数不明の詰みは `evalMate = ±100000`。 */
export function studyScoreToLegacyEval(score: StudyScore | null): {
    evalCp: number | null;
    evalMate: number | null;
} {
    if (!score) return { evalCp: null, evalMate: null };
    if (score.kind === "cp") return { evalCp: score.value, evalMate: null };
    const sign = score.winner === "sente" ? 1 : -1;
    const plies =
        score.plies === null || score.plies === 0 ? STUDY_LEGACY_MATE_WITHOUT_PLY : score.plies;
    return { evalCp: null, evalMate: sign * plies };
}
