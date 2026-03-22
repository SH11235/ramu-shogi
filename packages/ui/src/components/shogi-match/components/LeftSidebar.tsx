import type { NnueSelection } from "@shogi/app-core";
import { NONE_NNUE_SELECTION } from "@shogi/app-core";
import type { SkillLevelSettings } from "@shogi/engine-client";
import type { ReactElement } from "react";
import { Input } from "../../input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../select";
import { Switch } from "../../switch";
import { useMatchSettings } from "../contexts/MatchSettingsContext";
import { buildThreadOptions } from "../utils/threadOptions";
import { PlayerIcon } from "./PlayerIcon";
import { SkillLevelSelector } from "./SkillLevelSelector";

type SideKey = "sente" | "gote";

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
        analysisEngineId,
        onAnalysisEngineIdChange,
        onOpenNnueManager,
        onOpenDisplaySettings,
        onOpenPassRightsSettings,
        engineOptions,
        onOpenEngineManager,
        onOpenEngineSettings,
    } = useMatchSettings();

    const externalEngines = engineOptions?.filter((e) => e.kind === "external") ?? [];
    const availableEngines = engineOptions ?? [];

    const threadOptions = buildThreadOptions();

    // カスタム NNUE（プリセット以外）のフィルタリング
    const customNnueList = nnueList.filter((n) => n.source !== "preset");

    // プレイヤー選択の値を生成: "human", "material", "preset:{presetKey}", "nnue:{nnueId}", "ext:{engineId}"
    const getSelectorValue = (
        side: SideKey,
        setting: { role: string; engineId?: string },
    ): string => {
        if (setting.role === "human") return "human";
        // 外部エンジンの場合
        if (setting.engineId && externalEngines.some((e) => e.id === setting.engineId)) {
            return `ext:${setting.engineId}`;
        }
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
        } else if (value.startsWith("ext:")) {
            // 外部エンジンに変更
            handleTimeEnabledChange(side, true);
            const engineId = value.slice("ext:".length);
            onSidesChange({
                ...sides,
                [side]: {
                    role: "engine",
                    engineId,
                    skillLevel: undefined,
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
                            {/* 外部エンジン */}
                            {externalEngines.map((engine) => (
                                <SelectItem key={engine.id} value={`ext:${engine.id}`}>
                                    <span className="flex items-center gap-1.5">
                                        <PlayerIcon
                                            side="sente"
                                            isAI
                                            showBorder={false}
                                            size="xs"
                                        />
                                        {engine.label}
                                    </span>
                                </SelectItem>
                            ))}
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
                {isDevMode && (
                    <div className={labelClassName}>
                        <span>スレッド数</span>
                        <select
                            value={String(engineThreads[side])}
                            disabled={settingsLocked}
                            onChange={(e) =>
                                onEngineThreadsChange({
                                    ...engineThreads,
                                    [side]: Number(e.target.value),
                                })
                            }
                            className={inputClassName}
                        >
                            {threadOptions.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                </option>
                            ))}
                        </select>
                        <span className="text-[11px] text-muted-foreground">0 = 自動</span>
                    </div>
                )}
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

                {onAnalysisEngineIdChange && availableEngines.length > 0 && (
                    <div className={labelClassName}>
                        <span>解析エンジン</span>
                        <select
                            value={analysisEngineId ?? internalEngineId}
                            disabled={settingsLocked}
                            onChange={(e) => onAnalysisEngineIdChange(e.target.value)}
                            className={inputClassName}
                        >
                            {availableEngines.map((engine) => (
                                <option key={engine.id} value={engine.id}>
                                    {engine.label}
                                </option>
                            ))}
                        </select>
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

            {/* 外部エンジン管理（available な場合のみ） */}
            {onOpenEngineManager && (
                <button
                    type="button"
                    onClick={onOpenEngineManager}
                    className="w-full text-left px-3 py-2 rounded-lg text-sm text-wafuu-sumi bg-wafuu-washi border-2 border-wafuu-border shadow-sm hover:shadow-md hover:-translate-y-0.5 hover:border-wafuu-kincha transition-all flex items-center gap-2"
                >
                    <span>⚙️</span>
                    <span>外部エンジン管理...</span>
                </button>
            )}

            {/* 起動中外部エンジンの設定 */}
            {onOpenEngineSettings && (
                <>
                    {(["sente", "gote"] as const).map((side) => {
                        const setting = sides[side];
                        if (setting.role !== "engine") return null;
                        const engineId = setting.engineId;
                        const engine = engineOptions?.find((e) => e.id === engineId);
                        if (!engine || engine.kind !== "external") return null;
                        const sideLabel = side === "sente" ? "先手" : "後手";
                        return (
                            <button
                                key={`engine-settings-${side}`}
                                type="button"
                                onClick={() => onOpenEngineSettings(side)}
                                className="w-full text-left px-3 py-2 rounded-lg text-sm text-wafuu-sumi bg-wafuu-washi border-2 border-wafuu-border shadow-sm hover:shadow-md hover:-translate-y-0.5 hover:border-wafuu-kincha transition-all flex items-center gap-2"
                            >
                                <span>{side === "sente" ? "☗" : "☖"}</span>
                                <span>
                                    {sideLabel} {engine.label} 設定...
                                </span>
                            </button>
                        );
                    })}
                    {(() => {
                        const aEngine = engineOptions?.find((e) => e.id === analysisEngineId);
                        if (!aEngine || aEngine.kind !== "external") return null;
                        return (
                            <button
                                type="button"
                                onClick={() => onOpenEngineSettings("analysis")}
                                className="w-full text-left px-3 py-2 rounded-lg text-sm text-wafuu-sumi bg-wafuu-washi border-2 border-wafuu-border shadow-sm hover:shadow-md hover:-translate-y-0.5 hover:border-wafuu-kincha transition-all flex items-center gap-2"
                            >
                                <span>🔍</span>
                                <span>解析 {aEngine.label} 設定...</span>
                            </button>
                        );
                    })()}
                </>
            )}

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
