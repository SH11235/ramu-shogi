/**
 * 対局画面（`screen="play"`）の PC レイアウト。
 *
 * 2 列: 盤 | 進み具合ごとの欄（設定 → 棋譜とヒント → 結果）。
 * 棋譜の読み込み・駒を動かす検討・棋譜の解析は置かない（研究ノートで行う）。
 *
 * Context の前提: MatchSettings / Analysis / MatchState / Navigation を親で Provider 済み。
 */

import type { Dispatch, ReactElement, SetStateAction } from "react";
import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../dialog";
import { ClockDisplay } from "../components/ClockDisplay";
import { DisplaySettingsPanel } from "../components/DisplaySettingsPanel";
import { KifuNavigationToolbar } from "../components/KifuNavigationToolbar";
import { LeftSidebar } from "../components/LeftSidebar";
import { PassRightsSettingsDialog } from "../components/PassRightsSettingsDialog";
import { PCBoardContent } from "../components/PCBoardContent";
import { SoundToggle } from "../components/SoundToggle";
import { useMatchSettings } from "../contexts/MatchSettingsContext";
import { useMatchState } from "../contexts/MatchStateContext";
import { useNavigation } from "../contexts/NavigationContext";
import { useShogiMatchConfig } from "../ShogiMatchContext";
import type { DisplaySettings, PassRightsSettings } from "../types";
import {
    PlayMatchActions,
    PlayMessage,
    PlayPositionEditorPanel,
    PlayTurnStatus,
} from "./PlayControls";
import { PlayHintCard } from "./PlayHintCard";
import { PlayMoveList } from "./PlayMoveList";
import { PlayResultCard, PlayResultDialog } from "./PlayResult";
import { PlaySetupPanel } from "./PlaySetupPanel";

interface PlayPCLayoutProps {
    matchLayoutClasses: string;
    candidateNote: string | null;
    isDisplaySettingsOpen: boolean;
    onDisplaySettingsOpenChange: (open: boolean) => void;
    setDisplaySettings: Dispatch<SetStateAction<DisplaySettings>>;
    isPassRightsSettingsOpen: boolean;
    onPassRightsSettingsOpenChange: (open: boolean) => void;
    handlePassRightsSettingsChange: (settings: PassRightsSettings) => void;
}

export function PlayPCLayout({
    matchLayoutClasses,
    candidateNote,
    isDisplaySettingsOpen,
    onDisplaySettingsOpenChange,
    setDisplaySettings,
    isPassRightsSettingsOpen,
    onPassRightsSettingsOpenChange,
    handlePassRightsSettingsChange,
}: PlayPCLayoutProps): ReactElement {
    const { play } = useShogiMatchConfig();
    const { timeSettings, passRightsSettings, settingsLocked } = useMatchSettings();
    const {
        boardSectionRef,
        isDraggingPiece,
        clocks,
        isMatchRunning,
        position,
        flipBoard,
        onFlipBoardChange,
        selection,
        moveShadow,
        displaySettings,
        grid,
        editFromSquare,
        lastMove,
        promotionSelection,
        hideEmptyHandPieces,
        getHandInfo,
        handleSquareSelect,
        handlePromotionChoice,
        handleHandSelect,
        handleHandPiecePointerDown,
        handlePiecePointerDown,
        handlePieceTogglePromote,
        handleIncrementHand,
        handleDecrementHand,
    } = useMatchState();
    const { navigationState, navigationHandlers } = useNavigation();
    const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);

    const phase = play?.phase ?? "setup";
    const isEditing = phase === "editing";
    const inGame = phase === "playing" || phase === "paused" || phase === "finished";

    return (
        <section className={matchLayoutClasses}>
            <div className="w-full overflow-x-auto">
                <div className="mx-auto flex w-max items-start gap-6 px-4 py-2">
                    {/* 盤の列 */}
                    <div className="flex shrink-0 flex-col items-center gap-2">
                        <div ref={boardSectionRef} className="relative flex w-fit flex-col gap-2">
                            <div
                                className={`flex flex-col items-center gap-2 ${isDraggingPiece ? "touch-none" : ""}`}
                            >
                                {/* 盤の上の行。対局が始まるまでは時計を出さない（高さは確保して、
                                    対局開始で盤の位置が動かないようにする）。 */}
                                <div className="flex min-h-8 w-full items-center justify-between gap-3">
                                    {inGame ? (
                                        <ClockDisplay
                                            clocks={clocks}
                                            timeSettings={timeSettings}
                                            isRunning={isMatchRunning}
                                            className="flex-1"
                                            centerContent={<PlayTurnStatus />}
                                        />
                                    ) : (
                                        <span className="text-sm text-wafuu-sumi-light">
                                            {isEditing
                                                ? "開始局面を編集しています"
                                                : play?.isCustomStart
                                                  ? "指定の局面から始めます"
                                                  : "平手"}
                                        </span>
                                    )}
                                    <div className="flex shrink-0 items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={() => onFlipBoardChange(!flipBoard)}
                                            aria-pressed={flipBoard}
                                            className={`flex h-8 items-center gap-1 whitespace-nowrap rounded-md border border-wafuu-border px-2 text-[13px] ${
                                                flipBoard ? "bg-wafuu-kin/20" : "bg-card"
                                            }`}
                                            title="盤面を反転"
                                        >
                                            <span aria-hidden>🔄</span>
                                            <span>反転</span>
                                        </button>
                                        <SoundToggle />
                                    </div>
                                </div>

                                <PCBoardContent
                                    grid={grid}
                                    flipBoard={flipBoard}
                                    lastMove={lastMove}
                                    selection={selection}
                                    moveShadow={moveShadow}
                                    promotionSelection={promotionSelection}
                                    displaySettings={displaySettings}
                                    isEditModeActive={isEditing}
                                    isMatchRunning={isMatchRunning}
                                    hideEmptyHandPieces={hideEmptyHandPieces || !isEditing}
                                    editFromSquare={editFromSquare}
                                    candidateNote={candidateNote}
                                    onSquareSelect={(sq, shiftKey) => {
                                        void handleSquareSelect(sq, shiftKey);
                                    }}
                                    onPromotionChoice={handlePromotionChoice}
                                    onHandSelect={handleHandSelect}
                                    onPiecePointerDown={handlePiecePointerDown}
                                    onPieceTogglePromote={handlePieceTogglePromote}
                                    onHandPiecePointerDown={handleHandPiecePointerDown}
                                    onIncrementHand={handleIncrementHand}
                                    onDecrementHand={handleDecrementHand}
                                    topHand={getHandInfo("top")}
                                    bottomHand={getHandInfo("bottom")}
                                    passRightsSettings={passRightsSettings}
                                    passRights={position.passRights}
                                    turn={position.turn}
                                />

                                {/* 盤の下。操作の有無で盤が動かないよう、高さを確保する。 */}
                                <div className="flex min-h-10 w-full flex-col items-center gap-2">
                                    <PlayMatchActions />
                                    {phase === "finished" && (
                                        <KifuNavigationToolbar
                                            currentPly={navigationState.currentPly}
                                            totalPly={navigationState.totalPly}
                                            onBack={navigationHandlers.goBack}
                                            onForward={() => navigationHandlers.goForward()}
                                            onToStart={navigationHandlers.goToStart}
                                            onToEnd={navigationHandlers.goToEnd}
                                            canGoForward={navigationState.canGoForward}
                                        />
                                    )}
                                    {phase === "setup" && play?.isCustomStart && (
                                        <button
                                            type="button"
                                            onClick={play.resetToStartpos}
                                            className="rounded-sm text-sm text-wafuu-sumi-light underline underline-offset-2 hover:text-wafuu-sumi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                        >
                                            平手に戻す
                                        </button>
                                    )}
                                    <PlayMessage />
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* 進み具合ごとの欄 */}
                    <div className="flex w-[var(--panel-width)] shrink-0 flex-col gap-3">
                        {phase === "setup" && (
                            <PlaySetupPanel onOpenAdvanced={() => setIsAdvancedOpen(true)} />
                        )}
                        {isEditing && <PlayPositionEditorPanel />}
                        {phase === "finished" && <PlayResultCard />}
                        {inGame && (
                            <section
                                aria-label="棋譜"
                                className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3 shadow-card"
                            >
                                <h2 className="text-sm font-semibold text-foreground">棋譜</h2>
                                <PlayMoveList
                                    selectable={phase === "finished"}
                                    className="max-h-[min(38vh,320px)]"
                                />
                            </section>
                        )}
                        {(phase === "playing" || phase === "paused") && <PlayHintCard />}
                    </div>
                </div>
            </div>

            <PlayResultDialog />

            {/* 詳細設定（先後それぞれの担当・秒数・変則ルール・評価関数の管理・表示） */}
            <Dialog open={isAdvancedOpen} onOpenChange={setIsAdvancedOpen}>
                <DialogContent
                    className="max-h-[calc(100dvh-32px)] w-[min(440px,calc(100%-24px))] overflow-y-auto"
                    hasDescription
                >
                    <div className="flex flex-col gap-4">
                        <DialogHeader>
                            <DialogTitle>詳細設定</DialogTitle>
                            <DialogDescription>
                                先手・後手それぞれの担当（人・AI）、秒数、変則ルール、評価関数、盤の表示を変えられます。
                            </DialogDescription>
                        </DialogHeader>
                        <LeftSidebar
                            displaySettingsOpen={isDisplaySettingsOpen}
                            onDisplaySettingsToggle={() =>
                                onDisplaySettingsOpenChange(!isDisplaySettingsOpen)
                            }
                            displaySettingsPanel={
                                isDisplaySettingsOpen ? (
                                    <DisplaySettingsPanel
                                        settings={displaySettings}
                                        onChange={setDisplaySettings}
                                    />
                                ) : null
                            }
                        />
                    </div>
                </DialogContent>
            </Dialog>

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
