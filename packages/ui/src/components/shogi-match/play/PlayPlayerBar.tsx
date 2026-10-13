/**
 * 対局者の帯（盤の上 = 相手、盤の下 = 自分）。誰が・どのくらいの時間で指しているかを言葉で出す。
 *
 * 時計は「∞」「00:00+00:10」のような記号にせず、「時間無制限」「1手10秒」「残り 9:32」と書く。
 * 手番の側を強調する。
 */

import type { Player } from "@shogi/app-core";
import { cn } from "@shogi/design-system";
import { SKILL_LEVEL_MAX } from "@shogi/engine-client";
import type { ReactElement } from "react";
import { PlayerIcon } from "../components/PlayerIcon";
import { useMatchSettings } from "../contexts/MatchSettingsContext";
import { useMatchState } from "../contexts/MatchStateContext";
import { useShogiMatchConfig } from "../ShogiMatchContext";
import { formatTime } from "../utils/timeFormat";

const seconds = (ms: number): number => Math.max(0, Math.ceil(ms / 1000));

/** 対局者の時間を言葉にする（「時間無制限」「1手10秒」「残り 09:32」「秒読み 7秒」）。 */
function usePlayerTimeText(owner: Player): string {
    const { play } = useShogiMatchConfig();
    const { timeSettings } = useMatchSettings();
    const { sides, clocks } = useMatchState();
    const phase = play?.phase ?? "setup";
    const isAI = sides[owner].role === "engine";
    const rule = timeSettings[owner];
    const clock = clocks[owner];
    if (!rule.enabled) return "時間無制限";
    if (phase !== "playing" && phase !== "paused") {
        // 対局の前後は、残り時間でなく決まり（持ち時間・秒読み）を出す。
        return rule.mainMs > 0
            ? `${Math.round(rule.mainMs / 60_000)}分＋1手${seconds(rule.byoyomiMs)}秒`
            : `1手${seconds(rule.byoyomiMs)}秒`;
    }
    // AI の 1 手の考慮時間は、設定と同じ言い方で出す（刻々と減る秒は見せない）。
    if (isAI && rule.mainMs === 0) return `1手${seconds(rule.byoyomiMs)}秒`;
    if (clock.mainMs > 0) return `残り ${formatTime(clock.mainMs)}`;
    return `残り ${seconds(clock.byoyomiMs)}秒`;
}

interface PlayPlayerBarProps {
    /** 盤の上か下か（盤の向きに合わせて、どちらの対局者かが決まる） */
    position: "top" | "bottom";
    className?: string;
}

export function PlayPlayerBar({ position, className }: PlayPlayerBarProps): ReactElement {
    const { play } = useShogiMatchConfig();
    const { engineOptions } = useMatchSettings();
    const { getHandInfo, sides, isMatchRunning, position: board } = useMatchState();
    const owner = getHandInfo(position).owner;
    const setting = sides[owner];
    const isAI = setting.role === "engine";
    const phase = play?.phase ?? "setup";
    const timeText = usePlayerTimeText(owner);

    const engine = engineOptions?.find((option) => option.id === setting.engineId);
    const levelText =
        isAI && engine?.kind !== "external"
            ? `レベル${setting.skillLevel?.skillLevel ?? SKILL_LEVEL_MAX}`
            : null;

    // 人 対 人では、どちらも「あなた」になってしまうので、先手・後手で呼ぶ。
    const bothHumans = sides.sente.role === "human" && sides.gote.role === "human";
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
                {bothHumans ? sideLabel : (play?.playerNames[owner] ?? sideLabel)}
            </span>
            {!bothHumans && (
                <span className="shrink-0 text-xs text-wafuu-sumi-light">
                    {sideLabel}
                    {levelText ? ` ・ ${levelText}` : ""}
                </span>
            )}
            <span
                className={cn(
                    "ml-auto shrink-0 whitespace-nowrap text-sm tabular-nums",
                    isTurn ? "font-semibold text-wafuu-sumi" : "text-wafuu-sumi-light",
                )}
            >
                {timeText}
            </span>
        </div>
    );
}

/** 自分（盤の下の側）の時間だけを出す（スマホの操作の帯に置く）。時間無制限なら何も出さない。 */
export function PlayMyTime({ className }: { className?: string }): ReactElement | null {
    const { timeSettings } = useMatchSettings();
    const { getHandInfo } = useMatchState();
    const owner = getHandInfo("bottom").owner;
    const timeText = usePlayerTimeText(owner);
    if (!timeSettings[owner].enabled) return null;
    return (
        <span
            className={cn(
                "shrink-0 whitespace-nowrap text-sm font-semibold tabular-nums text-wafuu-sumi",
                className,
            )}
        >
            {timeText}
        </span>
    );
}
