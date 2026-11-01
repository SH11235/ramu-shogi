import type { UsageEvents, UsageTracker } from "@shogi/ui/providers/UsageContext";
import type { UsageClient } from "./usage";

const MAX_DURATION_SEC = 864_000;

/**
 * 画面の部品（packages/ui）から来るイベントを送信クライアントへ渡す。対局の時間は部品が持たないので、
 * ここで開始の時刻を覚えて終局のときに足す（開始を見ていない終局は 0 秒）。
 */
export function createUsageTracker(
    client: UsageClient,
    now: () => number = Date.now,
): UsageTracker {
    let matchStartedAt: number | null = null;
    return (event, props) => {
        if (event === "match_end") {
            const elapsed = matchStartedAt === null ? 0 : (now() - matchStartedAt) / 1000;
            matchStartedAt = null;
            client.track("match_end", {
                ...(props as UsageEvents["match_end"]),
                durationSec: Math.min(MAX_DURATION_SEC, Math.max(0, Math.round(elapsed))),
            });
            return;
        }
        if (event === "match_start") matchStartedAt = now();
        client.track(event, props as never);
    };
}
