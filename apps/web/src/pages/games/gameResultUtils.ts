import type {
    GameRecordSource,
    GameRecordSummary,
    GameRecordVisibility,
} from "@shogi/api-contract";

/** 公開設定の表示名（API の値をそのまま見せない）。 */
export const VISIBILITY_LABELS: Record<GameRecordVisibility, string> = {
    private: "非公開",
    unlisted: "限定公開",
    public: "公開",
};

/** 棋譜の出どころの表示名。 */
export const SOURCE_LABELS: Record<GameRecordSource, string> = {
    online_room: "オンライン対局",
    local_app: "アプリでの対局",
    import: "取り込み",
    csa_relay: "CSA 中継",
};

const RESULT_REASON_LABELS: Record<string, string> = {
    resign: "投了",
    timeout: "時間切れ",
    sennichite: "千日手",
    oute_sennichite: "連続王手の千日手",
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
