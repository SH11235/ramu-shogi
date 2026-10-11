import type { ReactElement } from "react";
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
    return (
        <section
            id="board-display-settings"
            aria-label="表示設定"
            className="flex flex-col gap-4 rounded-lg border border-wafuu-border bg-wafuu-washi p-3"
        >
            <label className="flex flex-col gap-2 text-sm">
                <span>マス内座標表示</span>
                <select
                    value={settings.squareNotation}
                    onChange={(event) =>
                        onChange({
                            ...settings,
                            squareNotation: event.target.value as DisplaySettings["squareNotation"],
                        })
                    }
                    className="rounded border border-wafuu-border bg-wafuu-washi px-2 py-1.5 text-wafuu-sumi"
                >
                    <option value="none">なし</option>
                    <option value="sfen">SFEN (5e)</option>
                    <option value="japanese">日本式 (５五)</option>
                </select>
            </label>
            {toggles.map(({ key, label }) => (
                <label key={key} className="flex cursor-pointer items-center gap-3 text-sm">
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
