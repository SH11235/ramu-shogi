import type { ReactElement } from "react";
import { useNavigation } from "../contexts/NavigationContext";

export function SoundToggle(): ReactElement {
    const { displaySettings, onDisplaySettingsChange } = useNavigation();
    const enabled = displaySettings.enableSound;

    return (
        <button
            type="button"
            aria-label="サウンド"
            aria-pressed={enabled}
            title={enabled ? "サウンドON（クリックでOFF）" : "サウンドOFF（クリックでON）"}
            onClick={() =>
                onDisplaySettingsChange((previous) => ({
                    ...previous,
                    enableSound: !previous.enableSound,
                }))
            }
            className={`flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md border border-wafuu-border transition-colors hover:bg-wafuu-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                enabled ? "bg-wafuu-kin/20 text-wafuu-sumi" : "bg-card text-muted-foreground"
            }`}
        >
            <svg
                viewBox="0 0 24 24"
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
            >
                <path d="M11 5 6 9H3v6h3l5 4Z" />
                {enabled ? (
                    <>
                        <path d="M15 8a6 6 0 0 1 0 8" />
                        <path d="M18 5a10 10 0 0 1 0 14" />
                    </>
                ) : (
                    <path d="m15 8 6 8" />
                )}
            </svg>
        </button>
    );
}
