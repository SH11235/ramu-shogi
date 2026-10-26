import type { ReactElement } from "react";
import { BOARD_PATTERN_OPTIONS, type BoardPattern } from "../../board-appearance";
import { NativeSelect } from "../../native-select";
import {
    BOARD_PATTERN_LABEL,
    DISPLAY_TOGGLE_CHECKBOX_CLASS,
    DISPLAY_TOGGLE_HINTS,
    DISPLAY_TOGGLE_LABELS,
    type DisplayToggleKey,
    SQUARE_NOTATION_LABEL,
    SQUARE_NOTATION_OPTIONS,
} from "../displaySettingsFields";
import { useBoardPattern } from "../hooks/useBoardPattern";
import type { DisplaySettings } from "../types";

interface DisplaySettingsPanelProps {
    settings: DisplaySettings;
    onChange: (settings: DisplaySettings) => void;
}

const TOGGLES: DisplayToggleKey[] = [
    "showBoardLabels",
    "highlightLastMove",
    "showKifuEval",
    "showSearchInfo",
    "enableWheelNavigation",
];

export function DisplaySettingsPanel({
    settings,
    onChange,
}: DisplaySettingsPanelProps): ReactElement {
    const [boardPattern, setBoardPattern] = useBoardPattern();
    return (
        <section
            id="board-display-settings"
            aria-label="表示設定"
            className="flex flex-col gap-4 border-t border-wafuu-border p-3"
        >
            <label className="flex flex-col gap-2 text-sm">
                <span>{SQUARE_NOTATION_LABEL}</span>
                <NativeSelect
                    value={settings.squareNotation}
                    onChange={(event) =>
                        onChange({
                            ...settings,
                            squareNotation: event.target.value as DisplaySettings["squareNotation"],
                        })
                    }
                >
                    {SQUARE_NOTATION_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                            {opt.label}
                        </option>
                    ))}
                </NativeSelect>
            </label>
            <label className="flex flex-col gap-2 text-sm">
                <span>{BOARD_PATTERN_LABEL}</span>
                <NativeSelect
                    value={boardPattern}
                    onChange={(event) => setBoardPattern(event.target.value as BoardPattern)}
                >
                    {BOARD_PATTERN_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                            {opt.label}
                        </option>
                    ))}
                </NativeSelect>
            </label>
            {TOGGLES.map((key) => (
                <label
                    key={key}
                    className="flex cursor-pointer items-center gap-3 text-sm"
                    title={DISPLAY_TOGGLE_HINTS[key]}
                >
                    <input
                        type="checkbox"
                        checked={settings[key]}
                        onChange={(event) => onChange({ ...settings, [key]: event.target.checked })}
                        className={DISPLAY_TOGGLE_CHECKBOX_CLASS}
                    />
                    <span>{DISPLAY_TOGGLE_LABELS[key]}</span>
                </label>
            ))}
        </section>
    );
}
