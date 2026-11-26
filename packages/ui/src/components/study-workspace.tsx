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
    type StudyAnalysisResult,
    type StudyDocument,
    type StudyOp,
    studyScoreToKifuEval,
} from "@shogi/app-core";
import { cn } from "@shogi/design-system";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { useEffect, useEffectEvent, useId, useRef, useState } from "react";
import { useUsageTracker } from "../providers/UsageContext";
import type { PlayFromPosition } from "./rshogi-play-from-position";
import { KIFU_NAV_STEP_TEN } from "./shogi-match/components/KifuNavigationToolbar";
import { MatchNnueDownloadDialog } from "./shogi-match/components/MatchNnueDownloadDialog";
import { type HandInfo, MobileBoardSection } from "./shogi-match/components/MobileBoardSection";
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
import type { StudyAnalysisRunState } from "./study-workspace/StudyAnalysisRunControls";
import { StudyAnalysisSettings } from "./study-workspace/StudyAnalysisSettings";
import {
    STUDY_AUTO_ANALYZE_FINISHED,
    StudyCandidatesPanel,
    type StudyElsewhereActivity,
    type StudyPvRequest,
} from "./study-workspace/StudyCandidatesPanel";
import {
    isStudyCommentOverLimit,
    StudyCommentBox,
    type StudyCommentDraftChange,
} from "./study-workspace/StudyCommentBox";
import { StudyDeleteVariationDialog } from "./study-workspace/StudyDeleteVariationDialog";
import { StudyDesktopLayout } from "./study-workspace/StudyDesktopLayout";
import {
    buildStudyEvalGraph,
    type StudyDeepRead,
    StudyEvalGraphPanel,
    type StudyGraphSeries,
} from "./study-workspace/StudyEvalGraphPanel";
import { StudyGameInfo } from "./study-workspace/StudyGameInfo";
import { StudyIconButton } from "./study-workspace/StudyIconButton";
import { CommentIcon, FlipIcon } from "./study-workspace/StudyIcons";
import {
    StudyMobileLayout,
    type StudyMobileTab,
    useStudyMobileMeasure,
} from "./study-workspace/StudyMobileLayout";
import { type StudyKifuFormat, StudyMoreMenu } from "./study-workspace/StudyMoreMenu";
import { StudyMoveList } from "./study-workspace/StudyMoveList";
import { StudyNavBar } from "./study-workspace/StudyNavBar";
import { StudyNotice } from "./study-workspace/StudyNotice";
import { type StudyBandLine, StudyPositionBand } from "./study-workspace/StudyPositionBand";
import { buildStudyReviewItems, StudyReviewList } from "./study-workspace/StudyReviewList";
import {
    StudySaveIndicator,
    StudySaveNotice,
    StudySaveStrip,
    type StudyWorkspaceSaveStatus,
    showsStudySaveStrip,
} from "./study-workspace/StudySaveStatus";
import { StudyTitleDialog } from "./study-workspace/StudyTitleDialog";
import { StudyTreeDialog } from "./study-workspace/StudyTreeDialog";
import { StudyWorkspaceHeader } from "./study-workspace/StudyWorkspaceHeader";
import {
    exportStudyLineToCsa,
    exportStudyLineToKif,
    exportStudyPositionToSfen,
    studyLineHasPass,
} from "./study-workspace/studyExport";
import { type StudyKifuFile, studyKifuFileName } from "./study-workspace/studyFile";
import {
    deriveStudyPositionInsights,
    pickStudyBandResult,
} from "./study-workspace/studyPositionInsights";
import {
    applyStudyLayerToTree,
    buildStudyStructureTree,
    chooseStudyDisplayLayer,
    countStudyLayerResults,
    type StudyStructureTree,
    studyBestCandidate,
    studyFirstMoveLabel,
    studyLimitsLabel,
    studyMoveLabel,
    studyOriginLabel,
    studyPathTo,
    studyPlayersLabel,
    studyStructureKey,
} from "./study-workspace/studyView";
import {
    type StudyAnalysisController,
    type StudyApplyOpsOptions,
    type StudyApplyOpsResult,
    type StudyEngineIdentity,
    type StudyFullStartOptions,
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

/** 「自動で読む」を入れているか（端末ごとに覚える）。 */
const STUDY_AUTO_ANALYZE_STORAGE_KEY = "shogi:studyAutoAnalyze";

const AUTO_ANALYZE_OFF_NOTICE: Message = {
    text: "自動で読むを切りました（読んだ分は残っています）。",
    type: "warning",
};

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
    onApplyOps: (ops: StudyOp[], options?: StudyApplyOpsOptions) => StudyApplyOpsResult;
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
    /**
     * 棋譜をファイルに保存する（保存のしかたは呼び出し側が決める。Web はブラウザのダウンロード）。
     * 渡さなければ「ファイルに保存」を出さない。
     */
    onSaveKifuFile?: (file: StudyKifuFile) => void;
    /**
     * 表題を変えるダイアログの開閉を、呼び出し側で持つ（ページの見出しの表題からも開けるように）。
     * 省略時は画面の中で持つ。
     */
    titleDialog?: { open: boolean; onOpenChange: (open: boolean) => void };
    /** 合法手の取得の差し替え（Desktop・テスト用）。省略時は共通の PositionService。 */
    fetchLegalMoves?: StudyFetchLegalMoves;
    /**
     * 編集できない状態（開いている間にログインが切れて、ノートを保存できなくなった）。
     * 画面は残し、編集と解析のすべての入口を止めて、ログインし直す案内を出す。
     * 書きかけのコメントは消さない。
     */
    locked?: boolean;
    readOnly?: boolean;
    shareDialog?: { open: boolean; onOpen: () => void };
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
    onSaveKifuFile,
    titleDialog,
    fetchLegalMoves,
    locked = false,
    readOnly = false,
    shareDialog,
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
    const track = useUsageTracker();
    const editingDisabled = locked || readOnly;
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
    const [mobileTab, setMobileTab] = useState<StudyMobileTab>("candidates");
    const mobileMeasure = useStudyMobileMeasure(isMobile);
    // コメント欄は普段は畳んでおき、盤の上のボタンで開く（開いたままにすれば、手を送っても出続ける）。
    const [isCommentOpen, setIsCommentOpen] = useState(false);
    const commentToggleId = useId();
    // 対局時の評価値と解析の両方があるとき、評価値グラフでどちらを主の線にするか。
    const [graphPrimaryChoice, setGraphPrimaryChoice] = useState<StudyGraphSeries>("source");
    const sideColumnRef = useRef<HTMLDivElement | null>(null);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [ownTitleDialogOpen, setOwnTitleDialogOpen] = useState(false);
    const isTitleDialogOpen = titleDialog?.open ?? ownTitleDialogOpen;
    const setIsTitleDialogOpen = titleDialog?.onOpenChange ?? setOwnTitleDialogOpen;
    // 「その他の操作」を開いている間は、矢印キーで局面を動かさない（コピー・対局に渡す局面が、
    // メニューの中でのキー操作で変わってしまうため）。
    const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
    const [isTreeOpen, setIsTreeOpen] = useState(false);
    const treeOpener = useRef<HTMLElement | null>(null);
    const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
    const comments = useStudyCommentDrafts({
        initialDrafts: initialCommentDrafts,
        onDraftChange: onCommentDraftChange,
    });
    // 「この局面を深く解析」を押した局面。その局面を見ている間、結果を開いた状態で目立たせる。
    const [deepNodeId, setDeepNodeId] = useState<string | null>(null);
    /** 自動で読むが、続きを読めずに読み終えた局面（局面を離れると消す）。 */
    const [autoFinishedNodeId, setAutoFinishedNodeId] = useState<string | null>(null);
    /**
     * 自動で読むが、読み始めるかを最後に決めた局面。決めるのは 1 拍おいてからなので、局面を移った・入れた
     * 直後はいまの局面と食い違う。帯にその間だけ「未解析」を出さないのに使う。
     */
    const [autoDecidedNodeId, setAutoDecidedNodeId] = useState<string | null>(null);
    /** 別の局面で終わった解析・詰み探索（候補手の欄で知らせる。局面を移ると消す）。 */
    const [finishedElsewhere, setFinishedElsewhere] = useState<{
        what: "deep" | "mate" | "shortest" | "full";
        nodeId: string | null;
    } | null>(null);
    const [pvPreview, setPvPreview] = useState<{
        pv: string[];
        startPosition: PositionState;
        /** 最初の手の表記（候補手の欄と同じ。直前の手と同じマスなら「同」）。 */
        firstMoveLabel: string | null;
        ply: number;
        evalCp?: number;
        evalMate?: number;
    } | null>(null);

    /**
     * 局面を移った回数。止め終わるのを待ってから始める操作が、待つ間に局面を移ったかを見る
     * （移って戻った場合も、移ったことにする）。変化が消されて戻されたときは数えないので、
     * 見ている局面とも比べる（`isSamePositionAs`）。
     */
    const leaveCountRef = useRef(0);
    const currentNodeIdRef = useRef<string | null>(null);
    /** 押したときから局面を移っていないか。 */
    const isSamePositionAs = (pressed: { nodeId: string; leaveCount: number }): boolean =>
        leaveCountRef.current === pressed.leaveCount && currentNodeIdRef.current === pressed.nodeId;
    const nav = useStudyNodeNavigation({
        tree,
        initialNodeId,
        onCurrentNodeChange,
        onMessageChange,
        locked,
        onLeave: (leaving) => {
            leaveCountRef.current += 1;
            setDeepNodeId(null);
            setAutoFinishedNodeId(null);
            setFinishedElsewhere(null);
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
    useEffect(() => {
        currentNodeIdRef.current = currentNodeId;
    }, [currentNodeId]);
    const { selection, promotionSelection } = nav;
    const position = currentNode.positionAfter;
    const storedNode = Object.hasOwn(doc.tree.nodes, currentNodeId)
        ? doc.tree.nodes[currentNodeId]
        : undefined;

    const editing = useStudyMoveEditing({
        doc,
        tree,
        nav,
        locked: editingDisabled,
        readOnly,
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
            shareDialog?.open === true ||
            isMoreMenuOpen ||
            isTreeOpen,
        containerRef: boardSectionRef,
        enableWheelNavigation: displaySettings.enableWheelNavigation,
    });

    // --- 悪手・疑問手・解析の状態 ---
    const insights = deriveStudyPositionInsights({
        doc,
        currentNodeId,
        displayLayerId,
        deepNodeId,
        deepLayerId,
    });
    const { highlightKinds, displayLayer, unanalyzedCount } = insights;
    const hasResults = insights.analyzedCount > 0;
    const needsFullAnalysis =
        analysis.mode !== "full" && insights.analyzedCount * 2 < insights.totalCount;
    const reviewItems = buildStudyReviewItems({
        doc,
        tree,
        line,
        highlights: insights.highlights,
        displayLayerId,
    });
    const savedPicked = pickStudyBandResult({
        doc,
        nodeId: currentNodeId,
        displayLayerId,
        deepNodeId,
        deepLayerId,
    });
    const liveHere = analysis.live?.nodeId === currentNodeId ? analysis.live : undefined;
    // 帯が表示中の設定とは別の読みの値を出す局面（グラフに、線とは別の印で示す）。全体の解析の途中の
    // 値は表示中の設定の値なので、印にしない。
    const deepReads = new Map<string, StudyDeepRead>();
    for (const nodeId of line) {
        if (nodeId === currentNodeId && liveHere?.preview) {
            if (analysis.mode !== "deep") continue;
            const deepLayer = doc.layers.find((layer) => layer.id === deepLayerId);
            deepReads.set(nodeId, {
                limits: studyLimitsLabel(
                    deepLayer?.spec.limits ?? {
                        timeMs: liveHere.budgetMs,
                        depth: null,
                        nodes: null,
                    },
                ),
                result: liveHere.preview,
            });
            continue;
        }
        const picked =
            nodeId === currentNodeId
                ? savedPicked
                : pickStudyBandResult({ doc, nodeId, displayLayerId, deepNodeId, deepLayerId });
        if (picked && picked.layer.id !== displayLayerId) {
            deepReads.set(nodeId, {
                limits: studyLimitsLabel(picked.layer.spec.limits),
                result: picked.result,
            });
        }
    }
    const graph = buildStudyEvalGraph({
        doc,
        tree,
        line,
        highlights: insights.highlights,
        hasResults,
        primaryChoice: graphPrimaryChoice,
        deepReads,
        currentNodeId,
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
    const copyText = (text: string, done: string, onCopied?: () => void): void => {
        const failed = (): void =>
            onMessageChange({ text: "コピーできませんでした。", type: "error" });
        try {
            void navigator.clipboard.writeText(text).then(() => {
                onMessageChange({ text: done, type: "success" });
                onCopied?.();
            }, failed);
        } catch {
            failed();
        }
    };
    const csaUnavailableReason = studyLineHasPass(tree, line)
        ? "パスを含む手順は CSA にできません"
        : undefined;
    const exportKifu = (format: StudyKifuFormat): string =>
        format === "csa"
            ? exportStudyLineToCsa(doc, tree, line)
            : exportStudyLineToKif(doc, tree, line);
    const kifuLabel = (format: StudyKifuFormat): string =>
        `${line.length > 1 ? `表示中の手順（${line.length - 1} 手）` : "開始局面"}を ${format.toUpperCase()} で`;
    const copyKifu = (format: StudyKifuFormat): void => {
        let text: string;
        try {
            text = exportKifu(format);
        } catch {
            onMessageChange({ text: "棋譜を書き出せませんでした。", type: "error" });
            return;
        }
        copyText(text, `${kifuLabel(format)}コピーしました。`, () =>
            track("kifu_export", { format }),
        );
    };
    const saveKifu = onSaveKifuFile
        ? (format: StudyKifuFormat): void => {
              try {
                  onSaveKifuFile({
                      fileName: studyKifuFileName(doc.title, format),
                      text: exportKifu(format),
                  });
                  onMessageChange({ text: `${kifuLabel(format)}保存しました。`, type: "success" });
                  track("kifu_export", { format });
              } catch {
                  onMessageChange({ text: "ファイルに保存できませんでした。", type: "error" });
              }
          }
        : undefined;
    const copySfen = (): void =>
        copyText(
            exportStudyPositionToSfen(tree.startSfen, movesToCurrent),
            "いま見ている局面を SFEN でコピーしました。",
        );
    const confirmDeleteVariation = (): void => {
        const targetId = deleteTargetId;
        setDeleteTargetId(null);
        if (targetId === null || editingDisabled) return;
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
    }, [locked, setIsTitleDialogOpen]);
    const settingsOpen = isSettingsOpen && !editingDisabled;
    const deleteDialogTargetId = editingDisabled ? null : deleteTargetId;

    // 解析と詰み探索は同時に動かさない（スマートフォンで CPU とメモリを取り合う）
    const mateRunning = (mate?.runningNodeId ?? null) !== null;
    /** 解析を始められない（準備中か、詰み探索の途中）。 */
    const analysisBlocked = analysis.isPreparing || mateRunning;
    const startFull = (): void => {
        if (locked || mateRunning) return;
        void analysis.startFull(fullStartOptions());
    };
    /** 表示中の設定の未解析分を、その設定で解析する。表示中の結果が無ければ全体の解析。 */
    const resumeDisplayLayer = (): void => {
        if (locked || mateRunning) return;
        if (displayLayerId === null) {
            startFull();
            return;
        }
        void analysis.resumeLayer(displayLayerId, fullStartOptions());
    };
    /** 解析・詰み探索は 1 つずつ動かす。押した操作を優先し、動いている詰み探索は止める。 */
    const stopMate = (): void => {
        if (mateRunning) mate?.stop();
    };
    /** 深く解析を始められない（準備中か、全体の解析の途中）。 */
    const deepBlocked = analysis.isPreparing || analysis.mode === "full";
    /**
     * 解析・詰み探索の操作の通し番号。前の解析を止め終わるのを待ってから始める操作は、待っている間に
     * 別の操作をした・画面を離れたら始めない（待っている間の操作のほうを優先する）。
     */
    const actionSerialRef = useRef(0);
    useEffect(
        () => () => {
            actionSerialRef.current += 1;
        },
        [],
    );
    // 自動で読む: 入れている間は、見ている局面を読み続ける（局面を移ればその局面を）。切ると止まる。
    // 読んでいるかどうかはスイッチそのものが表すので、自動で読む専用の止めるボタンは置かない。
    const [storedAutoAnalyze, setAutoAnalyze] = useLocalStorage<boolean>(
        STUDY_AUTO_ANALYZE_STORAGE_KEY,
        false,
    );
    const autoAnalyze = !readOnly && storedAutoAnalyze;
    /** このタブで最後に書いた自動で読むの値。別のタブで書き換えられたのを見分けるのに使う。 */
    const localAutoAnalyzeRef = useRef<boolean | null>(null);
    const setAutoAnalyzeHere = (enabled: boolean): void => {
        localAutoAnalyzeRef.current = enabled;
        setAutoAnalyze(enabled);
    };
    /** 自動で読むを切って、読みを止めている途中か。止め終わる前に入れ直したとき、止めている読みを取り込まない。 */
    const stoppingAutoRef = useRef(false);
    const stopAutoReading = (): void => {
        actionSerialRef.current += 1;
        stoppingAutoRef.current = true;
        void analysis.cancel().finally(() => {
            stoppingAutoRef.current = false;
        });
    };
    /**
     * 自動で読む以外の解析の操作を始める前に、自動で読むを切る（押した操作をそのまま通し、切ったことを
     * 知らせる）。読んでいた分は残る。止め終わるまでに別の操作をしたら false（その操作のほうを優先する）。
     */
    const leaveAutoAnalyze = async (): Promise<boolean> => {
        if (!autoAnalyze) return true;
        setAutoAnalyzeHere(false);
        onMessageChange(AUTO_ANALYZE_OFF_NOTICE);
        if (analysis.mode !== "deep" && !analysis.isPreparing) return true;
        const request = ++actionSerialRef.current;
        await analysis.cancel();
        return actionSerialRef.current === request;
    };
    /**
     * 全体の解析（残りを解析も）を始めるときの指定。自動で読むは、始められる設定と分かってから切り、
     * そのあと始められずに終わったら（AI のダウンロードを断った、など）入れ直す。読みを止め終わるのを
     * 待つ間に別の操作（スイッチを入れ直すなど）をしたら始めない。切った知らせは、始めるときに出す。
     */
    const fullStartOptions = (): StudyFullStartOptions => {
        // 別のタブで自動で読むを入れたときは操作の番号が進まないので、入れた回数も見る。
        if (!autoAnalyze) {
            const request = ++actionSerialRef.current;
            const enabledCount = autoEnabledCountRef.current;
            return {
                isWanted: () =>
                    actionSerialRef.current === request &&
                    autoEnabledCountRef.current === enabledCount,
            };
        }
        let request = 0;
        let enabledCount = 0;
        const isWanted = (): boolean =>
            actionSerialRef.current === request && autoEnabledCountRef.current === enabledCount;
        return {
            onCommit: () => {
                request = ++actionSerialRef.current;
                enabledCount = autoEnabledCountRef.current;
                setAutoAnalyzeHere(false);
            },
            isWanted,
            notice: AUTO_ANALYZE_OFF_NOTICE,
            // 始められなかったら（AI のダウンロードを断った、など）、切った自動で読むを戻して読み直す。
            onNotStarted: () => {
                if (!isWanted()) return;
                autoStartedNodeRef.current = null;
                setAutoAnalyzeHere(true);
            },
        };
    };
    /** 自動で読むが入った回数（別のタブでの切り替えも数える）。待っている解析の開始が見る。 */
    const autoEnabledCountRef = useRef(0);
    useEffect(() => {
        if (autoAnalyze) autoEnabledCountRef.current += 1;
    }, [autoAnalyze]);
    /** 自動で読み始めた（または手で読み始めた）局面。同じ局面で読み直さないために覚える。 */
    const autoStartedNodeRef = useRef<string | null>(null);
    // 外すと、開き直したとき（StrictMode の付け直しも）に同じ局面をもう一度読み始められる。
    // `useStudyAnalysis` は外れるときに準備中の解析を取りやめるので、覚えたままだと読まずに終わる。
    useEffect(
        () => () => {
            autoStartedNodeRef.current = null;
        },
        [],
    );
    const startDeep = (): void => {
        if (locked || deepBlocked) return;
        actionSerialRef.current += 1;
        stopMate();
        setDeepNodeId(currentNodeId);
        autoStartedNodeRef.current = currentNodeId;
        void analysis.startDeep(currentNodeId);
    };
    // パスの局面は、足した手が文書に入って画面のツリーに現れてから解析を始める（解析は画面のツリーから
    // 手順を読むので、足した直後に始めると局面が見つからずに何もしない）。
    const [pendingPassDeepNodeId, setPendingPassDeepNodeId] = useState<string | null>(null);
    /** パスを足すのを待っている間に別の操作をしたら、待っていた解析は始めない。 */
    const passRequestRef = useRef(0);
    // パスを足している間に押し直しても無視する（足す処理は 2 回目を受け付けないので、
    // 押し直しを別の操作として数えると、1 回目の解析まで取りやめてしまう）。
    const passingRef = useRef(false);
    const startDeepAfterPass = async (): Promise<void> => {
        if (locked || deepBlocked || passingRef.current) return;
        const pressed = { nodeId: currentNodeId, leaveCount: leaveCountRef.current };
        if (autoAnalyze && !(await leaveAutoAnalyze())) return;
        // 読みを止め終わるのを待つ間に局面を移ったら、移った先にパスを足さない。
        if (!isSamePositionAs(pressed)) return;
        const request = ++actionSerialRef.current;
        passRequestRef.current = request;
        passingRef.current = true;
        let passNodeId: string | null;
        try {
            passNodeId = await editing.passFromCurrent();
        } finally {
            passingRef.current = false;
        }
        if (passNodeId !== null && actionSerialRef.current === request) {
            setPendingPassDeepNodeId(passNodeId);
        }
    };
    // 依存配列を付けず、描画のたびに「待っている局面がツリーに現れたか」を確かめる。
    useEffect(() => {
        if (pendingPassDeepNodeId === null) return;
        // 別の局面へ移ったら、待つのをやめる（後でその局面へ来ても、勝手に解析を始めない）。
        if (currentNodeId !== pendingPassDeepNodeId) {
            setPendingPassDeepNodeId(null);
            return;
        }
        if (!tree.nodes.has(pendingPassDeepNodeId)) return;
        setPendingPassDeepNodeId(null);
        // 待っている間に別の操作をした・全体の解析が始まっていたら、重ねて動かさない。
        if (locked || deepBlocked || actionSerialRef.current !== passRequestRef.current) return;
        actionSerialRef.current += 1;
        stopMate();
        setDeepNodeId(pendingPassDeepNodeId);
        autoStartedNodeRef.current = pendingPassDeepNodeId;
        void analysis.startDeep(pendingPassDeepNodeId);
    });
    const onAutoAnalyzeTarget = useEffectEvent(
        (
            nodeId: string,
            enabled: boolean,
            isLocked: boolean,
            isPreparing: boolean,
            mode: StudyAnalysisController["mode"],
            pendingPassNodeId: string | null,
        ): void => {
            // 編集できない間は、準備中の解析も取りやめになる。戻ったら同じ局面から読み直す。
            if (!enabled || isLocked) {
                autoStartedNodeRef.current = null;
                return;
            }
            // パスを足して解析するのを待っている間は、そちらに任せる。
            if (isPreparing || mode === "full" || pendingPassNodeId !== null) return;
            if (autoStartedNodeRef.current === nodeId) return;
            // 別の局面を読み始めた後に残っている live は、止め終わるのを待っている前の読みで、止め終わると
            // 予約した局面の読みが始まる。取り込まずに読み直す（読み直しで予約は取りやめになる）。
            if (analysis.live?.nodeId === nodeId && autoStartedNodeRef.current === null) {
                // 切って止めている途中の読みは、止まると続きを読めない（1 回だけの読み）ことがある。
                // 取り込まず、止まったあと（`mode` が変わってこの判定がもう一度走る）に読み直す。
                if (stoppingAutoRef.current) return;
                autoStartedNodeRef.current = nodeId;
                return;
            }
            // 切って入れ直したときなど、この局面の読みを止めたところからなら続きを読む。
            if (analysis.continuableDeepNodeId === nodeId) {
                autoStartedNodeRef.current = nodeId;
                continueDeep();
                return;
            }
            startDeep();
        },
    );
    // 深く解析は一定の時間ごとに区切って読み、区切りごとに結果を保存する。入れている間は、
    // 区切りまで読んだら同じ局面の続きを読む（読み続ける）。
    const onAutoAnalyzePaused = useEffectEvent((nodeId: string | null): void => {
        if (!autoAnalyze || locked || nodeId === null) return;
        if (nodeId !== currentNodeId || autoStartedNodeRef.current !== nodeId) return;
        if (analysis.mode !== null || analysis.isPreparing) return;
        continueDeep();
    });
    useEffect(() => {
        onAutoAnalyzePaused(analysis.continuableDeepNodeId);
    }, [analysis.continuableDeepNodeId]);
    // 別のタブで自動で読むを切ったときも、このタブの読みを止める（このタブで切ったときは、切った操作の
    // ほうで止める。全体の解析を始めるために切ったときに止めると、待っている開始を取り消してしまう）。
    const onAutoAnalyzeChange = useEffectEvent((enabled: boolean): void => {
        const local = localAutoAnalyzeRef.current === enabled;
        localAutoAnalyzeRef.current = null;
        if (enabled) return;
        // 入れ直したら同じ局面を読み直す（1 拍おいて覚えを消す判定は、すぐ入れ直すと走らない）。
        autoStartedNodeRef.current = null;
        if (local) return;
        // 準備中も止める（この間に全体の解析を始めるときは、このタブで切っているので local になる）。
        if (analysis.mode === "deep" || analysis.isPreparing) stopAutoReading();
    });
    const previousAutoAnalyzeRef = useRef(autoAnalyze);
    useEffect(() => {
        if (previousAutoAnalyzeRef.current === autoAnalyze) return;
        previousAutoAnalyzeRef.current = autoAnalyze;
        onAutoAnalyzeChange(autoAnalyze);
    }, [autoAnalyze]);
    // 解析エンジンが変わると、読んでいた読みは手放される。読み終えたのではないので、同じ局面を新しい
    // エンジンで読み直す（読み終えたかの判定より先に覚えを消す）。
    const onAnalysisEngineChange = useEffectEvent((): void => {
        autoStartedNodeRef.current = null;
        setAutoFinishedNodeId(null);
        // 読み終えて止まっていたなら、ここで読み始める（読んでいたなら、手放されて止まったときに
        // 読み直す）。
        if (autoAnalyze && !locked && analysis.mode === null && !analysis.isPreparing) {
            startDeep();
        }
    });
    const analysisEngineId = analysis.form.engineId;
    const previousEngineIdRef = useRef(analysisEngineId);
    useEffect(() => {
        if (previousEngineIdRef.current === analysisEngineId) return;
        previousEngineIdRef.current = analysisEngineId;
        onAnalysisEngineChange();
    }, [analysisEngineId]);
    // 続きから読めない AI・局面と、読めなかったときは、同じ局面を読み直し続けない（同じ結果を繰り返す
    // だけになる）。入れたままでも止まっていることを、スイッチの行で伝える。
    const onAutoAnalyzeSettled = useEffectEvent((mode: StudyAnalysisController["mode"]): void => {
        if (mode !== null || analysis.isPreparing || !autoAnalyze) return;
        if (autoStartedNodeRef.current !== currentNodeId) return;
        if (analysis.continuableDeepNodeId === currentNodeId) return;
        // 読めずに止まったとき（失敗の知らせを出している）は、読み終えたことにしない。
        if (message?.type === "error") return;
        setAutoFinishedNodeId(currentNodeId);
    });
    useEffect(() => {
        onAutoAnalyzeSettled(analysis.mode);
    }, [analysis.mode]);
    const changeAutoAnalyze = (enabled: boolean): void => {
        // 自動で読むを切って始めようと待っている操作があれば、スイッチの操作のほうを優先して取りやめる。
        actionSerialRef.current += 1;
        setAutoAnalyzeHere(enabled);
        setAutoDecidedNodeId(null);
        if (!enabled) {
            // 入れ直したら同じ局面を読み直す（切ったのが描画に出る前に入れ直されることもあるので、ここでも消す）。
            autoStartedNodeRef.current = null;
            // 切ったら止める（そこまでの読みは残る）。
            if (analysis.mode === "deep" || analysis.isPreparing) stopAutoReading();
            return;
        }
        // 入れたら、動いている全体の解析より自動で読むを優先する（詰み探索は読み始めるときに止まる）。
        if (analysis.mode === "full") {
            cancelAnalysis();
            onMessageChange({
                text: "全体の解析を止めました（解析した分は残っています）。",
                type: "warning",
            });
        }
    };
    // 準備中・全体の解析中で始められなかった局面は、それが終わったときに始める。
    // 付けた直後に始めると、StrictMode の付け直しで `useStudyAnalysis` の準備が宙に浮くので、
    // 1 拍おいてから始め、その前に外れたら取りやめる。
    useEffect(() => {
        const timer = setTimeout(() => {
            setAutoDecidedNodeId(currentNodeId);
            onAutoAnalyzeTarget(
                currentNodeId,
                autoAnalyze,
                locked,
                analysis.isPreparing,
                analysis.mode,
                pendingPassDeepNodeId,
            );
        }, 0);
        return () => clearTimeout(timer);
    }, [
        currentNodeId,
        autoAnalyze,
        locked,
        analysis.isPreparing,
        analysis.mode,
        pendingPassDeepNodeId,
    ]);
    const continueDeep = (): void => {
        if (locked) return;
        actionSerialRef.current += 1;
        stopMate();
        setDeepNodeId(currentNodeId);
        void analysis.continueDeep();
    };
    const cancelAnalysis = (): void => {
        actionSerialRef.current += 1;
        void analysis.cancel();
    };
    const stopMateByUser = (): void => {
        actionSerialRef.current += 1;
        mate?.stop();
    };
    /** 詰み・詰めろか最短手順を調べ始める。 */
    const startMate = async (kind: "mate" | "shortest"): Promise<void> => {
        if (!mate || deepBlocked) return;
        const node = currentNode;
        const pressed = { nodeId: currentNodeId, leaveCount: leaveCountRef.current };
        if (autoAnalyze && !(await leaveAutoAnalyze())) return;
        const request = ++actionSerialRef.current;
        // 深く解析している読みは止める（そこまでの結果は残る）。別の局面の詰み探索も止める。
        if (analysis.mode === "deep") {
            await analysis.cancel();
            if (actionSerialRef.current !== request) return;
        }
        // 止め終わるのを待つ間に局面を移ったら、押した局面の詰み探索は始めない。
        if (!isSamePositionAs(pressed)) return;
        stopMate();
        if (kind === "mate") mate.start(node);
        else mate.startShortest(node);
    };
    /**
     * 別の局面で動いている解析・詰み探索の局面の表記。狭い列でも 1 行に収まるよう手数だけにし、
     * 指し手まで含めた表記はマウスを載せると見られるようにする。
     */
    const positionOf = (nodeId: string): { positionLabel: string; positionTitle: string } => {
        const node = tree.nodes.get(nodeId);
        if (!node) return { positionLabel: "別の局面", positionTitle: "別の局面" };
        if (node.ply === 0) return { positionLabel: "開始局面", positionTitle: "開始局面" };
        return {
            positionLabel: `${node.ply}手目`,
            positionTitle: `${node.ply}手目 ${studyMoveLabel(tree, nodeId)}`,
        };
    };
    /** 自動で読むで、いま読んでいる。 */
    const autoReadingNow = autoAnalyze && analysis.mode === "deep";
    /** 自動で読むの、スイッチの行に出す状態（読んでいる局面の表記）。出すものが無ければ null。 */
    const autoReading = ((): string | null => {
        if (autoAnalyze && analysis.mode === null && autoFinishedNodeId === currentNodeId) {
            return STUDY_AUTO_ANALYZE_FINISHED;
        }
        if (!autoReadingNow) return null;
        // 前の局面の読みを止め終わるまで live は前の局面を指す。自動で読むは見ている局面を読むので、
        // 前の局面の深さは出さない。
        const live = analysis.live?.nodeId === currentNodeId ? analysis.live : null;
        const depth = live?.preview?.depth ?? live?.depth ?? null;
        return `${positionOf(currentNodeId).positionLabel}を読んでいます${depth === null ? "" : `・深さ ${depth}`}`;
    })();
    /** いま読んでいる（CPU を使っている）か。スマートフォンで、候補手の欄を開いていない間に知らせる。 */
    const isReading = analysis.mode !== null || mateRunning;
    const running: Exclude<StudyElsewhereActivity, { kind: "finished" }> | undefined = (() => {
        if (analysis.mode === "full") {
            return { kind: "full", progress: analysis.progress, onStop: cancelAnalysis };
        }
        const deepLive = analysis.live;
        // 自動で読む間に別の局面の live が残るのは、前の局面の読みを止め終わるまで。見ている局面を読む
        // 準備の間なので、別の局面の行は出さない。
        if (
            analysis.mode === "deep" &&
            !autoAnalyze &&
            deepLive &&
            deepLive.nodeId !== currentNodeId
        ) {
            return {
                kind: "deep",
                ...positionOf(deepLive.nodeId),
                live: deepLive,
                onGo: () => {
                    navigateTo(deepLive.nodeId);
                    // 戻った局面では、深く解析した結果を開いて見せる（移るときに閉じるので、移ってから開く）。
                    setDeepNodeId(deepLive.nodeId);
                },
                onStop: cancelAnalysis,
            };
        }
        const mateNodeId = mate?.runningNodeId ?? null;
        if (mate && mateNodeId !== null && mateNodeId !== currentNodeId) {
            return {
                kind: "mate",
                ...positionOf(mateNodeId),
                state: mate.results.get(mateNodeId),
                shortest:
                    mate.runningKind === "shortest"
                        ? mate.shortestResults.get(mateNodeId)
                        : undefined,
                onGo: () => navigateTo(mateNodeId),
                onStop: stopMateByUser,
            };
        }
        return undefined;
    })();
    // 別の局面で動いていたものが、利用者の操作なしに終わったら、行を消さずに「終わりました」に替える。
    // 局面を移る・閉じるまで残す（終わった瞬間に行が消えて、下の候補手が動かないように）。
    const runningTarget =
        running === undefined
            ? null
            : {
                  what:
                      running.kind === "mate" && mate?.runningKind === "shortest"
                          ? ("shortest" as const)
                          : running.kind,
                  nodeId:
                      running.kind === "deep"
                          ? running.live.nodeId
                          : running.kind === "mate"
                            ? (mate?.runningNodeId ?? null)
                            : null,
              };
    const runningKey = runningTarget ? `${runningTarget.what}:${runningTarget.nodeId}` : null;
    const previousRunningRef = useRef<{
        target: NonNullable<typeof runningTarget>;
        currentNodeId: string;
        serial: number;
        completedRuns: number;
    } | null>(null);
    const onRunningChange = useEffectEvent((key: string | null, nodeId: string): void => {
        const previous = previousRunningRef.current;
        if (key !== null && runningTarget) {
            previousRunningRef.current = {
                target: runningTarget,
                currentNodeId: nodeId,
                serial: actionSerialRef.current,
                completedRuns: analysis.completedRuns,
            };
            setFinishedElsewhere(null);
            return;
        }
        previousRunningRef.current = null;
        // 局面を移った・止めた・別の解析に切り替えたときは、終わったと知らせない。
        if (
            previous === null ||
            previous.currentNodeId !== nodeId ||
            previous.serial !== actionSerialRef.current
        ) {
            return;
        }
        // 別のタブで自動で読むを入れると、深く解析はまだ動いたまま行だけが消える（止めるのは自動で読む）。
        if (previous.target.what === "deep" && analysis.mode === "deep") return;
        // 全体の解析は、最後まで読んだときだけ「終わりました」と出す（エンジンが変わった・保存できずに
        // 止めた、などは、その理由のほうを知らせている）。
        if (previous.target.what === "full" && analysis.completedRuns === previous.completedRuns) {
            return;
        }
        setFinishedElsewhere(previous.target);
    });
    useEffect(() => {
        onRunningChange(runningKey, currentNodeId);
    }, [runningKey, currentNodeId]);
    const elsewhere: StudyElsewhereActivity | undefined =
        running ??
        (finishedElsewhere
            ? {
                  kind: "finished",
                  what: finishedElsewhere.what,
                  position:
                      finishedElsewhere.nodeId === null
                          ? null
                          : (() => {
                                const nodeId = finishedElsewhere.nodeId;
                                return {
                                    ...positionOf(nodeId),
                                    onGo: () => {
                                        navigateTo(nodeId);
                                        if (finishedElsewhere.what === "deep")
                                            setDeepNodeId(nodeId);
                                    },
                                };
                            })(),
                  onDismiss: () => setFinishedElsewhere(null),
              }
            : undefined);
    const analysisRun: StudyAnalysisRunState = {
        mode: analysis.mode,
        progress: analysis.progress,
        fullTargetCount: analysis.fullTargetCount,
        locked: editingDisabled,
        needsFullAnalysis,
        unanalyzedCount,
        // 自動で読んでいる間も押せる（押すと自動で読むを切ってから始める）。
        startDisabled: analysisBlocked || (analysis.mode !== null && !autoReadingNow),
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
            id={commentToggleId}
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
        onBackTen: () => nav.navigateToPly(Math.max(0, currentIndex - KIFU_NAV_STEP_TEN)),
        onForwardTen: () =>
            nav.navigateToPly(Math.min(line.length - 1, currentIndex + KIFU_NAV_STEP_TEN)),
    };
    // 選んでいる駒の影（マウスを乗せた行き先に出す）
    const moveShadow = useMoveShadow({
        enabled: !editingDisabled,
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
            displayLayerCondition={displayLayer ? studyLimitsLabel(displayLayer.spec.limits) : null}
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
            onPromoteToMainLine={readOnly ? undefined : editing.promoteLineToMain}
            onRequestDeleteVariation={readOnly ? undefined : setDeleteTargetId}
            onOpenTree={(opener) => {
                treeOpener.current = opener;
                setIsTreeOpen(true);
            }}
            // スマートフォンでは一覧の場所いっぱいに広げ、中で送る（手が少なくても下が空かないように）。
            className={isMobile ? "min-h-0 flex-1" : isWide ? "max-h-full" : "max-h-[26rem]"}
        />
    );
    // 読んでいる間に、前に深く読んだ記録のほうが深ければ、それも出す（今の読みが超えるまで）。
    const recordResult = savedPicked?.result ?? null;
    const recordAhead =
        liveHere && recordResult && recordResult.depth > (liveHere.preview?.depth ?? 0)
            ? recordResult
            : null;
    /** 帯の 1 段に出す値。 */
    const bandLineOf = (result: StudyAnalysisResult | null): StudyBandLine | null => {
        if (!result) return null;
        const best = studyBestCandidate(result);
        return best
            ? {
                  bestMove: studyFirstMoveLabel(currentNode, best.pv),
                  score: best.score,
                  depth: result.depth,
              }
            : { bestMove: null, score: null, depth: null };
    };
    // 帯にラムを出すのは自動で読む読みだけ（パスして解析の読みは、止める操作のある候補手のタブで知らせる）。
    // 局面を移った直後は、前の局面の読みを止めてこの局面を読み始めるまで間があるので、その間も読んでいる
    // ことにする（「未解析」が一瞬出ないように）。
    const bandShowsReading =
        autoAnalyze &&
        (liveHere !== undefined ||
            (!locked &&
                analysis.mode !== "full" &&
                (autoDecidedNodeId !== currentNodeId ||
                    analysis.mode === "deep" ||
                    analysis.isPreparing)));
    const candidatesPanel = (
        <StudyCandidatesPanel
            node={currentNode}
            positionResult={insights.positionResult}
            deeperResult={insights.deeperResult}
            source={storedNode?.source ?? null}
            analysisMode={analysis.mode}
            isPreparing={analysis.isPreparing}
            live={liveHere}
            autoAnalyze={
                editingDisabled
                    ? undefined
                    : { enabled: autoAnalyze, onChange: changeAutoAnalyze, reading: autoReading }
            }
            // スマートフォンではスイッチを局面の帯に置く（どの表示からでも止められるように）。
            autoSwitchElsewhere={isMobile}
            // スマートフォンは帯に記録を出すので、ここには添えない。
            recordAhead={isMobile ? null : recordAhead}
            controlsLast={isMobile}
            onStartDeepAfterPass={editingDisabled ? undefined : () => void startDeepAfterPass()}
            revision={insights.revision}
            onCancel={cancelAnalysis}
            onPreviewPv={previewPv}
            onAddPvAsVariation={readOnly ? undefined : editing.addPvAsVariation}
            mate={
                mate?.supported
                    ? {
                          state: mate.results.get(currentNode.id),
                          moveLabel:
                              currentNode.ply === 0 ? null : studyMoveLabel(tree, currentNodeId),
                          onStart: () => void startMate("mate"),
                          onStop: stopMateByUser,
                          shortest: {
                              state: mate.shortestResults.get(currentNode.id),
                              onStart: () => void startMate("shortest"),
                              onStop: stopMateByUser,
                          },
                      }
                    : undefined
            }
            elsewhere={elsewhere}
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
            disabled={editingDisabled}
            baseConfirmed={commentBaseConfirmed}
            onDone={() => {
                setIsCommentOpen(false);
                // 閉じると入力欄ごと消えるので、開いたボタンへ戻す（キーボード操作の続きのため）。
                requestAnimationFrame(() => document.getElementById(commentToggleId)?.focus());
            }}
        />
    );
    const layerPicker = readOnly && doc.layers.length > 0 && (
        <label className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            表示する解析
            <select
                value={displayLayerId ?? ""}
                onChange={(event) => onDisplayLayerChange(event.target.value)}
                className="min-h-8 min-w-0 rounded-md border border-input bg-background px-2 text-foreground"
            >
                {doc.layers.map((layer) => (
                    <option key={layer.id} value={layer.id}>
                        {layer.display.label}
                    </option>
                ))}
            </select>
        </label>
    );
    const metaRow = (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1.5 text-xs text-muted-foreground">
            {playersLabel && <span className="truncate">{playersLabel}</span>}
            <span className="truncate">{originLink ?? studyOriginLabel(doc.origin)}</span>
            <StudyGameInfo meta={doc.meta} className="order-last basis-full" />
            {/* スマートフォンで保存の状態の帯を出している間は、同じ案内をここに重ねない。 */}
            {readOnly && <span>閲覧のみ</span>}
            {!readOnly && !(isMobile && showsStudySaveStrip(saveStatus, localOnly)) && (
                <StudySaveIndicator
                    status={saveStatus}
                    onLogin={onLogin}
                    localOnly={localOnly}
                    className="md:ml-auto"
                />
            )}
        </div>
    );
    const moreMenu = (
        <StudyMoreMenu
            onOpenChange={setIsMoreMenuOpen}
            // スマートフォンでは出典・保存先の行と、表題・解析の設定・盤の反転を画面に出さず、ここに置く。
            info={isMobile ? metaRow : undefined}
            extraItems={[
                ...(shareDialog && !readOnly
                    ? [{ label: "公開設定・共有リンク", run: shareDialog.onOpen }]
                    : []),
                ...(isMobile && !editingDisabled
                    ? [
                          { label: "表題を変更", run: () => setIsTitleDialogOpen(true) },
                          {
                              label: "解析の設定",
                              note: analysis.settingsLabel,
                              run: () => setIsSettingsOpen(true),
                          },
                      ]
                    : []),
                ...(isMobile
                    ? [
                          {
                              label: flipBoard ? "盤面を元に戻す" : "盤面を反転",
                              run: () => setFlipBoard(!flipBoard),
                          },
                      ]
                    : []),
            ]}
            onPass={editingDisabled ? undefined : () => void editing.passFromCurrent()}
            onCopyKifu={copyKifu}
            onSaveKifu={saveKifu}
            csaUnavailableReason={csaUnavailableReason}
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
                        readOnly={readOnly}
                        onCommitTitle={commitTitle}
                        moreMenu={moreMenu}
                        settingsLabel={analysis.settingsLabel}
                        onOpenSettings={() => setIsSettingsOpen(true)}
                        metaRow={metaRow}
                        layerPicker={layerPicker}
                    />
                )}

                {/* 編集できない間は、再送とノートの破棄も止める（残すのは「ログインし直す」だけ）。 */}
                {!readOnly && (
                    <StudySaveNotice
                        status={saveStatus}
                        onRetry={locked ? undefined : onRetrySave}
                        onDiscard={locked ? undefined : onDiscard}
                        localOnly={localOnly}
                    />
                )}

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
                        className="sticky top-2 z-30 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-status-warning-border bg-status-warning-bg px-3 py-2 text-sm text-status-warning shadow-panel"
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
                            // この局面の読みは帯にラムが出るので、タブには帯に出ない読み（全体の解析・
                            // 詰み探索・別の局面の読み）だけを知らせる。
                            isReading={isReading && !bandShowsReading}
                            saveStrip={
                                readOnly ? (
                                    layerPicker
                                ) : (
                                    <StudySaveStrip
                                        status={saveStatus}
                                        onLogin={onLogin}
                                        localOnly={localOnly}
                                    />
                                )
                            }
                            board={sideHandBoard}
                            boardSectionRef={boardSectionRef}
                            nav={navProps}
                            commentButton={commentButton}
                            commentBox={commentBox}
                            showsComment={showsComment}
                            // 変化に入ったあと、どの表示からでも本譜へ戻れるようにする。
                            onBackToMainLine={nav.onMainLine ? null : nav.backToMainLine}
                            positionBand={
                                <StudyPositionBand
                                    live={bandLineOf(liveHere?.preview ?? null)}
                                    record={bandLineOf(savedPicked?.result ?? null)}
                                    // パスして解析の読みも今の読みとして出すが、ラムは自動で読む読みだけ。
                                    reading={bandShowsReading || liveHere !== undefined}
                                    showRam={bandShowsReading}
                                    autoAnalyze={
                                        editingDisabled
                                            ? undefined
                                            : {
                                                  enabled: autoAnalyze,
                                                  onChange: changeAutoAnalyze,
                                                  status: autoReading,
                                              }
                                    }
                                />
                            }
                            graphPanel={graphPanel}
                            reviewList={
                                <StudyReviewList
                                    items={reviewItems}
                                    currentNodeId={currentNodeId}
                                    hasResults={hasResults}
                                    unanalyzedCount={unanalyzedCount}
                                    onSelect={(nodeId) => navigateTo(nodeId)}
                                />
                            }
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
                open={isTitleDialogOpen && !editingDisabled}
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
                canStart={
                    !editingDisabled &&
                    (analysis.mode === null || autoReadingNow) &&
                    !analysisBlocked
                }
                onStartFull={startFull}
                onOpenNnueLibrary={onOpenNnueLibrary}
            />

            <StudyTreeDialog
                open={isTreeOpen}
                onOpenChange={setIsTreeOpen}
                tree={tree}
                currentNodeId={currentNodeId}
                onSelect={(nodeId) => navigateTo(nodeId)}
                flipBoard={flipBoard}
                returnFocus={treeOpener}
                renderBoard={
                    locked
                        ? undefined
                        : ({ cellSize, handPlacement }) => (
                              <div
                                  style={{ "--shogi-cell-size": `${cellSize}px` } as CSSProperties}
                              >
                                  <PCBoardContent
                                      {...boardProps}
                                      handSize={handPlacement === "sides" ? "medium" : "compact"}
                                      handPlacement={handPlacement}
                                      handFrame="outline"
                                  />
                              </div>
                          )
                }
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
    readOnly = false,
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
        locked: locked || readOnly,
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
                readOnly={readOnly}
                doc={doc}
                tree={tree}
                unrestoredCount={structure.unrestoredCount}
                onApplyOps={onApplyOps}
                displayLayerId={displayLayerId}
                onDisplayLayerChange={changeDisplayLayer}
                analysis={analysis}
                mate={readOnly ? undefined : mate}
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
