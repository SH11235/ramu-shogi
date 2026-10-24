/**
 * 対局画面の詳細設定。ふだんは触らないものをここに集める:
 * 時間を秒で指定（AI は読む量も）、先後別のスレッド数、変則ルール、評価関数、盤の表示。
 *
 * PC ではダイアログ、スマホでは下から出るシートの中に置く。ここで変えた内容は、設定の欄にもそのまま出る。
 */

import type { Player } from "@shogi/app-core";
import { cn } from "@shogi/design-system";
import type { ReactElement, ReactNode } from "react";
import { useId, useRef, useState } from "react";
import { NativeSelect } from "../../native-select";
import { PassRightsSettingsDialog } from "../components/PassRightsSettingsDialog";
import { useMatchSettings } from "../contexts/MatchSettingsContext";
import { useMatchState } from "../contexts/MatchStateContext";
import { useShogiMatchConfig } from "../ShogiMatchContext";
import type { DisplaySettings, EngineSearchLimit } from "../types";
import { HINT_MULTI_PV_CHOICES } from "../utils/hintSettings";
import {
    type FixedSearchLimit,
    formatSearchLimit,
    parseSearchLimitInput,
    SEARCH_LIMIT_DEFAULTS,
} from "../utils/searchLimits";
import { buildThreadOptions, clampThreads, threadCapOf } from "../utils/threadOptions";
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

type SearchKind = EngineSearchLimit["kind"];

const SEARCH_KIND_OPTIONS: Array<{ id: SearchKind; label: string }> = [
    { id: "clock", label: "時計どおり" },
    { id: "nodes", label: "ノード数" },
    { id: "depth", label: "深さ" },
];

const searchValueOf = (limit: FixedSearchLimit): number =>
    limit.kind === "nodes" ? limit.nodes : limit.depth;

/**
 * ノード数・深さの数を入れる欄。打っている途中の文字は手元に持ち、正しい数になったときだけ保存する
 * （空や範囲外のまま離れても、保存してある数は変わらない）。
 */
function SearchLimitInput({
    limit,
    disabled,
    onChange,
}: {
    limit: FixedSearchLimit;
    disabled: boolean;
    onChange: (limit: FixedSearchLimit) => void;
}): ReactElement {
    const kind = limit.kind;
    const saved = searchValueOf(limit);
    const hintId = useId();
    // 打っている文字は、どの保存値の上で打ったかと組で持つ。設定の欄や別のタブから保存値が変わったら、
    // 古い下書きを捨てて新しい値を見せる（下書きのまま打ち続けて、新しい値を上書きしないように）。
    const [draft, setDraft] = useState<{ text: string; base: number } | null>(null);
    const text = draft && draft.base === saved && !disabled ? draft.text : String(saved);
    const { error } = parseSearchLimitInput(text, kind);
    return (
        <div className="flex flex-col gap-1">
            <label className="flex items-center gap-1.5 text-sm">
                {kind === "nodes" ? "ノード数" : "深さ"}
                <input
                    type="text"
                    inputMode="numeric"
                    value={text}
                    disabled={disabled}
                    aria-invalid={error !== null}
                    aria-describedby={hintId}
                    onChange={(event) => {
                        const parsed = parseSearchLimitInput(event.target.value, kind);
                        setDraft({
                            text: event.target.value,
                            base: parsed.limit ? searchValueOf(parsed.limit) : saved,
                        });
                        if (parsed.limit) onChange(parsed.limit);
                    }}
                    onBlur={() => setDraft(null)}
                    className={cn(NUMBER_INPUT_CLASS, kind === "nodes" && "w-32")}
                />
                {kind === "nodes" && "局面"}
            </label>
            <p
                id={hintId}
                aria-live="polite"
                className={cn("text-xs", error ? "text-destructive" : "text-wafuu-sumi-light")}
            >
                {error ??
                    `毎手 ${formatSearchLimit(limit)}${kind === "depth" ? " " : ""}まで読む（時計は使わない）`}
            </p>
        </div>
    );
}

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
        engineSearchLimits,
        onEngineSearchLimitsChange,
        onOpenNnueManager,
        onOpenEngineManager,
        engineOptions,
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

    const setSearchKind = (side: Player, kind: SearchKind) => {
        if (kind === engineSearchLimits[side].kind) return;
        const limit: EngineSearchLimit =
            kind === "clock"
                ? { kind }
                : kind === "nodes"
                  ? { kind, nodes: SEARCH_LIMIT_DEFAULTS.nodes }
                  : { kind, depth: SEARCH_LIMIT_DEFAULTS.depth };
        onEngineSearchLimitsChange({ ...engineSearchLimits, [side]: limit });
    };

    const hasAi = sides.sente.role === "engine" || sides.gote.role === "engine";

    return (
        <div className="flex flex-col gap-4 text-wafuu-sumi">
            <Group title={hasAi ? "時間・読む量" : "時間を秒で指定"}>
                {(["sente", "gote"] as const).map((side) => {
                    const clock = timeSettings[side];
                    const isAi = sides[side].role === "engine";
                    const searchLimit = engineSearchLimits[side];
                    // ノード数・深さで読む AI は時計を使わないので、秒の欄の代わりに数の欄を出す。
                    const fixedSearch = isAi && searchLimit.kind !== "clock" ? searchLimit : null;
                    const inputsDisabled = settingsLocked || !clock.enabled;
                    return (
                        <fieldset key={side} className="flex min-w-0 flex-col gap-1.5">
                            <legend className="sr-only">
                                {sideName(side)}
                                {isAi ? "の時間・読む量" : "の時間"}
                            </legend>
                            <div className="flex items-center justify-between gap-3">
                                <span aria-hidden className="text-sm font-medium">
                                    {sideName(side)}
                                </span>
                                {/* AI は必ず考慮時間か読む量を持つ。人は時間無制限にできる。 */}
                                {isAi && (
                                    <label className="flex items-center gap-1.5 text-sm">
                                        読み方
                                        <NativeSelect
                                            value={searchLimit.kind}
                                            disabled={settingsLocked}
                                            onChange={(event) =>
                                                setSearchKind(
                                                    side,
                                                    event.target.value as SearchKind,
                                                )
                                            }
                                            wrapperClassName="w-36"
                                            className="min-h-10 text-sm"
                                        >
                                            {SEARCH_KIND_OPTIONS.map((option) => (
                                                <option key={option.id} value={option.id}>
                                                    {option.label}
                                                </option>
                                            ))}
                                        </NativeSelect>
                                    </label>
                                )}
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
                            {fixedSearch ? (
                                <SearchLimitInput
                                    key={fixedSearch.kind}
                                    limit={fixedSearch}
                                    disabled={settingsLocked}
                                    onChange={(limit) =>
                                        onEngineSearchLimitsChange({
                                            ...engineSearchLimits,
                                            [side]: limit,
                                        })
                                    }
                                />
                            ) : (
                                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                                    <label className="flex items-center gap-1.5 text-sm">
                                        持ち時間
                                        <input
                                            type="number"
                                            inputMode="numeric"
                                            min={0}
                                            max={MAX_SECONDS}
                                            value={Math.floor(clock.mainMs / 1000)}
                                            disabled={inputsDisabled}
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
                                            disabled={inputsDisabled}
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
                                            disabled={inputsDisabled}
                                            onChange={(event) =>
                                                setSeconds(side, "incrementMs", event.target.value)
                                            }
                                            className={NUMBER_INPUT_CLASS}
                                        />
                                        秒
                                    </label>
                                </div>
                            )}
                        </fieldset>
                    );
                })}
            </Group>

            {(sides.sente.role === "engine" || sides.gote.role === "engine") && (
                <Group title="AI のスレッド数">
                    {(["sente", "gote"] as const)
                        .filter((side) => sides[side].role === "engine")
                        .map((side) => (
                            <label
                                key={side}
                                className="flex items-center justify-between gap-3 text-sm"
                            >
                                {side === "sente" ? "☗ 先手" : "☖ 後手"}
                                <NativeSelect
                                    value={String(
                                        clampThreads(
                                            engineThreads[side],
                                            threadCapOf(engineOptions, [sides[side].engineId]),
                                        ),
                                    )}
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
                                    {buildThreadOptions({
                                        maxThreads: threadCapOf(engineOptions, [
                                            sides[side].engineId,
                                        ]),
                                    }).map((option) => (
                                        <option key={option.value} value={option.value}>
                                            {option.label}
                                        </option>
                                    ))}
                                </NativeSelect>
                            </label>
                        ))}
                </Group>
            )}

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

            {play && (
                <Group title="ヒント">
                    <label className="flex items-center justify-between gap-3 text-sm">
                        候補手の数
                        <NativeSelect
                            value={String(play.hintMultiPv)}
                            onChange={(event) => play.setHintMultiPv(Number(event.target.value))}
                            wrapperClassName="w-40"
                            className="min-h-10 text-sm"
                        >
                            {HINT_MULTI_PV_CHOICES.map((count) => (
                                <option key={count} value={count}>
                                    {count}
                                </option>
                            ))}
                        </NativeSelect>
                    </label>
                </Group>
            )}

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

            {isDevMode && devTools && <Group title="開発者向け">{devTools}</Group>}

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
