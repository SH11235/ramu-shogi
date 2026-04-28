/**
 * rshogi CSA 棋譜一覧コンポーネント。
 *
 * Web/Desktop 両方から共通で使う。表示用のフォーマットだけ担当し、
 * fetch / state 管理 (cursor, ページング) は呼び出し側 (Page) で行う。
 *
 * 入力データ (`RshogiGameSummary`) は match-client の decode 層通過後の
 * camelCase + epoch_ms 形式で受け取る前提。
 */

import type { RshogiGameSummary, RshogiTimeControl } from "@shogi/match-client";
import type { ReactElement } from "react";

export interface RshogiCsaGameListProps {
    games: RshogiGameSummary[];
    /** 行クリック時に gameId を返す。 */
    onSelect: (gameId: string) => void;
    /** 「もっと読み込む」押下時に呼ばれる。`hasMore=true` のときのみ表示。 */
    onLoadMore?: () => void;
    /** 初回 / ページ追加読み込み中フラグ。 */
    isLoading?: boolean;
    /** 次ページが存在するか。 */
    hasMore?: boolean;
    /** 一覧が空のときに出すメッセージ (省略時はデフォルト)。 */
    emptyMessage?: string;
}

const pad2 = (n: number): string => n.toString().padStart(2, "0");

/** 既存 ramu-shogi の慣習に揃えた `YYYY-MM-DD HH:mm` (ローカル時刻) フォーマット。 */
const formatStartedAt = (epochMs: number | undefined): string => {
    if (epochMs === undefined) return "不明";
    const d = new Date(epochMs);
    if (Number.isNaN(d.getTime())) return "不明";
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

const CLOCK_KIND_LABEL: Record<string, string> = {
    fischer: "Fischer",
    countdown: "秒読み",
    countdown_msec: "秒読み(ms)",
    stopwatch: "ストップウォッチ",
};

const formatClockSummary = (clock: RshogiTimeControl | undefined): string => {
    if (!clock) return "持ち時間: 不明";
    const kindLabel = clock.kind ? (CLOCK_KIND_LABEL[clock.kind] ?? clock.kind) : "持ち時間";
    const mainMin = Math.round(clock.mainSeconds / 60);
    const main = mainMin > 0 ? `${mainMin}min` : "";
    const inc =
        clock.incrementSeconds && clock.incrementSeconds > 0 ? `+${clock.incrementSeconds}s` : "";
    // byoyomi は秒値を優先、ms 値はサーバが ms 精度で返した countdown_msec 系のために
    // <1 秒のときだけ ms 単位で表示する。
    let byoyomi = "";
    if (clock.byoyomiSeconds > 0) {
        byoyomi = `+秒読み${clock.byoyomiSeconds}s`;
    } else if (clock.byoyomiMilliseconds && clock.byoyomiMilliseconds > 0) {
        byoyomi = `+秒読み${clock.byoyomiMilliseconds}ms`;
    }
    const tail = [main, inc, byoyomi].filter((s) => s.length > 0).join(" ");
    return tail.length > 0 ? `${kindLabel} ${tail}` : kindLabel;
};

const RESULT_KIND_LABEL: Record<string, string> = {
    resignation: "投了",
    checkmate: "詰み",
    time_expired: "時間切れ",
    draw: "千日手",
    jishogi: "入玉勝ち",
    oute_sennichite: "連続王手千日手",
    abort: "中断",
    max_moves: "最大手数",
    abnormal: "異常終了",
};

const formatResultSummary = (game: RshogiGameSummary): string => {
    const result = game.result;
    if (!result) return "結果: 未確定";
    const winnerLabel =
        result.winner === "sente" ? "☗勝" : result.winner === "gote" ? "☖勝" : "引分";
    const reason = RESULT_KIND_LABEL[result.kind] ?? "終局";
    return `${winnerLabel} (${reason})`;
};

export function RshogiCsaGameList({
    games,
    onSelect,
    onLoadMore,
    isLoading,
    hasMore,
    emptyMessage,
}: RshogiCsaGameListProps): ReactElement {
    const empty = games.length === 0;

    return (
        <div className="flex flex-col gap-3">
            {empty && !isLoading && (
                <div className="rounded-lg border border-wafuu-border bg-wafuu-washi-warm p-4 text-sm text-muted-foreground">
                    {emptyMessage ?? "棋譜がまだありません。"}
                </div>
            )}

            {empty && isLoading && (
                <div className="rounded-lg border border-wafuu-border bg-wafuu-washi-warm p-4 text-sm text-muted-foreground">
                    読み込み中...
                </div>
            )}

            {!empty && (
                <ul className="flex flex-col gap-2" aria-label="rshogi 棋譜一覧">
                    {games.map((game) => (
                        <li key={game.gameId}>
                            <button
                                type="button"
                                onClick={() => onSelect(game.gameId)}
                                className="flex w-full flex-col gap-1 rounded-lg border border-wafuu-border bg-wafuu-washi-warm p-3 text-left transition-colors hover:bg-wafuu-kincha/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wafuu-shu"
                            >
                                <div className="flex flex-wrap items-baseline justify-between gap-2">
                                    <span className="text-sm font-semibold text-wafuu-sumi">
                                        ☗ {game.senteName} vs ☖ {game.goteName}
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                        {formatStartedAt(game.startedAtMs)}
                                    </span>
                                </div>
                                <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                                    <span>{formatResultSummary(game)}</span>
                                    <span>{formatClockSummary(game.timeControl)}</span>
                                    {game.movesCount !== undefined && (
                                        <span>{game.movesCount}手</span>
                                    )}
                                    {game.source && <span>source: {game.source}</span>}
                                </div>
                                <div className="text-[11px] font-mono text-muted-foreground/80">
                                    {game.gameId}
                                </div>
                            </button>
                        </li>
                    ))}
                </ul>
            )}

            {hasMore && onLoadMore && (
                <div className="flex justify-center">
                    <button
                        type="button"
                        onClick={onLoadMore}
                        disabled={isLoading}
                        className="rounded-md border border-wafuu-border px-4 py-1.5 text-sm text-wafuu-sumi transition-colors hover:bg-wafuu-kincha/10 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {isLoading ? "読み込み中..." : "もっと読み込む"}
                    </button>
                </div>
            )}
        </div>
    );
}
