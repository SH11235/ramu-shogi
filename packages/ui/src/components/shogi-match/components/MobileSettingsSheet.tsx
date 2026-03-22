import type { NnueMeta, NnueSelection, PresetWithStatus } from "@shogi/app-core";
import { NONE_NNUE_SELECTION } from "@shogi/app-core";
import type { SkillLevelSettings } from "@shogi/engine-client";
import type { ReactElement } from "react";
import { useEffect, useRef, useState } from "react";
import { Switch } from "../../switch";
import type { ClockSettings } from "../hooks/useClockManager";
import type {
    DisplaySettings,
    EngineOption,
    EngineThreadSettings,
    PassRightsSettings,
    SideSetting,
    SquareNotation,
} from "../types";
import type { KifMoveData } from "../utils/kifParser";
import { parseKif, parseSfen } from "../utils/kifParser";
import { buildThreadOptions } from "../utils/threadOptions";
import { SkillLevelSelector } from "./SkillLevelSelector";

type SideKey = "sente" | "gote";

// =============================================================================
// NumericInput: 文字列ベースの数値入力コンポーネント
// =============================================================================

interface NumericInputProps {
    id: string;
    value: number;
    onChange: (value: number) => void;
    disabled?: boolean;
    min?: number;
    className?: string;
}

/**
 * 編集中は空欄を許容し、blur時に数値変換する入力コンポーネント
 * - type="text" + inputMode="numeric" でモバイルで数字キーボードを表示
 * - 「0を消して3を入力」のような自然な操作が可能
 */
function NumericInput({
    id,
    value,
    onChange,
    disabled = false,
    min = 0,
    className,
}: NumericInputProps): ReactElement {
    const [inputValue, setInputValue] = useState(String(value));

    // 外部からの値変更を反映（ただし編集中でない場合のみ）
    useEffect(() => {
        setInputValue(String(value));
    }, [value]);

    const handleBlur = () => {
        // 空文字や無効な値は min に正規化
        const parsed = parseInt(inputValue, 10);
        const normalized = Number.isNaN(parsed) ? min : Math.max(min, parsed);
        setInputValue(String(normalized));
        onChange(normalized);
    };

    return (
        <input
            id={id}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={inputValue}
            disabled={disabled}
            className={`${className} h-10 rounded-md px-3 py-2`}
            onChange={(e) => setInputValue(e.target.value)}
            onBlur={handleBlur}
        />
    );
}

interface MobileSettingsSheetProps {
    // 対局設定
    sides: { sente: SideSetting; gote: SideSetting };
    onSidesChange: (sides: { sente: SideSetting; gote: SideSetting }) => void;
    analysisEngineId?: string;
    onAnalysisEngineIdChange?: (engineId: string) => void;
    timeSettings: ClockSettings;
    onTimeSettingsChange: (settings: ClockSettings) => void;

    // パス権設定（オプション）
    passRightsSettings?: PassRightsSettings;
    onPassRightsSettingsChange?: (settings: PassRightsSettings) => void;

    // エンジン情報
    internalEngineId: string;
    engineOptions?: EngineOption[];
    nnueList: NnueMeta[];
    presets: PresetWithStatus[];
    senteNnueSelection: NnueSelection;
    onSenteNnueSelectionChange: (selection: NnueSelection) => void;
    goteNnueSelection: NnueSelection;
    onGoteNnueSelectionChange: (selection: NnueSelection) => void;

    // 状態
    settingsLocked: boolean;
    isMatchRunning: boolean;
    isDevMode: boolean;
    engineThreads: EngineThreadSettings;
    onEngineThreadsChange: (threads: EngineThreadSettings) => void;

    // アクション
    onStartMatch?: () => void;
    onStopMatch?: () => void;
    onResetToStartpos?: () => void;
    onOpenEngineManager?: () => void;

    // 表示設定
    displaySettings: DisplaySettings;
    onDisplaySettingsChange: (settings: DisplaySettings) => void;

    // Aboutダイアログを開く
    onOpenAbout?: () => void;

    // 棋譜インポート
    /** SFENインポート時のコールバック */
    onImportSfen?: (sfen: string, moves: string[]) => Promise<void>;
    /** KIFインポート時のコールバック */
    onImportKif?: (moves: string[], moveData: KifMoveData[], startSfen?: string) => Promise<void>;
    /** 局面が準備完了しているか */
    positionReady?: boolean;
}

// iOS Safari は16px未満のinput/selectにフォーカスすると自動ズームするため、text-base(16px)を使用
const selectClassName = "w-full p-2 rounded-lg border border-border bg-background text-base";
const inputClassName = "w-full border border-border bg-background text-base";
const labelClassName = "flex flex-col gap-1 text-sm";

// SkillLevelSelectorの高さを確保してレイアウトシフトを防止
const SKILL_LEVEL_SELECTOR_MIN_HEIGHT = "min-h-[4rem] flex items-center";

// =============================================================================
// KifuImportSection: 棋譜/局面インポートセクション
// =============================================================================

interface KifuImportSectionProps {
    onImportSfen: (sfen: string, moves: string[]) => Promise<void>;
    onImportKif: (moves: string[], moveData: KifMoveData[], startSfen?: string) => Promise<void>;
    positionReady: boolean;
}

function KifuImportSection({
    onImportSfen,
    onImportKif,
    positionReady,
}: KifuImportSectionProps): ReactElement {
    const [isExpanded, setIsExpanded] = useState(false);
    const [inputValue, setInputValue] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);
    const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // コンポーネントアンマウント時にタイマーをクリーンアップ
    useEffect(() => {
        return () => {
            if (successTimerRef.current) {
                clearTimeout(successTimerRef.current);
            }
        };
    }, []);

    const handleImport = async () => {
        if (!inputValue.trim()) {
            setError("入力が空です");
            return;
        }

        setError(null);
        setSuccess(false);
        if (successTimerRef.current) {
            clearTimeout(successTimerRef.current);
            successTimerRef.current = null;
        }

        try {
            const looksLikeKif =
                /#KIF|手数----|開始日時|終了日時|手合割|開始局面|先手：|後手：|持ち時間|表題|棋戦/.test(
                    inputValue,
                ) ||
                /[▲△☗☖]/.test(inputValue) ||
                /[１２３４５６７８９1-9][一二三四五六七八九].*(歩|香|桂|銀|金|角|飛|玉|王|と|馬|龍|竜)/.test(
                    inputValue,
                );

            if (looksLikeKif) {
                const result = parseKif(inputValue);
                if (!result.success) {
                    setError(result.error ?? "KIFのパースに失敗しました");
                    return;
                }
                await onImportKif(result.moves, result.moveData, result.startSfen);
                setSuccess(true);
                setInputValue("");
                successTimerRef.current = setTimeout(() => setSuccess(false), 2000);
                return;
            }

            const { sfen, moves } = parseSfen(inputValue);
            if (!sfen) {
                setError("SFENの形式が正しくありません");
                return;
            }
            await onImportSfen(sfen, moves);
            setSuccess(true);
            setInputValue("");
            successTimerRef.current = setTimeout(() => setSuccess(false), 2000);
        } catch (e) {
            setError(e instanceof Error ? e.message : "インポートに失敗しました");
        }
    };

    return (
        <div className="space-y-2 pt-3 border-t border-border">
            <button
                type="button"
                onClick={() => setIsExpanded(!isExpanded)}
                className="flex items-center justify-between w-full text-left"
            >
                <span className="font-medium text-sm">棋譜/局面インポート</span>
                <span className="text-muted-foreground text-sm">{isExpanded ? "▲" : "▼"}</span>
            </button>

            {isExpanded && (
                <div className="space-y-2 pt-2">
                    <p className="text-xs text-muted-foreground">
                        SFEN形式の局面、またはKIF形式の棋譜を貼り付けてください
                    </p>
                    <textarea
                        value={inputValue}
                        onChange={(e) => {
                            setInputValue(e.target.value);
                            setError(null);
                            setSuccess(false);
                        }}
                        placeholder="startpos moves 7g7f 3c3d&#10;または&#10;1 ７六歩(77)"
                        rows={4}
                        className="w-full p-2 text-base font-mono rounded-md border border-border bg-background resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                        disabled={!positionReady}
                    />
                    {error && <div className="text-xs text-destructive">{error}</div>}
                    <button
                        type="button"
                        onClick={handleImport}
                        disabled={!positionReady || !inputValue.trim()}
                        className={`w-full py-2 text-sm rounded-md border transition-colors ${
                            success
                                ? "bg-green-600 text-white border-green-600"
                                : "bg-primary text-primary-foreground border-primary hover:bg-primary/90"
                        } disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                        {success ? "読み込み完了" : "読み込み"}
                    </button>
                </div>
            )}
        </div>
    );
}

/**
 * モバイル用設定シート（BottomSheet内のコンテンツ）
 */
const NOTATION_OPTIONS: { value: SquareNotation; label: string }[] = [
    { value: "none", label: "非表示" },
    { value: "sfen", label: "SFEN (5e)" },
    { value: "japanese", label: "日本式 (５五)" },
];

export function MobileSettingsSheet({
    sides,
    onSidesChange,
    analysisEngineId,
    onAnalysisEngineIdChange,
    timeSettings,
    onTimeSettingsChange,
    passRightsSettings,
    onPassRightsSettingsChange,
    internalEngineId,
    engineOptions,
    nnueList,
    presets,
    senteNnueSelection,
    onSenteNnueSelectionChange,
    goteNnueSelection,
    onGoteNnueSelectionChange,
    settingsLocked,
    isMatchRunning,
    isDevMode,
    engineThreads,
    onEngineThreadsChange,
    onStartMatch,
    onStopMatch,
    onResetToStartpos,
    onOpenEngineManager,
    displaySettings,
    onDisplaySettingsChange,
    onOpenAbout,
    onImportSfen,
    onImportKif,
    positionReady = true,
}: MobileSettingsSheetProps): ReactElement {
    const threadOptions = buildThreadOptions();
    const externalEngines = engineOptions?.filter((engine) => engine.kind === "external") ?? [];
    // カスタム NNUE（プリセット以外）のフィルタリング
    const customNnueList = nnueList.filter((n) => n.source !== "preset");

    // 選択肢の値を生成: "human", "preset:{presetKey}", "nnue:{nnueId}", "material", "ext:{engineId}"
    const getSelectorValue = (side: SideKey, setting: SideSetting): string => {
        if (setting.role === "human") return "human";
        if (setting.engineId && externalEngines.some((engine) => engine.id === setting.engineId)) {
            return `ext:${setting.engineId}`;
        }
        const selection = side === "sente" ? senteNnueSelection : goteNnueSelection;
        if (selection.presetKey) return `preset:${selection.presetKey}`;
        if (selection.nnueId) return `nnue:${selection.nnueId}`;
        return "material";
    };
    const resolvedAnalysisEngineId =
        analysisEngineId && engineOptions?.some((engine) => engine.id === analysisEngineId)
            ? analysisEngineId
            : internalEngineId;

    const handleTimeEnabledChange = (side: SideKey, enabled: boolean) => {
        onTimeSettingsChange({
            ...timeSettings,
            [side]: {
                ...timeSettings[side],
                enabled,
            },
        });
    };

    const handleSelectorChange = (side: SideKey, value: string) => {
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
                [side]: { role: "human", engineId: undefined, skillLevel: undefined },
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

    return (
        <div className="flex flex-col gap-4 w-full max-w-full overflow-hidden">
            {/* 対局中のロック表示 */}
            {settingsLocked && (
                <div className="flex items-center gap-2 p-2 rounded-lg bg-destructive/10 text-destructive text-sm">
                    <span>対局中は設定を変更できません</span>
                </div>
            )}

            {/* 先手/後手ラベル + 入替ボタン */}
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1 mb-1">
                <div className="text-sm font-semibold text-wafuu-shu text-center">☗先手</div>
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
                        if (passRightsSettings && onPassRightsSettingsChange) {
                            onPassRightsSettingsChange({
                                ...passRightsSettings,
                                senteInitialCount: passRightsSettings.goteInitialCount,
                                goteInitialCount: passRightsSettings.senteInitialCount,
                            });
                        }
                    }}
                    disabled={settingsLocked}
                    title="先手と後手の設定を入れ替える"
                    className="px-2 py-1 text-base text-muted-foreground hover:text-primary hover:bg-primary/10 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    ⇄
                </button>
                <div className="text-sm font-semibold text-wafuu-ai text-center">☖後手</div>
            </div>
            {/* 先手/後手設定（PC版と同じ2列レイアウト） */}
            <div className="grid grid-cols-2 gap-3 [&>div]:min-w-0">
                {/* 先手側 */}
                <div className="flex flex-col gap-2 border-r border-border pr-3">
                    <label className={labelClassName}>
                        <span className="text-xs text-muted-foreground">プレイヤー</span>
                        <select
                            value={getSelectorValue("sente", sides.sente)}
                            onChange={(e) => handleSelectorChange("sente", e.target.value)}
                            disabled={settingsLocked}
                            className={selectClassName}
                        >
                            <option value="human">人間</option>
                            {/* プリセット NNUE */}
                            {presets.map((preset) => (
                                <option
                                    key={preset.config.presetKey}
                                    value={`preset:${preset.config.presetKey}`}
                                >
                                    AI（{preset.config.displayName}）
                                </option>
                            ))}
                            {/* カスタム NNUE */}
                            {customNnueList.map((nnue) => (
                                <option key={nnue.id} value={`nnue:${nnue.id}`}>
                                    {nnue.displayName}
                                </option>
                            ))}
                            <option value="material">簡易AI（駒得）</option>
                            {externalEngines.map((engine) => (
                                <option key={engine.id} value={`ext:${engine.id}`}>
                                    {engine.label}
                                </option>
                            ))}
                        </select>
                    </label>
                    {/* レイアウトシフト防止のため固定高さを確保 */}
                    <div className={SKILL_LEVEL_SELECTOR_MIN_HEIGHT}>
                        {sides.sente.role === "engine" ? (
                            <SkillLevelSelector
                                value={sides.sente.skillLevel}
                                onChange={(sl) => handleSkillLevelChange("sente", sl)}
                                disabled={settingsLocked}
                            />
                        ) : (
                            <div className="flex items-center justify-between gap-2 w-full">
                                <span className="text-sm text-muted-foreground">時間制限</span>
                                <Switch
                                    id="sente-time-enabled"
                                    checked={timeSettings.sente.enabled}
                                    onCheckedChange={(enabled) =>
                                        handleTimeEnabledChange("sente", enabled)
                                    }
                                    disabled={settingsLocked}
                                />
                            </div>
                        )}
                    </div>
                    {isDevMode && (
                        <label htmlFor="mobile-sente-threads" className={labelClassName}>
                            <span className="text-xs text-muted-foreground">スレッド数</span>
                            <select
                                id="mobile-sente-threads"
                                value={engineThreads.sente}
                                disabled={settingsLocked}
                                onChange={(e) =>
                                    onEngineThreadsChange({
                                        ...engineThreads,
                                        sente: Number(e.target.value),
                                    })
                                }
                                className={selectClassName}
                            >
                                {threadOptions.map((opt) => (
                                    <option key={opt.value} value={opt.value}>
                                        {opt.label}
                                    </option>
                                ))}
                            </select>
                            <span className="text-[11px] text-muted-foreground">0 = 自動</span>
                        </label>
                    )}
                    <label htmlFor="mobile-sente-main" className={labelClassName}>
                        <span className="text-xs text-muted-foreground">持ち時間(秒)</span>
                        <NumericInput
                            id="mobile-sente-main"
                            value={Math.floor(timeSettings.sente.mainMs / 1000)}
                            disabled={settingsLocked || !timeSettings.sente.enabled}
                            className={inputClassName}
                            onChange={(v) =>
                                onTimeSettingsChange({
                                    ...timeSettings,
                                    sente: { ...timeSettings.sente, mainMs: v * 1000 },
                                })
                            }
                        />
                    </label>
                    <label htmlFor="mobile-sente-byoyomi" className={labelClassName}>
                        <span className="text-xs text-muted-foreground">秒読み(秒)</span>
                        <NumericInput
                            id="mobile-sente-byoyomi"
                            value={Math.floor(timeSettings.sente.byoyomiMs / 1000)}
                            disabled={settingsLocked || !timeSettings.sente.enabled}
                            className={inputClassName}
                            onChange={(v) =>
                                onTimeSettingsChange({
                                    ...timeSettings,
                                    sente: { ...timeSettings.sente, byoyomiMs: v * 1000 },
                                })
                            }
                        />
                    </label>
                </div>
                {/* 後手側 */}
                <div className="flex flex-col gap-2">
                    <label className={labelClassName}>
                        <span className="text-xs text-muted-foreground">プレイヤー</span>
                        <select
                            value={getSelectorValue("gote", sides.gote)}
                            onChange={(e) => handleSelectorChange("gote", e.target.value)}
                            disabled={settingsLocked}
                            className={selectClassName}
                        >
                            <option value="human">人間</option>
                            {/* プリセット NNUE */}
                            {presets.map((preset) => (
                                <option
                                    key={preset.config.presetKey}
                                    value={`preset:${preset.config.presetKey}`}
                                >
                                    AI（{preset.config.displayName}）
                                </option>
                            ))}
                            {/* カスタム NNUE */}
                            {customNnueList.map((nnue) => (
                                <option key={nnue.id} value={`nnue:${nnue.id}`}>
                                    {nnue.displayName}
                                </option>
                            ))}
                            <option value="material">簡易AI（駒得）</option>
                            {externalEngines.map((engine) => (
                                <option key={engine.id} value={`ext:${engine.id}`}>
                                    {engine.label}
                                </option>
                            ))}
                        </select>
                    </label>
                    {/* レイアウトシフト防止のため固定高さを確保 */}
                    <div className={SKILL_LEVEL_SELECTOR_MIN_HEIGHT}>
                        {sides.gote.role === "engine" ? (
                            <SkillLevelSelector
                                value={sides.gote.skillLevel}
                                onChange={(sl) => handleSkillLevelChange("gote", sl)}
                                disabled={settingsLocked}
                            />
                        ) : (
                            <div className="flex items-center justify-between gap-2 w-full">
                                <span className="text-sm text-muted-foreground">時間制限</span>
                                <Switch
                                    id="gote-time-enabled"
                                    checked={timeSettings.gote.enabled}
                                    onCheckedChange={(enabled) =>
                                        handleTimeEnabledChange("gote", enabled)
                                    }
                                    disabled={settingsLocked}
                                />
                            </div>
                        )}
                    </div>
                    {isDevMode && (
                        <label htmlFor="mobile-gote-threads" className={labelClassName}>
                            <span className="text-xs text-muted-foreground">スレッド数</span>
                            <select
                                id="mobile-gote-threads"
                                value={engineThreads.gote}
                                disabled={settingsLocked}
                                onChange={(e) =>
                                    onEngineThreadsChange({
                                        ...engineThreads,
                                        gote: Number(e.target.value),
                                    })
                                }
                                className={selectClassName}
                            >
                                {threadOptions.map((opt) => (
                                    <option key={opt.value} value={opt.value}>
                                        {opt.label}
                                    </option>
                                ))}
                            </select>
                            <span className="text-[11px] text-muted-foreground">0 = 自動</span>
                        </label>
                    )}
                    <label htmlFor="mobile-gote-main" className={labelClassName}>
                        <span className="text-xs text-muted-foreground">持ち時間(秒)</span>
                        <NumericInput
                            id="mobile-gote-main"
                            value={Math.floor(timeSettings.gote.mainMs / 1000)}
                            disabled={settingsLocked || !timeSettings.gote.enabled}
                            className={inputClassName}
                            onChange={(v) =>
                                onTimeSettingsChange({
                                    ...timeSettings,
                                    gote: { ...timeSettings.gote, mainMs: v * 1000 },
                                })
                            }
                        />
                    </label>
                    <label htmlFor="mobile-gote-byoyomi" className={labelClassName}>
                        <span className="text-xs text-muted-foreground">秒読み(秒)</span>
                        <NumericInput
                            id="mobile-gote-byoyomi"
                            value={Math.floor(timeSettings.gote.byoyomiMs / 1000)}
                            disabled={settingsLocked || !timeSettings.gote.enabled}
                            className={inputClassName}
                            onChange={(v) =>
                                onTimeSettingsChange({
                                    ...timeSettings,
                                    gote: { ...timeSettings.gote, byoyomiMs: v * 1000 },
                                })
                            }
                        />
                    </label>
                </div>
            </div>

            {onAnalysisEngineIdChange && engineOptions && engineOptions.length > 0 && (
                <div className="space-y-2 pt-3 border-t border-border">
                    <div className="font-medium text-sm">解析エンジン</div>
                    <label className={labelClassName}>
                        <span className="text-xs text-muted-foreground">使用エンジン</span>
                        <select
                            value={resolvedAnalysisEngineId}
                            disabled={settingsLocked}
                            onChange={(e) => onAnalysisEngineIdChange(e.target.value)}
                            className={selectClassName}
                        >
                            {engineOptions.map((engine) => (
                                <option key={engine.id} value={engine.id}>
                                    {engine.label}
                                </option>
                            ))}
                        </select>
                    </label>
                </div>
            )}

            {onOpenEngineManager && (
                <div className="space-y-2 pt-3 border-t border-border">
                    <button
                        type="button"
                        onClick={onOpenEngineManager}
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-left text-sm text-wafuu-sumi"
                    >
                        外部エンジン管理...
                    </button>
                </div>
            )}

            {/* パス権設定（オプション） */}
            {passRightsSettings && onPassRightsSettingsChange && (
                <div className="space-y-3 pt-3 border-t border-border">
                    <div className="font-medium text-sm">変則ルール</div>
                    <div className="flex items-center justify-between">
                        <label htmlFor="mobile-pass-rights-toggle" className="text-sm">
                            パス権を有効にする
                        </label>
                        <Switch
                            id="mobile-pass-rights-toggle"
                            checked={passRightsSettings.enabled}
                            onCheckedChange={(checked) =>
                                onPassRightsSettingsChange({
                                    ...passRightsSettings,
                                    enabled: checked,
                                })
                            }
                            disabled={settingsLocked}
                        />
                    </div>
                    {passRightsSettings.enabled && (
                        <div className="flex flex-col gap-2">
                            <span className="text-sm text-muted-foreground">初期パス権数</span>
                            {/* 先手/後手ラベル */}
                            <div className="grid grid-cols-2 gap-3">
                                <div className="text-xs font-semibold text-wafuu-shu text-center">
                                    ☗先手
                                </div>
                                <div className="text-xs font-semibold text-wafuu-ai text-center">
                                    ☖後手
                                </div>
                            </div>
                            {/* 先手/後手パス権数設定 */}
                            <div className="grid grid-cols-2 gap-3">
                                {/* 先手 */}
                                <div className="flex items-center justify-center gap-1">
                                    <button
                                        type="button"
                                        onClick={() =>
                                            onPassRightsSettingsChange({
                                                ...passRightsSettings,
                                                senteInitialCount: Math.max(
                                                    0,
                                                    passRightsSettings.senteInitialCount - 1,
                                                ),
                                            })
                                        }
                                        disabled={
                                            settingsLocked ||
                                            passRightsSettings.senteInitialCount <= 0
                                        }
                                        className="flex h-8 w-8 items-center justify-center rounded border border-border bg-background text-base disabled:opacity-50"
                                    >
                                        -
                                    </button>
                                    <span className="w-8 text-center text-base font-semibold">
                                        {passRightsSettings.senteInitialCount}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() =>
                                            onPassRightsSettingsChange({
                                                ...passRightsSettings,
                                                senteInitialCount: Math.min(
                                                    10,
                                                    passRightsSettings.senteInitialCount + 1,
                                                ),
                                            })
                                        }
                                        disabled={
                                            settingsLocked ||
                                            passRightsSettings.senteInitialCount >= 10
                                        }
                                        className="flex h-8 w-8 items-center justify-center rounded border border-border bg-background text-base disabled:opacity-50"
                                    >
                                        +
                                    </button>
                                </div>
                                {/* 後手 */}
                                <div className="flex items-center justify-center gap-1">
                                    <button
                                        type="button"
                                        onClick={() =>
                                            onPassRightsSettingsChange({
                                                ...passRightsSettings,
                                                goteInitialCount: Math.max(
                                                    0,
                                                    passRightsSettings.goteInitialCount - 1,
                                                ),
                                            })
                                        }
                                        disabled={
                                            settingsLocked ||
                                            passRightsSettings.goteInitialCount <= 0
                                        }
                                        className="flex h-8 w-8 items-center justify-center rounded border border-border bg-background text-base disabled:opacity-50"
                                    >
                                        -
                                    </button>
                                    <span className="w-8 text-center text-base font-semibold">
                                        {passRightsSettings.goteInitialCount}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() =>
                                            onPassRightsSettingsChange({
                                                ...passRightsSettings,
                                                goteInitialCount: Math.min(
                                                    10,
                                                    passRightsSettings.goteInitialCount + 1,
                                                ),
                                            })
                                        }
                                        disabled={
                                            settingsLocked ||
                                            passRightsSettings.goteInitialCount >= 10
                                        }
                                        className="flex h-8 w-8 items-center justify-center rounded border border-border bg-background text-base disabled:opacity-50"
                                    >
                                        +
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                    {passRightsSettings.enabled && (
                        <div className="flex items-center justify-between">
                            <span className="text-sm text-muted-foreground">
                                確認ダイアログしきい値(ms)
                            </span>
                            <input
                                type="number"
                                min={0}
                                step={500}
                                value={passRightsSettings.confirmDialogThresholdMs}
                                onChange={(e) =>
                                    onPassRightsSettingsChange({
                                        ...passRightsSettings,
                                        confirmDialogThresholdMs: Math.max(
                                            0,
                                            Number(e.target.value) || 0,
                                        ),
                                    })
                                }
                                disabled={settingsLocked}
                                className="w-28 rounded border border-border bg-background px-2 py-1 text-sm"
                            />
                        </div>
                    )}
                    <p className="text-xs text-muted-foreground">
                        王手されていない時に手番をパスできます
                    </p>
                </div>
            )}

            {/* アクションボタン（頻繁に使うので上部に配置） */}
            <div className="flex justify-center gap-3 pt-3 border-t border-border">
                {isMatchRunning ? (
                    onStopMatch && (
                        <button
                            type="button"
                            onClick={onStopMatch}
                            className="flex-1 px-6 py-3 bg-destructive text-destructive-foreground rounded-lg font-medium shadow-md active:scale-95 transition-transform"
                        >
                            対局を停止
                        </button>
                    )
                ) : (
                    <>
                        {onResetToStartpos && (
                            <button
                                type="button"
                                onClick={onResetToStartpos}
                                className="px-4 py-3 border border-border rounded-lg font-medium hover:bg-muted active:scale-95 transition-all"
                            >
                                平手に戻す
                            </button>
                        )}
                        {onStartMatch && (
                            <button
                                type="button"
                                onClick={onStartMatch}
                                className="flex-1 px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium shadow-md active:scale-95 transition-transform"
                            >
                                対局を開始
                            </button>
                        )}
                    </>
                )}
            </div>

            {/* 棋譜/局面インポート */}
            {onImportSfen && onImportKif && (
                <KifuImportSection
                    onImportSfen={onImportSfen}
                    onImportKif={onImportKif}
                    positionReady={positionReady}
                />
            )}

            {/* 表示設定 */}
            <div className="space-y-3 pt-3 border-t border-border">
                <div className="font-medium text-sm">表示設定</div>

                {/* 座標表示 */}
                <label htmlFor="mobile-notation" className={labelClassName}>
                    <span className="text-xs text-muted-foreground">座標表示</span>
                    <select
                        id="mobile-notation"
                        value={displaySettings.squareNotation}
                        onChange={(e) =>
                            onDisplaySettingsChange({
                                ...displaySettings,
                                squareNotation: e.target.value as SquareNotation,
                            })
                        }
                        className={selectClassName}
                    >
                        {NOTATION_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                                {opt.label}
                            </option>
                        ))}
                    </select>
                </label>

                {/* チェックボックス設定 */}
                <div className="space-y-2">
                    <label className="flex items-center gap-2 text-sm">
                        <input
                            type="checkbox"
                            checked={displaySettings.showBoardLabels}
                            onChange={(e) =>
                                onDisplaySettingsChange({
                                    ...displaySettings,
                                    showBoardLabels: e.target.checked,
                                })
                            }
                            className="w-4 h-4"
                        />
                        <span>盤外ラベル（筋・段）を表示</span>
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                        <input
                            type="checkbox"
                            checked={displaySettings.highlightLastMove}
                            onChange={(e) =>
                                onDisplaySettingsChange({
                                    ...displaySettings,
                                    highlightLastMove: e.target.checked,
                                })
                            }
                            className="w-4 h-4"
                        />
                        <span>最終手を強調表示</span>
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                        <input
                            type="checkbox"
                            checked={displaySettings.enableSound}
                            onChange={(e) =>
                                onDisplaySettingsChange({
                                    ...displaySettings,
                                    enableSound: e.target.checked,
                                })
                            }
                            className="w-4 h-4"
                        />
                        <span>サウンド</span>
                    </label>
                </div>
            </div>

            {/* このアプリについて / ライセンス */}
            {onOpenAbout && (
                <div className="pt-3 border-t border-border">
                    <button
                        type="button"
                        onClick={onOpenAbout}
                        className="text-sm text-muted-foreground hover:text-foreground hover:underline transition-colors"
                    >
                        このアプリについて / ライセンス
                    </button>
                </div>
            )}
        </div>
    );
}
