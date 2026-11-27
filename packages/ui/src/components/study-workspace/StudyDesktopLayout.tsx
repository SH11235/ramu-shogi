import { cn } from "@shogi/design-system";
import type { CSSProperties, ReactElement, ReactNode, RefObject } from "react";
import { useState } from "react";

/** 盤の下の操作の行の高さ（1 段のとき）。測るまでの値。 */
const ACTION_BAR_HEIGHT_PX = 55;

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

/** 編集できない間に、操作を止めて薄くする範囲。 */
function Lockable({
    locked,
    className,
    children,
    ref,
}: {
    locked: boolean;
    className?: string;
    children: ReactNode;
    ref?: RefObject<HTMLDivElement | null>;
}): ReactElement {
    return (
        <div ref={ref} inert={locked} className={cn(className, locked && "opacity-70")}>
            {children}
        </div>
    );
}

/**
 * PC（2〜3 列）とタブレットの縦持ち（2 列）の画面。
 *
 * 編集できない間は、盤の下の操作の行（棋譜・局面の書き出し）を除いて操作を止める。
 */
export function StudyDesktopLayout({
    locked,
    actionBar,
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
    locked: boolean;
    /** 盤の下（局面の移動の下）に置く、棋譜と、いまの局面の操作。 */
    actionBar: ReactNode;
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
    // 盤の下の行は、盤の幅が足りないと 2 段に折り返して高くなる。その高さを測って盤の高さの式に入れる
    // （折り返すと盤は縮み、縮めば幅はさらに狭くなるので、折り返したままで落ち着く）。
    const [actionBarHeight, setActionBarHeight] = useState(ACTION_BAR_HEIGHT_PX);
    const observeActionBar = (element: HTMLDivElement | null) => {
        if (!element) return;
        const update = () => setActionBarHeight(Math.ceil(element.getBoundingClientRect().height));
        update();
        const observer = new ResizeObserver(update);
        observer.observe(element);
        return () => observer.disconnect();
    };
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
                        <Lockable
                            locked={locked}
                            className="flex w-full flex-col items-center gap-2"
                        >
                            {boardStatus}
                            {fluidBoard}
                            {navBar}
                        </Lockable>
                        <div className="-mt-1 w-full">{actionBar}</div>
                    </div>
                    <Lockable locked={locked}>{graphWithComment}</Lockable>
                </div>
                <Lockable locked={locked} className="flex min-w-0 flex-col gap-3">
                    {candidatesPanel}
                    {moveList}
                </Lockable>
            </div>
        );
    }
    // 盤の大きさの決め方は対局画面（PlayPCLayout）に倣う: 高さは画面の高さから、表題の行・盤の上の行・
    // 局面の移動の 267px と、盤の下の操作の行の高さを引いた残りで決める。横は右の列の
    // 幅（xl は 2 列で約 600px、lg は 1 列で約 330px）を残す分で抑える。盤と駒台の幅は
    // マスのおよそ 11.2 倍 + 56px。この分岐は PC だけで描くので、xl 未満の値は画面幅の
    // 条件を付けずに置く（lg の rem と isTablet の px が文字の大きさで食い違っても効くように）。
    // xl では評価値グラフを右の 2 列にまたがる横長の行に出し、その下に 2 列を並べる。
    // 2 列の高さは、画面の高さから表題の行・出典の行などの 9.75rem を引いた全体の残りで決める。
    return (
        <div
            className={cn(
                "grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3 [--shogi-cell-size:clamp(34px,min(calc((100dvh-267px-var(--study-action-bar-height))/9),calc((100vw-440px)/11.2)),72px)] xl:grid-cols-[auto_minmax(300px,1fr)_minmax(260px,300px)] xl:[--shogi-cell-size:clamp(34px,min(calc((100dvh-267px-var(--study-action-bar-height))/9),calc((min(100vw,1600px)-720px)/11.2)),72px)]",
                isWide && "h-[calc(100dvh-9.75rem)] grid-rows-[auto_minmax(0,1fr)]",
            )}
            style={{ "--study-action-bar-height": `${actionBarHeight}px` } as CSSProperties}
        >
            <div
                // 持ち駒は対局画面と同じく盤の左右に置く（盤の上下を詰めて 1 画面に収める）。
                className={cn("flex w-fit flex-col items-center gap-2", isWide && "row-span-2")}
            >
                {/* ホイールでの局面の移動は盤と局面の移動の上だけにする（書き出しの行の上で回して、
                    コピーする局面が変わらないように）。 */}
                <Lockable
                    ref={boardSectionRef}
                    locked={locked}
                    className="flex flex-col items-center gap-2"
                >
                    {boardStatus}
                    {board}
                    {navBar}
                </Lockable>
                {/* 盤の下の行は、局面の移動に寄せて置く（盤の高さを 1px でも多く残す）。 */}
                <div ref={observeActionBar} className="-mt-1 w-full">
                    {actionBar}
                </div>
            </div>
            {isWide && (
                <Lockable locked={locked} className="col-span-2 min-w-0">
                    {graphWithComment}
                </Lockable>
            )}
            {/* 右の列は画面の高さに収め、溢れる分は列の中で送る。送る列の端で欄の影やフォーカスの
                枠が切れないよう、内側に余白を取って外側の余白で打ち消す（xl 未満の上限は、画面の
                高さから表題の行などの 10rem を引き、その余白の上下 0.5rem を足し戻した値。xl では
                グラフの下の行いっぱいに伸ばす）。 */}
            <div
                ref={sideColumnRef}
                inert={locked}
                className={cn(
                    "-m-1 flex min-w-0 flex-col gap-3 overflow-y-auto p-1",
                    isWide ? "min-h-0 self-stretch" : "max-h-[calc(100dvh-9.5rem)]",
                    locked && "opacity-70",
                )}
            >
                {!isWide && <div className="shrink-0">{graphWithComment}</div>}
                <div className="shrink-0">{candidatesPanel}</div>
                {!isWide && <div className="shrink-0">{moveList}</div>}
            </div>
            {isWide && (
                <Lockable locked={locked} className="flex min-h-0 min-w-0 flex-col self-stretch">
                    {moveList}
                </Lockable>
            )}
        </div>
    );
}
