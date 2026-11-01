import { createContext, type ReactElement, type ReactNode, useContext } from "react";

type MatchPlayers = "human_ai" | "ai_ai" | "human_human";
type KifuFormat = "kif" | "ki2" | "csa" | "sfen" | "usi" | "url" | "other";

/**
 * 画面から送れる利用状況のイベントと項目。Web の受け口が検証する形と同じにする
 * （食い違いは Web 側の型のテストで検出する）。対局の時間は、送る側のアプリが開始の時刻から足す。
 */
export type UsageEvents = {
    match_start: {
        players: MatchPlayers;
        /** 配布 AI の presetKey、組み込みの駒得 AI は "material"、利用者が入れた NNUE は "custom" */
        ai?: string;
        time?: "none" | "byoyomi" | "fischer" | "sudden";
        start?: "even" | "handicap" | "position";
    };
    match_end: {
        /** 人と AI の対局では人から見た結果、それ以外は勝った側 */
        result: "win" | "loss" | "draw" | "abort" | "sente_win" | "gote_win";
        reason?:
            | "checkmate"
            | "resignation"
            | "time_expired"
            | "win_declaration"
            | "repetition"
            | "illegal_move"
            | "abort"
            | "other";
        plies: number;
    };
    hint_request: Record<string, never>;
    analysis_start: { kind: "single" | "batch" };
    kifu_import: { format: KifuFormat };
    kifu_export: { format: KifuFormat };
    nnue_download: { ai: string };
};

export type UsageTracker = <E extends keyof UsageEvents>(event: E, props: UsageEvents[E]) => void;

const noop: UsageTracker = () => {};

// 既定では何も送らない。送るアプリ（Web）だけが Provider で送り先を渡す
const UsageContext = createContext<UsageTracker>(noop);

export function UsageTrackingProvider({
    track,
    children,
}: {
    track: UsageTracker;
    children: ReactNode;
}): ReactElement {
    return <UsageContext.Provider value={track}>{children}</UsageContext.Provider>;
}

export function useUsageTracker(): UsageTracker {
    return useContext(UsageContext);
}
