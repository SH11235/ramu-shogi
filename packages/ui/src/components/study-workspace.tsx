/**
 * 研究ノートの画面（Web / Desktop 共通）。
 *
 * 「取り込む → 全体を解析 → 悪手の印から深掘り」が主役になるよう、検討モード（`ShogiMatch`）とは
 * 別に組んでいる。盤・持ち駒・評価値グラフ・読み筋の再生・指し手の入力・解析の実行は
 * 既存の部品とフックをそのまま使う。
 *
 * 画面は保存用の文書（`StudyDocument`）を唯一の元データにする。編集は操作（`StudyOp`）として
 * `onApplyOps` に渡し、呼び出し側が文書を更新して保存層へ流す（ui は保存層に依存しない）。
 */

import {
    isStudyPassMove,
    type KifuTree,
    type LastMove,
    type PieceType,
    type Player,
    type PositionState,
    type Square,
    type StudyDocument,
    type StudyOp,
    studyScoreToKifuEval,
} from "@shogi/app-core";
import { cn } from "@shogi/design-system";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import type { PlayFromPosition } from "./rshogi-play-from-position";
import { MatchNnueDownloadDialog } from "./shogi-match/components/MatchNnueDownloadDialog";
import { type HandInfo, MobileBoardSection } from "./shogi-match/components/MobileBoardSection";
import { MobileKifuBar } from "./shogi-match/components/MobileKifuBar";
import { PCBoardContent } from "./shogi-match/components/PCBoardContent";
import { PvPreviewDialog } from "./shogi-match/components/PvPreviewDialog";
import { TOOLTIP_DELAY_DURATION_MS } from "./shogi-match/constants";
import { DISPLAY_SETTINGS_STORAGE_KEY } from "./shogi-match/hooks/useBoardPattern";
import { useKifuKeyboardNavigation } from "./shogi-match/hooks/useKifuKeyboardNavigation";
import { useLocalStorage } from "./shogi-match/hooks/useLocalStorage";
import { useIsMobile, useMediaQuery } from "./shogi-match/hooks/useMediaQuery";
import { useMoveShadow } from "./shogi-match/hooks/useMoveShadow";
import {
    DEFAULT_DISPLAY_SETTINGS,
    type DisplaySettings,
    type EngineOption,
    type Message,
} from "./shogi-match/types";
import { boardToGrid } from "./shogi-match/utils/positionUtils";
import {
    type StudyAnalysisRunState,
    StudyHeaderAnalysisAction,
} from "./study-workspace/StudyAnalysisRunControls";
import { StudyAnalysisSettings } from "./study-workspace/StudyAnalysisSettings";
import { StudyCandidatesPanel, type StudyPvRequest } from "./study-workspace/StudyCandidatesPanel";
import {
    isStudyCommentOverLimit,
    StudyCommentBox,
    type StudyCommentDraftChange,
} from "./study-workspace/StudyCommentBox";
import { StudyDeleteVariationDialog } from "./study-workspace/StudyDeleteVariationDialog";
import { StudyDesktopLayout } from "./study-workspace/StudyDesktopLayout";
import {
    buildStudyEvalGraph,
    StudyEvalGraphPanel,
    type StudyGraphSeries,
} from "./study-workspace/StudyEvalGraphPanel";
import { StudyIconButton } from "./study-workspace/StudyIconButton";
import { BranchIcon, CommentIcon, FlipIcon } from "./study-workspace/StudyIcons";
import {
    StudyMobileLayout,
    type StudyMobileTab,
    useStudyMobileMeasure,
} from "./study-workspace/StudyMobileLayout";
import { StudyMoreMenu } from "./study-workspace/StudyMoreMenu";
import { StudyMoveList } from "./study-workspace/StudyMoveList";
import { StudyNavBar } from "./study-workspace/StudyNavBar";
import { StudyNotice } from "./study-workspace/StudyNotice";
import {
    StudySaveIndicator,
    StudySaveNotice,
    type StudyWorkspaceSaveStatus,
} from "./study-workspace/StudySaveStatus";
import { StudyTitleDialog } from "./study-workspace/StudyTitleDialog";
import { StudyWorkspaceHeader } from "./study-workspace/StudyWorkspaceHeader";
import { exportStudyLineToKif, exportStudyPositionToSfen } from "./study-workspace/studyExport";
import { deriveStudyPositionInsights } from "./study-workspace/studyPositionInsights";
import {
    applyStudyLayerToTree,
    buildStudyStructureTree,
    chooseStudyDisplayLayer,
    countStudyLayerResults,
    type StudyStructureTree,
    studyFirstMoveLabel,
    studyMoveLabel,
    studyOriginLabel,
    studyPathTo,
    studyPlayersLabel,
    studyStructureKey,
} from "./study-workspace/studyView";
import {
    type StudyAnalysisController,
    type StudyApplyOpsResult,
    type StudyEngineIdentity,
    useStudyAnalysis,
} from "./study-workspace/useStudyAnalysis";
import {
    type StudyCommentDraft,
    useStudyCommentDrafts,
} from "./study-workspace/useStudyCommentDrafts";
import { type StudyMateController, useStudyMate } from "./study-workspace/useStudyMate";
import {
    type StudyFetchLegalMoves,
    useStudyMoveEditing,
} from "./study-workspace/useStudyMoveEditing";
import { useStudyNodeNavigation } from "./study-workspace/useStudyNodeNavigation";
import { TooltipProvider } from "./tooltip";

export type { StudyCommentDraft };

/** 通知を出しておく時間（ミリ秒）。エラーは読む時間を長めに取る。 */
const NOTICE_DURATION_MS = { error: 9000, warning: 7000, success: 4000 } as const;

interface StudyWorkspaceCommonProps {
    /** 研究ノートの文書（画面の唯一の元データ）。 */
    doc: StudyDocument;
    /**
     * 編集の操作。呼び出し側が文書に適用し、保存層へ流す。保存できなかったとき `false` で
     * 解決する Promise を返すと、実行中の解析を止める。
     */
    onApplyOps: (ops: StudyOp[]) => StudyApplyOpsResult;
    saveStatus: StudyWorkspaceSaveStatus;
    /** 止まっている送信をもう一度試す。 */
    onRetrySave?: () => void;
    /** ログインへ進む（未ログインのときの案内に使う）。 */
    onLogin?: () => void;
    /** AI（評価関数）を追加する画面を開く。指定がなければ解析設定に追加の入口を出さない。 */
    onOpenNnueLibrary?: () => void;
    /** このブラウザからノートを消す（他の端末で削除されたとき）。 */
    onDiscard?: () => void;
    /** 元の棋譜へのリンク。無ければ出どころの種別だけを出す。 */
    originLink?: ReactNode;
    /**
     * 保存先がこの端末だけの環境（ログインの仕組みが無い Desktop）。保存の状態の文言を
     * 「この端末に保存済み」にし、ログインの案内を出さない。
     */
    localOnly?: boolean;
    /**
     * いま見ている局面を対局ページで開く（開き方は呼び出し側が決める。Web は `/play` へ移動）。
     * 渡さなければ「この局面から対局」を出さない。
     */
    onPlayFromPosition?: (position: PlayFromPosition) => void;
    /** 合法手の取得の差し替え（Desktop・テスト用）。省略時は共通の PositionService。 */
    fetchLegalMoves?: StudyFetchLegalMoves;
    /**
     * 編集できない状態（開いている間にログインが切れて、ノートを保存できなくなった）。
     * 画面は残し、編集と解析のすべての入口を止めて、ログインし直す案内を出す。
     * 書きかけのコメントは消さない。
     */
    locked?: boolean;
    /**
     * 最初に入れておくコメントの下書き（前回、保存できないまま残っていた入力）。手ごとに 1 つ。
     * その手を開いたときにコメント欄へ戻す。
     */
    initialCommentDrafts?: readonly StudyCommentDraft[] | null;
    /**
     * まだ保存できていないコメントの入力（下書き）が変わった。呼び出し側は、手ごとの下書きの
     * 置き場所に反映する。消す通知（`clear`）は、保存できた内容（`savedText`）を持つ: 置いてある
     * 下書きがその内容と同じときだけ消すこと（古い保存の完了が、新しい下書きを消さないように）。
     */
    onCommentDraftChange?: (nodeId: string, change: StudyCommentDraftChange) => void;
    /**
     * 文書のコメントが最新だと確かめられているか。false の間（ノートを開いた直後で、サーバーの
     * 最新の内容をまだ取り込めていない）は、コメントの下書きを自動では保存しない（他の端末の
     * コメントを、確かめずに上書きしないため）。省略時は true。
     */
    commentBaseConfirmed?: boolean;
}

interface StudyWorkspaceViewProps extends StudyWorkspaceCommonProps {
    /** 文書から作った棋譜ツリー（`buildStudyViewTree(doc, displayLayerId)` の結果）。 */
    tree: KifuTree;
    /** 開始局面から再生できず、表示できなかった枝の数。 */
    unrestoredCount?: number;
    /** 表示中の解析レイヤー。 */
    displayLayerId: string | null;
    onDisplayLayerChange: (layerId: string) => void;
    analysis: StudyAnalysisController;
    /** 画面の上に重ねて出す通知（操作の結果・エラー）。 */
    message: Message | null;
    onMessageChange: (message: Message | null) => void;
    /** 最初に開く局面（前回見ていた局面）。 */
    initialNodeId?: string | null;
    /** 見ている局面が変わった。 */
    onCurrentNodeChange?: (nodeId: string) => void;
    /** 直近の「この局面を深く解析」で使った解析の設定（レイヤー）。 */
    deepLayerId?: string | null;
    /** 詰み探索。渡さなければ出さない。 */
    mate?: StudyMateController;
}

/** USI の指し手から、盤上で強調する最終手を作る。 */
function lastMoveOf(usiMove: string | null): LastMove | undefined {
    // パスには移動元も移動先も無い（`pass` は 4 文字なので、通常の移動として読まないよう先に見る）。
    if (!usiMove || usiMove.length < 4 || isStudyPassMove(usiMove)) return undefined;
    if (usiMove.includes("*")) {
        return { from: null, to: usiMove.slice(-2) as Square, promotes: false };
    }
    return {
        from: usiMove.slice(0, 2) as Square,
        to: usiMove.slice(2, 4) as Square,
        promotes: usiMove.endsWith("+"),
    };
}

/** 研究ノートの画面の見た目と操作（解析の実行は `analysis` として受け取る）。 */
export function StudyWorkspaceView({
    doc,
    tree,
    unrestoredCount = 0,
    onApplyOps,
    saveStatus,
    onRetrySave,
    onLogin,
    onOpenNnueLibrary,
    onDiscard,
    originLink,
    localOnly = false,
    onPlayFromPosition,
    fetchLegalMoves,
    locked = false,
    initialCommentDrafts,
    onCommentDraftChange,
    commentBaseConfirmed = true,
    displayLayerId,
    onDisplayLayerChange,
    analysis,
    message,
    onMessageChange,
    initialNodeId,
    onCurrentNodeChange,
    deepLayerId = null,
    mate,
}: StudyWorkspaceViewProps): ReactElement {
    const isMobile = useIsMobile();
    // 768〜1023px（タブレットの縦持ち）: 盤を小さくして 2 列にする。
    const isTablet = useMediaQuery("(min-width: 768px) and (max-width: 1023px)");
    // 3 列で並ぶ幅。表題の行に余裕があるので、保存の状態なども同じ行に入れる（縦を取らない）。
    // Tailwind の xl（80rem）と同じ単位で判定する（px だと、ブラウザの文字の大きさを変えたときに
    // 棋譜の欄を置く列が CSS のグリッドと食い違う）。
    const isWide = useMediaQuery("(min-width: 80rem)");
    const [storedDisplaySettings] = useLocalStorage<DisplaySettings>(
        DISPLAY_SETTINGS_STORAGE_KEY,
        DEFAULT_DISPLAY_SETTINGS,
    );
    const displaySettings = { ...DEFAULT_DISPLAY_SETTINGS, ...storedDisplaySettings };

    const [flipBoard, setFlipBoard] = useState(false);
    const [mobileTab, setMobileTab] = useState<StudyMobileTab>("board");
    const mobileMeasure = useStudyMobileMeasure(isMobile);
    // コメント欄は普段は畳んでおき、盤の上のボタンで開く（開いたままにすれば、手を送っても出続ける）。
    const [isCommentOpen, setIsCommentOpen] = useState(false);
    // 対局時の評価値と解析の両方があるとき、評価値グラフでどちらを主の線にするか。
    const [graphPrimaryChoice, setGraphPrimaryChoice] = useState<StudyGraphSeries>("source");
    const sideColumnRef = useRef<HTMLDivElement | null>(null);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [isTitleDialogOpen, setIsTitleDialogOpen] = useState(false);
    // 「その他の操作」を開いている間は、矢印キーで局面を動かさない（コピー・対局に渡す局面が、
    // メニューの中でのキー操作で変わってしまうため）。
    const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
    const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
    const comments = useStudyCommentDrafts({
        initialDrafts: initialCommentDrafts,
        onDraftChange: onCommentDraftChange,
    });
    // 「この局面を深く解析」を押した局面。その局面を見ている間、結果を開いた状態で目立たせる。
    const [deepNodeId, setDeepNodeId] = useState<string | null>(null);
    const [pvPreview, setPvPreview] = useState<{
        pv: string[];
        startPosition: PositionState;
        /** 最初の手の表記（候補手の欄と同じ。直前の手と同じマスなら「同」）。 */
        firstMoveLabel: string | null;
        ply: number;
        evalCp?: number;
        evalMate?: number;
    } | null>(null);

    const nav = useStudyNodeNavigation({
        tree,
        initialNodeId,
        onCurrentNodeChange,
        onMessageChange,
        locked,
        onLeave: (leaving) => {
            setDeepNodeId(null);
            // 長すぎて保存できていないコメントを残して移るときは、黙って移らず知らせる。
            const draft = comments.drafts.get(leaving.id);
            if (draft !== undefined && isStudyCommentOverLimit(draft.text)) {
                onMessageChange({
                    text: `${leaving.ply === 0 ? "開始局面" : `${leaving.ply}手目`}のコメントは長すぎるため、保存されていません。入力はその手に残してあります（棋譜に「未保存」の印が付きます）。`,
                    type: "warning",
                });
            }
        },
    });
    const { currentNodeId, currentNode, line, currentIndex, movesToCurrent, navigateTo } = nav;
    const { selection, promotionSelection } = nav;
    const position = currentNode.positionAfter;
    const storedNode = Object.hasOwn(doc.tree.nodes, currentNodeId)
        ? doc.tree.nodes[currentNodeId]
        : undefined;

    const editing = useStudyMoveEditing({
        doc,
        tree,
        nav,
        locked,
        fetchLegalMoves,
        onApplyOps,
        onMessageChange,
    });
    const { handleSquareSelect, handlePromotionChoice, handleHandSelect, getLegalSet } =
        editing.board;

    const boardSectionRef = useRef<HTMLDivElement | null>(null);
    useKifuKeyboardNavigation({
        onForward: nav.goForward,
        onBack: nav.goBack,
        onToStart: nav.goToStart,
        onToEnd: nav.goToEnd,
        // 読み筋の再生・確認ダイアログが開いている間は、そちらのキー操作を優先する。
        disabled:
            locked ||
            pvPreview !== null ||
            deleteTargetId !== null ||
            isSettingsOpen ||
            isTitleDialogOpen ||
            isMoreMenuOpen,
        containerRef: boardSectionRef,
        enableWheelNavigation: displaySettings.enableWheelNavigation,
    });

    // --- 悪手・疑問手・解析の状態 ---
    const insights = deriveStudyPositionInsights({
        doc,
        tree,
        currentNodeId,
        displayLayerId,
        deepNodeId,
        deepLayerId,
    });
    const { highlightKinds, displayLayer, unanalyzedCount } = insights;
    const hasResults = insights.analyzedCount > 0;
    const needsFullAnalysis =
        analysis.mode !== "full" && insights.analyzedCount * 2 < insights.totalCount;
    const graph = buildStudyEvalGraph({
        doc,
        tree,
        line,
        highlights: insights.highlights,
        hasResults,
        primaryChoice: graphPrimaryChoice,
    });

    // --- 編集 ---
    const previewPv = (request: StudyPvRequest): void => {
        const baseNode = tree.nodes.get(request.nodeId);
        if (!baseNode) return;
        const evalData = studyScoreToKifuEval(request.score);
        setPvPreview({
            pv: request.pv,
            startPosition: baseNode.positionAfter,
            firstMoveLabel: studyFirstMoveLabel(baseNode, request.pv),
            ply: baseNode.ply,
            evalCp: evalData?.scoreCp,
            evalMate: evalData?.scoreMate,
        });
    };
    const copyText = (text: string, done: string): void => {
        const failed = (): void =>
            onMessageChange({ text: "コピーできませんでした。", type: "error" });
        try {
            void navigator.clipboard
                .writeText(text)
                .then(() => onMessageChange({ text: done, type: "success" }), failed);
        } catch {
            failed();
        }
    };
    const copyKif = (): void =>
        copyText(
            exportStudyLineToKif(doc, tree, line),
            line.length > 1
                ? `表示中の手順（${line.length - 1} 手）を KIF でコピーしました。`
                : "開始局面を KIF でコピーしました。",
        );
    const copySfen = (): void =>
        copyText(
            exportStudyPositionToSfen(tree.startSfen, movesToCurrent),
            "いま見ている局面を SFEN でコピーしました。",
        );
    const confirmDeleteVariation = (): void => {
        const targetId = deleteTargetId;
        setDeleteTargetId(null);
        if (targetId === null || locked) return;
        const target = tree.nodes.get(targetId);
        if (!target || target.parentId === null) return;
        // 消す変化の中を見ていたら、枝分かれの手前へ戻ってから消す。
        if (studyPathTo(tree, currentNodeId).includes(targetId)) {
            navigateTo(target.parentId, { resetLine: true });
        } else if (line.includes(targetId)) {
            nav.resetLine();
        }
        void onApplyOps([{ type: "deleteSubtree", nodeId: targetId }]);
    };
    // 編集できなくなったら、開いているダイアログ・シートを閉じる（その中から編集や解析を
    // 始められないように）。開いているかどうかの表示も、編集できる間だけにする。
    useEffect(() => {
        if (!locked) return;
        setIsSettingsOpen(false);
        setIsTitleDialogOpen(false);
        setDeleteTargetId(null);
    }, [locked]);
    const settingsOpen = isSettingsOpen && !locked;
    const deleteDialogTargetId = locked ? null : deleteTargetId;

    // 解析と詰み探索は同時に動かさない（スマートフォンで CPU とメモリを取り合う）
    const mateRunning = (mate?.runningNodeId ?? null) !== null;
    /** 解析を始められない（準備中か、詰み探索の途中）。 */
    const analysisBlocked = analysis.isPreparing || mateRunning;
    const startFull = (): void => {
        if (locked || mateRunning) return;
        void analysis.startFull();
    };
    /** 表示中の設定の未解析分を、その設定で解析する。表示中の結果が無ければ全体の解析。 */
    const resumeDisplayLayer = (): void => {
        if (locked || mateRunning) return;
        if (displayLayerId === null) startFull();
        else void analysis.resumeLayer(displayLayerId);
    };
    const startDeep = (): void => {
        if (locked || mateRunning) return;
        setDeepNodeId(currentNodeId);
        void analysis.startDeep(currentNodeId);
    };
    const continueDeep = (): void => {
        if (locked) return;
        setDeepNodeId(currentNodeId);
        void analysis.continueDeep();
    };
    const cancelAnalysis = (): void => {
        void analysis.cancel();
    };
    const analysisRun: StudyAnalysisRunState = {
        mode: analysis.mode,
        progress: analysis.progress,
        fullTargetCount: analysis.fullTargetCount,
        locked,
        needsFullAnalysis,
        unanalyzedCount,
        startDisabled: analysisBlocked || analysis.mode !== null,
        onStartFull: startFull,
        onResume: resumeDisplayLayer,
        onCancel: cancelAnalysis,
    };

    // --- 表示 ---
    const grid = (() => {
        const base = boardToGrid(position.board);
        return flipBoard ? [...base].reverse().map((row) => [...row].reverse()) : base;
    })();
    const handInfo = (side: "top" | "bottom"): HandInfo => {
        const owner: Player =
            side === "top" ? (flipBoard ? "sente" : "gote") : flipBoard ? "gote" : "sente";
        return {
            owner,
            hand: position.hands[owner],
            isActive: position.turn === owner,
            isAI: false,
        };
    };
    const moveTitle =
        currentNode.ply === 0
            ? "開始局面"
            : `${currentNode.ply}手目 ${studyMoveLabel(tree, currentNodeId)}`;
    // 取り込んだ棋譜の表題は「先手 対 後手」になる。表題がその形のままなら、対局者の行は同じ内容の
    // 繰り返しになるので出さない（利用者が表題を書き換えたら、対局者の行を出す）。
    const playersLabel = ((): string | null => {
        const black = doc.meta.blackName?.trim();
        const white = doc.meta.whiteName?.trim();
        if (black && white && doc.title.trim() === `${black} 対 ${white}`) return null;
        return studyPlayersLabel(doc.meta);
    })();
    const savedComment = storedNode?.comment ?? "";
    // 書きかけが保存できていない手（長すぎる・別の画面の変更とぶつかった）では、利用者の対応が
    // 要るので、畳んでいても開いて見せる。
    const commentNeedsAttention = comments.unsaved.has(currentNodeId);
    // 開いて見せたら、開いたままにする（対応が済んだ瞬間に、入力中の欄が閉じてしまわないように）。
    if (commentNeedsAttention && !isCommentOpen) setIsCommentOpen(true);
    const showsComment = isCommentOpen || commentNeedsAttention;
    // PC の右の列は列の中で送るので、送ったあとで開くと、列の先頭に重ねたコメント欄が見えないまま
    // になる。開いたときに、列の中だけを送って見せる（`scrollIntoView` はページ全体まで動かす）。
    useEffect(() => {
        const column = sideColumnRef.current;
        const comment = document.getElementById("study-comment");
        if (!showsComment || !column || !comment) return;
        const offset = comment.getBoundingClientRect().top - column.getBoundingClientRect().top;
        if (offset < 0) column.scrollTop += offset;
    }, [showsComment]);
    // 保存できていない書きかけ（保存を待っている・保存に失敗した、など）がこの手にあるか。
    const hasCommentDraft = comments.draftIds.has(currentNodeId);

    const commentButton = (
        <StudyIconButton
            label={
                commentNeedsAttention
                    ? "コメント（保存できていない書きかけがあります）"
                    : showsComment
                      ? "コメントを閉じる"
                      : hasCommentDraft
                        ? "コメントを開く（保存していない書きかけあり）"
                        : savedComment !== ""
                          ? "コメントを開く（コメントあり）"
                          : "コメントを開く"
            }
            pressed={showsComment}
            aria-expanded={showsComment}
            aria-controls="study-comment"
            // 対応が要る書きかけがある間は、閉じられない。
            disabled={commentNeedsAttention}
            onClick={() => setIsCommentOpen(!showsComment)}
            className="relative"
        >
            <CommentIcon />
            {(savedComment !== "" || hasCommentDraft) && (
                // この手にコメントがある印。保存していない書きかけは、注意の色にする。
                <span
                    aria-hidden="true"
                    className={cn(
                        "absolute right-1.5 top-1.5 h-2 w-2 rounded-full ring-2 ring-background",
                        // 開いて入力している間は、保存待ちで色を変えない（ちらつかせない）。
                        hasCommentDraft && !showsComment ? "bg-status-warning" : "bg-wafuu-shu",
                    )}
                />
            )}
        </StudyIconButton>
    );
    const boardStatus = (
        <div className="flex w-full items-center justify-between gap-2">
            <output className="flex min-w-0 items-baseline gap-2">
                <span className="truncate text-sm font-semibold text-wafuu-sumi">{moveTitle}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                    {position.turn === "sente" ? "☗先手番" : "☖後手番"}
                </span>
            </output>
            <div className="flex shrink-0 items-center gap-1">
                {commentButton}
                <StudyIconButton
                    label="盤面を反転"
                    pressed={flipBoard}
                    onClick={() => setFlipBoard(!flipBoard)}
                >
                    <FlipIcon />
                </StudyIconButton>
            </div>
        </div>
    );
    const navProps = {
        index: currentIndex,
        total: line.length - 1,
        onToStart: nav.goToStart,
        onBack: nav.goBack,
        onForward: nav.goForward,
        onToEnd: nav.goToEnd,
    };
    // 選んでいる駒の影（マウスを乗せた行き先に出す）
    const moveShadow = useMoveShadow({
        enabled: !locked,
        selection,
        grid,
        turn: position.turn,
        positionKey: `${tree.startSfen}|${movesToCurrent.join(" ")}`,
        getLegalSet,
    });
    const boardProps = {
        grid,
        flipBoard,
        lastMove: lastMoveOf(currentNode.usiMove),
        selection,
        moveShadow,
        promotionSelection,
        displaySettings,
        isEditModeActive: false,
        isMatchRunning: false,
        // 研究ノートに局面編集は無いので、持っていない駒は出さない（駒台の高さは盤の部品が保つ）。
        hideEmptyHandPieces: true,
        editFromSquare: null,
        candidateNote: null,
        onSquareSelect: (square: string, shiftKey?: boolean): void => {
            void handleSquareSelect(square, shiftKey);
        },
        onPromotionChoice: handlePromotionChoice,
        onHandSelect: (piece: PieceType): void => handleHandSelect(piece),
        topHand: handInfo("top"),
        bottomHand: handInfo("bottom"),
    };
    // 持ち駒は対局画面と同じく盤の左右に置く（盤の上下を詰めて 1 画面に収める）。
    const sideHandBoard = (
        <PCBoardContent
            {...boardProps}
            handSize="medium"
            handPlacement="sides"
            handFrame="outline"
        />
    );

    const graphPanel = (
        <StudyEvalGraphPanel
            doc={doc}
            currentNode={currentNode}
            currentPly={currentIndex}
            graph={graph}
            hasResults={hasResults}
            displayLayerLabel={displayLayer ? displayLayer.display.label : null}
            onPrimaryChange={setGraphPrimaryChoice}
            run={analysisRun}
            isMobile={isMobile}
            isWide={isWide}
            mobileSlotHeight={mobileMeasure.graphSlotHeight}
            onPlySelect={nav.navigateToPly}
        />
    );
    const moveList = (
        <StudyMoveList
            doc={doc}
            tree={tree}
            line={line}
            currentNodeId={currentNodeId}
            highlightKinds={highlightKinds}
            clearedKinds={insights.clearedKinds}
            unsavedComments={comments.unsaved}
            onSelect={(nodeId) => navigateTo(nodeId)}
            onBackToMainLine={nav.backToMainLine}
            onPromoteToMainLine={editing.promoteLineToMain}
            onRequestDeleteVariation={setDeleteTargetId}
            // スマートフォンでは一覧の場所いっぱいに広げ、中で送る（手が少なくても下が空かないように）。
            className={isMobile ? "min-h-0 flex-1" : isWide ? "max-h-full" : "max-h-[26rem]"}
        />
    );
    const candidatesPanel = (
        <StudyCandidatesPanel
            node={currentNode}
            positionResult={insights.positionResult}
            alternative={insights.alternative}
            playedBestLabel={insights.playedBestLabel}
            deeperResult={insights.deeperResult}
            deeperIsFresh={insights.deeperIsFresh}
            onShowLayer={onDisplayLayerChange}
            source={storedNode?.source ?? null}
            analysisMode={analysis.mode}
            isPreparing={analysis.isPreparing}
            liveDepth={analysis.live?.nodeId === currentNodeId ? analysis.live.depth : undefined}
            onStartDeep={startDeep}
            revision={insights.revision}
            canContinueDeep={analysis.continuableDeepNodeId === currentNodeId}
            onContinueDeep={continueDeep}
            onCancel={cancelAnalysis}
            onPreviewPv={previewPv}
            onAddPvAsVariation={editing.addPvAsVariation}
            mate={
                mate?.supported
                    ? {
                          state: mate.results.get(currentNode.id),
                          busyElsewhere:
                              mate.runningNodeId !== null && mate.runningNodeId !== currentNode.id,
                          onStart: () => {
                              if (analysis.mode !== null || analysis.isPreparing) return;
                              mate.start(currentNode);
                          },
                          onStop: mate.stop,
                      }
                    : undefined
            }
        />
    );
    const commentBox = (
        <StudyCommentBox
            key={currentNodeId}
            value={savedComment}
            onChange={(value) => onApplyOps([{ type: "setComment", nodeId: currentNodeId, value }])}
            initialDraft={comments.drafts.get(currentNodeId)}
            onDraftChange={(change) => comments.changeDraft(currentNodeId, change)}
            onConflictChange={(conflicted) => comments.changeConflict(currentNodeId, conflicted)}
            disabled={locked}
            baseConfirmed={commentBaseConfirmed}
        />
    );
    // 変化（本譜から外れた手順）を見ているときの「本譜に戻る」。盤で駒を動かして変化に入ったあと、
    // どの表示からでも戻れるようにする。
    const backToMainButton = nav.onMainLine ? null : (
        <button
            type="button"
            onClick={nav.backToMainLine}
            className="flex h-9 shrink-0 items-center gap-1 rounded-md border border-wafuu-border bg-card px-2 text-xs font-medium text-wafuu-ai transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
            <BranchIcon className="h-3.5 w-3.5" />
            本譜に戻る
        </button>
    );
    const metaRow = (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1.5 text-xs text-muted-foreground">
            {playersLabel && <span className="truncate">{playersLabel}</span>}
            <span className="truncate">{originLink ?? studyOriginLabel(doc.origin)}</span>
            <StudySaveIndicator
                status={saveStatus}
                onLogin={onLogin}
                localOnly={localOnly}
                className="md:ml-auto"
            />
        </div>
    );
    const moreMenu = (
        <StudyMoreMenu
            onOpenChange={setIsMoreMenuOpen}
            // スマートフォンでは出典・保存先の行と、表題・解析の設定・盤の反転を画面に出さず、ここに置く。
            info={isMobile ? metaRow : undefined}
            extraItems={
                isMobile
                    ? [
                          ...(locked
                              ? []
                              : [
                                    {
                                        label: "表題を変更",
                                        note: "研究ノートの名前",
                                        run: () => setIsTitleDialogOpen(true),
                                    },
                                    {
                                        label: "解析の設定",
                                        note: analysis.settingsLabel,
                                        run: () => setIsSettingsOpen(true),
                                    },
                                ]),
                          {
                              label: flipBoard ? "盤面を元に戻す" : "盤面を反転",
                              note: "後手側から盤を見る",
                              run: () => setFlipBoard(!flipBoard),
                          },
                      ]
                    : undefined
            }
            onPass={locked ? undefined : () => void editing.passFromCurrent()}
            onCopyKif={copyKif}
            onCopySfen={copySfen}
            onPlayFromPosition={
                onPlayFromPosition
                    ? () =>
                          onPlayFromPosition({
                              sfen: tree.startSfen,
                              moves: movesToCurrent,
                          })
                    : undefined
            }
        />
    );
    const commitTitle = (value: string): void => void onApplyOps([{ type: "setTitle", value }]);
    const { rootTop } = mobileMeasure;

    return (
        <TooltipProvider delayDuration={TOOLTIP_DELAY_DURATION_MS}>
            <div
                ref={mobileMeasure.rootRef}
                className={cn(
                    "flex w-full max-w-[1320px] xl:max-w-[1600px] flex-col gap-2 self-center px-3 py-1.5 md:gap-3 md:px-4 md:py-3",
                    // 下で切れた欄の中の絶対配置の要素（読み上げ用の見出しなど）も、ここで切る。
                    isMobile && "relative overflow-hidden",
                    // 高さはいまの画面（dvh）に合わせ、帯が縮んでも画面の下に空きを残さない。盤の大きさは
                    // barsSlack を引いた高さから決めるので、帯の出入りで盤は変わらない。
                    isMobile &&
                        rootTop !== null &&
                        "h-[calc(100vh-var(--study-top))] supports-[height:1dvh]:h-[calc(100dvh-var(--study-top))]",
                )}
                style={
                    isMobile && rootTop !== null
                        ? ({ "--study-top": `${rootTop}px` } as CSSProperties)
                        : undefined
                }
            >
                {isMobile && (
                    <div
                        ref={mobileMeasure.observeBarsSlack}
                        aria-hidden="true"
                        className="pointer-events-none invisible fixed top-0 left-0 h-0 w-0 supports-[height:1svh]:h-[calc(100dvh-100svh)]"
                    />
                )}
                {/* スマートフォンでは表題をパンくずに任せ、表題の行は出さない（狭い行に大きな表題を置くと
                    ほとんど読めない）。その他の操作は、表示の切り替えの行に置く。 */}
                {!isMobile && (
                    <StudyWorkspaceHeader
                        title={doc.title}
                        locked={locked}
                        onCommitTitle={commitTitle}
                        moreMenu={moreMenu}
                        settingsLabel={analysis.settingsLabel}
                        onOpenSettings={() => setIsSettingsOpen(true)}
                        analysisAction={
                            <StudyHeaderAnalysisAction
                                run={analysisRun}
                                graphIsEmpty={!graph.hasSourceGraph && !hasResults}
                            />
                        }
                        metaRow={metaRow}
                    />
                )}

                {/* 編集できない間は、再送とノートの破棄も止める（残すのは「ログインし直す」だけ）。 */}
                <StudySaveNotice
                    status={saveStatus}
                    onRetry={locked ? undefined : onRetrySave}
                    onDiscard={locked ? undefined : onDiscard}
                    localOnly={localOnly}
                />

                {unrestoredCount > 0 && (
                    <output className="block rounded-lg border border-status-warning-border bg-status-warning-bg px-3 py-2 text-sm text-status-warning">
                        このノートには、盤面を再現できず表示していない変化が {unrestoredCount}{" "}
                        件あります（データは消していません）。
                    </output>
                )}

                {locked && (
                    // スクロール位置によらず見えるよう、画面の上端に貼り付ける（下にあるのは、
                    // 薄くなって操作できない画面だけなので、理由が見えないと困る）。
                    <div
                        role="alert"
                        className="sticky top-2 z-30 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-status-warning-border bg-status-warning-bg px-3 py-2 text-sm text-status-warning shadow-card"
                    >
                        <p className="min-w-0 flex-1">
                            ログインが切れたため、このノートはいま編集できません。ログインし直すと、続きから編集できます（書きかけのコメントは残っています）。
                        </p>
                        {onLogin && (
                            <button
                                type="button"
                                onClick={onLogin}
                                className="min-h-10 shrink-0 rounded-md border border-current px-3 text-xs font-medium transition-colors hover:bg-background/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                                ログインし直す
                            </button>
                        )}
                    </div>
                )}

                {/* 編集できない間は、画面を残したまま操作だけを止める。 */}
                {/* スマートフォンでは表示の切り替えと「その他の操作」を止めない（棋譜のコピーなど、
                    編集できない間も中身を持ち出せるように）。止めるのは表示の場所だけ。 */}
                <div
                    inert={locked && !isMobile}
                    className={cn(
                        "flex flex-col gap-3",
                        isMobile && "min-h-0 flex-1",
                        locked && !isMobile && "opacity-70",
                    )}
                >
                    {isMobile ? (
                        <StudyMobileLayout
                            tab={mobileTab}
                            onTabChange={setMobileTab}
                            measure={mobileMeasure}
                            locked={locked}
                            moreMenu={moreMenu}
                            board={sideHandBoard}
                            boardSectionRef={boardSectionRef}
                            nav={navProps}
                            commentButton={commentButton}
                            commentBox={commentBox}
                            showsComment={showsComment}
                            backToMainButton={backToMainButton}
                            // 手を横に流す棋譜（いまの手を中央に。前後の流れが 1 行で見え、押すとその手へ
                            // 移る）。指し手の表記を省略せずに出せる。
                            moveStrip={
                                <MobileKifuBar
                                    tone="wafuu"
                                    moves={line.slice(1).map((nodeId, index) => ({
                                        ply: index + 1,
                                        displayText: studyMoveLabel(tree, nodeId),
                                        mark: highlightKinds.get(nodeId),
                                    }))}
                                    currentPly={currentIndex}
                                    onPlySelect={nav.navigateToPly}
                                />
                            }
                            graphPanel={graphPanel}
                            moveList={moveList}
                            candidatesPanel={candidatesPanel}
                        />
                    ) : (
                        <StudyDesktopLayout
                            isTablet={isTablet}
                            isWide={isWide}
                            boardStatus={boardStatus}
                            board={sideHandBoard}
                            fluidBoard={
                                // 盤を親の幅に合わせて描く。
                                <MobileBoardSection
                                    {...boardProps}
                                    position={position}
                                    boardSectionRef={boardSectionRef}
                                    isDraggingPiece={false}
                                />
                            }
                            boardSectionRef={boardSectionRef}
                            sideColumnRef={sideColumnRef}
                            navBar={<StudyNavBar {...navProps} />}
                            graphPanel={graphPanel}
                            commentBox={commentBox}
                            showsComment={showsComment}
                            candidatesPanel={candidatesPanel}
                            moveList={moveList}
                        />
                    )}
                </div>
            </div>

            <StudyNotice message={message} onDismiss={() => onMessageChange(null)} />

            <StudyTitleDialog
                open={isTitleDialogOpen && !locked}
                onOpenChange={setIsTitleDialogOpen}
                title={doc.title}
                onCommit={commitTitle}
            />

            <StudyAnalysisSettings
                open={settingsOpen}
                onOpenChange={setIsSettingsOpen}
                isMobile={isMobile}
                doc={doc}
                displayLayerId={displayLayerId}
                onDisplayLayerChange={onDisplayLayerChange}
                form={analysis.form}
                settingsLabel={analysis.settingsLabel}
                canStart={!locked && analysis.mode === null && !analysisBlocked}
                onStartFull={startFull}
                onOpenNnueLibrary={onOpenNnueLibrary}
            />

            <StudyDeleteVariationDialog
                doc={doc}
                tree={tree}
                open={deleteDialogTargetId !== null}
                targetId={deleteTargetId}
                onCancel={() => setDeleteTargetId(null)}
                onConfirm={confirmDeleteVariation}
            />

            {pvPreview && (
                <PvPreviewDialog
                    onClose={() => setPvPreview(null)}
                    pv={pvPreview.pv}
                    startPosition={pvPreview.startPosition}
                    ply={pvPreview.ply}
                    evalCp={pvPreview.evalCp}
                    evalMate={pvPreview.evalMate}
                    squareNotation={displaySettings.squareNotation}
                    showBoardLabels={displaySettings.showBoardLabels}
                    flipBoard={flipBoard}
                    description="読み筋を 1 手ずつ盤面で再生します。"
                    firstMoveLabel={pvPreview.firstMoveLabel ?? undefined}
                />
            )}
        </TooltipProvider>
    );
}

/** ノートごとに覚えておく表示の状態。 */
export interface StudyWorkspaceViewState {
    /** 表示中の解析レイヤー。 */
    selectedLayerId: string | null;
    /** 見ていた局面（保存用の `nodeId`）。 */
    currentNodeId: string | null;
}

export interface StudyWorkspaceProps extends StudyWorkspaceCommonProps {
    /** 解析に使えるエンジン（Web は内蔵の Wasm エンジン）。 */
    engineOptions: EngineOption[];
    /** NNUE プリセット manifest.json の URL。 */
    manifestUrl: string;
    /** 内蔵エンジンの識別情報（解析結果を「どの AI・どの設定か」で分けるのに使う）。 */
    engine: StudyEngineIdentity;
    defaultNnuePresetKey?: string;
    /** 解析の区切り（完了・中止）。送信待ちをすぐ流すのに使う。 */
    onFlush?: () => void;
    /**
     * 前回の表示の状態（表示していた解析の設定と、見ていた局面）。最初の表示にだけ使う。
     * 保存先は呼び出し側が持つ（Web は保存層の `getViewState` / `setViewState`）。
     */
    initialView?: StudyWorkspaceViewState | null;
    /** 表示の状態が変わった。呼び出し側が保存する。 */
    onViewChange?: (view: StudyWorkspaceViewState) => void;
    /**
     * 呼び出し側から出す通知（保存できなかった操作の理由など）。`id` が変わるたびに出す。
     */
    notice?: { id: number; text: string; type: Message["type"] } | null;
}

/**
 * 研究ノートの画面。文書と保存の状態を受け取り、解析の実行（エンジン・NNUE）をつないで表示する。
 * `NnueProvider` の内側で使うこと。ノートを切り替えるときは `key={doc.id}` で作り直す。
 */
export function StudyWorkspace({
    doc,
    onApplyOps,
    engineOptions,
    manifestUrl,
    engine,
    defaultNnuePresetKey,
    onFlush,
    initialView,
    onViewChange,
    notice,
    locked = false,
    ...viewProps
}: StudyWorkspaceProps): ReactElement {
    const [preferredLayerId, setPreferredLayerId] = useState<string | null>(
        initialView?.selectedLayerId ?? null,
    );
    const viewNodeIdRef = useRef<string | null>(initialView?.currentNodeId ?? null);
    const [message, setMessage] = useState<Message | null>(null);
    // 設定を変えた解析を中止したときに、表示を戻す先（解析を始める前に表示していた設定）。
    const [revertLayerId, setRevertLayerId] = useState<string | null>(null);
    const previousLayerIdRef = useRef<string | null>(null);
    // 直近の「この局面を深く解析」で使った設定（結果を、候補手の欄に別の段として出すのに使う）。
    const [deepLayerId, setDeepLayerId] = useState<string | null>(null);

    const displayLayerId = chooseStudyDisplayLayer(doc.layers, preferredLayerId);

    // 盤面の復元（全ノードの指し手の再生）は重いので、ツリーの形が変わったときだけやり直す。
    // コメント・しおり・解析結果の更新では、復元済みのツリーに評価値を重ねるだけにする。
    const structureRef = useRef<{ key: string; value: StudyStructureTree } | null>(null);
    const structureKey = studyStructureKey(doc);
    if (structureRef.current === null || structureRef.current.key !== structureKey) {
        structureRef.current = { key: structureKey, value: buildStudyStructureTree(doc) };
    }
    const structure = structureRef.current.value;
    const tree = applyStudyLayerToTree(structure.tree, doc, displayLayerId);

    const changeDisplayLayer = (layerId: string): void => {
        setPreferredLayerId(layerId);
        onViewChange?.({ selectedLayerId: layerId, currentNodeId: viewNodeIdRef.current });
    };

    const { controller, download, switchToSimpleAi } = useStudyAnalysis({
        doc,
        tree,
        engineOptions,
        manifestUrl,
        engine,
        defaultNnuePresetKey,
        onApplyOps,
        onFlush,
        locked,
        // 全体の解析を始めたら、その設定の結果を表示に切り替える。1 局面だけの深い解析では
        // 切り替えない（評価値グラフと悪手・疑問手の印は全体の解析の結果のまま見せる）。
        onLayerStarted: (layerId, mode) => {
            if (mode !== "full") {
                setDeepLayerId(layerId);
                return;
            }
            previousLayerIdRef.current = displayLayerId !== layerId ? displayLayerId : null;
            setRevertLayerId(null);
            changeDisplayLayer(layerId);
        },
        setMessage,
    });

    // 通知は時間で消す（次の操作ですぐ消えないように）。
    useEffect(() => {
        if (message === null) return;
        const timer = setTimeout(
            () => setMessage((current) => (current === message ? null : current)),
            NOTICE_DURATION_MS[message.type],
        );
        return () => clearTimeout(timer);
    }, [message]);

    // 呼び出し側からの通知。
    const noticeId = notice?.id ?? null;
    const shownNoticeIdRef = useRef(noticeId);
    // biome-ignore lint/correctness/useExhaustiveDependencies: 同じ通知を出し直さないよう、id が変わったときだけ出す
    useEffect(() => {
        // 開いた時点で既にあった通知（前に開いていたノートのもの）は出さない。
        if (noticeId === shownNoticeIdRef.current) return;
        shownNoticeIdRef.current = noticeId;
        if (notice) setMessage({ text: notice.text, type: notice.type });
    }, [noticeId]);

    // 設定を変えた解析を中止し、その設定の結果が元の設定より少なければ、表示を元に戻す
    // （中止しただけで、それまで見ていた結果が消えたように見えないように）。
    useEffect(() => {
        if (revertLayerId === null || controller.mode !== null) return;
        setRevertLayerId(null);
        const current = doc.layers.find((layer) => layer.id === displayLayerId);
        const previous = doc.layers.find((layer) => layer.id === revertLayerId);
        if (!previous || !current || current.id === previous.id) return;
        if (countStudyLayerResults(doc, current) < countStudyLayerResults(doc, previous)) {
            setPreferredLayerId(previous.id);
            onViewChange?.({ selectedLayerId: previous.id, currentNodeId: viewNodeIdRef.current });
        }
    }, [revertLayerId, controller.mode, doc, displayLayerId, onViewChange]);

    const isMobile = useIsMobile();
    const mate = useStudyMate({
        engineOption: engineOptions.find((option) => option.supportsMate),
        // スマートフォンはメモリが少ないので、置換表を小さくする
        hashMb: isMobile ? 32 : 64,
    });

    const analysis: StudyAnalysisController = {
        ...controller,
        cancel: async () => {
            const wasFull = controller.mode === "full";
            await controller.cancel();
            if (wasFull && previousLayerIdRef.current !== null) {
                setRevertLayerId(previousLayerIdRef.current);
            }
        },
    };

    return (
        <>
            <StudyWorkspaceView
                {...viewProps}
                locked={locked}
                doc={doc}
                tree={tree}
                unrestoredCount={structure.unrestoredCount}
                onApplyOps={onApplyOps}
                displayLayerId={displayLayerId}
                onDisplayLayerChange={changeDisplayLayer}
                analysis={analysis}
                mate={mate}
                message={message}
                onMessageChange={setMessage}
                deepLayerId={deepLayerId}
                initialNodeId={initialView?.currentNodeId ?? null}
                onCurrentNodeChange={(nodeId) => {
                    viewNodeIdRef.current = nodeId;
                    onViewChange?.({ selectedLayerId: displayLayerId, currentNodeId: nodeId });
                }}
            />
            <MatchNnueDownloadDialog
                state={download}
                purpose="analysis"
                alternative={{
                    label: "ダウンロードせず、簡易 AI で解析する",
                    onSelect: switchToSimpleAi,
                }}
            />
        </>
    );
}
