import { cn } from "@shogi/design-system";
import type { KeyboardEvent, ReactElement } from "react";
import { useRef, useState } from "react";
import { normalizeSoundVoice, type SoundVoice } from "../../../hooks/useShogiSound";
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

const KIFU_NAVIGATION_KEYS = new Set([
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
    "Home",
    "End",
]);

const ICON_PROPS = {
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round",
    strokeLinejoin: "round",
} as const;

function SoundIcon({ mode, className = "h-5 w-5" }: { mode: SoundMode; className?: string }) {
    if (mode === "dog") {
        // トイプードルの顔。耳を頭の後ろに描いて重ね、毛色で塗る。輪郭は文字色のままにして、
        // 明るい背景でも暗い背景でも形が読めるようにする
        return (
            <svg
                viewBox="2.3 4.1 19.4 16.2"
                className={className}
                strokeWidth="1.3"
                aria-hidden="true"
                {...ICON_PROPS}
            >
                <path
                    d="M7.2 9.8C4.8 9.6 3.3 11.7 3.5 14.4c.2 2.4 1.5 3.9 3.1 3.6 1-.2 1.4-1 1.3-1.9Z"
                    className="fill-ram-fur-deep"
                />
                <path
                    d="M16.8 9.8c2.4-.2 3.9 1.9 3.7 4.6-.2 2.4-1.5 3.9-3.1 3.6-1-.2-1.4-1-1.3-1.9Z"
                    className="fill-ram-fur-deep"
                />
                <path
                    d="M7 10a2.6 2.6 0 0 1 2.4-3.6 2.7 2.7 0 0 1 5.2 0A2.6 2.6 0 0 1 17 10l-1.3 1.5v3a3.7 3.7 0 0 1-7.4 0v-3Z"
                    className="fill-ram-fur"
                />
                <ellipse
                    cx="12"
                    cy="15.5"
                    rx="2"
                    ry="1.5"
                    className="fill-ram-cream"
                    stroke="none"
                />
                <circle cx="10.4" cy="12.9" r=".95" className="fill-ram-ink" stroke="none" />
                <circle cx="13.6" cy="12.9" r=".95" className="fill-ram-ink" stroke="none" />
                <ellipse cx="12" cy="15" rx="1" ry=".72" className="fill-ram-ink" stroke="none" />
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
    const menuRef = useRef<HTMLDivElement>(null);
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

    const voice = normalizeSoundVoice(
        displaySettings.cpuSoundVoice,
        DEFAULT_DISPLAY_SETTINGS.cpuSoundVoice,
    );
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

    const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
        // 棋譜の矢印キー送りは document で聞いているので、メニューを開いている間は背後の局面を動かさない
        if (KIFU_NAVIGATION_KEYS.has(event.key)) event.stopPropagation();
        const items = [
            ...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitemradio"]'),
        ];
        const index = items.indexOf(document.activeElement as HTMLElement);
        const target = {
            ArrowDown: items[(index + 1) % items.length],
            ArrowUp: items[(index - 1 + items.length) % items.length],
            Home: items[0],
            End: items[items.length - 1],
        }[event.key];
        if (!target) return;
        event.preventDefault();
        target.focus();
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
            <PopoverContent
                align="end"
                className="w-36 p-1"
                // 先頭ではなく今の選択から矢印キーで動けるようにする
                onOpenAutoFocus={(event) => {
                    event.preventDefault();
                    menuRef.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
                }}
            >
                {/* ラジオ入力だと矢印キーで移っただけで選ばれて閉じるので、移動と決定を分けたメニューにする */}
                <div
                    ref={menuRef}
                    role="menu"
                    aria-label="着手音"
                    onKeyDown={moveFocus}
                    className="flex flex-col gap-0.5"
                >
                    {MODE_OPTIONS.map((option) => {
                        const checked = option.mode === mode;
                        return (
                            <button
                                key={option.mode}
                                type="button"
                                role="menuitemradio"
                                aria-checked={checked}
                                onClick={() => select(option.mode)}
                                className={cn(
                                    "flex min-h-10 w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-left text-sm text-wafuu-sumi transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                    checked && "bg-wafuu-kin/20 font-medium",
                                )}
                            >
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
                            </button>
                        );
                    })}
                </div>
            </PopoverContent>
        </Popover>
    );
}
