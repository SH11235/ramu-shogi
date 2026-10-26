import type { ClockState } from "@shogi/match-client";
import { useEffect, useState } from "react";

/** サーバーの時計を、最後に受け取った時刻からの経過で減らしながら表示する残り時間 */
export function useOnlineClock(clockState: ClockState | null): { b: number; w: number } {
    const [displayMs, setDisplayMs] = useState<{ b: number; w: number }>({ b: 0, w: 0 });

    useEffect(() => {
        if (!clockState) return;
        const update = (): void => {
            const elapsed = Date.now() - clockState.lastTickTs;
            setDisplayMs({
                b:
                    clockState.running === "b"
                        ? Math.max(0, clockState.b.remainMs - elapsed)
                        : clockState.b.remainMs,
                w:
                    clockState.running === "w"
                        ? Math.max(0, clockState.w.remainMs - elapsed)
                        : clockState.w.remainMs,
            });
        };
        update();
        const id = setInterval(update, 500);
        return () => clearInterval(id);
    }, [clockState]);

    return displayMs;
}
