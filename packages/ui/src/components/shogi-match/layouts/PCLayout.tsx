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
import { DisplaySettingsPanel } from "../components/DisplaySettingsPanel";
import { EngineLogsPanel } from "../components/EngineLogsPanel";
import { ImportDialog } from "../components/ImportDialog";
import { KifuImportPanel } from "../components/KifuImportPanel";
import { LeftSidebar } from "../components/LeftSidebar";
import { PassRightsSettingsDialog } from "../components/PassRightsSettingsDialog";
import { PCBoardSection } from "../components/PCBoardSection";
import { PCKifuSection } from "../components/PCKifuSection";
import { useMatchSettings } from "../contexts/MatchSettingsContext";
import { useNavigation } from "../contexts/NavigationContext";
import type { DisplaySettings, PassRightsSettings } from "../types";
import type { ImportKifHandler, ImportSfenHandler } from "../utils/kifuImport";

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

    /** 棋譜/局面インポートのダイアログの開閉状態 */
    isImportDialogOpen: boolean;
    onImportDialogOpenChange: (open: boolean) => void;

    /** SFENインポート時のコールバック */
    importSfen: ImportSfenHandler;

    /** KIFインポート時のコールバック */
    importKif: ImportKifHandler;

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

    /** サイドバーの表示設定 */
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
    isImportDialogOpen,
    onImportDialogOpenChange,
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

    // NavigationContext から表示設定を取得
    const { displaySettings: navDisplaySettings } = navigation;

    return (
        <section className={matchLayoutClasses}>
            {reviewMode ? (
                // 観戦/検討モード: 中央 max-width の Grid 3 カラム。盤(~537px)+棋譜
                // (var(--panel-width)=400px)+情報(最大240px)+gap が収まる 1280px 以上で
                // 横並びにし、それ未満は盤→棋譜→情報の順に縦積みする。狭い幅で 3 列を
                // 維持すると固定幅の棋譜パネルが列をはみ出し横スクロールが出るため。
                // 盤列は auto で盤幅に密着させ(1fr だと盤が浮く)、棋譜列は panel 幅に
                // 一致させてはみ出しを防ぐ。情報列の minmax は盤幅の変動を吸収する。
                // 情報パネルが無いときは盤を狭い列へ押し込まないよう 2 列にし、
                // justify-center で盤+棋譜の対を中央へ寄せる。
                // 全体を白地のカードで囲まない（中の評価値グラフ・棋譜・対局情報がそれぞれ枠を持つ。
                // 外側まで囲むと、ページの中で中央だけが浮いて見える）。
                <div className="flex w-full max-w-[1240px] flex-col gap-4 p-4 text-foreground">
                    {reviewTopContent}
                    <div
                        className={`grid grid-cols-1 gap-4 min-[1280px]:items-start min-[1280px]:justify-center ${
                            reviewLeftContent
                                ? "min-[1280px]:grid-cols-[minmax(210px,240px)_auto_var(--panel-width)]"
                                : "min-[1280px]:grid-cols-[auto_var(--panel-width)]"
                        }`}
                    >
                        {reviewLeftContent && (
                            <div className="order-3 min-w-0 min-[1280px]:order-none">
                                {reviewLeftContent}
                            </div>
                        )}
                        <div className="order-1 flex min-w-0 justify-center min-[1280px]:order-none">
                            {/* 盤上の時計はスコアボード(reviewTopContent)が時計を表示する
                                ときだけ隠す。スコアボードが無い静的 viewer 等では従来どおり
                                盤上時計を残す。 */}
                            <PCBoardSection
                                candidateNote={candidateNote}
                                hideClock={Boolean(reviewTopContent)}
                            />
                        </div>
                        {/* 縦積み時は固定幅の棋譜パネルを中央へ。横並び時は列幅に一致する
                            ので justify-self は既定へ戻す。 */}
                        <div className="order-2 min-w-0 justify-self-center min-[1280px]:order-none min-[1280px]:justify-self-auto">
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
                            <LeftSidebar
                                displaySettingsOpen={isDisplaySettingsOpen}
                                onDisplaySettingsToggle={() =>
                                    onDisplaySettingsOpenChange(!isDisplaySettingsOpen)
                                }
                                displaySettingsPanel={
                                    isDisplaySettingsOpen ? (
                                        <DisplaySettingsPanel
                                            settings={navDisplaySettings}
                                            onChange={setDisplaySettings}
                                        />
                                    ) : null
                                }
                            />
                        </div>
                        <PCBoardSection candidateNote={candidateNote} />
                        <PCKifuSection />
                    </div>
                </div>
            )}

            {/* 棋譜/局面インポート（開発モードではエンジンログも） */}
            <ImportDialog open={isImportDialogOpen} onOpenChange={onImportDialogOpenChange}>
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
            </ImportDialog>

            {/* 変則ルールダイアログ */}
            {passRightsSettings && (
                <PassRightsSettingsDialog
                    open={isPassRightsSettingsOpen}
                    onOpenChange={onPassRightsSettingsOpenChange}
                    passRightsSettings={passRightsSettings}
                    onChange={handlePassRightsSettingsChange}
                    settingsLocked={settingsLocked}
                />
            )}
        </section>
    );
}
