import type { NnueSelection } from "@shogi/app-core";
import { detectParallelism, NONE_NNUE_SELECTION } from "@shogi/app-core";
import type { SkillLevelSettings } from "@shogi/engine-client";
import type { ReactElement } from "react";
import { Input } from "../../input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../select";
import { Switch } from "../../switch";
import { useAnalysis } from "../contexts/AnalysisContext";
import { useMatchSettings } from "../contexts/MatchSettingsContext";
import { PlayerIcon } from "./PlayerIcon";
import { SkillLevelSelector } from "./SkillLevelSelector";

type SideKey = "sente" | "gote";

const PARALLEL_WORKER_OPTIONS = [
    { value: 0, label: "自動" },
    { value: 1, label: "1" },
    { value: 2, label: "2" },
    { value: 3, label: "3" },
    { value: 4, label: "4" },
];

const ANALYSIS_TIME_OPTIONS = [
    { value: 500, label: "0.5秒" },
    { value: 1000, label: "1秒" },
    { value: 2000, label: "2秒" },
    { value: 3000, label: "3秒" },
];

const EVAL_FILE_MANAGER_LABEL = "評価関数ファイル管理";
const SETTINGS_LOCKED_MESSAGE = "対局中は変更不可";
const sectionClassName = "flex flex-col gap-3";
const sectionTitleClassName = "text-sm font-semibold text-wafuu-sumi";
const labelClassName = "flex flex-col gap-1 text-xs text-muted-foreground";
const inputClassName = "border border-wafuu-border bg-wafuu-washi text-sm text-xs";

/**
 * 左サイドバーコンポーネント
 * 対局設定、分析設定、NNUE管理、表示設定を含む
 *
 * 対局設定は MatchSettingsContext から取得
 * 分析設定は AnalysisContext から取得
 */
export function LeftSidebar(): ReactElement {
    // 分析設定は Context から取得
    const {
        analysisSettings,
        onAnalysisSettingsChange,
        analysisNnueSelection,
        onAnalysisNnueSelectionChange,
    } = useAnalysis();
    // 対局設定は Context から取得
    const {
        sides,
        onSidesChange,
        timeSettings,
        onTimeSettingsChange,
        passRightsSettings,
        onPassRightsSettingsChange,
        settingsLocked,
        isDevMode,
        engineThreads,
        onEngineThreadsChange,
        internalEngineId,
        nnueList,
        presets,
        senteNnueSelection,
        onSenteNnueSelectionChange,
        goteNnueSelection,
        onGoteNnueSelectionChange,
        onOpenNnueManager,
        onOpenDisplaySettings,
        onOpenPassRightsSettings,
    } = useMatchSettings();

    const parallelismConfig = detectParallelism();

    // カスタム NNUE（プリセット以外）のフィルタリング
    const customNnueList = nnueList.filter((n) => n.source !== "preset");

    // プレイヤー選択の値を生成: "human", "material", "preset:{presetKey}", "nnue:{nnueId}"
    const getSelectorValue = (side: SideKey, setting: { role: string }): string => {
        if (setting.role === "human") return "human";
        const selection = side === "sente" ? senteNnueSelection : goteNnueSelection;
        if (selection.presetKey) return `preset:${selection.presetKey}`;
        if (selection.nnueId) return `nnue:${selection.nnueId}`;
        return "material";
    };

    const handlePlayerChange = (side: SideKey, value: string) => {
        const currentSetting = sides[side];
        const updateNnueSelection = (nextSelection: NnueSelection) => {
            if (side === "sente") {
                onSenteNnueSelectionChange(nextSelection);
            } else {
                onGoteNnueSelectionChange(nextSelection);
            }
        };
        if (value === "human") {
            // 人間プレイヤーに変更したときは時間無制限にする
            handleTimeEnabledChange(side, false);
            onSidesChange({
                ...sides,
                [side]: {
                    role: "human",
                    engineId: undefined,
                    skillLevel: undefined,
                },
            });
        } else if (value === "material") {
            // AIプレイヤーに変更したときは時間制限を有効にする
            handleTimeEnabledChange(side, true);
            updateNnueSelection(NONE_NNUE_SELECTION);
            onSidesChange({
                ...sides,
                [side]: {
                    role: "engine",
                    engineId: internalEngineId,
                    skillLevel: currentSetting.skillLevel,
                },
            });
        } else if (value.startsWith("preset:")) {
            // AIプレイヤーに変更したときは時間制限を有効にする
            handleTimeEnabledChange(side, true);
            const presetKey = value.slice("preset:".length);
            updateNnueSelection({ presetKey, nnueId: null });
            onSidesChange({
                ...sides,
                [side]: {
                    role: "engine",
                    engineId: internalEngineId,
                    skillLevel: currentSetting.skillLevel,
                },
            });
        } else if (value.startsWith("nnue:")) {
            // AIプレイヤーに変更したときは時間制限を有効にする
            handleTimeEnabledChange(side, true);
            const nnueId = value.slice("nnue:".length);
            updateNnueSelection({ presetKey: null, nnueId });
            onSidesChange({
                ...sides,
                [side]: {
                    role: "engine",
                    engineId: internalEngineId,
                    skillLevel: currentSetting.skillLevel,
                },
            });
        }
    };

    const handleSkillLevelChange = (side: SideKey, skillLevel: SkillLevelSettings | undefined) => {
        onSidesChange({
            ...sides,
            [side]: { ...sides[side], skillLevel },
        });
    };

    const handleTimeChange = (side: SideKey, field: "mainMs" | "byoyomiMs", inputValue: string) => {
        const parsed = Number(inputValue);
        if (Number.isNaN(parsed) || parsed < 0) return;
        const MAX_SECONDS = 86400;
        const clampedSeconds = Math.min(Math.floor(parsed), MAX_SECONDS);
        onTimeSettingsChange({
            ...timeSettings,
            [side]: {
                ...timeSettings[side],
                [field]: clampedSeconds * 1000,
            },
        });
    };

    const handleTimeEnabledChange = (side: SideKey, enabled: boolean) => {
        onTimeSettingsChange({
            ...timeSettings,
            [side]: {
                ...timeSettings[side],
                enabled,
            },
        });
    };

    const sideColumn = (side: SideKey, hasBorder: boolean) => {
        const setting = sides[side];
        const selectorValue = getSelectorValue(side, setting);

        return (
            <div
                className={`flex flex-col gap-2 ${hasBorder ? "border-r-2 border-wafuu-sumi/20 pr-3" : "pl-3"}`}
            >
                <div className={labelClassName}>
                    <span>プレイヤー</span>
                    <Select
                        value={selectorValue}
                        onValueChange={(value) => handlePlayerChange(side, value)}
                        disabled={settingsLocked}
                    >
                        <SelectTrigger title={settingsLocked ? SETTINGS_LOCKED_MESSAGE : undefined}>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="human">人間</SelectItem>
                            {/* プリセット NNUE（未ダウンロードでも選択可能） */}
                            {presets.map((preset) => (
                                <SelectItem
                                    key={preset.config.presetKey}
                                    value={`preset:${preset.config.presetKey}`}
                                >
                                    <span className="flex items-center gap-1.5">
                                        <PlayerIcon
                                            side="sente"
                                            isAI
                                            showBorder={false}
                                            size="xs"
                                        />
                                        AI（{preset.config.displayName}）
                                    </span>
                                </SelectItem>
                            ))}
                            {/* カスタム NNUE（ダウンロード済み） */}
                            {customNnueList.map((nnue) => (
                                <SelectItem key={nnue.id} value={`nnue:${nnue.id}`}>
                                    <span className="flex items-center gap-1.5">
                                        <PlayerIcon
                                            side="sente"
                                            isAI
                                            showBorder={false}
                                            size="xs"
                                        />
                                        {nnue.displayName}
                                    </span>
                                </SelectItem>
                            ))}
                            <SelectItem value="material">
                                <span className="flex items-center gap-1.5">
                                    <PlayerIcon side="sente" isAI showBorder={false} size="xs" />
                                    簡易AI（駒得）
                                </span>
                            </SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                {/* レイアウトシフト防止のため固定高さを確保 */}
                <div className="min-h-[4rem] flex items-center">
                    {setting.role === "engine" ? (
                        <SkillLevelSelector
                            value={setting.skillLevel}
                            onChange={(skillLevel) => handleSkillLevelChange(side, skillLevel)}
                            disabled={settingsLocked}
                        />
                    ) : (
                        <div className="flex items-center justify-between gap-2 w-full">
                            <span className="text-xs text-muted-foreground">時間制限</span>
                            <Switch
                                checked={timeSettings[side].enabled}
                                onCheckedChange={(enabled) =>
                                    handleTimeEnabledChange(side, enabled)
                                }
                                disabled={settingsLocked}
                            />
                        </div>
                    )}
                </div>
                <div className={labelClassName}>
                    <span>持ち時間(秒)</span>
                    <Input
                        type="number"
                        min={0}
                        max={86400}
                        value={Math.floor(timeSettings[side].mainMs / 1000)}
                        disabled={settingsLocked || !timeSettings[side].enabled}
                        title={
                            settingsLocked
                                ? SETTINGS_LOCKED_MESSAGE
                                : !timeSettings[side].enabled
                                  ? "時間制限を有効にしてください"
                                  : undefined
                        }
                        className={inputClassName}
                        onChange={(e) => handleTimeChange(side, "mainMs", e.target.value)}
                    />
                </div>
                <div className={labelClassName}>
                    <span>秒読み(秒)</span>
                    <Input
                        type="number"
                        min={0}
                        max={86400}
                        value={Math.floor(timeSettings[side].byoyomiMs / 1000)}
                        disabled={settingsLocked || !timeSettings[side].enabled}
                        title={
                            settingsLocked
                                ? SETTINGS_LOCKED_MESSAGE
                                : !timeSettings[side].enabled
                                  ? "時間制限を有効にしてください"
                                  : undefined
                        }
                        className={inputClassName}
                        onChange={(e) => handleTimeChange(side, "byoyomiMs", e.target.value)}
                    />
                </div>
            </div>
        );
    };

    return (
        <div className="w-96 self-center overflow-y-auto bg-wafuu-washi-warm border border-wafuu-border rounded-xl p-4 flex flex-col gap-6">
            {/* 対局設定 */}
            <div className={sectionClassName}>
                <div className={sectionTitleClassName}>対局設定</div>
                {/* 先手/後手ラベル + 入替ボタン */}
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1 mb-1">
                    <div className="text-xs font-semibold text-wafuu-shu text-center">☗先手</div>
                    <button
                        type="button"
                        onClick={() => {
                            onSidesChange({ sente: sides.gote, gote: sides.sente });
                            onTimeSettingsChange({
                                sente: timeSettings.gote,
                                gote: timeSettings.sente,
                            });
                            onSenteNnueSelectionChange(goteNnueSelection);
                            onGoteNnueSelectionChange(senteNnueSelection);
                            onPassRightsSettingsChange({
                                ...passRightsSettings,
                                senteInitialCount: passRightsSettings.goteInitialCount,
                                goteInitialCount: passRightsSettings.senteInitialCount,
                            });
                        }}
                        disabled={settingsLocked}
                        title={
                            settingsLocked
                                ? SETTINGS_LOCKED_MESSAGE
                                : "先手と後手の設定を入れ替える"
                        }
                        className="px-1.5 py-0.5 text-sm text-muted-foreground hover:text-wafuu-kincha hover:bg-wafuu-kincha/10 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        ⇄
                    </button>
                    <div className="text-xs font-semibold text-wafuu-ai text-center">☖後手</div>
                </div>
                {/* 先手/後手設定 */}
                <div className="grid grid-cols-2">
                    {sideColumn("sente", true)}
                    {sideColumn("gote", false)}
                </div>

                {/* 変則ルール */}
                <button
                    type="button"
                    onClick={onOpenPassRightsSettings}
                    disabled={settingsLocked}
                    title={settingsLocked ? SETTINGS_LOCKED_MESSAGE : "変則ルール設定を開く"}
                    className="w-full text-left px-3 py-2 rounded-lg text-sm text-wafuu-sumi bg-wafuu-washi border-2 border-wafuu-border shadow-sm hover:shadow-md hover:-translate-y-0.5 hover:border-wafuu-kincha transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-sm disabled:hover:translate-y-0 disabled:hover:border-wafuu-border flex items-center gap-2"
                >
                    <span>🎲</span>
                    <span>
                        変則ルール...
                        {passRightsSettings.enabled && (
                            <span className="ml-2 text-xs text-muted-foreground">
                                (パス権: ☗{passRightsSettings.senteInitialCount}/☖
                                {passRightsSettings.goteInitialCount})
                            </span>
                        )}
                    </span>
                </button>

                {isDevMode && (
                    <div className="mt-2 flex flex-col gap-1">
                        <span className="text-xs text-muted-foreground">スレッド数</span>
                        <Input
                            type="number"
                            min={0}
                            value={engineThreads}
                            disabled={settingsLocked}
                            title={settingsLocked ? SETTINGS_LOCKED_MESSAGE : "0=自動"}
                            className={inputClassName}
                            onChange={(e) => {
                                const parsed = Number(e.target.value);
                                if (Number.isNaN(parsed)) return;
                                onEngineThreadsChange(Math.max(0, Math.trunc(parsed)));
                            }}
                        />
                        <span className="text-[11px] text-muted-foreground">
                            0 = 自動（次回初期化時に反映）
                        </span>
                    </div>
                )}
            </div>

            {/* NNUE 管理 */}
            <button
                type="button"
                onClick={onOpenNnueManager}
                className="w-full text-left px-3 py-2 rounded-lg text-sm text-wafuu-sumi bg-wafuu-washi border-2 border-wafuu-border shadow-sm hover:shadow-md hover:-translate-y-0.5 hover:border-wafuu-kincha transition-all flex items-center gap-2"
            >
                <span>📁</span>
                <span>{EVAL_FILE_MANAGER_LABEL}...</span>
            </button>

            {/* 分析設定 */}
            <div className={sectionClassName}>
                <div className={sectionTitleClassName}>分析設定</div>

                {/* 分析用 NNUE 選択 */}
                <div className={labelClassName}>
                    <span>
                        将棋エンジンの評価関数（
                        <button
                            type="button"
                            onClick={onOpenNnueManager}
                            className="text-wafuu-ai hover:underline"
                        >
                            {EVAL_FILE_MANAGER_LABEL}
                        </button>
                        から追加）
                    </span>
                    <Select
                        value={
                            analysisNnueSelection.presetKey
                                ? `preset:${analysisNnueSelection.presetKey}`
                                : analysisNnueSelection.nnueId
                                  ? `nnue:${analysisNnueSelection.nnueId}`
                                  : "material"
                        }
                        onValueChange={(value) => {
                            if (value === "material") {
                                onAnalysisNnueSelectionChange(NONE_NNUE_SELECTION);
                            } else if (value.startsWith("preset:")) {
                                const presetKey = value.slice("preset:".length);
                                onAnalysisNnueSelectionChange({ presetKey, nnueId: null });
                            } else if (value.startsWith("nnue:")) {
                                const nnueId = value.slice("nnue:".length);
                                onAnalysisNnueSelectionChange({ presetKey: null, nnueId });
                            }
                        }}
                    >
                        <SelectTrigger>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {/* プリセット NNUE */}
                            {presets.map((preset) => (
                                <SelectItem
                                    key={preset.config.presetKey}
                                    value={`preset:${preset.config.presetKey}`}
                                >
                                    {preset.config.displayName}
                                </SelectItem>
                            ))}
                            {/* カスタム NNUE */}
                            {customNnueList.map((nnue) => (
                                <SelectItem key={nnue.id} value={`nnue:${nnue.id}`}>
                                    {nnue.displayName}
                                </SelectItem>
                            ))}
                            <SelectItem value="material">簡易AI（駒得）</SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                {/* 並列数 */}
                <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">並列数</span>
                    <div className="flex gap-1 flex-wrap">
                        {PARALLEL_WORKER_OPTIONS.map((opt) => (
                            <button
                                key={opt.value}
                                type="button"
                                onClick={() =>
                                    onAnalysisSettingsChange({
                                        ...analysisSettings,
                                        parallelWorkers: opt.value,
                                    })
                                }
                                className={`px-2 py-1 rounded text-xs transition-colors ${
                                    analysisSettings.parallelWorkers === opt.value
                                        ? "bg-wafuu-kincha text-white"
                                        : "bg-wafuu-washi text-wafuu-sumi hover:bg-wafuu-border"
                                }`}
                            >
                                {opt.value === 0
                                    ? `自動(${parallelismConfig.recommendedWorkers})`
                                    : opt.label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* 解析時間 */}
                <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">解析時間</span>
                    <div className="flex gap-1 flex-wrap">
                        {ANALYSIS_TIME_OPTIONS.map((opt) => (
                            <button
                                key={opt.value}
                                type="button"
                                onClick={() =>
                                    onAnalysisSettingsChange({
                                        ...analysisSettings,
                                        batchAnalysisTimeMs: opt.value,
                                    })
                                }
                                className={`px-2 py-1 rounded text-xs transition-colors ${
                                    analysisSettings.batchAnalysisTimeMs === opt.value
                                        ? "bg-wafuu-kincha text-white"
                                        : "bg-wafuu-washi text-wafuu-sumi hover:bg-wafuu-border"
                                }`}
                            >
                                {opt.label}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* 表示設定 */}
            <button
                type="button"
                onClick={onOpenDisplaySettings}
                className="w-full text-left px-3 py-2 rounded-lg text-sm text-wafuu-sumi bg-wafuu-washi border-2 border-wafuu-border shadow-sm hover:shadow-md hover:-translate-y-0.5 hover:border-wafuu-kincha transition-all flex items-center gap-2"
            >
                <span>👁️</span>
                <span>表示設定...</span>
            </button>
        </div>
    );
}
