import type { GameResult, Player } from "@shogi/app-core";
import { useEffect, useEffectEvent, useRef } from "react";
import type { EngineSearchLimits, Message, SideSetting } from "../types";
import { clockSettingsForLimits } from "../utils/searchLimits";
import { type ClockSettings, useClockManager } from "./useClockManager";

const clockSettingsKey = (settings: ClockSettings): string =>
    (["sente", "gote"] as const)
        .map((side) => {
            const { mainMs, byoyomiMs, incrementMs, enabled } = settings[side];
            return `${mainMs}/${byoyomiMs}/${incrementMs}/${enabled}`;
        })
        .join("|");

/**
 * 対局時計。時間設定と AI の読む量から時計の設定を作り、時間切れを終局につなぐ。
 * 対局していない間は、時間設定を替えたら時計を戻す。
 */
export function useMatchClock({
    isPlayScreen,
    sides,
    timeSettings,
    engineSearchLimits,
    totalMoves,
    isMatchRunning,
    isPaused,
    matchEndedRef,
    endMatchRef,
    setMessage,
}: {
    isPlayScreen: boolean;
    sides: { sente: SideSetting; gote: SideSetting };
    timeSettings: ClockSettings;
    engineSearchLimits: EngineSearchLimits;
    /** いまの手数（時間切れの終局に記録する）。 */
    totalMoves: number;
    isMatchRunning: boolean;
    isPaused: boolean;
    matchEndedRef: { current: boolean };
    endMatchRef: { current: ((result: GameResult) => Promise<void>) | null };
    setMessage: (message: Message | null) => void;
}) {
    // 対局画面では、AI の「1 手◯秒」は考える長さの目安で、切れても負けにしない
    // （端末が重いと、AI が制限ぎりぎりまで考えて時計だけ先に 0 になることがある）。
    // 持ち時間のある決まり（秒読み・加算・切れ負け）は時計どおりに負けにする。
    const isTimeExemptAi = (side: Player): boolean =>
        isPlayScreen && sides[side].role === "engine" && timeSettings[side].mainMs === 0;
    const handleTimeExpired = async (side: Player) => {
        if (isTimeExemptAi(side)) return;
        const winner: Player = side === "sente" ? "gote" : "sente";
        const result: GameResult = {
            winner,
            reason: { kind: "time_expired", loser: side },
            totalMoves,
        };
        await endMatchRef.current?.(result);
    };

    const clockTimeSettings = clockSettingsForLimits(timeSettings, sides, engineSearchLimits);
    const clock = useClockManager({
        timeSettings: clockTimeSettings,
        isMatchRunning,
        onTimeExpired: handleTimeExpired,
        matchEndedRef,
        onClockError: (text: string) => {
            setMessage({ text, type: "error" });
        },
    });
    const { clocksRef, hasExpiredAtMove, resetClocks } = clock;
    const resetClocksBeforeMatch = useEffectEvent(() => resetClocks(false));

    /** 指す前に時間が切れていた手、終局後に届いた手なら、手を適用しない（true を返す）。 */
    const endIfFlaggedBeforeMove = (mover: Player): boolean => {
        // 合法手を調べている間などに終局していたら、その手は受け付けない。
        if (matchEndedRef.current) return true;
        if (isTimeExemptAi(mover) || !hasExpiredAtMove(mover)) return false;
        void handleTimeExpired(mover);
        return true;
    };

    const getRemainingTimeMs = (side: Player) => {
        const clockState = clocksRef.current;
        const state = clockState[side];
        if (!state) return 0;
        const isTicking = clockState.ticking === side;
        const elapsed = isTicking ? Date.now() - clockState.lastUpdatedAt : 0;
        const mainLeft = Math.max(0, state.mainMs - elapsed);
        const overMain = Math.max(0, elapsed - state.mainMs);
        const byoyomiLeft =
            state.mainMs === 0 && isTicking
                ? Math.max(0, state.byoyomiMs - elapsed)
                : Math.max(0, state.byoyomiMs - overMain);
        return mainLeft + byoyomiLeft;
    };

    // 対局前に時間設定が変わったら時計を合わせる。
    // 一時停止中は戻さない（戻すと、止めるたびに持ち時間・秒読みが元に戻ってしまう）。
    // ただし、一時停止中に時間設定そのものを変えたときは、新しい設定に合わせ直す。
    // 読む量（ノード数・深さ）を替えたときも時計の設定が替わるので、時計に渡す設定で比べる。
    // 設定は中身の値で比べる（設定のオブジェクトが作り直されただけで時計を戻さない）。
    const settingsKey = clockSettingsKey(clockTimeSettings);
    const syncedSettingsKeyRef = useRef(settingsKey);
    useEffect(() => {
        const settingsChanged = syncedSettingsKeyRef.current !== settingsKey;
        syncedSettingsKeyRef.current = settingsKey;
        if (!isMatchRunning && (!isPaused || settingsChanged)) {
            resetClocksBeforeMatch();
        }
    }, [isMatchRunning, isPaused, settingsKey]);

    return { ...clock, endIfFlaggedBeforeMove, getRemainingTimeMs };
}
