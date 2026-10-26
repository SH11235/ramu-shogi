import { cn } from "@shogi/design-system";
import type { CSSProperties, KeyboardEvent, ReactElement, ReactNode, RefObject } from "react";
import { useLayoutEffect, useRef, useState } from "react";
import { StudyNavBar } from "./StudyNavBar";
import { fitMobileBoard, mobileCommentMaxHeight } from "./studyMobileBoardFit";

/**
 * スマートフォンの表示の切り替え。盤と局面の移動はどの表示でも同じ位置に置き、その下の欄だけを
 * 替える（表示を替えても操作の位置が動かないように）。切り替えは画面の上（ブラウザの下端の操作に
 * 隠れない位置）に、名前の付いたタブで出す。
 */
export type StudyMobileTab = "board" | "moves" | "candidates";

const MOBILE_TABS: { id: StudyMobileTab; label: string }[] = [
    { id: "board", label: "盤" },
    { id: "moves", label: "棋譜" },
    { id: "candidates", label: "候補手" },
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
    // 表示の場所と、盤の表示でグラフに使える場所の大きさ（グラフの場所は盤の表示のときだけ
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
    board,
    boardSectionRef,
    nav,
    commentButton,
    commentBox,
    showsComment,
    backToMainButton,
    moveStrip,
    graphPanel,
    moveList,
    candidatesPanel,
}: {
    tab: StudyMobileTab;
    onTabChange: (tab: StudyMobileTab) => void;
    measure: StudyMobileMeasure;
    locked: boolean;
    moreMenu: ReactNode;
    board: ReactNode;
    boardSectionRef: RefObject<HTMLDivElement | null>;
    nav: {
        index: number;
        total: number;
        onToStart: () => void;
        onBack: () => void;
        onForward: () => void;
        onToEnd: () => void;
    };
    commentButton: ReactNode;
    commentBox: ReactNode;
    showsComment: boolean;
    backToMainButton: ReactNode;
    moveStrip: ReactNode;
    graphPanel: ReactNode;
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
                    className="grid min-w-0 flex-1 grid-cols-[3rem_repeat(3,minmax(0,1fr))] gap-1 rounded-lg border border-wafuu-border bg-wafuu-washi-warm p-1"
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
                                "h-9 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                tab === item.id
                                    ? "bg-card text-wafuu-shu shadow-sm"
                                    : "text-wafuu-sumi-light hover:text-wafuu-sumi",
                            )}
                        >
                            {item.label}
                        </button>
                    ))}
                </div>
                {moreMenu}
            </div>
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
                {/* 局面の移動と、この局面へのコメント。どの表示でも盤のすぐ下の同じ位置に置く。
                    コメント欄は開いたときだけ、この行の下に重ねる（開閉で画面が上下しない）。 */}
                <div className="relative flex shrink-0 items-center justify-center gap-1">
                    <StudyNavBar compact {...nav} />
                    {commentButton}
                    <div
                        id="study-comment"
                        hidden={!showsComment}
                        // 欄は下の場所の高さまでにして中で送る（別の画面の変更との突き合わせなどで
                        // 高くなる）。下の場所が低すぎるときは下限の高さで出し、表示の場所ごと送る
                        // （欄の端まで送ったら外側へ送りを渡し、上の操作へ戻れるようにする）。
                        className="absolute inset-x-0 top-full z-20 mt-1.5 overflow-y-auto rounded-xl shadow-lg"
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
                {tab === "board" ? (
                    <div className="flex min-h-0 flex-1 flex-col gap-1.5">
                        <div className="flex shrink-0 items-center gap-1.5">
                            {backToMainButton}
                            <div className="min-w-0 flex-1">{moveStrip}</div>
                        </div>
                        {/* グラフは残りの高さいっぱいに広げる（盤の下に空きを作らない）。 */}
                        <div ref={measure.observeGraphSlot} className="min-h-0 flex-1">
                            {graphPanel}
                        </div>
                    </div>
                ) : (
                    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain">
                        {/* 棋譜の欄は見出しに同じ操作があるので、それ以外の欄にだけ出す。 */}
                        {tab !== "moves" && backToMainButton && (
                            <div className="flex shrink-0">{backToMainButton}</div>
                        )}
                        {tab === "moves" && moveList}
                        {tab === "candidates" && candidatesPanel}
                    </div>
                )}
            </div>
        </div>
    );
}
