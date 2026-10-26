/**
 * 対局画面（`screen="play"`）の PC レイアウト。
 *
 * 2 列: 盤 | 進み具合ごとの欄（設定 → 棋譜とヒント → 結果）。
 * 棋譜の読み込み・駒を動かす検討・棋譜の解析は置かない（研究ノートで行う）。
 * 盤の位置は、設定 → 対局 → 終局を通して動かさない。
 *
 * Context の前提: MatchSettings / Analysis / MatchState / Navigation を親で Provider 済み。
 */

import { cn } from "@shogi/design-system";
import type { Dispatch, ReactElement, ReactNode, SetStateAction } from "react";
import { useState } from "react";
import { Button } from "../../button";
import { cardVariants } from "../../card";
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
import { PlayEndStamp } from "./PlayEndStamp";
import { PlayKifuReading } from "./PlayEngineReading";
import { PlayHintCard, usePlayHintMove } from "./PlayHintCard";
import { PlayMoveList } from "./PlayMoveList";
import { PlayPlayerBar } from "./PlayPlayerBar";
import { PlayResultCard } from "./PlayResult";
import { PlayResultDialog } from "./PlayResultDialog";
import { PlaySetupPanel } from "./PlaySetupPanel";
import { PLAY_OUTLINE_BUTTON } from "./playStyles";

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
    const hasEngine = sides.sente.role === "engine" || sides.gote.role === "engine";

    return (
        <section
            ref={rootRef}
            // 盤は画面の高さと幅に合わせる（低い画面で縦にはみ出さず、高い画面で小さく残らないように）。
            // 幅の側の引き算は、マス以外の盤の列（持ち駒・枠・盤の横の操作）が約 190px、欄を横に並べるときは
            // さらに欄・列の間・左右の余白の約 490px（欄が広い 1700px 以上は約 550px）。
            // 幅 1000px 未満では欄を横に置けないので、盤の下に回す。
            className={`${matchLayoutClasses} [--shogi-cell-size:clamp(34px,min(calc((100dvh-300px)/9),calc((100vw-300px)/9)),72px)] min-[1000px]:[--shogi-cell-size:clamp(34px,min(calc((100dvh-300px)/9),calc((100vw-700px)/9)),72px)] min-[1700px]:[--panel-width:460px] min-[1700px]:[--shogi-cell-size:clamp(34px,min(calc((100dvh-300px)/9),calc((100vw-760px)/9)),72px)]`}
        >
            <div className="w-full overflow-x-auto">
                <div className="mx-auto flex w-full flex-col items-center gap-6 px-4 py-2 min-[1000px]:w-max min-[1000px]:flex-row min-[1000px]:items-start min-[1000px]:gap-14">
                    {/* 盤の列: 相手の帯 → 持ち駒 → 盤 → 持ち駒 → 自分の帯 → 操作 */}
                    <div className="flex shrink-0 flex-col items-center gap-2">
                        <div ref={boardSectionRef} className="relative flex w-fit flex-col gap-2">
                            {/* 盤の横の操作（盤の向き・着手音）は、盤の右上の角に固定する（どの段階でも同じ位置）。 */}
                            <PlayBoardTools
                                size="lg"
                                className="absolute left-full top-0 ml-2 flex-col"
                            />
                            <div
                                className={`flex flex-col items-center gap-2 ${isDraggingPiece ? "touch-none" : ""}`}
                            >
                                <PlayPlayerBar position="top" enableIconZoom />

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
                                        handFrame="outline"
                                        hintMove={hintMove}
                                        boardOverlay={<PlayEndStamp />}
                                        handSize="medium"
                                        // 横に余裕があるので、持ち駒は盤の左右に縦に置く（盤の上下を詰めて 1 画面に収める）。
                                        handPlacement="sides"
                                        // パス権の残りは、対局者の帯に言葉で出す（盤のそばの ● は出さない）。
                                        passRightsSettings={undefined}
                                        passRights={position.passRights}
                                        turn={position.turn}
                                    />
                                </div>

                                <PlayPlayerBar position="bottom" enableIconZoom />

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
                                            size="large"
                                        />
                                    )}
                                    {phase !== "playing" && phase !== "paused" && <PlayMessage />}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* 進み具合ごとの欄 */}
                    <div className="flex w-full max-w-[var(--panel-width)] shrink-0 flex-col gap-4 pt-1 min-[1000px]:w-[var(--panel-width)]">
                        {phase === "finished" && <PlayResultDialog variant="center" />}
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
                                // 欄の下端を盤の列の下端に揃える。338px は、この欄より上に積む欄（手番・ヒントなど）と
                                // 下の余白の分。終局後は、ヒントの代わりに出す結果の欄が約 45px 高いので引く
                                // （それらの欄の高さを変えたら、この値も見直す）。AI の読みの欄を足しても、
                                // 縮むのは棋譜の一覧だけにする。
                                className={cn(
                                    "flex min-h-0 flex-col gap-2",
                                    cardVariants({ variant: "washi" }),
                                    "p-4",
                                    phase === "finished"
                                        ? "max-h-[max(182px,calc(100dvh-383px))]"
                                        : "max-h-[max(182px,calc(100dvh-338px))]",
                                )}
                            >
                                <h2 className="text-sm font-semibold text-wafuu-sumi">棋譜</h2>
                                {hasEngine && displaySettings.showEngineReading && (
                                    <PlayKifuReading className="shrink-0" />
                                )}
                                <PlayMoveList
                                    selectable={phase === "finished"}
                                    upToCurrent={phase !== "finished"}
                                    showSearch={hasEngine && displaySettings.showEngineReading}
                                    className="min-h-[5.5rem] flex-1"
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
