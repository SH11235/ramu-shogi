/**
 * 対局画面（`screen="play"`）のスマホレイアウト。
 *
 * 進み具合ごとに縦に並べる:
 * - 設定: 設定の欄だけ（盤は出さない。設定と対局開始を 1 画面に収める）
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
import { PlayKifuStrip } from "./PlayEngineReading";
import { PlayHintButton, PlayHintLine, usePlayHintMove } from "./PlayHintCard";
import { PlayMyStatus, PlayPlayerBar } from "./PlayPlayerBar";
import { PlayResultCard, PlayResultHeadline } from "./PlayResult";
import { PlayResultDialog } from "./PlayResultDialog";
import { PlaySetupPanel } from "./PlaySetupPanel";
import { PLAY_HAND_ZONES, PLAY_HEADING } from "./playStyles";
import { useStableBoardMaxWidth } from "./useStableBoardMaxWidth";

interface PlayMobileLayoutProps {
    candidateNote: string | null;
    onDisplaySettingsChange: (settings: DisplaySettings) => void;
    devTools?: ReactNode;
}

export function PlayMobileLayout({
    candidateNote,
    onDisplaySettingsChange,
    devTools,
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
    const { navigationState, navigationHandlers } = useNavigation();
    const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
    const hintMove = usePlayHintMove();
    const rootRef = usePlayPhaseFocus<HTMLDivElement>(play?.phase ?? "setup");

    const phase = play?.phase ?? "setup";
    const isEditing = phase === "editing";
    const inGame = phase === "playing" || phase === "paused" || phase === "finished";
    // 自分 対 AI では盤の下があなたなので、手番の行には時間だけを出す。AI 同士・人同士では
    // 盤の下の対局者が誰かも分かるよう、アイコンと名前を添える。
    const isVsAi = (sides.sente.role === "human") !== (sides.gote.role === "human");
    const hasEngine = sides.sente.role === "engine" || sides.gote.role === "engine";

    const boardMaxWidth = useStableBoardMaxWidth(299, 267);

    const board = (
        // 設定中と終局後は盤を操作できない。フォーカスや読み上げの対象からも外す。
        <div
            inert={phase === "setup" || phase === "finished"}
            // 盤は幅だけでなく高さにも合わせる（横向きなどの低い画面で、盤が画面に入らないのを避ける）。
            // 対局中・終局後の盤の欄（持ち駒を含む）の高さは、幅に約 118px を足したもの。上下の帯・操作・余白
            // と合わせて画面に収まるよう、幅の上限を `useStableBoardMaxWidth` で決める（開いたときに測って固定し、
            // スクロールでブラウザのバーが出入りしても盤の大きさを変えない）。下限の 267px はマス 26px の盤の幅で、
            // ブラウザのバー込みで高さ 553px の端末（iPhone SE など）でも縦にはみ出さない大きさ。
            // CSS の上限は、測れない環境での代わり。
            // 設定中は隠すだけにして、対局を始めたときに盤を作り直さない。
            className={`relative mx-auto w-full ${isEditing ? "max-w-[max(260px,calc(100svh-430px))]" : "max-w-[max(267px,calc(100svh-307px))]"} justify-center ${PLAY_HAND_ZONES} ${phase === "setup" ? "hidden" : "flex"}`}
            style={isEditing ? undefined : { maxWidth: boardMaxWidth }}
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
                boardOverlay={<PlayEndStamp />}
                boardSectionRef={boardSectionRef}
                isDraggingPiece={isDraggingPiece}
                // パス権の残りは、対局者の帯・パスのボタンに言葉で出す（盤のそばの ● は出さない）。
                passRightsSettings={undefined}
                passRights={position.passRights}
                turn={position.turn}
                minCellSize={26}
            />
        </div>
    );

    return (
        <div
            ref={rootRef}
            // 画面の高さいっぱいを使う（背の高い端末でも、対局の操作が親指の届く下端に来るように）。
            // 盤と同じく、ブラウザのバーが出ているときの高さ（svh）で測る。dvh だと、バーを畳んだときに
            // 欄だけが伸びて、盤と下の操作の間が空く。
            className="relative flex min-h-[calc(100svh-53px)] w-full min-w-0 flex-col gap-1 bg-background px-2 pb-[max(env(safe-area-inset-bottom),8px)] text-foreground"
        >
            {/* 盤の上: 段階ごとの内容。盤そのものは、どの段階でも下の 1 か所に置く
                （段階が変わっても盤を作り直さない）。 */}
            {phase === "setup" && (
                <>
                    <PlayMessage />
                    <PlaySetupPanel
                        rows
                        onOpenAdvanced={() => setIsAdvancedOpen(true)}
                        className="flex-1 px-2 pt-3"
                    />
                </>
            )}
            {isEditing && (
                <div className="flex items-center justify-between gap-2 px-2 pt-2">
                    <h1 data-play-heading tabIndex={-1} className={`${PLAY_HEADING} outline-none`}>
                        開始局面を編集
                    </h1>
                    <PlayBoardTools />
                </div>
            )}
            {inGame && (
                <>
                    {phase !== "finished" && (
                        <h1 data-play-heading tabIndex={-1} className="sr-only">
                            対局中
                        </h1>
                    )}
                    {/* 相手の帯と、盤の横の操作（盤の向き・着手音）。対局中は棋譜の帯を出さない（直前の手は盤に示す。
                        縦を詰めて、盤と操作を 1 画面に収める）。 */}
                    {/* 高さは帯（アイコン 32px）に合わせて固定し、結果の行に替わっても盤を動かさない。 */}
                    <div className="flex min-h-10 items-center gap-1">
                        {/* 終局後は、相手の帯の場所に結果を出す（最初に目が行く所）。 */}
                        {phase === "finished" ? (
                            <PlayResultHeadline className="min-w-0 flex-1 px-1" />
                        ) : (
                            <PlayPlayerBar position="top" className="min-w-0 flex-1" />
                        )}
                        <PlayBoardTools />
                    </div>
                </>
            )}

            {board}

            {/* 盤の下: 段階ごとの内容。 */}
            {isEditing && (
                <>
                    <PlayMessage />
                    {/* 編集を終える操作は、画面の下端に留める。 */}
                    <PlayPositionEditorPanel
                        hideHeading
                        stickyPrimary
                        className="gap-3 px-2 pb-1"
                    />
                </>
            )}
            {phase === "finished" && (
                <>
                    {/* 振り返りの送りと次の一歩は、対局中の手番の行・操作の行と同じ高さ・同じ位置に置く
                        （終局で盤の大きさも位置も変えない）。棋譜の帯は行の幅いっぱいに置き（1 手ずつはここで送る）、両端に最初・最後へのボタンを置く。 */}
                    <div className="sticky bottom-0 z-10 mt-auto flex flex-col gap-1 bg-background pb-1">
                        <KifuNavigationToolbar
                            currentPly={navigationState.currentPly}
                            totalPly={navigationState.totalPly}
                            onBack={navigationHandlers.goBack}
                            onForward={() => navigationHandlers.goForward()}
                            onToStart={navigationHandlers.goToStart}
                            onToEnd={navigationHandlers.goToEnd}
                            canGoForward={navigationState.canGoForward}
                            size="bar"
                            center={
                                <PlayKifuStrip
                                    showReading={hasEngine && displaySettings.showEngineReading}
                                    className="h-8"
                                />
                            }
                        />
                        <PlayResultCard singleRow hideSummary />
                    </div>
                    <PlayMessage />
                    <PlayResultDialog variant="sheet" />
                </>
            )}
            {(phase === "playing" || phase === "paused") && (
                // 手番（知らせ・ヒントがあればそれ）と操作。画面の下端に留めて、盤が上へ送られても
                // 押せるようにする。高さは固定して、盤を動かさない。
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
                        <PlayMyStatus withPlayer={!isVsAi} />
                    </div>
                    <PlayMatchActions
                        compact
                        extra={
                            phase === "playing" &&
                            (sides.sente.role === "human" || sides.gote.role === "human") ? (
                                <PlayHintButton className="flex-1 px-2" />
                            ) : null
                        }
                    />
                </div>
            )}

            {/* 詳細設定（先後それぞれの担当・秒数・変則ルール・評価関数の管理・表示） */}
            <BottomSheet
                open={isAdvancedOpen}
                onOpenChange={setIsAdvancedOpen}
                title="詳細設定"
                height="full"
            >
                <div className="px-1 pb-4">
                    <PlayAdvancedSettings
                        onDisplaySettingsChange={onDisplaySettingsChange}
                        devTools={devTools}
                    />
                </div>
            </BottomSheet>
        </div>
    );
}
