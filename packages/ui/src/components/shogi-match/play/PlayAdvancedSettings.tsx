/**
 * 対局画面の詳細設定。ふだんは触らないものをここに集める:
 * 時間を秒で指定、変則ルール、評価関数、盤の表示。
 *
 * PC ではダイアログ、スマホでは下から出るシートの中に置く。ここで変えた内容は、設定の欄にもそのまま出る。
 */

import type { Player } from "@shogi/app-core";
import { cn } from "@shogi/design-system";
import type { ReactElement, ReactNode } from "react";
import { useRef, useState } from "react";
import { NativeSelect } from "../../native-select";
import { PassRightsSettingsDialog } from "../components/PassRightsSettingsDialog";
import { useMatchSettings } from "../contexts/MatchSettingsContext";
import { useMatchState } from "../contexts/MatchStateContext";
import { useShogiMatchConfig } from "../ShogiMatchContext";
import type { DisplaySettings } from "../types";
import { buildThreadOptions } from "../utils/threadOptions";
import { PLAY_OUTLINE_BUTTON } from "./playStyles";
import { usePlaySetup } from "./usePlaySetup";

const DISPLAY_TOGGLES: Array<{ key: keyof DisplaySettings; label: string }> = [
    { key: "showBoardLabels", label: "盤の外に筋・段を表示" },
    { key: "highlightLastMove", label: "直前の手を強調" },
    { key: "showSearchInfo", label: "AI の探索情報（NPS・深さ）を表示" },
    { key: "enableWheelNavigation", label: "終局後、盤の上のホイールで棋譜を送る" },
];

const MAX_SECONDS = 86_400;

function Group({ title, children }: { title: string; children: ReactNode }): ReactElement {
    return (
        <section className="flex flex-col gap-2.5 border-t border-wafuu-border pt-4 first:border-t-0 first:pt-0">
            <h3 className="text-sm font-semibold text-wafuu-sumi">{title}</h3>
            {children}
        </section>
    );
}

const NUMBER_INPUT_CLASS =
    "h-10 w-20 rounded-md border border-wafuu-border bg-background px-2 text-right text-sm tabular-nums text-wafuu-sumi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

const ROW_BUTTON_CLASS = cn(
    "flex min-h-10 w-full items-center justify-between gap-3 rounded-md border px-3 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
    PLAY_OUTLINE_BUTTON,
);

interface PlayAdvancedSettingsProps {
    onDisplaySettingsChange: (settings: DisplaySettings) => void;
    /** 開発モードで「開発者向け」に添える部品（エンジンのログ・再試行など）。 */
    devTools?: ReactNode;
}

export function PlayAdvancedSettings({
    onDisplaySettingsChange,
    devTools,
}: PlayAdvancedSettingsProps): ReactElement {
    const setup = usePlaySetup();
    const {
        sides,
        timeSettings,
        onTimeSettingsChange,
        passRightsSettings,
        onPassRightsSettingsChange,
        settingsLocked: matchLocked,
        isDevMode,
        engineThreads,
        onEngineThreadsChange,
        onOpenNnueManager,
        onOpenEngineManager,
    } = useMatchSettings();
    const { displaySettings } = useMatchState();
    const { play } = useShogiMatchConfig();
    // 対局中に加えて、対局を始める準備の間・前の対局を片付けている間も、設定を変えさせない。
    const settingsLocked = matchLocked || play?.busy === true;
    const passRightsButtonRef = useRef<HTMLButtonElement>(null);
    const [isPassRightsOpen, setIsPassRightsOpen] = useState(false);

    const sideName = (side: Player): string => {
        const mark = side === "sente" ? "☗ 先手" : "☖ 後手";
        if (setup.kind === "vs-ai") {
            return `${mark}（${sides[side].role === "human" ? "あなた" : "AI"}）`;
        }
        return mark;
    };

    const setSeconds = (
        side: Player,
        field: "mainMs" | "byoyomiMs" | "incrementMs",
        raw: string,
    ) => {
        const parsed = Number(raw);
        if (Number.isNaN(parsed) || parsed < 0) return;
        const seconds = Math.min(Math.floor(parsed), MAX_SECONDS);
        // 秒読みと加算はどちらか一方の決まり。片方に秒を入れたら、もう片方は 0 にする。
        const exclusive =
            seconds > 0 && field === "byoyomiMs"
                ? { incrementMs: 0 }
                : seconds > 0 && field === "incrementMs"
                  ? { byoyomiMs: 0 }
                  : {};
        onTimeSettingsChange({
            ...timeSettings,
            [side]: { ...timeSettings[side], ...exclusive, [field]: seconds * 1000 },
        });
    };

    return (
        <div className="flex flex-col gap-4 text-wafuu-sumi">
            <Group title="時間を秒で指定">
                {(["sente", "gote"] as const).map((side) => {
                    const clock = timeSettings[side];
                    const isAi = sides[side].role === "engine";
                    return (
                        <fieldset key={side} className="flex min-w-0 flex-col gap-1.5">
                            <legend className="sr-only">{sideName(side)}の時間</legend>
                            <div className="flex items-center justify-between gap-3">
                                <span aria-hidden className="text-sm font-medium">
                                    {sideName(side)}
                                </span>
                                {/* AI は必ず考慮時間を持つ。人は時間無制限にできる。 */}
                                {!isAi && (
                                    <label className="flex min-h-8 items-center gap-1.5 text-sm">
                                        <input
                                            type="checkbox"
                                            checked={clock.enabled}
                                            disabled={settingsLocked}
                                            onChange={(event) =>
                                                onTimeSettingsChange({
                                                    ...timeSettings,
                                                    [side]: {
                                                        ...clock,
                                                        enabled: event.target.checked,
                                                    },
                                                })
                                            }
                                            className="h-4 w-4 accent-wafuu-shu"
                                        />
                                        時間制限あり
                                    </label>
                                )}
                            </div>
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                                <label className="flex items-center gap-1.5 text-sm">
                                    持ち時間
                                    <input
                                        type="number"
                                        inputMode="numeric"
                                        min={0}
                                        max={MAX_SECONDS}
                                        value={Math.floor(clock.mainMs / 1000)}
                                        disabled={settingsLocked || !clock.enabled}
                                        onChange={(event) =>
                                            setSeconds(side, "mainMs", event.target.value)
                                        }
                                        className={NUMBER_INPUT_CLASS}
                                    />
                                    秒
                                </label>
                                <label className="flex items-center gap-1.5 text-sm">
                                    秒読み
                                    <input
                                        type="number"
                                        inputMode="numeric"
                                        min={0}
                                        max={MAX_SECONDS}
                                        value={Math.floor(clock.byoyomiMs / 1000)}
                                        disabled={settingsLocked || !clock.enabled}
                                        onChange={(event) =>
                                            setSeconds(side, "byoyomiMs", event.target.value)
                                        }
                                        className={NUMBER_INPUT_CLASS}
                                    />
                                    秒
                                </label>
                                <label className="flex items-center gap-1.5 text-sm">
                                    1手ごとに +
                                    <input
                                        type="number"
                                        inputMode="numeric"
                                        min={0}
                                        max={MAX_SECONDS}
                                        value={Math.floor(clock.incrementMs / 1000)}
                                        disabled={settingsLocked || !clock.enabled}
                                        onChange={(event) =>
                                            setSeconds(side, "incrementMs", event.target.value)
                                        }
                                        className={NUMBER_INPUT_CLASS}
                                    />
                                    秒
                                </label>
                            </div>
                        </fieldset>
                    );
                })}
            </Group>

            <Group title="ルール・評価関数">
                <button
                    ref={passRightsButtonRef}
                    type="button"
                    disabled={settingsLocked}
                    onClick={() => setIsPassRightsOpen(true)}
                    className={ROW_BUTTON_CLASS}
                >
                    <span>変則ルール（パス権）</span>
                    <span className="text-xs text-wafuu-sumi-light">
                        {passRightsSettings.enabled
                            ? `あり（☗${passRightsSettings.senteInitialCount}・☖${passRightsSettings.goteInitialCount}）`
                            : "なし"}
                    </span>
                </button>
                <button type="button" onClick={onOpenNnueManager} className={ROW_BUTTON_CLASS}>
                    <span>AI（評価関数）</span>
                    <span aria-hidden className="text-wafuu-sumi-light">
                        ›
                    </span>
                </button>
                {onOpenEngineManager && (
                    <button
                        type="button"
                        onClick={onOpenEngineManager}
                        className={ROW_BUTTON_CLASS}
                    >
                        <span>外部エンジンを管理</span>
                        <span aria-hidden className="text-wafuu-sumi-light">
                            ›
                        </span>
                    </button>
                )}
            </Group>

            <Group title="盤の表示">
                <label className="flex items-center justify-between gap-3 text-sm">
                    マスの中の座標
                    <NativeSelect
                        value={displaySettings.squareNotation}
                        onChange={(event) =>
                            onDisplaySettingsChange({
                                ...displaySettings,
                                squareNotation: event.target
                                    .value as DisplaySettings["squareNotation"],
                            })
                        }
                        wrapperClassName="w-40"
                        className="min-h-10 text-sm"
                    >
                        <option value="none">なし</option>
                        <option value="sfen">SFEN（5e）</option>
                        <option value="japanese">日本式（５五）</option>
                    </NativeSelect>
                </label>
                {DISPLAY_TOGGLES.map(({ key, label }) => (
                    <label
                        key={key}
                        className="flex min-h-8 cursor-pointer items-center gap-2.5 text-sm"
                    >
                        <input
                            type="checkbox"
                            checked={displaySettings[key] === true}
                            onChange={(event) =>
                                onDisplaySettingsChange({
                                    ...displaySettings,
                                    [key]: event.target.checked,
                                })
                            }
                            className="h-4 w-4 accent-wafuu-shu"
                        />
                        {label}
                    </label>
                ))}
            </Group>

            {isDevMode && (
                <Group title="開発者向け">
                    {(["sente", "gote"] as const).map((side) => (
                        <label
                            key={side}
                            className="flex items-center justify-between gap-3 text-sm"
                        >
                            {side === "sente" ? "☗ 先手" : "☖ 後手"}のスレッド数
                            <NativeSelect
                                value={String(engineThreads[side])}
                                disabled={settingsLocked}
                                onChange={(event) =>
                                    onEngineThreadsChange({
                                        ...engineThreads,
                                        [side]: Number(event.target.value),
                                    })
                                }
                                wrapperClassName="w-40"
                                className="min-h-10 text-sm"
                            >
                                {buildThreadOptions().map((option) => (
                                    <option key={option.value} value={option.value}>
                                        {option.label}
                                    </option>
                                ))}
                            </NativeSelect>
                        </label>
                    ))}
                    {devTools}
                </Group>
            )}

            <PassRightsSettingsDialog
                open={isPassRightsOpen}
                onOpenChange={(open) => {
                    setIsPassRightsOpen(open);
                    // 閉じたら、開いたボタンへフォーカスを戻す（ダイアログの中のダイアログ）。
                    if (!open) requestAnimationFrame(() => passRightsButtonRef.current?.focus());
                }}
                passRightsSettings={passRightsSettings}
                onChange={onPassRightsSettingsChange}
                settingsLocked={settingsLocked}
            />
        </div>
    );
}
