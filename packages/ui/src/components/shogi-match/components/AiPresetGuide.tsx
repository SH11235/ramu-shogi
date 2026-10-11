import type { PresetWithStatus } from "@shogi/app-core";
import type { ReactElement } from "react";

export function AiPresetGuide({ presets }: { presets: PresetWithStatus[] }): ReactElement | null {
    const guidedPresets = presets.filter(({ config }) => config.usageLabel && config.description);
    if (guidedPresets.length === 0) return null;

    return (
        <div className="flex flex-col gap-1 rounded-md bg-muted p-2 text-xs text-muted-foreground">
            <div className="font-medium text-foreground">AIの選び方</div>
            {guidedPresets.map(({ config }) => (
                <p key={config.presetKey}>
                    <span className="font-medium text-foreground">
                        {config.displayName}（{config.usageLabel}）：
                    </span>
                    {config.description}
                </p>
            ))}
        </div>
    );
}
