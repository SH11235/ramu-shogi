/**
 * 研究ノートの画面（Web / Desktop 共通）。
 *
 * 「取り込む → 全体を解析 → 注目局面から深掘り」が主役になるよう、検討モード（`ShogiMatch`）とは
 * 別に組んでいる。盤・持ち駒・評価値グラフ・読み筋の再生・指し手の入力・解析の実行は
 * 既存の部品とフックをそのまま使う。
 *
 * 画面は保存用の文書（`StudyDocument`）を唯一の元データにする。編集は操作（`StudyOp`）として
 * `onApplyOps` に渡し、呼び出し側が文書を更新して保存層へ流す（ui は保存層に依存しない）。
 */

import {
    applyMoveWithState,
    applyStudyMoveWithState,
    computeStudyHighlights,
    getPositionService,
    isStudyPassMove,
    isStudyUsiMove,
    type KifuTree,
    type LastMove,
    type PieceType,
    type Player,
    type PositionState,
    type Square,
    STUDY_LIMITS,
    STUDY_MAX_PASSES_PER_SIDE,
    STUDY_PASS_MOVE,
    type StudyDocument,
    type StudyHighlightKind,
    type StudyOp,
    studyChildNodeId,
    studyLineFitsPassLimit,
    studyPassRightsForLine,
    studyScoreToKifuEval,
} from "@shogi/app-core";
import { cn } from "@shogi/design-system";
import type { KeyboardEvent, ReactElement, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "./alert-dialog";
import { Button } from "./button";
import type { PlayFromPosition } from "./rshogi-play-from-position";
import { EvalGraph, type EvalGraphMarker } from "./shogi-match/components/EvalGraph";
import { MatchNnueDownloadDialog } from "./shogi-match/components/MatchNnueDownloadDialog";
import { type HandInfo, MobileBoardSection } from "./shogi-match/components/MobileBoardSection";
import { PCBoardContent } from "./shogi-match/components/PCBoardContent";
import { PvPreviewDialog } from "./shogi-match/components/PvPreviewDialog";
import { TOOLTIP_DELAY_DURATION_MS } from "./shogi-match/constants";
import { useKifuKeyboardNavigation } from "./shogi-match/hooks/useKifuKeyboardNavigation";
import { useLocalStorage } from "./shogi-match/hooks/useLocalStorage";
import { useIsMobile, useMediaQuery } from "./shogi-match/hooks/useMediaQuery";
import { useMoveExecution } from "./shogi-match/hooks/useMoveExecution";
import { useMoveShadow } from "./shogi-match/hooks/useMoveShadow";
import { PLAY_HAND_ZONES } from "./shogi-match/play/playStyles";
import {
    DEFAULT_DISPLAY_SETTINGS,
    type DisplaySettings,
    type EngineOption,
    type Message,
    type PromotionSelection,
    type Selection,
} from "./shogi-match/types";
import { LegalMoveCache } from "./shogi-match/utils/legalMoveCache";
import { boardToGrid } from "./shogi-match/utils/positionUtils";
import { StudyAnalysisSettings } from "./study-workspace/StudyAnalysisSettings";
import { StudyCandidatesPanel, type StudyPvRequest } from "./study-workspace/StudyCandidatesPanel";
import {
    isStudyCommentOverLimit,
    StudyCommentBox,
    type StudyCommentDraftChange,
} from "./study-workspace/StudyCommentBox";
import { StudyHighlightsPanel } from "./study-workspace/StudyHighlightsPanel";
import { StudyIconButton } from "./study-workspace/StudyIconButton";
import {
    AnalyzeIcon,
    BookmarkIcon,
    CommentIcon,
    FirstIcon,
    FlipIcon,
    LastIcon,
    NextIcon,
    PrevIcon,
    SettingsIcon,
} from "./study-workspace/StudyIcons";
import { StudyMoreMenu } from "./study-workspace/StudyMoreMenu";
import { StudyMoveList } from "./study-workspace/StudyMoveList";
import {
    StudySaveIndicator,
    StudySaveNotice,
    type StudyWorkspaceSaveStatus,
} from "./study-workspace/StudySaveStatus";
import { exportStudyLineToKif, exportStudyPositionToSfen } from "./study-workspace/studyExport";
import {
    applyStudyLayerToTree,
    buildStudyStructureTree,
    chooseStudyDisplayLayer,
    countStudyLayerResults,
    countStudyUnanalyzed,
    pickStudyDeeperResult,
    pickStudyPositionResult,
    resolveStudyLine,
    type StudyStructureTree,
    studyBestCandidate,
    studyFirstMoveLabel,
    studyHighlightTitle,
    studyLineEvalHistory,
    studyLineSourceEvalHistory,
    studyMainLineIds,
    studyMoveLabel,
    studyOriginLabel,
    studyPathTo,
    studyPlayersLabel,
    studyStructureKey,
    studySubtreeSize,
    studyVariationLength,
} from "./study-workspace/studyView";
import {
    type StudyAnalysisController,
    type StudyApplyOpsResult,
    type StudyEngineIdentity,
    useStudyAnalysis,
} from "./study-workspace/useStudyAnalysis";
import { TooltipProvider } from "./tooltip";

/** 既存の盤面と同じ表示設定（座標・最終手の強調・ホイール操作）を使う。 */
const DISPLAY_SETTINGS_KEY = "shogi-display-settings";

/** 研究ノートの評価値グラフの縦軸の上限（センチポーン）。詰みや大差は端に張り付けて描く。 */
const GRAPH_AXIS_CAP = 3000;
const GRAPH_MIN_SCALE = 1000;

/** 通知を出しておく時間（ミリ秒）。エラーは読む時間を長めに取る。 */
const NOTICE_DURATION_MS = { error: 9000, warning: 7000, success: 4000 } as const;

type FetchLegalMoves = (
    sfen: string,
    moves: string[],
    options?: { passRights?: { sente: number; gote: number } },
) => Promise<string[]>;

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
    fetchLegalMoves?: FetchLegalMoves;
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

/** 保存できていないコメントの入力。 */
export interface StudyCommentDraft {
    /** コメントを書いていた手（保存用の `nodeId`）。 */
    nodeId: string;
    text: string;
    /**
     * この下書きを書き始めたときの、保存済みのコメント。開き直したときに保存済みのコメントが
     * ここから変わっていたら、自動では保存せず、利用者に選んでもらう。分からなければ省略。
     */
    base?: string | null;
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
}

type MobileTab = "highlights" | "moves" | "candidates";

const MOBILE_TABS: { id: MobileTab; label: string }[] = [
    { id: "highlights", label: "注目局面" },
    { id: "moves", label: "棋譜" },
    { id: "candidates", label: "候補手" },
];

const noop = (): void => {};

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

function TitleInput({
    title,
    onCommit,
    disabled,
}: {
    title: string;
    onCommit: (title: string) => void;
    disabled: boolean;
}): ReactElement {
    const [draft, setDraft] = useState(title);
    const commit = (): void => {
        const next = Array.from(draft.trim()).slice(0, STUDY_LIMITS.titleLength).join("");
        if (next === "") {
            setDraft(title);
            return;
        }
        setDraft(next);
        if (next !== title) onCommit(next);
    };
    return (
        <input
            type="text"
            aria-label="研究ノートの表題"
            title="クリックして表題を編集"
            value={draft}
            readOnly={disabled}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => {
                // 編集できない間は、保存を試みない（入力は元に戻す）。
                if (disabled) setDraft(title);
                else commit();
            }}
            onKeyDown={(event) => {
                if (event.key === "Enter") {
                    event.currentTarget.blur();
                } else if (event.key === "Escape") {
                    setDraft(title);
                    event.currentTarget.blur();
                }
            }}
            className="min-w-0 flex-1 truncate rounded-md border border-transparent bg-transparent px-1.5 py-0.5 font-display text-lg font-bold text-wafuu-sumi transition-colors hover:border-wafuu-border focus:border-wafuu-border focus:bg-background focus:outline-none focus:ring-2 focus:ring-ring md:text-xl"
        />
    );
}

function NavBar({
    index,
    total,
    onToStart,
    onBack,
    onForward,
    onToEnd,
}: {
    index: number;
    total: number;
    onToStart: () => void;
    onBack: () => void;
    onForward: () => void;
    onToEnd: () => void;
}): ReactElement {
    const buttonClass = "w-12 border-border bg-background text-wafuu-sumi";
    return (
        <nav aria-label="局面の移動" className="flex items-center justify-center gap-1.5">
            <StudyIconButton
                label="最初の局面へ"
                className={buttonClass}
                onClick={onToStart}
                disabled={index <= 0}
            >
                <FirstIcon />
            </StudyIconButton>
            <StudyIconButton
                label="1 手戻る（←）"
                className={buttonClass}
                onClick={onBack}
                disabled={index <= 0}
            >
                <PrevIcon />
            </StudyIconButton>
            <output className="min-w-[4.5rem] text-center font-mono text-sm tabular-nums text-wafuu-sumi">
                {index} / {total}
            </output>
            <StudyIconButton
                label="1 手進む（→）"
                className={buttonClass}
                onClick={onForward}
                disabled={index >= total}
            >
                <NextIcon />
            </StudyIconButton>
            <StudyIconButton
                label="最後の局面へ"
                className={buttonClass}
                onClick={onToEnd}
                disabled={index >= total}
            >
                <LastIcon />
            </StudyIconButton>
        </nav>
    );
}

/**
 * 通知。レイアウトを動かさないよう、固定した位置に重ねて出す。
 *
 * 画面の上（ページの見出しのすぐ下）に出す。下に出すと、スマートフォンでは局面の移動ボタンや
 * 下端に固定した操作に、PC ではコメント欄に重なるため。
 */
function Notice({
    message,
    onDismiss,
}: {
    message: Message | null;
    onDismiss: () => void;
}): ReactElement {
    return (
        <div className="pointer-events-none fixed inset-x-0 top-14 z-40 flex justify-center px-3">
            {message && (
                <div
                    role={message.type === "error" ? "alert" : "status"}
                    className={cn(
                        "pointer-events-auto flex max-w-[min(36rem,100%)] items-start gap-3 whitespace-pre-line rounded-lg border px-3 py-2 text-sm shadow-card",
                        message.type === "error"
                            ? "border-destructive/40 bg-card text-destructive"
                            : message.type === "warning"
                              ? "border-status-warning-border bg-card text-status-warning"
                              : "border-status-success-border bg-card text-status-success",
                    )}
                >
                    <p className="min-w-0 flex-1">{message.text}</p>
                    <button
                        type="button"
                        onClick={onDismiss}
                        className="shrink-0 rounded-sm text-xs underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                        閉じる
                    </button>
                </div>
            )}
        </div>
    );
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
}: StudyWorkspaceViewProps): ReactElement {
    const isMobile = useIsMobile();
    // 768〜1023px（タブレットの縦持ち）: 盤を小さくして 2 列にする。
    const isTablet = useMediaQuery("(min-width: 768px) and (max-width: 1023px)");
    // 3 列で並ぶ幅。表題の行に余裕があるので、保存の状態なども同じ行に入れる（縦を取らない）。
    // Tailwind の xl（80rem）と同じ単位で判定する（px だと、ブラウザの文字の大きさを変えたときに
    // 棋譜の欄を置く列が CSS のグリッドと食い違う）。
    const isWide = useMediaQuery("(min-width: 80rem)");
    const [storedDisplaySettings] = useLocalStorage<DisplaySettings>(
        DISPLAY_SETTINGS_KEY,
        DEFAULT_DISPLAY_SETTINGS,
    );
    const displaySettings = { ...DEFAULT_DISPLAY_SETTINGS, ...storedDisplaySettings };

    const [requestedNodeId, setRequestedNodeId] = useState<string>(
        () => initialNodeId ?? tree.rootId,
    );
    // 移る前に見ていた局面。足した手が保存層に拒否されて消えたとき、ここへ戻る。
    const [fallbackNodeId, setFallbackNodeId] = useState<string | null>(null);
    const [lineState, setLineState] = useState<string[]>([]);
    const [selection, setSelection] = useState<Selection | null>(null);
    const [promotionSelection, setPromotionSelection] = useState<PromotionSelection | null>(null);
    const [flipBoard, setFlipBoard] = useState(false);
    const [mobileTab, setMobileTab] = useState<MobileTab>("highlights");
    // コメント欄は普段は畳んでおき、盤の上のボタンで開く（開いたままにすれば、手を送っても出続ける）。
    const [isCommentOpen, setIsCommentOpen] = useState(false);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    // 「その他の操作」を開いている間は、矢印キーで局面を動かさない（コピー・対局に渡す局面が、
    // メニューの中でのキー操作で変わってしまうため）。
    const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
    const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
    // まだ保存できていないコメントの入力（手ごと）。コメント欄は手を移るたびに作り直すので、
    // 上限を超えていて保存できない入力も、ここに残しておき、その手へ戻ったときに戻す。
    const commentDraftsRef = useRef<Map<
        string,
        { text: string; base?: string | null; fromStorage?: boolean }
    > | null>(null);
    if (!commentDraftsRef.current) {
        commentDraftsRef.current = new Map(
            (initialCommentDrafts ?? []).map((draft) => [
                draft.nodeId,
                // 開いたときに戻した（前回までの）書きかけ。
                { text: draft.text, base: draft.base, fromStorage: true },
            ]),
        );
    }
    const commentDrafts = commentDraftsRef.current;
    // 保存できていない書きかけがある手（コメントのボタンに印を付ける。欄を畳んでいても気づけるように）。
    const [draftCommentIds, setDraftCommentIds] = useState<ReadonlySet<string>>(
        () => new Set(commentDrafts.keys()),
    );
    // コメントが長すぎて保存できていない手（棋譜に印を付ける）。
    const [overLimitCommentIds, setOverLimitCommentIds] = useState<ReadonlySet<string>>(
        () =>
            new Set(
                (initialCommentDrafts ?? [])
                    .filter((draft) => isStudyCommentOverLimit(draft.text))
                    .map((draft) => draft.nodeId),
            ),
    );
    // 書きかけが別の画面での変更とぶつかり、利用者の選択を待っている手（棋譜に印を付ける）。
    const [conflictCommentIds, setConflictCommentIds] = useState<ReadonlySet<string>>(
        () => new Set(),
    );
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

    // 見ている局面までの経路（ルートから）。その局面が文書から消えたとき、残っている最も近い
    // 祖先（分岐点）へ移るのに使う。消えたあとではツリーからたどれないので、あるうちに覚えておく。
    const seenPathRef = useRef<string[]>([]);
    // この画面で足した手のうち、保存の結果がまだ分からないもの（保存層に拒否されて消えた手を、
    // 「別の画面で削除された」と取り違えないために覚えておく）。
    const unconfirmedAddsRef = useRef(new Set<string>());

    // 見ていた局面が（他の端末での削除や、保存層の拒否で）無くなっていたら、残っている所まで戻る。
    const currentNodeId = ((): string => {
        if (tree.nodes.has(requestedNodeId)) return requestedNodeId;
        // 見ていた局面の、残っている最も近い祖先（直前に見ていた別の局面へは飛ばさない）。
        const seenPath = seenPathRef.current;
        if (seenPath[seenPath.length - 1] === requestedNodeId) {
            for (let i = seenPath.length - 2; i >= 0; i--) {
                if (tree.nodes.has(seenPath[i])) return seenPath[i];
            }
        }
        if (fallbackNodeId !== null && tree.nodes.has(fallbackNodeId)) return fallbackNodeId;
        const index = lineState.indexOf(requestedNodeId);
        for (let i = index - 1; i >= 0; i--) {
            if (tree.nodes.has(lineState[i])) return lineState[i];
        }
        return tree.rootId;
    })();
    const currentNode = tree.nodes.get(currentNodeId) ?? tree.nodes.get(tree.rootId);
    if (!currentNode) {
        throw new Error("研究ノートのツリーにルートがありません");
    }
    const line = resolveStudyLine(tree, currentNodeId, lineState);
    const currentIndex = line.indexOf(currentNodeId);
    const position = currentNode.positionAfter;
    const storedNode = Object.hasOwn(doc.tree.nodes, currentNodeId)
        ? doc.tree.nodes[currentNodeId]
        : undefined;
    const movesToCurrent: string[] = [];
    for (const nodeId of studyPathTo(tree, currentNodeId)) {
        const move = tree.nodes.get(nodeId)?.usiMove;
        if (move) movesToCurrent.push(move);
    }

    // 見ている局面までの経路を覚える。見ていた局面が文書から消えていたら、移った先を見ている
    // 局面として確定し、別の画面で削除された場合は知らせる。
    const isCurrentMissing = currentNodeId !== requestedNodeId;
    // biome-ignore lint/correctness/useExhaustiveDependencies: 見ている局面とツリーが変わったときにだけ確かめる
    useEffect(() => {
        if (!isCurrentMissing) {
            seenPathRef.current = studyPathTo(tree, currentNodeId);
            return;
        }
        const seenPath = seenPathRef.current;
        const wasSeen = seenPath[seenPath.length - 1] === requestedNodeId;
        // この画面で足して、保存層に拒否された手は、理由を呼び出し側が知らせる。
        const wasRejectedAdd = unconfirmedAddsRef.current.has(requestedNodeId);
        setRequestedNodeId(currentNodeId);
        setSelection(null);
        setPromotionSelection(null);
        onCurrentNodeChange?.(currentNodeId);
        if (wasSeen && !wasRejectedAdd) {
            onMessageChange({
                text: "見ていた変化は別の画面で削除されました。分岐の手前の局面に移りました。",
                type: "warning",
            });
        }
    }, [isCurrentMissing, currentNodeId, tree]);

    /** この画面で足した手を、保存の結果が分かるまで覚えておく。 */
    const trackAddedNodes = (
        parentId: string,
        moves: readonly string[],
        outcome: StudyApplyOpsResult,
    ): void => {
        if (!(outcome instanceof Promise)) return;
        const ids: string[] = [];
        let cursor = parentId;
        for (const move of moves) {
            cursor = studyChildNodeId(cursor, move);
            ids.push(cursor);
        }
        for (const id of ids) unconfirmedAddsRef.current.add(id);
        void outcome.then((saved) => {
            // 保存できたら、以後に消えた場合は「別の画面で削除された」として扱う。
            if (saved) for (const id of ids) unconfirmedAddsRef.current.delete(id);
        });
    };

    const navigateTo = (nodeId: string, options?: { resetLine?: boolean }): void => {
        if (nodeId !== currentNodeId) {
            setDeepNodeId(null);
            // 長すぎて保存できていないコメントを残して移るときは、黙って移らず知らせる。
            const leaving = commentDrafts.get(currentNodeId);
            if (leaving !== undefined && isStudyCommentOverLimit(leaving.text)) {
                onMessageChange({
                    text: `${currentNode.ply === 0 ? "開始局面" : `${currentNode.ply}手目`}のコメントは長すぎるため、保存されていません。入力はその手に残してあります（棋譜に「未保存」の印が付きます）。`,
                    type: "warning",
                });
            }
        }
        setLineState(options?.resetLine ? [] : line);
        setFallbackNodeId(currentNodeId);
        setRequestedNodeId(nodeId);
        setSelection(null);
        setPromotionSelection(null);
        onCurrentNodeChange?.(nodeId);
    };
    const goBack = (): void => {
        if (currentNode.parentId !== null) navigateTo(currentNode.parentId);
    };
    const goForward = (): void => {
        const next = line[currentIndex + 1];
        if (next !== undefined) navigateTo(next);
    };
    const goToStart = (): void => navigateTo(tree.rootId);
    const goToEnd = (): void => navigateTo(line[line.length - 1]);

    // --- 盤上の操作（既存の検討モードと同じフックを、検討モードとして使う） ---
    const legalCacheRef = useRef<LegalMoveCache | null>(null);
    if (!legalCacheRef.current) legalCacheRef.current = new LegalMoveCache();
    const legalCache = legalCacheRef.current;
    const turnStartTimeRef = useRef(0);
    // 「パスを指す」が、パスできるかを確かめている間に変わりうるもの（いまの局面・編集できるか）。
    const passPendingRef = useRef(false);
    const latestPassGuardRef = useRef({ nodeId: currentNodeId, locked });
    useEffect(() => {
        latestPassGuardRef.current = { nodeId: currentNodeId, locked };
    }, [currentNodeId, locked]);
    const moveProcessingRef = useRef(false);

    /** いまの局面から手を足す（既にある手なら、その手へ移るだけ）。 */
    const addMoveFromCurrent = (usiMove: string): void => {
        if (!isStudyUsiMove(usiMove)) {
            onMessageChange({ text: "この手は研究ノートに追加できません", type: "error" });
            return;
        }
        const childId = studyChildNodeId(currentNodeId, usiMove);
        if (!tree.nodes.has(childId)) {
            if (Object.keys(doc.tree.nodes).length >= STUDY_LIMITS.nodesPerStudy) {
                onMessageChange({
                    text: `このノートの局面の数が上限（${STUDY_LIMITS.nodesPerStudy}）に達しました。これ以上、手を足せません。`,
                    type: "error",
                });
                return;
            }
            if (currentNode.ply + 1 > STUDY_LIMITS.lineLength) {
                onMessageChange({
                    text: `このノートの手数が上限（${STUDY_LIMITS.lineLength} 手）に達しました。`,
                    type: "error",
                });
                return;
            }
            trackAddedNodes(
                currentNodeId,
                [usiMove],
                onApplyOps([{ type: "addMoves", parentId: currentNodeId, moves: [usiMove] }]),
            );
        }
        navigateTo(childId);
    };

    /**
     * いまの局面でパスを指す。パスできない局面（王手がかかっている）と、エンジンが読み込めない
     * 回数（1 つの手順で各側 `STUDY_MAX_PASSES_PER_SIDE` 回まで）は断る。
     */
    const passFromCurrent = async (): Promise<void> => {
        // 確かめている間の押し直しは受け付けない。
        if (passPendingRef.current) return;
        const nodeId = currentNodeId;
        const moves = [...movesToCurrent, STUDY_PASS_MOVE];
        if (!tree.nodes.has(studyChildNodeId(currentNodeId, STUDY_PASS_MOVE))) {
            if (!studyLineFitsPassLimit(tree.startSfen, moves)) {
                onMessageChange({
                    text: `1 つの手順で指せるパスは、先手・後手それぞれ ${STUDY_MAX_PASSES_PER_SIDE} 回までです。`,
                    type: "error",
                });
                return;
            }
            // パスが合法手にあるかで確かめる（パスを足したあとの手順と同じパス権で調べる）。
            const passRights = studyPassRightsForLine(tree.startSfen, moves);
            const options = passRights ? { passRights } : undefined;
            let canPass = false;
            passPendingRef.current = true;
            try {
                const legal = fetchLegalMoves
                    ? await fetchLegalMoves(tree.startSfen, movesToCurrent, options)
                    : await getPositionService().getLegalMoves(
                          tree.startSfen,
                          movesToCurrent,
                          options,
                      );
                canPass = legal.includes(STUDY_PASS_MOVE);
            } catch {
                onMessageChange({
                    text: "パスできるかを確かめられませんでした。もう一度お試しください。",
                    type: "error",
                });
                return;
            } finally {
                passPendingRef.current = false;
            }
            // 確かめている間に、別の局面へ移った・編集できなくなったときは、足さない。
            if (latestPassGuardRef.current.nodeId !== nodeId || latestPassGuardRef.current.locked) {
                return;
            }
            if (!canPass) {
                onMessageChange({
                    text: "この局面ではパスできません（王手がかかっているときは、パスできません）。",
                    type: "error",
                });
                return;
            }
        }
        addMoveFromCurrent(STUDY_PASS_MOVE);
    };

    const { handleSquareSelect, handlePromotionChoice, handleHandSelect, getLegalSet } =
        useMoveExecution({
            position,
            navigation: {
                addMove: (usiMove) => addMoveFromCurrent(usiMove),
                tree: { ...tree, currentNodeId },
            },
            isEditMode: false,
            isReviewMode: true,
            isPaused: false,
            positionReady: true,
            fetchLegalMoves,
            startSfen: tree.startSfen,
            moves: movesToCurrent,
            legalCache,
            clearLegalCache: () => legalCache.clear(),
            setCanPassLegal: noop,
            // パスを含む手順の合法手は、パス権を有効にしないと求められない。
            getPassRightsOption: () => {
                const passRights = studyPassRightsForLine(tree.startSfen, movesToCurrent);
                return passRights ? { passRights } : {};
            },
            updateClocksForNextTurn: noop,
            turnStartTimeRef,
            isEngineTurn: () => false,
            selection,
            setSelection,
            promotionSelection,
            setPromotionSelection,
            setLastMove: noop,
            // 既存のフックは手を指すたびにメッセージを消す。ここで出した通知（上限など）まで消さない
            // よう、消す指示は受け流し、通知は時間で消す。
            setMessage: (next) => {
                if (next) onMessageChange(next);
            },
            setLastAddedBranchInfo: noop,
            editFromSquare: null,
            setEditFromSquare: noop,
            editTool: "place",
            editPieceType: null,
            editOwner: "sente",
            editPromoted: false,
            placePieceAt: () => false,
            moveProcessingRef,
        });

    const boardSectionRef = useRef<HTMLDivElement | null>(null);
    useKifuKeyboardNavigation({
        onForward: goForward,
        onBack: goBack,
        onToStart: goToStart,
        onToEnd: goToEnd,
        // 読み筋の再生・確認ダイアログが開いている間は、そちらのキー操作を優先する。
        disabled:
            locked ||
            pvPreview !== null ||
            deleteTargetId !== null ||
            isSettingsOpen ||
            isMoreMenuOpen,
        containerRef: boardSectionRef,
        enableWheelNavigation: displaySettings.enableWheelNavigation,
    });

    // --- 注目局面・解析の状態 ---
    const highlights = computeStudyHighlights(doc, displayLayerId);
    const highlightKinds = new Map<string, StudyHighlightKind>();
    for (const highlight of highlights) {
        if (highlight.kind) highlightKinds.set(highlight.nodeId, highlight.kind);
    }
    const displayLayer = doc.layers.find((layer) => layer.id === displayLayerId);
    const totalCount = Object.keys(doc.tree.nodes).length;
    const unanalyzedCount = countStudyUnanalyzed(doc, displayLayerId);
    const analyzedCount = displayLayer === undefined ? 0 : totalCount - unanalyzedCount;
    const hasResults = analyzedCount > 0;
    const needsFullAnalysis = analysis.mode !== "full" && analyzedCount * 2 < totalCount;
    // 候補手・「この手の代わりに」・注目局面の行の「最善」は、どれも表示中の設定の結果から出す
    // （欄によって別の設定の結果が混ざると、行とパネルで手や評価値が食い違う）。
    const positionResult = pickStudyPositionResult(doc, currentNodeId, displayLayerId);

    // 表示中の設定より深く読んだ結果は、候補手を差し替えず、別の段として添える。
    // 利用者がいま「この局面を深く解析」で得た結果は、AI が表示中の設定と違っていても必ず出す
    // （押したのに結果が見当たらない、にならないように）。
    const isDeepHere = deepNodeId === currentNodeId;
    const deepLayer =
        isDeepHere && deepLayerId !== null && deepLayerId !== displayLayerId
            ? doc.layers.find((layer) => layer.id === deepLayerId)
            : undefined;
    const freshDeepResult =
        deepLayer && Object.hasOwn(deepLayer.results, currentNodeId)
            ? { layer: deepLayer, result: deepLayer.results[currentNodeId] }
            : null;
    // ふだん添えるのは、表示中の結果より深く読めているものだけ（同じ深さ・浅い結果は出さない）。
    const storedDeeperResult = pickStudyDeeperResult(doc, currentNodeId, displayLayerId);
    const deeperResult =
        freshDeepResult ??
        (storedDeeperResult !== null &&
        (positionResult === null || storedDeeperResult.result.depth > positionResult.result.depth)
            ? storedDeeperResult
            : null);
    const deeperIsFresh =
        isDeepHere && deeperResult !== null && (freshDeepResult !== null || deepLayerId === null);

    // 悪手・疑問手の「代わりの最善手」（1 手前の局面の、表示中の設定の 1 位の候補の初手）。
    const bestMoveLabels = new Map<string, string>();
    for (const highlight of highlights) {
        if (highlight.kind === null || highlight.parentId === null) continue;
        const parent = tree.nodes.get(highlight.parentId);
        const result = pickStudyPositionResult(doc, highlight.parentId, displayLayerId);
        if (!parent || !result) continue;
        const best = studyBestCandidate(result.result);
        // 指した手が 1 位の候補と同じなら、代わりの手は無い。
        if (!best || best.pv[0] === highlight.usiMove) continue;
        const label = studyFirstMoveLabel(parent, best.pv);
        if (label) bestMoveLabels.set(highlight.nodeId, label);
    }

    // いま見ている手が悪手・疑問手なら、1 手前の局面の候補手（代わりに指すべきだった手）を出す。
    const currentKind = highlightKinds.get(currentNodeId);
    const parentNode = currentNode.parentId ? tree.nodes.get(currentNode.parentId) : undefined;
    const parentResult =
        currentKind && parentNode
            ? pickStudyPositionResult(doc, parentNode.id, displayLayerId)
            : null;
    // 指した手が 1 手前の局面の 1 位の候補と同じなら、代わりの手は無い（判定は相手の応手のあとの
    // 評価値との落差なので、1 位の手でも悪手・疑問手になることがある）。
    const playedIsBest =
        parentResult !== null &&
        studyBestCandidate(parentResult.result)?.pv[0] === currentNode.usiMove;
    const alternative =
        currentKind && parentNode && parentResult && !playedIsBest
            ? {
                  node: parentNode,
                  result: parentResult,
                  playedLabel: studyMoveLabel(tree, currentNodeId),
                  kindLabel: currentKind === "blunder" ? "悪手" : "疑問手",
              }
            : null;

    // グラフの印は悪手としおりだけ（疑問手まで出すと、件数が多いときに埋もれる。疑問手は一覧で分かる）。
    const graphMarkers: EvalGraphMarker[] = [];
    for (const highlight of highlights) {
        const index = line.indexOf(highlight.nodeId);
        if (index < 0) continue;
        const tone =
            highlight.kind === "blunder" ? "blunder" : highlight.bookmarked ? "bookmark" : null;
        if (!tone) continue;
        graphMarkers.push({
            ply: index,
            tone,
            label: `${studyHighlightTitle(tree, highlight)}（${tone === "blunder" ? "悪手" : "しおり"}）`,
        });
    }
    // 解析する前でも全体の流れが見えるよう、棋譜に付いていた評価値があればグラフに出す。
    const sourceHistory = hasResults ? null : studyLineSourceEvalHistory(doc, tree, line);
    const showsSourceGraph =
        sourceHistory?.some((entry) => entry.evalCp !== null || entry.evalMate !== null) ?? false;
    const graphHistory =
        showsSourceGraph && sourceHistory ? sourceHistory : studyLineEvalHistory(tree, line);

    // --- 編集 ---
    const toggleBookmark = (): void => {
        void onApplyOps([
            {
                type: "setBookmark",
                nodeId: currentNodeId,
                value: !(storedNode?.bookmarked ?? false),
            },
        ]);
    };
    const changeComment = (nodeId: string, value: string): StudyApplyOpsResult =>
        onApplyOps([{ type: "setComment", nodeId, value }]);
    const addPvAsVariation = (request: StudyPvRequest): void => {
        const baseNode = tree.nodes.get(request.nodeId);
        if (!baseNode) return;
        const moves: string[] = [];
        let cursor = baseNode.positionAfter;
        const room = Math.min(
            STUDY_LIMITS.lineLength - baseNode.ply,
            STUDY_LIMITS.nodesPerStudy - totalCount,
        );
        const movesToBase = studyPathTo(tree, request.nodeId)
            .map((nodeId) => tree.nodes.get(nodeId)?.usiMove ?? null)
            .filter((move): move is string => move !== null);
        for (const move of request.pv) {
            if (moves.length >= room || !isStudyUsiMove(move)) break;
            // エンジンが読み込めない回数のパスになる手前で切る。
            if (
                isStudyPassMove(move) &&
                !studyLineFitsPassLimit(tree.startSfen, [...movesToBase, ...moves, move])
            ) {
                break;
            }
            const applied = isStudyPassMove(move)
                ? applyStudyMoveWithState(cursor, move)
                : applyMoveWithState(cursor, move, { validateTurn: false });
            if (!applied.ok) break;
            moves.push(move);
            cursor = applied.next;
        }
        if (moves.length === 0) {
            onMessageChange({ text: "この読み筋は変化として追加できません", type: "error" });
            return;
        }
        trackAddedNodes(
            baseNode.id,
            moves,
            onApplyOps([{ type: "addMoves", parentId: baseNode.id, moves }]),
        );
        navigateTo(studyChildNodeId(baseNode.id, moves[0]));
        onMessageChange({
            text: `読み筋を変化として追加しました（${moves.length} 手）`,
            type: "success",
        });
    };
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
    const backToMainLine = (): void => {
        // 変化の中を見ていたら本譜から外れる直前の局面へ戻り、そこから先は本譜をたどる。
        const mainLine = studyMainLineIds(tree);
        let lastMainIndex = 0;
        for (let index = 1; index < line.length; index++) {
            if (!mainLine.has(line[index])) break;
            lastMainIndex = index;
        }
        navigateTo(currentIndex <= lastMainIndex ? currentNodeId : line[lastMainIndex], {
            resetLine: true,
        });
    };
    const promoteLineToMain = (): void => {
        if (locked) return;
        // いま見ている手順の各手を、その親の先頭の子にする（先頭の子をたどった手順が本譜）。
        // 並べ替えは保存されている子の並びに対して行う（盤面を再現できず表示していない
        // 変化も、並びには含まれているため）。
        const ops: StudyOp[] = [];
        for (let index = 1; index < line.length; index++) {
            const parentId = line[index - 1];
            const childId = line[index];
            if (!Object.hasOwn(doc.tree.nodes, parentId)) return;
            const children = doc.tree.nodes[parentId].children;
            if (children[0] === childId || !children.includes(childId)) continue;
            ops.push({
                type: "reorderChildren",
                parentId,
                value: [childId, ...children.filter((id) => id !== childId)],
            });
        }
        if (ops.length === 0) return;
        void onApplyOps(ops);
        onMessageChange({
            text: "見ていた変化を本譜にしました。元の本譜は変化として残っています。",
            type: "success",
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
            setLineState([]);
        }
        void onApplyOps([{ type: "deleteSubtree", nodeId: targetId }]);
    };
    const selectHighlight = (nodeId: string): void => {
        navigateTo(nodeId);
        // スマートフォンでは、移った先の局面の候補手をすぐ見られるようにする。
        if (isMobile) setMobileTab("candidates");
    };

    // 編集できなくなったら、開いているダイアログ・シートを閉じる（その中から編集や解析を
    // 始められないように）。開いているかどうかの表示も、編集できる間だけにする。
    useEffect(() => {
        if (!locked) return;
        setIsSettingsOpen(false);
        setDeleteTargetId(null);
        setSelection(null);
        setPromotionSelection(null);
    }, [locked]);
    const settingsOpen = isSettingsOpen && !locked;
    const deleteDialogTargetId = locked ? null : deleteTargetId;

    const startFull = (): void => {
        if (locked) return;
        void analysis.startFull();
    };
    /** 表示中の設定の未解析分を、その設定で解析する。表示中の結果が無ければ全体の解析。 */
    const resumeDisplayLayer = (): void => {
        if (locked) return;
        if (displayLayerId === null) startFull();
        else void analysis.resumeLayer(displayLayerId);
    };
    const startDeep = (): void => {
        if (locked) return;
        setDeepNodeId(currentNodeId);
        void analysis.startDeep(currentNodeId);
    };
    const changeCommentDraft = (nodeId: string, change: StudyCommentDraftChange): void => {
        if (change.type === "set") {
            commentDrafts.set(nodeId, { text: change.text, base: change.base });
        } else if (
            // 消すのは、持っている下書きが、保存できた内容と同じときだけ。作り直す前のコメント欄の
            // 保存があとから終わっても、そのあとに書いた新しい下書きは消さない。
            change.savedText === null ||
            commentDrafts.get(nodeId)?.text === change.savedText
        ) {
            commentDrafts.delete(nodeId);
        }
        const held = commentDrafts.get(nodeId);
        setDraftCommentIds((previous) => {
            if (previous.has(nodeId) === (held !== undefined)) return previous;
            const next = new Set(previous);
            if (held !== undefined) next.add(nodeId);
            else next.delete(nodeId);
            return next;
        });
        const isOver = held !== undefined && isStudyCommentOverLimit(held.text);
        setOverLimitCommentIds((previous) => {
            if (previous.has(nodeId) === isOver) return previous;
            const next = new Set(previous);
            if (isOver) next.add(nodeId);
            else next.delete(nodeId);
            return next;
        });
        onCommentDraftChange?.(nodeId, change);
    };
    const changeCommentConflict = (nodeId: string, conflicted: boolean): void => {
        setConflictCommentIds((previous) => {
            if (previous.has(nodeId) === conflicted) return previous;
            const next = new Set(previous);
            if (conflicted) next.add(nodeId);
            else next.delete(nodeId);
            return next;
        });
    };
    // 棋譜に付ける「未保存」の印（選択待ちの書きかけと、長すぎて保存できない書きかけ）。
    const unsavedComments = new Map<string, "over_limit" | "conflict">();
    for (const nodeId of overLimitCommentIds) unsavedComments.set(nodeId, "over_limit");
    for (const nodeId of conflictCommentIds) unsavedComments.set(nodeId, "conflict");
    const cancelAnalysis = (): void => {
        void analysis.cancel();
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
    const onSquareSelect = (square: string, shiftKey?: boolean): void => {
        void handleSquareSelect(square, shiftKey);
    };
    const onHandSelect = (piece: PieceType): void => handleHandSelect(piece);
    const lastMove = lastMoveOf(currentNode.usiMove);
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
    const commentNeedsAttention = unsavedComments.has(currentNodeId);
    // 開いて見せたら、開いたままにする（対応が済んだ瞬間に、入力中の欄が閉じてしまわないように）。
    if (commentNeedsAttention && !isCommentOpen) setIsCommentOpen(true);
    const showsComment = isCommentOpen || commentNeedsAttention;
    // 保存できていない書きかけ（保存を待っている・保存に失敗した、など）がこの手にあるか。
    const hasCommentDraft = draftCommentIds.has(currentNodeId);
    const settingsButtonLabel =
        doc.layers.length > 1 && displayLayer ? displayLayer.display.label : null;
    // スマートフォンでは、未解析のあいだ「全体を解析」を盤と移動ボタンのすぐ下（切り替えタブの
    // 上）に、通常の流れとして出す。画面の下端に固定・貼り付けはしない（貼り付くのは画面が低くて
    // 入りきらないときだけで、そのときは必ず移動ボタンや盤に重なってしまうため）。
    const showsFixedStart = isMobile && needsFullAnalysis && analysis.mode === null;

    const boardStatus = (
        <div className="flex w-full items-center justify-between gap-2">
            <output className="flex min-w-0 items-baseline gap-2">
                <span className="truncate text-sm font-semibold text-wafuu-sumi">{moveTitle}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                    {position.turn === "sente" ? "☗先手番" : "☖後手番"}
                </span>
            </output>
            <div className="flex shrink-0 items-center gap-1">
                <StudyIconButton
                    label={storedNode?.bookmarked ? "しおりを外す" : "この手にしおりを付ける"}
                    pressed={storedNode?.bookmarked ?? false}
                    onClick={toggleBookmark}
                >
                    <BookmarkIcon
                        filled={storedNode?.bookmarked ?? false}
                        className={storedNode?.bookmarked ? "text-wafuu-kin" : undefined}
                    />
                </StudyIconButton>
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
                                hasCommentDraft && !showsComment
                                    ? "bg-status-warning"
                                    : "bg-wafuu-shu",
                            )}
                        />
                    )}
                </StudyIconButton>
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
    const navBar = (
        <NavBar
            index={currentIndex}
            total={line.length - 1}
            onToStart={goToStart}
            onBack={goBack}
            onForward={goForward}
            onToEnd={goToEnd}
        />
    );
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
        lastMove,
        selection,
        moveShadow,
        promotionSelection,
        displaySettings,
        isEditModeActive: false,
        isMatchRunning: false,
        // 持ち駒の枠は常に出す（駒を取った・打ったときに盤が上下に動かないように）。
        hideEmptyHandPieces: false,
        editFromSquare: null,
        candidateNote: null,
        onSquareSelect,
        onPromotionChoice: handlePromotionChoice,
        onHandSelect,
        topHand: handInfo("top"),
        bottomHand: handInfo("bottom"),
    };
    /** 盤を親の幅に合わせて描く（スマートフォンとタブレット）。 */
    const fluidBoard = (
        <MobileBoardSection
            {...boardProps}
            position={position}
            boardSectionRef={boardSectionRef}
            isDraggingPiece={false}
        />
    );

    const highlightsPanel = (
        <StudyHighlightsPanel
            tree={tree}
            highlights={highlights}
            bestMoveLabels={bestMoveLabels}
            currentNodeId={currentNodeId}
            analyzedCount={analyzedCount}
            totalCount={totalCount}
            settingsLabel={analysis.settingsLabel}
            fullTargetCount={analysis.fullTargetCount}
            displayLabel={displayLayer?.display.label ?? null}
            analysisMode={analysis.mode}
            isPreparing={analysis.isPreparing}
            progress={analysis.progress}
            onSelect={selectHighlight}
            onStartFull={startFull}
            onResume={resumeDisplayLayer}
            onCancel={cancelAnalysis}
            onOpenSettings={() => setIsSettingsOpen(true)}
            hideHeading={isMobile}
            hideStartButton={showsFixedStart}
            // 主役なので、PC では画面の高さに合わせて伸ばす（下に候補手の欄が見える分は残す）。
            // 幅広の画面では上限を列の側で決める。
            className={
                isMobile
                    ? "max-h-[70vh]"
                    : isWide
                      ? undefined
                      : "max-h-[max(17rem,calc(100dvh-24rem))]"
            }
        />
    );
    const graphPanel = (
        <section
            aria-label="評価値グラフ"
            className="flex flex-col gap-1 rounded-xl border border-wafuu-border bg-card px-3 py-2 shadow-sm"
        >
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <h2 className="font-display text-sm font-semibold text-wafuu-sumi">評価値グラフ</h2>
                <span className="text-xs text-muted-foreground">
                    {showsSourceGraph
                        ? "対局時の評価値（解析前）"
                        : hasResults
                          ? (displayLayer?.display.label ?? "")
                          : "解析すると、形勢の流れが出ます"}
                </span>
            </div>
            <EvalGraph
                compact
                evalHistory={graphHistory}
                currentPly={currentIndex}
                height={isMobile ? 64 : 72}
                minScale={GRAPH_MIN_SCALE}
                axisCap={GRAPH_AXIS_CAP}
                onPlySelect={(ply) => {
                    const nodeId = line[ply];
                    if (nodeId !== undefined) navigateTo(nodeId);
                }}
                markers={graphMarkers}
                onMarkerSelect={(marker) => {
                    const nodeId = line[marker.ply];
                    if (nodeId !== undefined) navigateTo(nodeId);
                }}
            />
        </section>
    );
    const moveList = (
        <StudyMoveList
            doc={doc}
            tree={tree}
            line={line}
            currentNodeId={currentNodeId}
            highlightKinds={highlightKinds}
            unsavedComments={unsavedComments}
            onSelect={(nodeId) => navigateTo(nodeId)}
            onBackToMainLine={backToMainLine}
            onPromoteToMainLine={promoteLineToMain}
            onRequestDeleteVariation={setDeleteTargetId}
            className={
                isMobile ? "max-h-[max(60vh,18rem)]" : "max-h-[26rem] xl:max-h-[calc(100dvh-9rem)]"
            }
        />
    );
    const candidatesPanel = (
        <StudyCandidatesPanel
            node={currentNode}
            positionResult={positionResult}
            alternative={alternative}
            playedBestLabel={
                currentKind && playedIsBest ? studyMoveLabel(tree, currentNodeId) : null
            }
            deeperResult={deeperResult}
            deeperIsFresh={deeperIsFresh}
            onShowLayer={onDisplayLayerChange}
            source={storedNode?.source ?? null}
            analysisMode={analysis.mode}
            isPreparing={analysis.isPreparing}
            liveDepth={analysis.live?.nodeId === currentNodeId ? analysis.live.depth : undefined}
            onStartDeep={startDeep}
            onCancel={cancelAnalysis}
            onPreviewPv={previewPv}
            onAddPvAsVariation={addPvAsVariation}
        />
    );
    const commentBox = (
        <StudyCommentBox
            key={currentNodeId}
            value={savedComment}
            onChange={(value) => changeComment(currentNodeId, value)}
            initialDraft={commentDrafts.get(currentNodeId)}
            onDraftChange={(change) => changeCommentDraft(currentNodeId, change)}
            onConflictChange={(conflicted) => changeCommentConflict(currentNodeId, conflicted)}
            disabled={locked}
            baseConfirmed={commentBaseConfirmed}
        />
    );

    // コメント欄は畳んでいる間も描いたままにする（書きかけの保存・別の画面の変更との突き合わせは、
    // 欄が動いていないと進まない）。
    // コメント欄は開いたときだけグラフの上に重ねる（開閉で画面が上下しない）。重ねている間、
    // 下のグラフは操作させない。
    const graphWithComment = (
        <div className="relative w-0 min-w-full">
            <div inert={showsComment}>{graphPanel}</div>
            <div
                id="study-comment"
                hidden={!showsComment}
                className="absolute inset-x-0 top-0 z-20 rounded-xl shadow-lg"
            >
                {commentBox}
            </div>
        </div>
    );
    const metaRow = (
        <div
            className={cn(
                "flex items-center gap-x-3 gap-y-1 px-1.5 text-xs text-muted-foreground",
                // 表題の行に入れるときは、長い出典で表題を潰さないよう幅に上限を置く。
                isWide ? "min-w-0 max-w-[55%]" : "flex-wrap",
            )}
        >
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

    const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
        const index = MOBILE_TABS.findIndex((tab) => tab.id === mobileTab);
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
        setMobileTab(MOBILE_TABS[next].id);
        document.getElementById(`study-tab-${MOBILE_TABS[next].id}`)?.focus();
    };

    const deleteTarget = deleteTargetId ? tree.nodes.get(deleteTargetId) : undefined;
    // 消す変化に、取り込んだ棋譜の手（対局時の情報つき）が含まれるか。本譜を入れ替えたあとは、
    // 元の対局の手順も変化として消せるので、確認の文面で知らせる。評価値も消費時間も付いて
    // いない棋譜（`source` が無い）では見分けられないので、知らせない。
    const deleteTargetHasSource = ((): boolean => {
        if (!deleteTargetId) return false;
        const stack = [deleteTargetId];
        while (stack.length > 0) {
            const id = stack.pop() as string;
            if (!Object.hasOwn(doc.tree.nodes, id)) continue;
            const stored = doc.tree.nodes[id];
            if (stored.source !== null) return true;
            stack.push(...stored.children);
        }
        return false;
    })();

    return (
        <TooltipProvider delayDuration={TOOLTIP_DELAY_DURATION_MS}>
            <div className="flex w-full max-w-[1320px] xl:max-w-[1600px] flex-col gap-2 self-center px-3 py-1.5 md:gap-3 md:px-4 md:py-3">
                <header className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                        <TitleInput
                            key={doc.title}
                            title={doc.title}
                            disabled={locked}
                            onCommit={(value) => void onApplyOps([{ type: "setTitle", value }])}
                        />
                        {isWide && metaRow}
                        <StudyMoreMenu
                            onOpenChange={setIsMoreMenuOpen}
                            onPass={locked ? undefined : () => void passFromCurrent()}
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
                        {settingsButtonLabel ? (
                            <button
                                type="button"
                                onClick={() => setIsSettingsOpen(true)}
                                aria-haspopup="dialog"
                                disabled={locked}
                                className="flex h-10 max-w-[45%] shrink-0 items-center gap-1.5 rounded-md border border-wafuu-border bg-background px-2 text-xs text-wafuu-sumi transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
                            >
                                <SettingsIcon />
                                <span className="sr-only">解析の設定:</span>
                                <span className="truncate">{settingsButtonLabel}</span>
                            </button>
                        ) : (
                            <StudyIconButton
                                label="解析の設定"
                                aria-haspopup="dialog"
                                disabled={locked}
                                onClick={() => setIsSettingsOpen(true)}
                            >
                                <SettingsIcon />
                            </StudyIconButton>
                        )}
                    </div>
                    {/* スマホでは、盤と操作を最初の画面に収めるため、この行は画面の下へ回す。 */}
                    {!isMobile && !isWide && metaRow}
                </header>

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
                <div inert={locked} className={cn("flex flex-col gap-3", locked && "opacity-70")}>
                    {isMobile ? (
                        <div className="flex flex-col gap-3">
                            <div className="flex flex-col items-center gap-1.5">
                                {boardStatus}
                                {fluidBoard}
                                {navBar}
                            </div>
                            {/* グラフは操作ボタンのすぐ下に置き、コメント欄は開いたときだけその上に重ねる
                                （PC と同じ。開閉で下の要素が上下しない）。 */}
                            {graphWithComment}
                            {showsFixedStart && !locked && (
                                <div className="flex flex-col">
                                    <Button
                                        type="button"
                                        size="lg"
                                        className="w-full gap-2"
                                        onClick={startFull}
                                        disabled={analysis.isPreparing}
                                    >
                                        <AnalyzeIcon />
                                        {analysis.fullTargetCount === 0
                                            ? "解析済みの結果を表示"
                                            : "全体を解析"}
                                    </Button>
                                </div>
                            )}
                            <div
                                role="tablist"
                                aria-label="表示の切り替え"
                                className="grid grid-cols-3 gap-1 rounded-lg border border-wafuu-border bg-wafuu-washi-warm p-1"
                            >
                                {MOBILE_TABS.map((tab) => (
                                    <button
                                        key={tab.id}
                                        id={`study-tab-${tab.id}`}
                                        type="button"
                                        role="tab"
                                        aria-selected={mobileTab === tab.id}
                                        aria-controls="study-tabpanel"
                                        tabIndex={mobileTab === tab.id ? 0 : -1}
                                        onClick={() => setMobileTab(tab.id)}
                                        onKeyDown={handleTabKeyDown}
                                        className={cn(
                                            "h-10 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                            mobileTab === tab.id
                                                ? "bg-card text-wafuu-shu shadow-sm"
                                                : "text-wafuu-sumi-light hover:text-wafuu-sumi",
                                        )}
                                    >
                                        {tab.label}
                                    </button>
                                ))}
                            </div>
                            <div
                                id="study-tabpanel"
                                role="tabpanel"
                                aria-labelledby={`study-tab-${mobileTab}`}
                                className="flex flex-col gap-3"
                            >
                                {mobileTab === "highlights" && highlightsPanel}
                                {mobileTab === "moves" && moveList}
                                {mobileTab === "candidates" && candidatesPanel}
                            </div>
                            {metaRow}
                        </div>
                    ) : isTablet ? (
                        // タブレットの縦持ち: 盤を小さくして左に置き、右に注目局面からの列を並べる。
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
                                {highlightsPanel}
                                {candidatesPanel}
                                {moveList}
                            </div>
                        </div>
                    ) : (
                        // 盤の大きさは対局画面（PlayPCLayout）と揃える: 高さは同じ式で決め、横は右の列の
                        // 幅（xl は 2 列で約 600px、lg は 1 列で約 330px）を残す分で抑える。盤と駒台の幅は
                        // マスのおよそ 11.2 倍 + 56px。この分岐は PC だけで描くので、xl 未満の値は画面幅の
                        // 条件を付けずに置く（lg の rem と isTablet の px が文字の大きさで食い違っても効くように）。
                        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3 [--shogi-cell-size:clamp(34px,min(calc((100dvh-300px)/9),calc((100vw-440px)/11.2)),72px)] xl:grid-cols-[auto_minmax(300px,1fr)_minmax(260px,300px)] xl:[--shogi-cell-size:clamp(34px,min(calc((100dvh-300px)/9),calc((min(100vw,1600px)-720px)/11.2)),72px)]">
                            <div
                                ref={boardSectionRef}
                                // 持ち駒は対局画面と同じく盤の左右に置く（盤の上下を詰めて 1 画面に収める）。
                                className={cn(
                                    "flex w-fit flex-col items-center gap-2",
                                    PLAY_HAND_ZONES,
                                )}
                            >
                                {boardStatus}
                                <PCBoardContent
                                    {...boardProps}
                                    // 縦の駒台は空でも枠の大きさが変わらないので、無い駒は出さない。
                                    hideEmptyHandPieces
                                    handSize="medium"
                                    handPlacement="sides"
                                />
                                {navBar}
                            </div>
                            {/* 右の列は画面の高さに収める。xl では注目局面の一覧を縮めて収め、それでも溢れる分
                                （xl 未満では棋譜の欄も入るので常に）は列の中で送る。送る列の端で欄の影やフォーカスの
                                枠が切れないよう、内側に余白を取って外側の余白で打ち消す。 */}
                            <div className="-m-1 flex min-w-0 flex-col gap-3 p-1 max-h-[calc(100dvh-10rem+0.5rem)] overflow-y-auto xl:max-h-[calc(100dvh-9rem+0.5rem)]">
                                <div className="shrink-0">{graphWithComment}</div>
                                <div
                                    className={cn(
                                        "flex min-h-0 shrink-0 flex-col",
                                        // 縮めてよいのは、一覧の中で送れるだけの件数があるときだけ。縮んでも
                                        // 4 件ほどは見せる（件数が少ないときに下限を付けると欄の中が空く）。
                                        highlights.length > 3 && "xl:min-h-[12rem] xl:shrink",
                                    )}
                                >
                                    {highlightsPanel}
                                </div>
                                <div className="shrink-0">{candidatesPanel}</div>
                                {!isWide && <div className="shrink-0">{moveList}</div>}
                            </div>
                            {isWide && <div className="min-w-0">{moveList}</div>}
                        </div>
                    )}
                </div>
            </div>

            <Notice message={message} onDismiss={() => onMessageChange(null)} />

            <StudyAnalysisSettings
                open={settingsOpen}
                onOpenChange={setIsSettingsOpen}
                isMobile={isMobile}
                doc={doc}
                displayLayerId={displayLayerId}
                onDisplayLayerChange={onDisplayLayerChange}
                form={analysis.form}
                settingsLabel={analysis.settingsLabel}
                canStart={!locked && analysis.mode === null && !analysis.isPreparing}
                onStartFull={startFull}
            />

            <AlertDialog
                open={deleteDialogTargetId !== null}
                onOpenChange={(open) => {
                    if (!open) setDeleteTargetId(null);
                }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>この変化を削除しますか？</AlertDialogTitle>
                        <AlertDialogDescription>
                            {deleteTarget && deleteTargetId
                                ? `${deleteTarget.ply}手目 ${studyMoveLabel(tree, deleteTargetId)} から先の ${studyVariationLength(tree, deleteTargetId)} 手（その先の枝分かれを含めて ${studySubtreeSize(tree, deleteTargetId)} 局面）と、その解析結果・コメント・しおりを削除します。${
                                      deleteTargetHasSource
                                          ? "取り込んだ棋譜の手（対局時の評価値など）も含まれます。"
                                          : ""
                                  }元に戻せません。`
                                : "変化と、その解析結果・コメント・しおりを削除します。"}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>やめる</AlertDialogCancel>
                        <AlertDialogAction onClick={confirmDeleteVariation}>
                            削除する
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

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
        // 切り替えない（評価値グラフと注目局面は全体の解析の結果のまま見せる）。
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
