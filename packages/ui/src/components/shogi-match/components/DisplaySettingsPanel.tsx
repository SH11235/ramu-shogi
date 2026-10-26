import type { ReactElement } from "react";
import { NativeSelect } from "../../native-select";
import type { BoardPattern } from "../hooks/useBoardPattern";
import { BOARD_PATTERN_OPTIONS, useBoardPattern } from "../hooks/useBoardPattern";
import type { DisplaySettings } from "../types";

interface DisplaySettingsPanelProps {
    settings: DisplaySettings;
    onChange: (settings: DisplaySettings) => void;
}

const toggles = [
    { key: "showBoardLabels", label: "盤外ラベル表示（筋・段）" },
    { key: "highlightLastMove", label: "最終手を強調" },
    { key: "showKifuEval", label: "棋譜パネルに評価値を表示" },
    { key: "showSearchInfo", label: "探索情報 (NPS/深さ) を表示" },
    { key: "enableWheelNavigation", label: "ホイールナビゲーション" },
] as const;

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
                <span>マス内座標表示</span>
                <NativeSelect
                    value={settings.squareNotation}
                    onChange={(event) =>
                        onChange({
                            ...settings,
                            squareNotation: event.target.value as DisplaySettings["squareNotation"],
                        })
                    }
                >
                    <option value="none">なし</option>
                    <option value="sfen">SFEN (5e)</option>
                    <option value="japanese">日本式 (５五)</option>
                </NativeSelect>
            </label>
            <label className="flex flex-col gap-2 text-sm">
                <span>盤の模様</span>
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
            {toggles.map(({ key, label }) => (
                <label
                    key={key}
                    className="flex cursor-pointer items-center gap-3 text-sm"
                    title={
                        key === "enableWheelNavigation"
                            ? "盤面上でマウスホイールを下に回すと棋譜を1手進め、上に回すと1手戻します。対局中は無効です。"
                            : undefined
                    }
                >
                    <input
                        type="checkbox"
                        checked={settings[key]}
                        onChange={(event) => onChange({ ...settings, [key]: event.target.checked })}
                        className="h-4 w-4"
                    />
                    <span>{label}</span>
                </label>
            ))}
        </section>
    );
}
