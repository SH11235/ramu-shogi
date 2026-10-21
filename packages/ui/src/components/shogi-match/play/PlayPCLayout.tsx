/**
 * 対局画面（`screen="play"`）の PC レイアウト。
 *
 * 2 列: 盤 | 進み具合ごとの欄（設定 → 棋譜とヒント → 結果）。
 * 棋譜の読み込み・駒を動かす検討・棋譜の解析は置かない（研究ノートで行う）。
 * 盤の位置は、設定 → 対局 → 終局を通して動かさない。
 *
 * Context の前提: MatchSettings / Analysis / MatchState / Navigation を親で Provider 済み。
 */

import type { Dispatch, ReactElement, ReactNode, SetStateAction } from "react";
import { useState } from "react";
import { Button } from "../../button";
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "../../dialog";
import { KifuNavigationToolbar } from "../components/KifuNavigationToolbar";
import { PCBoardContent } from "../components/PCBoardContent";
import { useMatchState } from "../contexts/MatchStateContext";
import { useNavigation } from "../contexts/NavigationContext";
import { useShogiMatchConfig } from "../ShogiMatchContext";
import type { DisplaySettings } from "../types";
import { PlayAdvancedSettings } from "./PlayAdvancedSettings";
import {
    PlayBoardTools,
    PlayMatchActions,
    PlayMessage,
    PlayPositionEditorPanel,
    PlayTurnStatus,
    usePlayPhaseFocus,
} from "./PlayControls";
import { PlayHintCard, usePlayHintMove } from "./PlayHintCard";
import { PlayMoveList } from "./PlayMoveList";
import { PlayPlayerBar } from "./PlayPlayerBar";
import { PlayResultCard } from "./PlayResult";
import { PlaySetupPanel } from "./PlaySetupPanel";
import { PLAY_CARD, PLAY_HAND_ZONES, PLAY_OUTLINE_BUTTON } from "./playStyles";

interface PlayPCLayoutProps {
    matchLayoutClasses: string;
    candidateNote: string | null;
    setDisplaySettings: Dispatch<SetStateAction<DisplaySettings>>;
    devTools?: ReactNode;
}

export function PlayPCLayout({
    matchLayoutClasses,
    candidateNote,
    setDisplaySettings,
    devTools,
}: PlayPCLayoutProps): ReactElement {
    const { play } = useShogiMatchConfig();
    const hintMove = usePlayHintMove();
    const rootRef = usePlayPhaseFocus<HTMLElement>(play?.phase ?? "setup");
    const {
        boardSectionRef,
        isDraggingPiece,
        isMatchRunning,
        sides,
        position,
        flipBoard,
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
            ref={rootRef}
            // 盤は画面の高さに合わせる（低い画面で縦にはみ出さず、高い画面で小さく残らないように）。
            className={`${matchLayoutClasses} [--shogi-cell-size:clamp(34px,calc((100dvh-400px)/9),72px)] min-[1700px]:[--panel-width:460px]`}
        >
            <div className="w-full overflow-x-auto">
                <div className="mx-auto flex w-max items-start gap-14 px-4 py-2">
                    {/* 盤の列: 相手の帯 → 持ち駒 → 盤 → 持ち駒 → 自分の帯 → 操作 */}
                    <div className="flex shrink-0 flex-col items-center gap-2">
                        <div ref={boardSectionRef} className="relative flex w-fit flex-col gap-2">
                            {/* 盤の表示の操作（向き・音）は、盤の右上の角に固定する（どの段階でも同じ位置）。 */}
                            <PlayBoardTools className="absolute left-full top-0 ml-2 flex-col" />
                            <div
                                // 持ち駒の欄は、空のときも同じ高さで見せる（駒を取ったときに盤や操作が動かないように）。
                                className={`flex flex-col items-center gap-2 ${PLAY_HAND_ZONES} ${isDraggingPiece ? "touch-none" : ""}`}
                            >
                                <PlayPlayerBar position="top" />

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
                                        // パス権の残りは、対局者の帯に言葉で出す（盤のそばの ● は出さない）。
                                        passRightsSettings={undefined}
                                        passRights={position.passRights}
                                        turn={position.turn}
                                    />
                                </div>

                                <PlayPlayerBar position="bottom" />

                                {/* 盤の下。操作の有無で列の高さが変わらないよう、高さを確保する。 */}
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
                                    {phase !== "playing" && phase !== "paused" && <PlayMessage />}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* 進み具合ごとの欄 */}
                    <div className="flex w-[var(--panel-width)] shrink-0 flex-col gap-4 pt-1">
                        {phase === "setup" && (
                            <PlaySetupPanel onOpenAdvanced={() => setIsAdvancedOpen(true)} />
                        )}
                        {isEditing && <PlayPositionEditorPanel />}
                        {phase === "finished" && <PlayResultCard />}
                        {(phase === "playing" || phase === "paused") && (
                            <div className="flex flex-col">
                                <h1 data-play-heading tabIndex={-1} className="sr-only">
                                    対局中
                                </h1>
                                <PlayTurnStatus className="min-h-9 text-lg" />
                                {/* 知らせ（指せない手など）は手番のそばに出す。高さを確保して下を動かさない。 */}
                                <div className="min-h-5 text-left [&>p]:text-left">
                                    <PlayMessage />
                                </div>
                            </div>
                        )}
                        {(phase === "playing" || phase === "paused") && hasHumanPlayer && (
                            <PlayHintCard />
                        )}
                        {inGame && (
                            <section
                                aria-label="棋譜"
                                className={`flex flex-col gap-2 ${PLAY_CARD}`}
                            >
                                <h2 className="text-sm font-semibold text-wafuu-sumi">棋譜</h2>
                                <PlayMoveList
                                    selectable={phase === "finished"}
                                    upToCurrent={phase !== "finished"}
                                    className="max-h-[max(120px,calc(100dvh-520px))]"
                                />
                            </section>
                        )}
                    </div>
                </div>
            </div>

            {/* 詳細設定（先後それぞれの担当・秒数・変則ルール・評価関数の管理・表示） */}
            <Dialog open={isAdvancedOpen} onOpenChange={setIsAdvancedOpen}>
                <DialogContent
                    className="max-h-[calc(100dvh-32px)] w-[min(440px,calc(100%-24px))] overflow-y-auto"
                    hasDescription
                >
                    <div className="flex flex-col gap-4">
                        <DialogHeader>
                            <DialogTitle>詳細設定</DialogTitle>
                            <DialogDescription>ふだんは変えなくてよい設定です。</DialogDescription>
                        </DialogHeader>
                        <PlayAdvancedSettings
                            onDisplaySettingsChange={setDisplaySettings}
                            devTools={devTools}
                        />
                        <DialogClose asChild>
                            <Button
                                type="button"
                                variant="outline"
                                className={`self-end ${PLAY_OUTLINE_BUTTON}`}
                            >
                                閉じる
                            </Button>
                        </DialogClose>
                    </div>
                </DialogContent>
            </Dialog>
        </section>
    );
}
