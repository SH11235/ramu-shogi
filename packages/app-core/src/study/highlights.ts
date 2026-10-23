/**
 * 注目局面の計算（設計書 7.5）。
 *
 * 表示中のレイヤーで、手を指す前の局面（親ノード）と指した後の局面（そのノード）の評価値を
 * 比べ、落差の大きい手を拾う。検出結果は保存せず、表示のたびに計算する。
 */

import { isStudyPassMove } from "./pass";
import { parseStudySfen } from "./sfen";
import type { StudyAnalysisResult, StudyDocument, StudyPlayer, StudyScore } from "./types";

/** 評価値を勝率相当の値に直す式の名前。 */
export const STUDY_WIN_RATE_MODEL = "logistic-cp-v1";
/** `logistic-cp-v1` の係数。初期値で、実データで見直す。 */
export const STUDY_WIN_RATE_SCALE_CP = 600;
/** 落差がこの値以上なら「悪手」。 */
export const STUDY_BLUNDER_DROP = 0.2;
/** 落差がこの値以上なら「疑問手」。 */
export const STUDY_DUBIOUS_DROP = 0.1;

/**
 * 評価値（先手視点）を先手の勝率相当の値（0〜1）に直す（`logistic-cp-v1`）。
 * `P先手(cp) = 1 / (1 + exp(-cp / 600))`。詰みは勝者側を 1、反対側を 0 とする。
 */
export function studyScoreToSenteWinRate(score: StudyScore): number {
    if (score.kind === "mate") return score.winner === "sente" ? 1 : 0;
    return 1 / (1 + Math.exp(-score.value / STUDY_WIN_RATE_SCALE_CP));
}

export type StudyHighlightKind = "blunder" | "dubious";

export interface StudyHighlight {
    /** 注目する手のノード（その手を指した後の局面）。 */
    nodeId: string;
    /** 手を指す前の局面のノード。ルートは null。 */
    parentId: string | null;
    /** ルートからの手数（ルート = 0）。 */
    ply: number;
    /** USI の指し手。ルートは null。 */
    usiMove: string | null;
    /** その手を指した側。ルートは null。 */
    mover: StudyPlayer | null;
    /** 本譜（各ノードの先頭の子をたどった手順）の上にあるか。 */
    isMainLine: boolean;
    /** 悪手・疑問手の判定。評価値で拾われていなければ null（しおり・コメントだけの手）。 */
    kind: StudyHighlightKind | null;
    /** 指した側から見た勝率相当の値の落差。親か子が未解析なら null。 */
    drop: number | null;
    /** 手を指す前の局面の評価値（先手視点）。未解析なら null。 */
    scoreBefore: StudyScore | null;
    /** 手を指した後の局面の評価値（先手視点）。未解析なら null。 */
    scoreAfter: StudyScore | null;
    hasComment: boolean;
}

const bestScore = (
    results: Record<string, StudyAnalysisResult> | undefined,
    nodeId: string,
): StudyScore | null => {
    if (!results || !Object.hasOwn(results, nodeId)) return null;
    const { candidates } = results[nodeId];
    const best = candidates.find((candidate) => candidate.rank === 1) ?? candidates[0];
    return best?.score ?? null;
};

/**
 * 注目局面の一覧を作る。
 *
 * - 落差は、先手の手なら `P(親) − P(子)`、後手の手なら `P(子) − P(親)`。
 * - 落差 0.20 以上を悪手、0.10 以上を疑問手とし、落差の大きい順に並べる。
 * - 親か子のどちらかが未解析なら判定しない（補間も 0 での代用もしない）。
 * - 同じ勝者の詰みで手数が変わっただけのものは拾わない。
 * - 対局時の評価値（`source`）は判定に使わない。
 * - しおり・コメントのある手は、評価値が無くても一覧に入れる（落差で拾った手のあとに、手順の順）。
 *
 * @param layerId 表示中のレイヤー。null・該当なしなら評価値による判定はしない。
 */
export function computeStudyHighlights(
    doc: StudyDocument,
    layerId: string | null,
): StudyHighlight[] {
    const results =
        layerId === null ? undefined : doc.layers.find((layer) => layer.id === layerId)?.results;
    const startTurn = parseStudySfen(doc.startSfen).turn;
    const { nodes, rootId } = doc.tree;

    const judged: StudyHighlight[] = [];
    const marked: StudyHighlight[] = [];

    /** `hasPass`: ルートからこのノードの手前までに、パスがあったか。 */
    const stack: Array<{ nodeId: string; ply: number; isMainLine: boolean; hasPass: boolean }> = [
        { nodeId: rootId, ply: 0, isMainLine: true, hasPass: false },
    ];
    const visited = new Set<string>();
    while (stack.length > 0) {
        const item = stack.pop() as (typeof stack)[number];
        if (visited.has(item.nodeId)) continue;
        visited.add(item.nodeId);
        const node = nodes[item.nodeId];
        if (!node) continue;
        for (let i = node.children.length - 1; i >= 0; i--) {
            stack.push({
                nodeId: node.children[i],
                ply: item.ply + 1,
                isMainLine: item.isMainLine && i === 0,
                hasPass: item.hasPass || isStudyPassMove(node.usiMove),
            });
        }

        const isRoot = node.parentId === null;
        // 指した側は、開始局面の手番と手数で決まる（パスも手番を替えるので、偶奇は崩れない）。
        const mover: StudyPlayer | null = isRoot
            ? null
            : (item.ply % 2 === 1) === (startTurn === "sente")
              ? "sente"
              : "gote";
        const scoreAfter = bestScore(results, item.nodeId);
        const scoreBefore = node.parentId === null ? null : bestScore(results, node.parentId);

        let drop: number | null = null;
        let kind: StudyHighlightKind | null = null;
        // 手順の中の最初のパスは、判定しない。パスの前の局面は通常の将棋として、あとの局面は
        // パス権つきとして解析されるので（`studyPassRightsForLine`）、前後の評価値を比べられない。
        const isFirstPass = isStudyPassMove(node.usiMove) && !item.hasPass;
        if (!isFirstPass && mover !== null && scoreBefore !== null && scoreAfter !== null) {
            const before = studyScoreToSenteWinRate(scoreBefore);
            const after = studyScoreToSenteWinRate(scoreAfter);
            drop = mover === "sente" ? before - after : after - before;
            const sameMateWinner =
                scoreBefore.kind === "mate" &&
                scoreAfter.kind === "mate" &&
                scoreBefore.winner === scoreAfter.winner;
            if (!sameMateWinner) {
                if (drop >= STUDY_BLUNDER_DROP) kind = "blunder";
                else if (drop >= STUDY_DUBIOUS_DROP) kind = "dubious";
            }
        }

        const hasComment = node.comment !== "";
        // しおりは画面で付け外しできないので（保存した値は残す）、注目局面には入れない。
        if (kind === null && !hasComment) continue;
        const highlight: StudyHighlight = {
            nodeId: item.nodeId,
            parentId: node.parentId,
            ply: item.ply,
            usiMove: node.usiMove,
            mover,
            isMainLine: item.isMainLine,
            kind,
            drop,
            scoreBefore,
            scoreAfter,
            hasComment,
        };
        if (kind !== null) judged.push(highlight);
        else marked.push(highlight);
    }

    // 落差の大きい順。同じ落差は手順の順（走査した順）を保つ。
    judged.sort((a, b) => (b.drop ?? 0) - (a.drop ?? 0));
    return [...judged, ...marked];
}
