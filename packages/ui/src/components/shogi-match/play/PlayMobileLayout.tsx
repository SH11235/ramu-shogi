/**
 * 対局画面（`screen="play"`）のスマホレイアウト。
 *
 * 進み具合ごとに縦に並べる:
 * - 設定: 設定の欄 → 盤（触れない）
 * - 局面編集: 盤 → 編集の欄
 * - 対局中: 時計 → 盤 → 棋譜 1 行 → 操作 → ヒント
 * - 終局後: 盤 → 棋譜の送り → 結果の欄
 *
 * Context の前提: MatchSettings / Analysis / MatchState / Navigation を親で Provider 済み。
 */

import type { ReactElement, ReactNode } from "react";
import { useState } from "react";
import { BottomSheet } from "../components/BottomSheet";
import { KifuNavigationToolbar } from "../components/KifuNavigationToolbar";
import { MobileBoardSection } from "../components/MobileBoardSection";
import { MobileKifuBar } from "../components/MobileKifuBar";
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
} from "./PlayControls";
import { PlayHintButton, PlayHintLine, usePlayHintMove } from "./PlayHintCard";
import { PlayMyTime, PlayPlayerBar } from "./PlayPlayerBar";
import { PlayResultCard } from "./PlayResult";
import { PlaySetupPanel } from "./PlaySetupPanel";
import { PLAY_HAND_ZONES, PLAY_HEADING } from "./playStyles";

interface PlayMobileLayoutProps {
    searchInfo?: ReactNode;
    candidateNote: string | null;
    onDisplaySettingsChange: (settings: DisplaySettings) => void;
}

export function PlayMobileLayout({
    searchInfo,
    candidateNote,
    onDisplaySettingsChange,
}: PlayMobileLayoutProps): ReactElement {
    const { play } = useShogiMatchConfig();
    const {
        grid,
        position,
        flipBoard,
        lastMove,
        selection,
        moveShadow,
        promotionSelection,
        isMatchRunning,
        editFromSquare,
        displaySettings,
        getHandInfo,
        boardSectionRef,
        isDraggingPiece,
        message,
        handleSquareSelect,
        handlePromotionChoice,
        handleHandSelect,
        handlePiecePointerDown,
        handlePieceTogglePromote,
        handleHandPiecePointerDown,
        handleIncrementHand,
        handleDecrementHand,
        sides,
    } = useMatchState();
    const { navigationState, navigationHandlers, kifMoves, handlePlySelect } = useNavigation();
    const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
    const hintMove = usePlayHintMove();

    const phase = play?.phase ?? "setup";
    const isEditing = phase === "editing";
    const inGame = phase === "playing" || phase === "paused" || phase === "finished";
    const barMoves = kifMoves.map((move) => ({ ply: move.ply, displayText: move.displayText }));

    const board = (
        // 設定中と終局後は盤を操作できない。フォーカスや読み上げの対象からも外す。
        <div
            inert={phase === "setup" || phase === "finished"}
            // 持ち駒の欄は、空のときも高さを確保する（駒を取ったときに盤や操作が動かないように）。
            // 盤は幅だけでなく高さにも合わせる（横向きなどの低い画面で、盤が画面に入らないのを避ける）。
            // 持ち駒の欄は、駒が出たときの高さを最初から確保する（駒を取ったときに盤が動かないように）。
            className={`relative mx-auto flex w-full max-w-[max(280px,calc(100dvh-230px))] justify-center ${PLAY_HAND_ZONES}`}
        >
            <MobileBoardSection
                grid={grid}
                position={position}
                flipBoard={flipBoard}
                lastMove={lastMove}
                selection={selection}
                moveShadow={moveShadow}
                promotionSelection={promotionSelection}
                displaySettings={displaySettings}
                isEditModeActive={isEditing}
                isMatchRunning={isMatchRunning}
                hideEmptyHandPieces={!isEditing}
                editFromSquare={editFromSquare}
                candidateNote={candidateNote}
                onSquareSelect={handleSquareSelect}
                onPromotionChoice={handlePromotionChoice}
                onHandSelect={handleHandSelect}
                onPiecePointerDown={isEditing ? handlePiecePointerDown : undefined}
                onPieceTogglePromote={isEditing ? handlePieceTogglePromote : undefined}
                onHandPiecePointerDown={isEditing ? handleHandPiecePointerDown : undefined}
                onIncrementHand={handleIncrementHand}
                onDecrementHand={handleDecrementHand}
                // 対局者は帯に出すので、駒台には AI のアイコンを出さない。
                topHand={{ ...getHandInfo("top"), isAI: false }}
                bottomHand={{ ...getHandInfo("bottom"), isAI: false }}
                hintMove={hintMove}
                boardSectionRef={boardSectionRef}
                isDraggingPiece={isDraggingPiece}
                // パス権の残りは、対局者の帯・パスのボタンに言葉で出す（盤のそばの ● は出さない）。
                passRightsSettings={undefined}
                passRights={position.passRights}
                turn={position.turn}
            />
        </div>
    );

    return (
        <div
            // 画面の高さいっぱいを使う（背の高い端末でも、対局の操作が親指の届く下端に来るように）。
            className="relative flex min-h-[calc(100dvh-53px)] w-full min-w-0 flex-col gap-1 bg-background px-2 pb-[max(env(safe-area-inset-bottom),8px)] text-foreground"
        >
            {phase === "setup" && (
                <>
                    <PlaySetupPanel
                        onOpenAdvanced={() => setIsAdvancedOpen(true)}
                        className="px-2 pb-2 pt-3"
                    />
                    <PlayMessage />
                    <div className="flex items-center justify-between gap-2 px-1">
                        <span className="text-sm text-wafuu-sumi-light">
                            {play?.isCustomStart ? "指定の局面から始めます" : "開始局面（平手）"}
                        </span>
                        <PlayBoardTools />
                    </div>
                    {board}
                </>
            )}

            {isEditing && (
                <>
                    {/* 盤を先に置き、編集を終える操作は画面の下端に留める。 */}
                    <div className="flex items-center justify-between gap-2 px-2 pt-2">
                        <h1 className={PLAY_HEADING}>開始局面を編集</h1>
                        <PlayBoardTools />
                    </div>
                    {board}
                    <PlayMessage />
                    <PlayPositionEditorPanel
                        hideHeading
                        stickyPrimary
                        className="gap-3 px-2 pb-1"
                    />
                </>
            )}

            {inGame && (
                <>
                    {phase !== "finished" && <h1 className="sr-only">対局中</h1>}
                    {/* 相手の帯と、盤の向き・音。対局中は棋譜の帯を出さない（直前の手は盤に示す。
                        縦を詰めて、盤と操作を 1 画面に収める）。 */}
                    <div className="flex items-center gap-1">
                        <PlayPlayerBar position="top" className="min-w-0 flex-1" />
                        <PlayBoardTools />
                    </div>
                    {board}
                    {phase === "finished" ? (
                        <>
                            {/* 終局の結果と次の一歩は、対局中の操作と同じ位置（画面の下端）に出す。
                                盤は動かさない。 */}
                            <div className="sticky bottom-0 z-10 mt-auto border-t border-wafuu-border bg-background pb-1 pt-2">
                                <PlayResultCard compact className="px-1" />
                            </div>
                            <div className="flex justify-center">
                                <KifuNavigationToolbar
                                    currentPly={navigationState.currentPly}
                                    totalPly={navigationState.totalPly}
                                    onBack={navigationHandlers.goBack}
                                    onForward={() => navigationHandlers.goForward()}
                                    onToStart={navigationHandlers.goToStart}
                                    onToEnd={navigationHandlers.goToEnd}
                                    canGoForward={navigationState.canGoForward}
                                />
                            </div>
                            <MobileKifuBar
                                moves={barMoves}
                                currentPly={navigationState.currentPly}
                                onPlySelect={handlePlySelect}
                                tone="wafuu"
                            />
                            <PlayMessage />
                        </>
                    ) : (
                        <>
                            {/* 手番（知らせ・ヒントがあればそれ）と操作。画面の下端に留めて、盤が上へ
                                送られても押せるようにする。高さは固定して、盤を動かさない。 */}
                            <div className="sticky bottom-0 z-10 mt-auto flex flex-col gap-1 bg-background pb-1">
                                <div className="flex min-h-8 items-center gap-2 px-1">
                                    <div className="flex min-w-0 flex-1 items-center">
                                        {message ? (
                                            <PlayMessage className="text-left" />
                                        ) : (
                                            <PlayHintLine
                                                className="flex min-w-0 items-center"
                                                fallback={<PlayTurnStatus />}
                                            />
                                        )}
                                    </div>
                                    <PlayMyTime />
                                </div>
                                <PlayMatchActions
                                    compact
                                    extra={
                                        phase === "playing" &&
                                        (sides.sente.role === "human" ||
                                            sides.gote.role === "human") ? (
                                            <PlayHintButton className="flex-1 px-2" />
                                        ) : null
                                    }
                                />
                            </div>
                        </>
                    )}
                </>
            )}

            {displaySettings.showSearchInfo && <div className="min-h-10 w-full">{searchInfo}</div>}

            {/* 詳細設定（先後それぞれの担当・秒数・変則ルール・評価関数の管理・表示） */}
            <BottomSheet
                open={isAdvancedOpen}
                onOpenChange={setIsAdvancedOpen}
                title="詳細設定"
                height="full"
            >
                <div className="px-1 pb-4">
                    <PlayAdvancedSettings onDisplaySettingsChange={onDisplaySettingsChange} />
                </div>
            </BottomSheet>
        </div>
    );
}
