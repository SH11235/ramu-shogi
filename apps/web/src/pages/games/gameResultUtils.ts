import type { GameRecordSummary } from "@shogi/api-contract";

export const RESULT_REASON_LABELS: Record<string, string> = {
    resign: "投了",
    timeout: "時間切れ",
    sennichite: "千日手",
    disconnect: "切断",
    checkmate: "詰み",
    illegal_move: "反則",
};

export function formatGameResult(game: GameRecordSummary): string {
    if (!game.result) return "結果不明";
    const reason = RESULT_REASON_LABELS[game.result.reason] ?? game.result.reason;
    if (!game.result.winner) {
        return `引き分け (${reason})`;
    }

    const winner = game.participants.find(
        (participant) => participant.seat === game.result?.winner,
    );
    return `${winner?.displayNameSnapshot ?? (game.result.winner === "b" ? "先手" : "後手")} 勝ち (${reason})`;
}
