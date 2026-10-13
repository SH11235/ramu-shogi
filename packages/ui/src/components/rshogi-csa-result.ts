import type { Player } from "@shogi/app-core";
import type { RshogiGameResult } from "@shogi/match-client";

/** CSA の投了記録は保持し、勝敗と最終局面が一致するときだけ詰みと表示する。 */
export function resolveDisplayedResult(
    result: RshogiGameResult | undefined,
    checkmatedSide: Player | undefined,
): RshogiGameResult | undefined {
    if (
        result?.kind === "resignation" &&
        result.endReason === "RESIGN" &&
        checkmatedSide !== undefined &&
        result.winner === (checkmatedSide === "sente" ? "gote" : "sente")
    ) {
        return { ...result, kind: "checkmate" };
    }
    return result;
}
