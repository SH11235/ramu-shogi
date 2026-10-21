import { isKingInCheck, type PositionState, parseMove } from "@shogi/app-core";
import type { MoveScene } from "./dogSound";

/** 指し手がどの場面の音を鳴らすか。王手 > 駒取り > 成り > 通常 */
export function moveSoundScene(
    before: PositionState,
    move: string,
    after: PositionState,
): MoveScene {
    if (isKingInCheck(after)) return "check";
    const parsed = parseMove(move);
    if (parsed?.kind !== "move") return "move";
    if (before.board[parsed.to]) return "capture";
    return parsed.promote ? "promote" : "move";
}

// CPU 側から見てこれ以下なら劣勢とする（詰みを読まれた負けも含む）
const CPU_LOSING_CP = -1000;

/** 対局エンジンの探索結果（手番側＝エンジンから見た値）で、CPU が劣勢か */
export function isCpuLosing(stats: { scoreCp?: number; scoreMate?: number } | undefined): boolean {
    if (!stats) return false;
    // 詰まされた側は mate -0 を出すことがある
    if (stats.scoreMate !== undefined) return stats.scoreMate < 0 || Object.is(stats.scoreMate, -0);
    return stats.scoreCp !== undefined && stats.scoreCp <= CPU_LOSING_CP;
}
