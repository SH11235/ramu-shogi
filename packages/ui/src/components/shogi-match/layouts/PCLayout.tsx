/**
 * PC版レイアウト
 *
 * 3カラム構成: 左サイドバー | 将棋盤 | 棋譜セクション
 * ダイアログ類も含む
 *
 * Context の前提:
 * - MatchSettingsContext: 親で Provider 済み
 * - AnalysisContext: 親で Provider 済み
 * - MatchStateContext: 親で Provider 済み
 * - NavigationContext: 親で Provider 済み
 */

import type {
    EngineControllerErrorLog,
    EngineControllerEvent,
    EngineErrorDetails,
} from "@shogi/app-controller";
import type { Player } from "@shogi/app-core";
import type { Dispatch, ReactElement, ReactNode, SetStateAction } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../dialog";
import { Switch } from "../../switch";
import { EngineLogsPanel } from "../components/EngineLogsPanel";
import { KifuImportPanel } from "../components/KifuImportPanel";
import { LeftSidebar } from "../components/LeftSidebar";
import { PCBoardSection } from "../components/PCBoardSection";
import { PCKifuSection } from "../components/PCKifuSection";
import { SettingsModal } from "../components/SettingsModal";
import { useMatchSettings } from "../contexts/MatchSettingsContext";
import { useNavigation } from "../contexts/NavigationContext";
import type { DisplaySettings, PassRightsSettings } from "../types";
import type { KifMoveData } from "../utils/kifParser";

/**
 * PCLayout 固有の Props
 *
 * Context では取得できない、PCLayout 特有の機能用の Props
 */
interface PCLayoutProps {
    /** レイアウトクラス */
    matchLayoutClasses: string;

    /** 候補手の注釈（盤面表示用） */
    candidateNote: string | null;

    /** 設定モーダルの開閉状態 */
    isSettingsModalOpen: boolean;
    onSettingsModalOpenChange: (open: boolean) => void;

    /** SFENインポート時のコールバック */
    importSfen: (sfen: string, moves: string[]) => Promise<void>;

    /** KIFインポート時のコールバック */
    importKif: (moves: string[], moveData: KifMoveData[], startSfen?: string) => Promise<void>;

    /** 局面が準備完了しているか */
    positionReady: boolean;

    /** 開発者モード */
    isDevMode: boolean;

    /** エンジンログ */
    eventLogs: EngineControllerEvent[];
    errorLogs: EngineControllerErrorLog[];
    engineErrorDetails?: Record<Player, EngineErrorDetails | null>;
    retryEngine: (side: Player) => Promise<void>;
    isRetrying?: Record<Player, boolean>;

    /** 表示設定ダイアログ */
    isDisplaySettingsOpen: boolean;
    onDisplaySettingsOpenChange: (open: boolean) => void;
    setDisplaySettings: Dispatch<SetStateAction<DisplaySettings>>;

    /** パス権設定ダイアログ */
    isPassRightsSettingsOpen: boolean;
    onPassRightsSettingsOpenChange: (open: boolean) => void;
    handlePassRightsSettingsChange: (settings: PassRightsSettings) => void;
    /** 棋譜検討モード: 対局設定サイドバーを非表示にする */
    reviewMode?: boolean;
    /** 棋譜検討モード時に左サイドバー位置に表示するコンテンツ */
    reviewLeftContent?: ReactNode;
    /** 棋譜検討モード時に 3 カラムの上部へ全幅で表示するコンテンツ（観戦スコアボード等） */
    reviewTopContent?: ReactNode;
}

/**
 * PC版3カラムレイアウト
 */
export function PCLayout({
    matchLayoutClasses,
    candidateNote,
    isSettingsModalOpen,
    onSettingsModalOpenChange,
    importSfen,
    importKif,
    positionReady,
    isDevMode,
    eventLogs,
    errorLogs,
    engineErrorDetails,
    retryEngine,
    isRetrying,
    isDisplaySettingsOpen,
    onDisplaySettingsOpenChange,
    setDisplaySettings,
    isPassRightsSettingsOpen,
    onPassRightsSettingsOpenChange,
    handlePassRightsSettingsChange,
    reviewMode,
    reviewLeftContent,
    reviewTopContent,
}: PCLayoutProps): ReactElement {
    // Context から状態を取得
    const matchSettings = useMatchSettings();
    const navigation = useNavigation();

    // MatchSettingsContext から取得
    const { passRightsSettings, settingsLocked } = matchSettings;

    // NavigationContext から取得（ダイアログで使用）
    const { displaySettings: navDisplaySettings } = navigation;

    return (
        <section className={matchLayoutClasses}>
            {reviewMode ? (
                // 観戦/検討モード: 中央 max-width の Grid 3 カラム。1080px 未満では
                // 盤→棋譜→情報の順に縦積み。情報パネルが無いときは盤を狭い列へ
                // 押し込まないよう 2 列にする。
                <div className="flex w-full max-w-[1240px] flex-col gap-4 px-4 py-2">
                    {reviewTopContent}
                    <div
                        className={`grid grid-cols-1 gap-4 min-[1080px]:items-start ${
                            reviewLeftContent
                                ? "min-[1080px]:grid-cols-[minmax(210px,240px)_minmax(0,1fr)_minmax(300px,360px)]"
                                : "min-[1080px]:grid-cols-[minmax(0,1fr)_minmax(300px,360px)]"
                        }`}
                    >
                        {reviewLeftContent && (
                            <div className="order-3 min-w-0 min-[1080px]:order-none">
                                {reviewLeftContent}
                            </div>
                        )}
                        <div className="order-1 flex min-w-0 justify-center min-[1080px]:order-none">
                            <PCBoardSection candidateNote={candidateNote} hideClock />
                        </div>
                        <div className="order-2 min-w-0 min-[1080px]:order-none">
                            <PCKifuSection />
                        </div>
                    </div>
                </div>
            ) : (
                // 対局モード: 設定サイドバー・盤・棋譜はいずれも固定幅のため Grid で
                // 潰すと盤がはみ出す。中央寄せの flex 行にし、収まる幅では mx-auto で
                // 中央寄せ、収まらない幅では mx-auto が 0 に畳まれて左寄せ + 横スク
                // ロールに退避する (列を潰さず盤の重なりを防ぐ)。
                // 行は w-max (max-content) で常に内容幅を確保し、available 幅へ
                // クランプされて子が縮むのを防ぐ。LeftSidebar は shrink-0 が無いので
                // ラッパーで縮小を止める (盤・棋譜は各 root が shrink-0)。
                <div className="w-full overflow-x-auto">
                    <div className="mx-auto flex w-max items-start gap-4 px-4 py-2">
                        <div className="shrink-0">
                            <LeftSidebar />
                        </div>
                        <PCBoardSection candidateNote={candidateNote} />
                        <PCKifuSection />
                    </div>
                </div>
            )}

            {/* 設定モーダル（棋譜インポート等） */}
            <SettingsModal open={isSettingsModalOpen} onOpenChange={onSettingsModalOpenChange}>
                <div className="flex flex-col gap-6">
                    {/* インポート */}
                    <KifuImportPanel
                        onImportSfen={importSfen}
                        onImportKif={importKif}
                        positionReady={positionReady}
                    />

                    {/* エンジンログ（開発モード） */}
                    {isDevMode && (
                        <EngineLogsPanel
                            eventLogs={eventLogs}
                            errorLogs={errorLogs}
                            engineErrorDetails={engineErrorDetails}
                            onRetry={retryEngine}
                            isRetrying={isRetrying}
                        />
                    )}
                </div>
            </SettingsModal>

            {/* 表示設定ダイアログ */}
            <Dialog open={isDisplaySettingsOpen} onOpenChange={onDisplaySettingsOpenChange}>
                <DialogContent className="w-[min(450px,calc(100%-24px))]">
                    <DialogHeader>
                        <DialogTitle>表示設定</DialogTitle>
                    </DialogHeader>
                    <div className="flex flex-col gap-4 pt-2">
                        {/* マス内座標表示 */}
                        <div className="flex flex-col gap-2">
                            <span className="text-sm font-medium">マス内座標表示</span>
                            <div className="flex gap-2">
                                {(
                                    [
                                        { value: "none", label: "なし" },
                                        { value: "sfen", label: "SFEN (5e)" },
                                        { value: "japanese", label: "日本式 (５五)" },
                                    ] as const
                                ).map((opt) => (
                                    <button
                                        key={opt.value}
                                        type="button"
                                        onClick={() =>
                                            setDisplaySettings({
                                                ...navDisplaySettings,
                                                squareNotation: opt.value,
                                            })
                                        }
                                        className={`px-3 py-1.5 rounded text-sm transition-colors ${
                                            navDisplaySettings.squareNotation === opt.value
                                                ? "bg-wafuu-kincha text-white"
                                                : "bg-wafuu-washi text-wafuu-sumi hover:bg-wafuu-border border border-wafuu-border"
                                        }`}
                                    >
                                        {opt.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="h-px bg-wafuu-border" />

                        {/* チェックボックス項目 */}
                        <label className="flex items-center gap-3 text-sm cursor-pointer">
                            <input
                                type="checkbox"
                                checked={navDisplaySettings.showBoardLabels}
                                onChange={(e) =>
                                    setDisplaySettings({
                                        ...navDisplaySettings,
                                        showBoardLabels: e.target.checked,
                                    })
                                }
                                className="w-4 h-4"
                            />
                            <span>盤外ラベル表示（筋・段）</span>
                        </label>
                        <label className="flex items-center gap-3 text-sm cursor-pointer">
                            <input
                                type="checkbox"
                                checked={navDisplaySettings.highlightLastMove}
                                onChange={(e) =>
                                    setDisplaySettings({
                                        ...navDisplaySettings,
                                        highlightLastMove: e.target.checked,
                                    })
                                }
                                className="w-4 h-4"
                            />
                            <span>最終手を強調</span>
                        </label>
                        <label className="flex items-center gap-3 text-sm cursor-pointer">
                            <input
                                type="checkbox"
                                checked={navDisplaySettings.showKifuEval}
                                onChange={(e) =>
                                    setDisplaySettings({
                                        ...navDisplaySettings,
                                        showKifuEval: e.target.checked,
                                    })
                                }
                                className="w-4 h-4"
                            />
                            <span>棋譜パネルに評価値を表示</span>
                        </label>
                        <label className="flex items-center gap-3 text-sm cursor-pointer">
                            <input
                                type="checkbox"
                                checked={navDisplaySettings.enableWheelNavigation}
                                onChange={(e) =>
                                    setDisplaySettings({
                                        ...navDisplaySettings,
                                        enableWheelNavigation: e.target.checked,
                                    })
                                }
                                className="w-4 h-4"
                            />
                            <span>ホイールナビゲーション</span>
                        </label>
                    </div>
                </DialogContent>
            </Dialog>

            {/* 変則ルールダイアログ */}
            {passRightsSettings && (
                <Dialog
                    open={isPassRightsSettingsOpen}
                    onOpenChange={onPassRightsSettingsOpenChange}
                >
                    <DialogContent className="w-[min(400px,calc(100%-24px))]">
                        <DialogHeader>
                            <DialogTitle>変則ルール</DialogTitle>
                        </DialogHeader>
                        <div className="flex flex-col gap-4 pt-2">
                            {/* パス権セクション */}
                            <div className="flex flex-col gap-3 p-3 rounded-lg border border-wafuu-border bg-wafuu-washi/50">
                                <div className="flex items-center justify-between">
                                    <span className="text-sm font-medium">パス権</span>
                                    <Switch
                                        id="pass-rights-toggle"
                                        checked={passRightsSettings.enabled}
                                        onCheckedChange={(checked) =>
                                            handlePassRightsSettingsChange({
                                                ...passRightsSettings,
                                                enabled: checked,
                                            })
                                        }
                                        disabled={settingsLocked}
                                    />
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    王手されていない時に手番をパスできます
                                </p>

                                {/* 初期パス権数（先手・後手別） */}
                                <div
                                    className={`flex flex-col gap-2 ${!passRightsSettings.enabled ? "opacity-50" : ""}`}
                                >
                                    <span className="text-sm">初期パス権数</span>
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
                                                    handlePassRightsSettingsChange({
                                                        ...passRightsSettings,
                                                        senteInitialCount: Math.max(
                                                            0,
                                                            passRightsSettings.senteInitialCount -
                                                                1,
                                                        ),
                                                    })
                                                }
                                                disabled={
                                                    settingsLocked ||
                                                    !passRightsSettings.enabled ||
                                                    passRightsSettings.senteInitialCount <= 0
                                                }
                                                className="flex h-8 w-8 items-center justify-center rounded border border-border bg-card text-sm disabled:opacity-50"
                                            >
                                                -
                                            </button>
                                            <span className="w-8 text-center text-sm font-semibold">
                                                {passRightsSettings.senteInitialCount}
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    handlePassRightsSettingsChange({
                                                        ...passRightsSettings,
                                                        senteInitialCount: Math.min(
                                                            10,
                                                            passRightsSettings.senteInitialCount +
                                                                1,
                                                        ),
                                                    })
                                                }
                                                disabled={
                                                    settingsLocked ||
                                                    !passRightsSettings.enabled ||
                                                    passRightsSettings.senteInitialCount >= 10
                                                }
                                                className="flex h-8 w-8 items-center justify-center rounded border border-border bg-card text-sm disabled:opacity-50"
                                            >
                                                +
                                            </button>
                                        </div>
                                        {/* 後手 */}
                                        <div className="flex items-center justify-center gap-1">
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    handlePassRightsSettingsChange({
                                                        ...passRightsSettings,
                                                        goteInitialCount: Math.max(
                                                            0,
                                                            passRightsSettings.goteInitialCount - 1,
                                                        ),
                                                    })
                                                }
                                                disabled={
                                                    settingsLocked ||
                                                    !passRightsSettings.enabled ||
                                                    passRightsSettings.goteInitialCount <= 0
                                                }
                                                className="flex h-8 w-8 items-center justify-center rounded border border-border bg-card text-sm disabled:opacity-50"
                                            >
                                                -
                                            </button>
                                            <span className="w-8 text-center text-sm font-semibold">
                                                {passRightsSettings.goteInitialCount}
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    handlePassRightsSettingsChange({
                                                        ...passRightsSettings,
                                                        goteInitialCount: Math.min(
                                                            10,
                                                            passRightsSettings.goteInitialCount + 1,
                                                        ),
                                                    })
                                                }
                                                disabled={
                                                    settingsLocked ||
                                                    !passRightsSettings.enabled ||
                                                    passRightsSettings.goteInitialCount >= 10
                                                }
                                                className="flex h-8 w-8 items-center justify-center rounded border border-border bg-card text-sm disabled:opacity-50"
                                            >
                                                +
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                {/* パス確認ダイアログしきい値 */}
                                <div
                                    className={`flex flex-col gap-2 ${!passRightsSettings.enabled ? "opacity-50" : ""}`}
                                >
                                    <span className="text-sm">
                                        パス確認ダイアログしきい値（ms）
                                    </span>
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="number"
                                            min={0}
                                            step={500}
                                            value={passRightsSettings.confirmDialogThresholdMs}
                                            onChange={(e) =>
                                                handlePassRightsSettingsChange({
                                                    ...passRightsSettings,
                                                    confirmDialogThresholdMs: Math.max(
                                                        0,
                                                        Number(e.target.value) || 0,
                                                    ),
                                                })
                                            }
                                            disabled={settingsLocked || !passRightsSettings.enabled}
                                            className="w-28 rounded border border-border bg-card px-2 py-1 text-sm disabled:opacity-50"
                                        />
                                        <span className="text-xs text-muted-foreground">
                                            0で即時、時間が多ければ確認
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </DialogContent>
                </Dialog>
            )}
        </section>
    );
}
