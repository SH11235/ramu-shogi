// 開始局面セレクター
// ローカル対局・オンライン対局で共通使用

import type { ReactElement } from "react";
import { useState } from "react";
import { Input } from "./input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select";

// ─── プリセット定義 ────────────────────────────────────────────────────────────

export interface PositionPreset {
    /** API に送信する startSfen 値（"startpos" または "handicap:xxx" または SFEN 文字列） */
    value: string;
    label: string;
    /** 選択時に表示する補助説明 */
    description?: string;
}

/** v0.1 プリセット一覧（仕様書 §5.2 準拠） */
export const POSITION_PRESETS: PositionPreset[] = [
    { value: "startpos", label: "平手" },
    {
        value: "handicap:bishop",
        label: "角落ち",
        description: "後手（上手）の角行なし。先手（下手）が先に指します。",
    },
    {
        value: "handicap:rook",
        label: "飛車落ち",
        description: "後手（上手）の飛車なし。先手（下手）が先に指します。",
    },
    {
        value: "handicap:rook-bishop",
        label: "飛車角落ち",
        description: "後手（上手）の飛車・角なし。先手（下手）が先に指します。",
    },
    { value: "custom", label: "SFEN 直接入力" },
];

const CUSTOM_VALUE = "custom";

// ─── バリデーション ────────────────────────────────────────────────────────────

function validateCustomSfen(sfen: string): string | null {
    if (!sfen.trim()) return "局面（SFEN）を入力してください";

    // SFEN形式: 「盤面 手番 持駒 手数」をスペース区切りで
    const parts = sfen.trim().split(/\s+/);
    if (parts.length < 3)
        return "有効な局面ではありません（例: lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1）";

    const [board, turn] = parts;

    // 盤面: スラッシュで9段に分かれていること
    const rows = board.split("/");
    if (rows.length !== 9) return "盤面の形式が正しくありません（スラッシュ区切りで9段必要）";

    // 手番: b（先手）または w（後手）
    if (turn !== "b" && turn !== "w") return "手番の指定が正しくありません（b = 先手 / w = 後手）";

    return null;
}

// ─── コンポーネント ────────────────────────────────────────────────────────────

export interface PositionPresetSelectorProps {
    /** 現在選択されている startSfen 値 */
    value: string;
    /** 変更時コールバック（startSfen 文字列を渡す） */
    onChange: (sfen: string) => void;
}

/**
 * 開始局面セレクター。
 * プリセット選択 + SFEN 直接入力に対応。
 * ローカル対局・オンライン対局ルーム作成ダイアログで共用する。
 */
export function PositionPresetSelector({
    value,
    onChange,
}: PositionPresetSelectorProps): ReactElement {
    // プリセットの中に一致するものがあるかチェック
    const isPreset = POSITION_PRESETS.some((p) => p.value !== CUSTOM_VALUE && p.value === value);
    const selectValue = isPreset ? value : CUSTOM_VALUE;
    const [customSfen, setCustomSfen] = useState(isPreset ? "" : value);
    const [sfenError, setSfenError] = useState<string | null>(null);
    const selectedPreset = POSITION_PRESETS.find((p) => p.value === selectValue);

    function handleSelectChange(selected: string): void {
        setSfenError(null);
        if (selected === CUSTOM_VALUE) {
            // カスタム入力モードへ切り替え（現在のカスタム SFEN を維持）
            onChange(customSfen);
        } else {
            onChange(selected);
        }
    }

    function handleCustomInput(input: string): void {
        setCustomSfen(input);
        const error = validateCustomSfen(input);
        setSfenError(error);
        if (!error) {
            onChange(input);
        }
    }

    return (
        <div className="flex flex-col gap-2">
            <Select value={selectValue} onValueChange={handleSelectChange}>
                <SelectTrigger aria-label="開始局面を選択">
                    <SelectValue placeholder="開始局面を選択..." />
                </SelectTrigger>
                <SelectContent>
                    {POSITION_PRESETS.map((preset) => (
                        <SelectItem key={preset.value} value={preset.value}>
                            {preset.label}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
            {selectedPreset?.description && (
                <p className="text-xs text-muted-foreground">{selectedPreset.description}</p>
            )}
            {selectValue === CUSTOM_VALUE && (
                <>
                    <Input
                        placeholder="例: lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1"
                        value={customSfen}
                        onChange={(e) => handleCustomInput(e.target.value)}
                        className={`font-mono text-xs ${sfenError ? "border-destructive focus-visible:ring-destructive" : ""}`}
                        aria-invalid={sfenError !== null}
                    />
                    {sfenError && <p className="text-xs text-destructive">{sfenError}</p>}
                </>
            )}
        </div>
    );
}
