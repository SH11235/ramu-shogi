import type { GameResult } from "@shogi/match-client";

const GAME_END_REASONS: Record<string, string> = {
    resign: "投了",
    checkmate: "詰み",
    timeout: "時間切れ",
    sennichite: "千日手",
    oute_sennichite: "連続王手の千日手",
    illegal_move: "反則",
    disconnect: "切断不戦敗",
};

export function formatGameResultTitle(
    result: GameResult,
    playerNames: { b: string; w: string },
): string {
    const winnerName =
        result.winner === "b" ? playerNames.b : result.winner === "w" ? playerNames.w : null;
    return winnerName ? `${winnerName} の勝ち` : "引き分け";
}

export function formatGameEndReason(result: GameResult): string {
    return GAME_END_REASONS[result.reason] ?? result.reason;
}
