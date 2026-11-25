import { cn } from "@shogi/design-system";
import type { CSSProperties, KeyboardEvent, ReactElement, ReactNode, RefObject } from "react";
import { useLayoutEffect, useRef, useState } from "react";
import { RamRunningIcon } from "../ram-running-icon";
import { MobileNavigation } from "../shogi-match/components/MobileNavigation";
import { fitMobileBoard, mobileCommentMaxHeight } from "./studyMobileBoardFit";

/**
 * スマートフォンの表示の切り替え。盤・局面の移動・局面の帯はどの表示でも同じ位置に置き、その下の
 * 欄だけを替える（表示を替えても操作の位置が動かないように）。欄は答える問いで分ける: この局面で
 * 何を指すか（候補手）、手順と変化（棋譜）、一局のどこを見直すか（グラフ）。切り替えは画面の上
 * （ブラウザの下端の操作に隠れない位置）に、名前の付いたタブで出す。
 */
export type StudyMobileTab = "candidates" | "moves" | "graph";

const MOBILE_TABS: { id: StudyMobileTab; label: string }[] = [
    { id: "candidates", label: "候補手" },
    { id: "moves", label: "棋譜" },
    { id: "graph", label: "グラフ" },
];

/** 要素の大きさを測り続ける callback ref を作る。 */
const observeSize =
    (update: (element: HTMLDivElement) => void) => (element: HTMLDivElement | null) => {
        if (!element) return;
        const run = () => update(element);
        run();
        const observer = new ResizeObserver(run);
        observer.observe(element);
        return () => observer.disconnect();
    };

/**
 * スマートフォンの画面の寸法。画面の高さちょうどに収める（ページを縦に送らない）ために、画面の
 * 上端の位置・表示の場所・グラフの場所を測り、盤のマスとグラフの高さを決める。
 */
export function useStudyMobileMeasure(isMobile: boolean) {
    // 上端の位置（アプリの見出しの高さ）は端末と表示で変わるので、測って残りの高さを決める。
    const rootRef = useRef<HTMLDivElement | null>(null);
    const [rootTop, setRootTop] = useState<number | null>(null);
    useLayoutEffect(() => {
        const root = rootRef.current;
        if (!isMobile || !root) return;
        const update = () => setRootTop(root.getBoundingClientRect().top + window.scrollY);
        update();
        window.addEventListener("resize", update);
        return () => window.removeEventListener("resize", update);
    }, [isMobile]);
    // 表示の場所と、グラフの表示でグラフに使える場所の大きさ（グラフの場所はグラフの表示のときだけ
    // あるので、付いた要素をそのつど測る）。
    const [panel, setPanel] = useState<{ width: number; height: number } | null>(null);
    const [graphSlotHeight, setGraphSlotHeight] = useState<number | null>(null);
    // ブラウザの操作の帯が縮んで、いまの画面（dvh）が帯の出ている画面（svh）より高くなった分。
    // 全体はいまの画面いっぱいに広げ、増えた分は盤の下の欄に回す（盤の大きさは帯の出入りで変えない）。
    const [barsSlack, setBarsSlack] = useState(0);
    return {
        rootRef,
        rootTop,
        panel,
        graphSlotHeight,
        boardFit: panel === null ? null : fitMobileBoard(panel.width, panel.height - barsSlack),
        observePanel: observeSize((element) => {
            const { clientWidth: width, clientHeight: height } = element;
            setPanel((prev) =>
                prev?.width === width && prev.height === height ? prev : { width, height },
            );
        }),
        observeBarsSlack: observeSize((element) => setBarsSlack(element.clientHeight)),
        observeGraphSlot: observeSize((element) => setGraphSlotHeight(element.clientHeight)),
    };
}

type StudyMobileMeasure = ReturnType<typeof useStudyMobileMeasure>;

/**
 * スマートフォンの画面。盤（大きく見る）と一覧（盤を縮めて並べる）のどちらも、画面の高さに収める。
 * 欄の中身が変わっても高さは変わらず、形が変わるのは利用者が切り替えたときだけ。
 */
export function StudyMobileLayout({
    tab,
    onTabChange,
    measure,
    locked,
    moreMenu,
    isReading,
    saveStrip,
    board,
    boardSectionRef,
    nav,
    commentButton,
    commentBox,
    showsComment,
    onBackToMainLine,
    positionBand,
    graphPanel,
    reviewList,
    moveList,
    candidatesPanel,
}: {
    tab: StudyMobileTab;
    onTabChange: (tab: StudyMobileTab) => void;
    measure: StudyMobileMeasure;
    locked: boolean;
    moreMenu: ReactNode;
    /**
     * 読んでいる（CPU を使っている）か。読んでいる様子と止める操作は候補手の欄にあるので、ほかの表示を
     * 開いている間は「候補手」のタブに走るラムを出して知らせる。
     */
    isReading: boolean;
    /** 表示の切り替えの下に出す、保存の状態の帯（出さないときは null）。 */
    saveStrip: ReactNode;
    board: ReactNode;
    boardSectionRef: RefObject<HTMLDivElement | null>;
    nav: {
        index: number;
        total: number;
        onToStart: () => void;
        onBack: () => void;
        onForward: () => void;
        onToEnd: () => void;
        onBackTen: () => void;
        onForwardTen: () => void;
    };
    commentButton: ReactNode;
    commentBox: ReactNode;
    showsComment: boolean;
    /** 変化を見ているときの「本譜に戻る」。本譜にいる間は null。 */
    onBackToMainLine: (() => void) | null;
    /** いまの局面の手・評価値・悪手かどうか。どの表示でも局面の移動の下に出す。 */
    positionBand: ReactNode;
    graphPanel: ReactNode;
    /** グラフの下に並べる、見直す手の一覧。 */
    reviewList: ReactNode;
    moveList: ReactNode;
    candidatesPanel: ReactNode;
}): ReactElement {
    const { boardFit, panel } = measure;
    const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
        const index = MOBILE_TABS.findIndex((item) => item.id === tab);
        const next =
            event.key === "ArrowRight"
                ? (index + 1) % MOBILE_TABS.length
                : event.key === "ArrowLeft"
                  ? (index - 1 + MOBILE_TABS.length) % MOBILE_TABS.length
                  : event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? MOBILE_TABS.length - 1
                      : -1;
        if (next < 0) return;
        // タブの上の矢印キーはタブの切り替えに使う（棋譜の移動にしない）。
        event.preventDefault();
        event.stopPropagation();
        onTabChange(MOBILE_TABS[next].id);
        document.getElementById(`study-tab-${MOBILE_TABS[next].id}`)?.focus();
    };

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-1.5">
            <div className="flex shrink-0 items-center gap-1">
                <div
                    role="tablist"
                    aria-label="表示の切り替え"
                    className="grid min-w-0 flex-1 grid-cols-3 gap-1 rounded-lg border border-wafuu-border bg-wafuu-washi-warm p-1"
                >
                    {MOBILE_TABS.map((item) => (
                        <button
                            key={item.id}
                            id={`study-tab-${item.id}`}
                            type="button"
                            role="tab"
                            aria-selected={tab === item.id}
                            aria-controls="study-tabpanel"
                            tabIndex={tab === item.id ? 0 : -1}
                            onClick={() => onTabChange(item.id)}
                            onKeyDown={handleTabKeyDown}
                            className={cn(
                                "relative h-9 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                tab === item.id
                                    ? "bg-card text-wafuu-shu shadow-sm"
                                    : "text-wafuu-sumi-light hover:text-wafuu-sumi",
                            )}
                        >
                            {item.label}
                            {/* 文字を動かさず、被らないよう、通知の印と同じく右上の角に置く。 */}
                            {item.id === "candidates" && isReading && tab !== "candidates" && (
                                <>
                                    <RamRunningIcon className="absolute -top-3 -right-1" />
                                    <span className="sr-only">（読んでいます）</span>
                                </>
                            )}
                        </button>
                    ))}
                </div>
                {/* 手送りの行には手送りだけを置くので、コメントはどの表示でも出るこの行に置く。 */}
                {commentButton}
                {moreMenu}
            </div>
            {saveStrip}
            <div
                ref={measure.observePanel}
                id="study-tabpanel"
                role="tabpanel"
                aria-labelledby={`study-tab-${tab}`}
                inert={locked}
                // 普段は中身がちょうど収まる。盤が縮小の下限でも入らない低い画面と、コメント欄が
                // 下の場所より高いときだけ、ここを縦に送る（切れて届かない操作を作らない）。
                // スクロールバーが幅を取る環境でも、その幅を常に空けておき、送りが出入りしても
                // 盤の大きさを行き来させない。
                className={cn(
                    "flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]",
                    locked && "opacity-70",
                )}
            >
                <div
                    className="flex shrink-0 items-start justify-center overflow-hidden"
                    style={boardFit === null ? undefined : { height: boardFit.boardHeight }}
                >
                    <div
                        className="flex origin-top items-start justify-center"
                        style={
                            boardFit !== null && boardFit.scale < 1
                                ? { transform: `scale(${boardFit.scale})` }
                                : undefined
                        }
                    >
                        <div
                            ref={boardSectionRef}
                            style={
                                boardFit === null
                                    ? undefined
                                    : ({
                                          "--shogi-cell-size": `${boardFit.cellSize}px`,
                                      } as CSSProperties)
                            }
                        >
                            {board}
                        </div>
                    </div>
                </div>
                {/* 局面の移動。どの表示でも盤のすぐ下の同じ位置に置く。コメント欄は開いたときだけ、
                    この行の下に重ねる（開閉で画面が上下しない）。 */}
                <div className="relative flex shrink-0 justify-center">
                    <MobileNavigation
                        currentPly={nav.index}
                        totalPly={nav.total}
                        onToStart={nav.onToStart}
                        onBack={nav.onBack}
                        onForward={nav.onForward}
                        onToEnd={nav.onToEnd}
                        onBackTen={nav.onBackTen}
                        onForwardTen={nav.onForwardTen}
                        center={
                            // 変化を見ている間だけ、手数の場所を「本譜へ」にする（行の幅も並びも変えない）。
                            onBackToMainLine !== null ? (
                                <button
                                    type="button"
                                    aria-label="本譜に戻る"
                                    onClick={onBackToMainLine}
                                    className="flex h-10 w-[3.25rem] items-center justify-center rounded-md border border-wafuu-border bg-card text-xs min-[375px]:w-[3.75rem] font-medium text-wafuu-ai transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                >
                                    本譜へ
                                </button>
                            ) : undefined
                        }
                    />
                    <div
                        id="study-comment"
                        hidden={!showsComment}
                        // 欄は下の場所の高さまでにして中で送る（別の画面の変更との突き合わせなどで
                        // 高くなる）。下の場所が低すぎるときは下限の高さで出し、表示の場所ごと送る
                        // （欄の端まで送ったら外側へ送りを渡し、上の操作へ戻れるようにする）。
                        className="absolute inset-x-0 top-full z-20 mt-1.5 overflow-y-auto rounded-xl shadow-panel"
                        style={
                            panel === null || boardFit === null
                                ? undefined
                                : {
                                      maxHeight: mobileCommentMaxHeight(
                                          panel.height,
                                          boardFit.boardHeight,
                                      ),
                                  }
                        }
                    >
                        {commentBox}
                    </div>
                </div>
                <div className="shrink-0">{positionBand}</div>
                {tab === "graph" ? (
                    // グラフ（見出し・余白込みで描ける最低の高さ）と一覧の 1 行が入らない低い画面では、
                    // 縮めて重ねずに表示の場所ごと縦に送る。
                    <div className="flex min-h-[9.5rem] flex-1 flex-col gap-1.5">
                        {/* 一覧は中身の高さ（多ければ半分まで）にして中で送り、残りをグラフに回す。 */}
                        <div ref={measure.observeGraphSlot} className="min-h-[6.5rem] flex-1">
                            {graphPanel}
                        </div>
                        <div className="max-h-[50%] min-h-10 overflow-y-auto overscroll-contain">
                            {reviewList}
                        </div>
                    </div>
                ) : (
                    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain">
                        {tab === "moves" && moveList}
                        {tab === "candidates" && candidatesPanel}
                    </div>
                )}
            </div>
        </div>
    );
}
