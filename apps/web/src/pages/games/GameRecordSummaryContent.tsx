import type { GameRecordSummary } from "@shogi/api-contract";
import type { ReactElement } from "react";
import { formatGameResult, SOURCE_LABELS, VISIBILITY_LABELS } from "./gameResultUtils";

function formatFinishedAt(finishedAt: string | null): string {
    if (!finishedAt) return "未完了";
    return new Date(finishedAt).toLocaleString("ja-JP");
}

/** 自分の対局の一覧の 1 件の中身（公開範囲・種類・対局者・結果・日時）。リンクやボタンで包んで使う。 */
export function GameRecordSummaryContent({ game }: { game: GameRecordSummary }): ReactElement {
    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-full bg-muted px-2 py-1 text-muted-foreground">
                    {VISIBILITY_LABELS[game.visibility]}
                </span>
                <span className="rounded-full bg-muted px-2 py-1 text-muted-foreground">
                    {SOURCE_LABELS[game.source]}
                </span>
            </div>

            <div className="flex flex-col gap-1">
                <h2 className="text-base font-semibold text-foreground">
                    {game.participants
                        .map((participant) => participant.displayNameSnapshot)
                        .join(" vs ")}
                </h2>
                <p className="text-sm text-muted-foreground">{formatGameResult(game)}</p>
            </div>

            <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                {/* 終わった対局は終了日時だけ（作成日時は対局を始めた時刻でほぼ同じ）。 */}
                <span>終了: {formatFinishedAt(game.finishedAt)}</span>
                {!game.finishedAt && (
                    <span>作成: {new Date(game.createdAt).toLocaleString("ja-JP")}</span>
                )}
            </div>
        </div>
    );
}
