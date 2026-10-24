/**
 * 対局者の帯（盤の上 = 相手、盤の下 = 自分）。誰が・どのくらいの時間で指しているかを言葉で出す。
 *
 * 時計は「∞」「00:00+00:10」のような記号にせず、「時間無制限」「1手10秒」「5分 +10秒」「残り 9:32」と書く。
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
import { formatSearchLimit } from "../utils/searchLimits";
import { formatTime } from "../utils/timeFormat";
import { formatTimeRule } from "../utils/timeSettings";
import { PlayBarReading } from "./PlayEngineReading";

const seconds = (ms: number): number => Math.max(0, Math.ceil(ms / 1000));

/** 対局者の時間の文言と、残りが少ない（人の手番で 10 秒以下）かどうか。 */
function usePlayerTime(owner: Player): { text: string; urgent: boolean } {
    const text = usePlayerTimeTextOnly(owner);
    const { play } = useShogiMatchConfig();
    const { timeSettings } = useMatchSettings();
    const { sides, clocks, position } = useMatchState();
    const rule = timeSettings[owner];
    const clock = clocks[owner];
    const urgent =
        play?.phase === "playing" &&
        sides[owner].role === "human" &&
        rule.enabled &&
        position.turn === owner &&
        clock.mainMs + clock.byoyomiMs <= 10_000;
    return { text, urgent };
}

/** 対局者の時間を言葉にする（「時間無制限」「1手10秒」「残り 09:32」「残り 7秒」）。 */
function usePlayerTimeTextOnly(owner: Player): string {
    const { play } = useShogiMatchConfig();
    const { timeSettings, engineSearchLimits } = useMatchSettings();
    const { sides, clocks } = useMatchState();
    const phase = play?.phase ?? "setup";
    const isAI = sides[owner].role === "engine";
    const rule = timeSettings[owner];
    const clock = clocks[owner];
    const fixedSearch = isAI ? formatSearchLimit(engineSearchLimits[owner]) : null;
    if (fixedSearch) return fixedSearch;
    if (!rule.enabled) return "時間無制限";
    if (phase !== "playing" && phase !== "paused") {
        // 対局の前後は、残り時間でなく決まり（持ち時間・秒読み）を出す。
        return describeTimeRule(rule, { perMove: isAI });
    }
    // AI の 1 手の考慮時間は、設定と同じ言い方で出す（刻々と減る秒は見せない）。
    if (isAI && rule.mainMs === 0) return `1手${seconds(rule.byoyomiMs)}秒`;
    return describeRemaining(clock.mainMs, clock.byoyomiMs);
}

/**
 * 残り時間を言葉にする（「残り 09:32」「残り 18秒」）。1 分を切ったら秒で出す
 * （秒読みに入ったときと書き方を揃える）。秒は切り上げに揃える（境目で表示が止まらないように）。
 */
export function describeRemaining(mainMs: number, byoyomiMs: number): string {
    const main = seconds(mainMs);
    if (main >= 60) return `残り ${formatTime(main * 1000)}`;
    if (main > 0) return `残り ${main}秒`;
    return `残り ${seconds(byoyomiMs)}秒`;
}

/**
 * 時間の決まりを言葉にする（「10分 秒読み30秒」「5分 +10秒」「1手10秒」）。秒は切り上げに揃える。
 * `perMove` は AI の考慮時間の書き方（持ち時間なしの秒読みを「1手◯秒」と書く）。
 */
export function describeTimeRule(
    clock: { mainMs: number; byoyomiMs: number; incrementMs: number },
    options?: { perMove?: boolean },
): string {
    const ceilSeconds = (ms: number) => seconds(ms) * 1000;
    const text = formatTimeRule(
        {
            mainMs: ceilSeconds(clock.mainMs),
            byoyomiMs: ceilSeconds(clock.byoyomiMs),
            incrementMs: ceilSeconds(clock.incrementMs),
        },
        options,
    );
    return text || "1手0秒";
}

/** パス権（変則ルール）の残りの文言。対局が始まる前は、設定した初めの回数を出す。無効なら null。 */
function usePassRightsText(owner: Player): string | null {
    const { passRightsSettings } = useMatchSettings();
    const { position } = useMatchState();
    if (!passRightsSettings.enabled) return null;
    const remaining =
        position.passRights?.[owner] ??
        (owner === "sente"
            ? passRightsSettings.senteInitialCount
            : passRightsSettings.goteInitialCount);
    return `パス残り${remaining}`;
}

interface PlayPlayerBarProps {
    /** 盤の上か下か（盤の向きに合わせて、どちらの対局者かが決まる） */
    position: "top" | "bottom";
    /** CPU のアイコンをクリックで拡大できるようにするか */
    enableIconZoom?: boolean;
    className?: string;
}

export function PlayPlayerBar({
    position,
    enableIconZoom = false,
    className,
}: PlayPlayerBarProps): ReactElement {
    const { play } = useShogiMatchConfig();
    const { engineOptions } = useMatchSettings();
    const {
        getHandInfo,
        sides,
        isMatchRunning,
        position: board,
        displaySettings,
    } = useMatchState();
    const owner = getHandInfo(position).owner;
    const setting = sides[owner];
    const isAI = setting.role === "engine";
    const phase = play?.phase ?? "setup";
    const { text: timeText, urgent } = usePlayerTime(owner);
    const passText = usePassRightsText(owner);

    const engine = engineOptions?.find((option) => option.id === setting.engineId);
    const levelText =
        isAI && engine?.kind !== "external"
            ? `レベル${setting.skillLevel?.skillLevel ?? SKILL_LEVEL_MAX}`
            : null;

    // 人 対 人では、どちらも「あなた」になってしまうので、先手・後手で呼ぶ。
    const bothHumans = sides.sente.role === "human" && sides.gote.role === "human";
    const isTurn = phase === "playing" && isMatchRunning && board.turn === owner;
    const sideLabel = owner === "sente" ? "先手" : "後手";
    const showReading =
        isAI &&
        displaySettings.showEngineReading &&
        (phase === "playing" || phase === "paused" || phase === "finished");

    return (
        <div
            className={cn(
                "flex min-h-9 w-full items-center gap-2 rounded-md px-2 py-1 transition-colors",
                isTurn ? "bg-wafuu-kin/20 ring-1 ring-wafuu-kin/60" : "bg-transparent",
                className,
            )}
        >
            <PlayerIcon side={owner} isAI={isAI} size="bar" enableZoom={enableIconZoom} />
            <span className="min-w-0 truncate text-sm font-semibold text-wafuu-sumi">
                {bothHumans ? sideLabel : (play?.playerNames[owner] ?? sideLabel)}
            </span>
            {!bothHumans && (
                // 幅の狭い端末では、名前が切れないよう先後と強さを省く（先後は駒の向きと印で分かる）。
                // AI の読みを並べるときは、読みの方を残す。
                <span
                    className={cn(
                        "hidden shrink-0 text-xs text-wafuu-sumi-light",
                        showReading ? "min-[480px]:inline" : "min-[400px]:inline",
                    )}
                >
                    {sideLabel}
                    {levelText ? ` ・ ${levelText}` : ""}
                </span>
            )}
            {showReading && (
                <span className="ml-auto flex min-w-0 justify-end">
                    <PlayBarReading owner={owner} />
                </span>
            )}
            <span
                className={cn(
                    "shrink-0 whitespace-nowrap text-sm tabular-nums",
                    !showReading && "ml-auto",
                    urgent
                        ? "font-semibold text-wafuu-shu"
                        : isTurn
                          ? "font-semibold text-wafuu-sumi"
                          : "text-wafuu-sumi-light",
                )}
            >
                {passText ? `${passText} ・ ` : ""}
                {timeText}
            </span>
        </div>
    );
}

/**
 * 自分（盤の下の側）のパス権の残りと時間を出す（スマホの操作の帯に置く。スマホの対局中は、
 * 自分の側の帯を出さないため）。盤の下が AI なら、その AI の読みも添える。どれも無ければ何も出さない。
 */
export function PlayMyStatus({
    withPlayer = false,
    className,
}: {
    /** 盤の下の対局者のアイコンと名前も添える（AI 同士・人同士。盤の下が「あなた」とは限らない） */
    withPlayer?: boolean;
    className?: string;
}): ReactElement | null {
    const { play } = useShogiMatchConfig();
    const { timeSettings } = useMatchSettings();
    const { getHandInfo, sides, displaySettings } = useMatchState();
    const owner = getHandInfo("bottom").owner;
    const { text: timeText, urgent } = usePlayerTime(owner);
    const passText = usePassRightsText(owner);
    const showTime = timeSettings[owner].enabled;
    if (!withPlayer && !showTime && !passText) return null;
    const sideLabel = owner === "sente" ? "先手" : "後手";
    const bothHumans = sides.sente.role === "human" && sides.gote.role === "human";
    const name = bothHumans ? sideLabel : (play?.playerNames[owner] ?? sideLabel);
    return (
        <span
            className={cn(
                "flex min-w-0 shrink-0 items-center gap-1.5 whitespace-nowrap text-sm font-semibold tabular-nums",
                urgent ? "text-wafuu-shu" : "text-wafuu-sumi",
                className,
            )}
        >
            {withPlayer && (
                <>
                    <PlayerIcon side={owner} isAI={sides[owner].role === "engine"} size="md" />
                    {/* 幅の狭い端末では名前を省き、手番の行（ヒントの指し手など）の幅を残す。 */}
                    <span className="min-w-0 max-w-24 truncate max-[399px]:hidden">{name}</span>
                    {(passText || showTime) && <span aria-hidden>・</span>}
                </>
            )}
            {passText}
            {passText && showTime ? " ・ " : ""}
            {showTime ? timeText : ""}
            {/* AI 同士では盤の下も AI。盤の上の帯と同じく、その AI の読みを添える。 */}
            {withPlayer && sides[owner].role === "engine" && displaySettings.showEngineReading && (
                <PlayBarReading owner={owner} />
            )}
        </span>
    );
}
