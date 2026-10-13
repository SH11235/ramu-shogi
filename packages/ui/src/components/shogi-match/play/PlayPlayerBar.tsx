/**
 * 対局者の帯（盤の上 = 相手、盤の下 = 自分）。誰が・どのくらいの時間で指しているかを言葉で出す。
 *
 * 時計は「∞」「00:00+00:10」のような記号にせず、「時間無制限」「1手10秒」「残り 9:32」と書く。
 * 手番の側を強調する。
 */

import { cn } from "@shogi/design-system";
import { SKILL_LEVEL_MAX } from "@shogi/engine-client";
import type { ReactElement } from "react";
import { PlayerIcon } from "../components/PlayerIcon";
import { useMatchSettings } from "../contexts/MatchSettingsContext";
import { useMatchState } from "../contexts/MatchStateContext";
import { useShogiMatchConfig } from "../ShogiMatchContext";
import { formatTime } from "../utils/timeFormat";

const seconds = (ms: number): number => Math.max(0, Math.ceil(ms / 1000));

interface PlayPlayerBarProps {
    /** 盤の上か下か（盤の向きに合わせて、どちらの対局者かが決まる） */
    position: "top" | "bottom";
    className?: string;
}

export function PlayPlayerBar({ position, className }: PlayPlayerBarProps): ReactElement {
    const { play } = useShogiMatchConfig();
    const { timeSettings, engineOptions } = useMatchSettings();
    const { getHandInfo, sides, clocks, isMatchRunning, position: board } = useMatchState();
    const owner = getHandInfo(position).owner;
    const setting = sides[owner];
    const isAI = setting.role === "engine";
    const phase = play?.phase ?? "setup";
    const inGame = phase === "playing" || phase === "paused" || phase === "finished";

    const engine = engineOptions?.find((option) => option.id === setting.engineId);
    const levelText =
        isAI && engine?.kind !== "external"
            ? `レベル${setting.skillLevel?.skillLevel ?? SKILL_LEVEL_MAX}`
            : null;

    const rule = timeSettings[owner];
    const clock = clocks[owner];
    let timeText: string;
    if (!rule.enabled) {
        timeText = "時間無制限";
    } else if (!inGame) {
        timeText =
            rule.mainMs > 0
                ? `${Math.round(rule.mainMs / 60_000)}分＋1手${seconds(rule.byoyomiMs)}秒`
                : `1手${seconds(rule.byoyomiMs)}秒`;
    } else if (clock.mainMs > 0) {
        timeText = `残り ${formatTime(clock.mainMs)}`;
    } else {
        timeText = `秒読み ${seconds(clock.byoyomiMs)}秒`;
    }

    const isTurn = phase === "playing" && isMatchRunning && board.turn === owner;
    const sideLabel = owner === "sente" ? "先手" : "後手";

    return (
        <div
            className={cn(
                "flex min-h-9 w-full items-center gap-2 rounded-md px-2 py-1 transition-colors",
                isTurn ? "bg-wafuu-kin/20 ring-1 ring-wafuu-kin/60" : "bg-transparent",
                className,
            )}
        >
            <PlayerIcon side={owner} isAI={isAI} size="md" />
            <span className="min-w-0 truncate text-sm font-semibold text-wafuu-sumi">
                {play?.playerNames[owner] ?? sideLabel}
            </span>
            <span className="shrink-0 text-xs text-wafuu-sumi-light">
                {sideLabel}
                {levelText ? ` ・ ${levelText}` : ""}
            </span>
            <span
                className={cn(
                    "ml-auto shrink-0 whitespace-nowrap font-mono text-sm tabular-nums",
                    isTurn ? "font-semibold text-wafuu-sumi" : "text-wafuu-sumi-light",
                )}
            >
                {timeText}
            </span>
        </div>
    );
}
