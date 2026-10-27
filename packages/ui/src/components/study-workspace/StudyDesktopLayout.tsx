import { cn } from "@shogi/design-system";
import type { ReactElement, ReactNode, RefObject } from "react";

/**
 * PC・タブレットの評価値グラフと、その上に重ねるコメント欄。
 *
 * コメント欄は畳んでいる間も描いたままにする（書きかけの保存・別の画面の変更との突き合わせは、
 * 欄が動いていないと進まない）。開いたときだけグラフの上に重ねる（開閉で画面が上下しない）。
 * 重ねている間、下のグラフは操作させない。
 */
function GraphWithComment({
    graphPanel,
    commentBox,
    showsComment,
}: {
    graphPanel: ReactNode;
    commentBox: ReactNode;
    showsComment: boolean;
}): ReactElement {
    return (
        <div className="relative w-0 min-w-full">
            <div inert={showsComment}>{graphPanel}</div>
            <div
                id="study-comment"
                hidden={!showsComment}
                className="absolute inset-x-0 top-0 z-20 rounded-xl shadow-panel"
            >
                {commentBox}
            </div>
        </div>
    );
}

/** PC（2〜3 列）とタブレットの縦持ち（2 列）の画面。 */
export function StudyDesktopLayout({
    isTablet,
    isWide,
    boardStatus,
    board,
    fluidBoard,
    boardSectionRef,
    sideColumnRef,
    navBar,
    graphPanel,
    commentBox,
    showsComment,
    candidatesPanel,
    moveList,
}: {
    isTablet: boolean;
    isWide: boolean;
    boardStatus: ReactNode;
    /** 持ち駒を盤の左右に置いた盤（PC）。 */
    board: ReactNode;
    /** 親の幅に合わせて描く盤（タブレット）。 */
    fluidBoard: ReactNode;
    boardSectionRef: RefObject<HTMLDivElement | null>;
    sideColumnRef: RefObject<HTMLDivElement | null>;
    navBar: ReactNode;
    graphPanel: ReactNode;
    commentBox: ReactNode;
    showsComment: boolean;
    candidatesPanel: ReactNode;
    moveList: ReactNode;
}): ReactElement {
    const graphWithComment = (
        <GraphWithComment
            graphPanel={graphPanel}
            commentBox={commentBox}
            showsComment={showsComment}
        />
    );
    if (isTablet) {
        // タブレットの縦持ち: 盤を小さくして左に置き、右に候補手と棋譜の列を並べる。
        return (
            <div className="grid grid-cols-[22.5rem_minmax(0,1fr)] items-start gap-3">
                <div className="flex min-w-0 flex-col gap-3">
                    <div className="flex flex-col items-center gap-2">
                        {boardStatus}
                        {fluidBoard}
                        {navBar}
                    </div>
                    {graphWithComment}
                </div>
                <div className="flex min-w-0 flex-col gap-3">
                    {candidatesPanel}
                    {moveList}
                </div>
            </div>
        );
    }
    // 盤の大きさは対局画面（PlayPCLayout）と揃える: 高さは同じ式で決め、横は右の列の
    // 幅（xl は 2 列で約 600px、lg は 1 列で約 330px）を残す分で抑える。盤と駒台の幅は
    // マスのおよそ 11.2 倍 + 56px。この分岐は PC だけで描くので、xl 未満の値は画面幅の
    // 条件を付けずに置く（lg の rem と isTablet の px が文字の大きさで食い違っても効くように）。
    // xl では評価値グラフを右の 2 列にまたがる横長の行に出し、その下に 2 列を並べる。
    // 2 列の高さは、画面の高さから表題の行・出典の行などの 9.75rem を引いた全体の残りで決める。
    return (
        <div
            className={cn(
                "grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3 [--shogi-cell-size:clamp(34px,min(calc((100dvh-300px)/9),calc((100vw-440px)/11.2)),72px)] xl:grid-cols-[auto_minmax(300px,1fr)_minmax(260px,300px)] xl:[--shogi-cell-size:clamp(34px,min(calc((100dvh-300px)/9),calc((min(100vw,1600px)-720px)/11.2)),72px)]",
                isWide && "h-[calc(100dvh-9.75rem)] grid-rows-[auto_minmax(0,1fr)]",
            )}
        >
            <div
                ref={boardSectionRef}
                // 持ち駒は対局画面と同じく盤の左右に置く（盤の上下を詰めて 1 画面に収める）。
                className={cn("flex w-fit flex-col items-center gap-2", isWide && "row-span-2")}
            >
                {boardStatus}
                {board}
                {navBar}
            </div>
            {isWide && <div className="col-span-2 min-w-0">{graphWithComment}</div>}
            {/* 右の列は画面の高さに収め、溢れる分は列の中で送る。送る列の端で欄の影やフォーカスの
                枠が切れないよう、内側に余白を取って外側の余白で打ち消す（xl 未満の上限は、画面の
                高さから表題の行などの 10rem を引き、その余白の上下 0.5rem を足し戻した値。xl では
                グラフの下の行いっぱいに伸ばす）。 */}
            <div
                ref={sideColumnRef}
                className={cn(
                    "-m-1 flex min-w-0 flex-col gap-3 overflow-y-auto p-1",
                    isWide ? "min-h-0 self-stretch" : "max-h-[calc(100dvh-9.5rem)]",
                )}
            >
                {!isWide && <div className="shrink-0">{graphWithComment}</div>}
                <div className="shrink-0">{candidatesPanel}</div>
                {!isWide && <div className="shrink-0">{moveList}</div>}
            </div>
            {isWide && <div className="flex min-h-0 min-w-0 flex-col self-stretch">{moveList}</div>}
        </div>
    );
}
