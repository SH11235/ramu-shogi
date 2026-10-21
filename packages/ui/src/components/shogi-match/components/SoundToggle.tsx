import { cn } from "@shogi/design-system";
import type { ReactElement } from "react";
import { useId, useState } from "react";
import type { SoundVoice } from "../../../hooks/useShogiSound";
import { Popover, PopoverContent, PopoverTrigger } from "../../popover";
import { useNavigation } from "../contexts/NavigationContext";
import { useShogiMatchConfig } from "../ShogiMatchContext";
import { DEFAULT_DISPLAY_SETTINGS } from "../types";

type SoundMode = SoundVoice | "off";

const BUTTON_CLASS =
    "flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md border border-wafuu-border bg-card text-wafuu-sumi transition-colors hover:bg-wafuu-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const MODE_OPTIONS: Array<{ mode: SoundMode; label: string }> = [
    { mode: "dog", label: "犬" },
    { mode: "standard", label: "通常" },
    { mode: "off", label: "OFF" },
];

const ICON_PROPS = {
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round",
    strokeLinejoin: "round",
} as const;

function SoundIcon({ mode, className = "h-5 w-5" }: { mode: SoundMode; className?: string }) {
    if (mode === "dog") {
        // トイプードルの顔。小さくしても形が残るよう、垂れ耳を塗って輪郭を強くし、枠いっぱいに描く
        return (
            <svg
                viewBox="2.3 4.1 19.4 16.2"
                className={className}
                strokeWidth="1.5"
                aria-hidden="true"
                {...ICON_PROPS}
            >
                <path d="M7 10a2.6 2.6 0 0 1 2.4-3.6 2.7 2.7 0 0 1 5.2 0A2.6 2.6 0 0 1 17 10" />
                <path
                    d="M7.2 9.8C4.8 9.6 3.3 11.7 3.5 14.4c.2 2.4 1.5 3.9 3.1 3.6 1-.2 1.4-1 1.3-1.9Z"
                    fill="currentColor"
                />
                <path
                    d="M16.8 9.8c2.4-.2 3.9 1.9 3.7 4.6-.2 2.4-1.5 3.9-3.1 3.6-1-.2-1.4-1-1.3-1.9Z"
                    fill="currentColor"
                />
                <path d="M8.3 11.5v3a3.7 3.7 0 0 0 7.4 0v-3" />
                <circle cx="10.4" cy="13" r=".9" fill="currentColor" stroke="none" />
                <circle cx="13.6" cy="13" r=".9" fill="currentColor" stroke="none" />
                <ellipse cx="12" cy="15.6" rx="1.1" ry=".8" fill="currentColor" stroke="none" />
            </svg>
        );
    }
    return (
        <svg
            viewBox="0 0 24 24"
            className={className}
            strokeWidth="1.8"
            aria-hidden="true"
            {...ICON_PROPS}
        >
            <path d="M11 5 6 9H3v6h3l5 4Z" />
            {mode === "standard" ? (
                <>
                    <path d="M15 8a6 6 0 0 1 0 8" />
                    <path d="M18 5a10 10 0 0 1 0 14" />
                </>
            ) : (
                <>
                    <path d="m16 9 5 6" />
                    <path d="m21 9-5 6" />
                </>
            )}
        </svg>
    );
}

/**
 * 着手音の切り替え。人どうしの対局では押すたびに ON/OFF、CPU 戦では「犬・通常・OFF」を選ぶメニューを出す。
 * CPU 戦は犬が既定なので、驚いた人が 1 回で確実に止められるよう、順送りではなく選択肢を並べる。
 */
export function SoundToggle(): ReactElement {
    const { displaySettings, onDisplaySettingsChange } = useNavigation();
    const { soundVoiceSelectable, previewSound } = useShogiMatchConfig();
    const [open, setOpen] = useState(false);
    const groupName = useId();
    const enabled = displaySettings.enableSound;

    if (!soundVoiceSelectable) {
        return (
            <button
                type="button"
                aria-label="サウンド"
                aria-pressed={enabled}
                title={enabled ? "サウンドON（クリックでOFF）" : "サウンドOFF（クリックでON）"}
                onClick={() =>
                    onDisplaySettingsChange((previous) => ({
                        ...previous,
                        enableSound: !(
                            previous.enableSound ?? DEFAULT_DISPLAY_SETTINGS.enableSound
                        ),
                    }))
                }
                className={BUTTON_CLASS}
            >
                <SoundIcon mode={enabled ? "standard" : "off"} />
            </button>
        );
    }

    const voice = displaySettings.cpuSoundVoice ?? DEFAULT_DISPLAY_SETTINGS.cpuSoundVoice;
    const mode: SoundMode = enabled ? voice : "off";
    const current = MODE_OPTIONS.find((option) => option.mode === mode);

    const select = (next: SoundMode) => {
        onDisplaySettingsChange((previous) => ({
            ...previous,
            enableSound: next !== "off",
            cpuSoundVoice: next === "off" ? (previous.cpuSoundVoice ?? voice) : next,
        }));
        setOpen(false);
        // 選んだ音を試しに鳴らす（この操作で、ブラウザが音を出せる状態にもなる）
        if (next !== "off") previewSound?.(next);
    };

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    aria-label={`着手音: ${current?.label}`}
                    title={`着手音: ${current?.label}（クリックで変更）`}
                    className={`${BUTTON_CLASS} data-[state=open]:bg-wafuu-border`}
                >
                    <SoundIcon mode={mode} />
                </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-36 p-1">
                <fieldset className="flex flex-col gap-0.5">
                    <legend className="sr-only">着手音</legend>
                    {MODE_OPTIONS.map((option) => {
                        const checked = option.mode === mode;
                        return (
                            <label
                                key={option.mode}
                                className={cn(
                                    "flex min-h-10 w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-sm text-wafuu-sumi transition-colors hover:bg-muted/60 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                                    checked && "bg-wafuu-kin/20 font-medium",
                                )}
                            >
                                {/* 選び直しでも閉じて試し鳴らしできるよう、change ではなく click で拾う */}
                                <input
                                    type="radio"
                                    name={groupName}
                                    value={option.mode}
                                    checked={checked}
                                    onChange={() => {}}
                                    onClick={() => select(option.mode)}
                                    className="sr-only"
                                />
                                <SoundIcon mode={option.mode} />
                                <span className="flex-1">{option.label}</span>
                                {checked && (
                                    <svg
                                        viewBox="0 0 24 24"
                                        className="h-4 w-4"
                                        strokeWidth="2"
                                        aria-hidden="true"
                                        {...ICON_PROPS}
                                    >
                                        <path d="m5 12 5 5 9-10" />
                                    </svg>
                                )}
                            </label>
                        );
                    })}
                </fieldset>
            </PopoverContent>
        </Popover>
    );
}
