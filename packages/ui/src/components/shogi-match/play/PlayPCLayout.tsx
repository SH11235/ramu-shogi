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
import { PlayHintCard, usePlayHintMove } from "./PlayHintCard";
import { PlayMoveList } from "./PlayMoveList";
import { PlayPlayerBar } from "./PlayPlayerBar";
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
    const { passRightsSettings, settingsLocked } = useMatchSettings();
    const hintMove = usePlayHintMove();
    const {
        boardSectionRef,
        isDraggingPiece,
        isMatchRunning,
        sides,
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
    // 設定中と終局後は盤を操作できない。フォーカスや読み上げの対象からも外す。
    const boardInert = phase === "setup" || phase === "finished";
    const hasHumanPlayer = sides.sente.role === "human" || sides.gote.role === "human";

    return (
        <section
            // 盤は画面の高さに合わせる（低い画面で縦にはみ出さず、高い画面で小さく残らないように）。
            className={`${matchLayoutClasses} [--shogi-cell-size:clamp(40px,calc((100dvh-370px)/9),60px)]`}
        >
            <div className="w-full overflow-x-auto">
                <div className="mx-auto flex w-max items-start gap-6 px-4 py-2">
                    {/* 盤の列 */}
                    <div className="flex shrink-0 flex-col items-center gap-2">
                        <div ref={boardSectionRef} className="relative flex w-fit flex-col gap-2">
                            <div
                                // 持ち駒の欄は、空のときも高さを確保する（駒を取ったときに盤が動かないように）。
                                className={`flex flex-col items-center gap-2 [&_[data-zone^=hand-]]:min-h-[38px] ${isDraggingPiece ? "touch-none" : ""}`}
                            >
                                {/* 盤の上: 相手の帯と、盤の向き・音。 */}
                                <div className="flex w-full items-center gap-2">
                                    <PlayPlayerBar position="top" className="min-w-0 flex-1" />
                                    <button
                                        type="button"
                                        onClick={() => onFlipBoardChange(!flipBoard)}
                                        aria-pressed={flipBoard}
                                        className={`flex h-8 shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-wafuu-border px-2 text-[13px] ${
                                            flipBoard ? "bg-wafuu-kin/20" : "bg-card"
                                        }`}
                                        title="盤面を反転"
                                    >
                                        <span aria-hidden>🔄</span>
                                        <span>反転</span>
                                    </button>
                                    <SoundToggle />
                                </div>

                                <div inert={boardInert} className="contents">
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
                                        // 対局者は帯に出すので、駒台には AI のアイコンを出さない。
                                        topHand={{ ...getHandInfo("top"), isAI: false }}
                                        bottomHand={{ ...getHandInfo("bottom"), isAI: false }}
                                        hintMove={hintMove}
                                        handSize="medium"
                                        passRightsSettings={passRightsSettings}
                                        passRights={position.passRights}
                                        turn={position.turn}
                                    />
                                </div>

                                <PlayPlayerBar position="bottom" />

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
                        {(phase === "playing" || phase === "paused") && (
                            <PlayTurnStatus className="min-h-9 px-1 text-base" />
                        )}
                        {inGame && (
                            <section
                                aria-label="棋譜"
                                className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3 shadow-card"
                            >
                                <h2 className="text-sm font-semibold text-foreground">棋譜</h2>
                                <PlayMoveList
                                    selectable={phase === "finished"}
                                    upToCurrent={phase !== "finished"}
                                    className="max-h-[min(34vh,300px)]"
                                />
                            </section>
                        )}
                        {(phase === "playing" || phase === "paused") && hasHumanPlayer && (
                            <PlayHintCard />
                        )}
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
                                先手・後手を個別に設定します（AI
                                同士・人同士、秒数の指定、変則ルール、評価関数、盤の表示）。ここで変えた内容は、設定の欄にも反映されます。
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
