import type { ReactElement } from "react";

function formatMs(ms: number): string {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

interface PlayerHeaderProps {
    name: string;
    seat: "b" | "w";
    isMyTurn: boolean;
    remainMs: number;
    isOffline: boolean;
    /** undefined = パス権機能が無効、数値 = 残りパス権数 */
    passRightsCount?: number;
}

export function PlayerHeader({
    name,
    seat,
    isMyTurn,
    remainMs,
    isOffline,
    passRightsCount,
}: PlayerHeaderProps): ReactElement {
    return (
        // スマホでは親が中央寄せなので、幅を指定しないと中身の幅に縮み、名前と残り時間がくっつく。
        <div
            className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 ${isMyTurn ? "border-primary bg-primary/5" : "border-border bg-card"}`}
        >
            <div className="flex min-w-0 flex-wrap items-center gap-x-2">
                <span
                    className={`min-w-0 truncate text-sm font-semibold ${seat === "b" ? "text-wafuu-shu" : "text-wafuu-ai"}`}
                >
                    {seat === "b" ? "▲" : "△"} {name}
                </span>
                {isOffline && <span className="text-xs text-destructive">● 切断中</span>}
                {passRightsCount !== undefined && (
                    <span
                        className={`text-xs ${passRightsCount > 0 ? "text-muted-foreground" : "text-muted-foreground/50"}`}
                    >
                        パス権: {passRightsCount}
                    </span>
                )}
            </div>
            <span
                className={`shrink-0 font-mono text-base tabular-nums md:text-sm ${isMyTurn ? "text-primary font-bold" : "text-muted-foreground"}`}
            >
                {formatMs(remainMs)}
            </span>
        </div>
    );
}
