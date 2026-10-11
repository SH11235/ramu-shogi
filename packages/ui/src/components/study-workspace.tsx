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
    computeStudyHighlights,
    isStudyUsiMove,
    type KifuTree,
    type LastMove,
    type PieceType,
    type Player,
    type PositionState,
    type Square,
    STUDY_LIMITS,
    type StudyDocument,
    type StudyHighlightKind,
    type StudyOp,
    studyChildNodeId,
    studyScoreToKifuEval,
} from "@shogi/app-core";
import { cn } from "@shogi/design-system";
import type { ReactElement, ReactNode } from "react";
import { useRef, useState } from "react";
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
import { EvalGraph, type EvalGraphMarker } from "./shogi-match/components/EvalGraph";
import { MatchNnueDownloadDialog } from "./shogi-match/components/MatchNnueDownloadDialog";
import { type HandInfo, MobileBoardSection } from "./shogi-match/components/MobileBoardSection";
import { PCBoardContent } from "./shogi-match/components/PCBoardContent";
import { PvPreviewDialog } from "./shogi-match/components/PvPreviewDialog";
import { TOOLTIP_DELAY_DURATION_MS } from "./shogi-match/constants";
import { useKifuKeyboardNavigation } from "./shogi-match/hooks/useKifuKeyboardNavigation";
import { useLocalStorage } from "./shogi-match/hooks/useLocalStorage";
import { useIsMobile } from "./shogi-match/hooks/useMediaQuery";
import { useMoveExecution } from "./shogi-match/hooks/useMoveExecution";
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
import { StudyHighlightsPanel } from "./study-workspace/StudyHighlightsPanel";
import { StudyIconButton } from "./study-workspace/StudyIconButton";
import {
    BookmarkIcon,
    FirstIcon,
    FlipIcon,
    LastIcon,
    NextIcon,
    PrevIcon,
    SettingsIcon,
} from "./study-workspace/StudyIcons";
import { StudyMoveList } from "./study-workspace/StudyMoveList";
import {
    StudySaveIndicator,
    StudySaveNotice,
    type StudyWorkspaceSaveStatus,
} from "./study-workspace/StudySaveStatus";
import {
    buildStudyViewTree,
    chooseStudyDisplayLayer,
    countStudyUnanalyzed,
    pickStudyPositionResult,
    resolveStudyLine,
    studyHighlightTitle,
    studyLineEvalHistory,
    studyLineSourceEvalHistory,
    studyMoveLabel,
    studyOriginLabel,
    studyPathTo,
    studyPlayersLabel,
} from "./study-workspace/studyView";
import {
    type StudyAnalysisController,
    type StudyEngineIdentity,
    useStudyAnalysis,
} from "./study-workspace/useStudyAnalysis";
import { TooltipProvider } from "./tooltip";

/** 既存の盤面と同じ表示設定（座標・最終手の強調・ホイール操作）を使う。 */
const DISPLAY_SETTINGS_KEY = "shogi-display-settings";

type FetchLegalMoves = (
    sfen: string,
    moves: string[],
    options?: { passRights?: { sente: number; gote: number } },
) => Promise<string[]>;

interface StudyWorkspaceCommonProps {
    /** 研究ノートの文書（画面の唯一の元データ）。 */
    doc: StudyDocument;
    /** 編集の操作。呼び出し側が文書に適用し、保存層へ流す。 */
    onApplyOps: (ops: StudyOp[]) => void;
    saveStatus: StudyWorkspaceSaveStatus;
    /** 止まっている送信をもう一度試す。 */
    onRetrySave?: () => void;
    /** ログインへ進む（未ログインのときの案内に使う）。 */
    onLogin?: () => void;
    /** このブラウザからノートを消す（他の端末で削除されたとき）。 */
    onDiscard?: () => void;
    /** 元の棋譜へのリンク。無ければ出どころの種別だけを出す。 */
    originLink?: ReactNode;
    /** 合法手の取得の差し替え（Desktop・テスト用）。省略時は共通の PositionService。 */
    fetchLegalMoves?: FetchLegalMoves;
}

interface StudyWorkspaceViewProps extends StudyWorkspaceCommonProps {
    /** `buildStudyViewTree(doc, displayLayerId)` の結果。 */
    tree: KifuTree;
    /** 開始局面から再生できず、表示できなかった枝の数。 */
    unrestoredCount?: number;
    /** 表示中の解析レイヤー。 */
    displayLayerId: string | null;
    onDisplayLayerChange: (layerId: string) => void;
    analysis: StudyAnalysisController;
    message: Message | null;
    onMessageChange: (message: Message | null) => void;
    /** 最初に開く局面（前回見ていた局面）。 */
    initialNodeId?: string | null;
    /** 見ている局面が変わった。 */
    onCurrentNodeChange?: (nodeId: string) => void;
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
    if (!usiMove || usiMove.length < 4) return undefined;
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
}: {
    title: string;
    onCommit: (title: string) => void;
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
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
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
    large,
}: {
    index: number;
    total: number;
    onToStart: () => void;
    onBack: () => void;
    onForward: () => void;
    onToEnd: () => void;
    /** スマートフォン向けに押しやすい大きさにする。 */
    large: boolean;
}): ReactElement {
    const size = large ? "h-10 w-12" : "h-8 w-9";
    const buttonClass = cn(size, "border-border bg-background text-wafuu-sumi");
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
    fetchLegalMoves,
    displayLayerId,
    onDisplayLayerChange,
    analysis,
    message,
    onMessageChange,
    initialNodeId,
    onCurrentNodeChange,
}: StudyWorkspaceViewProps): ReactElement {
    const isMobile = useIsMobile();
    const [storedDisplaySettings] = useLocalStorage<DisplaySettings>(
        DISPLAY_SETTINGS_KEY,
        DEFAULT_DISPLAY_SETTINGS,
    );
    const displaySettings = { ...DEFAULT_DISPLAY_SETTINGS, ...storedDisplaySettings };

    const [requestedNodeId, setRequestedNodeId] = useState<string>(
        () => initialNodeId ?? tree.rootId,
    );
    const [lineState, setLineState] = useState<string[]>([]);
    const [selection, setSelection] = useState<Selection | null>(null);
    const [promotionSelection, setPromotionSelection] = useState<PromotionSelection | null>(null);
    const [flipBoard, setFlipBoard] = useState(false);
    const [mobileTab, setMobileTab] = useState<MobileTab>("highlights");
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
    const [pvPreview, setPvPreview] = useState<{
        pv: string[];
        startPosition: PositionState;
        ply: number;
        evalCp?: number;
        evalMate?: number;
    } | null>(null);

    // 見ていた局面が（他の端末での削除などで）無くなっていたら、手順の上で残っている所まで戻る。
    const currentNodeId = ((): string => {
        if (tree.nodes.has(requestedNodeId)) return requestedNodeId;
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

    const navigateTo = (nodeId: string, options?: { resetLine?: boolean }): void => {
        setLineState(options?.resetLine ? [] : line);
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
                    text: `1 つのノートに入れられる局面は ${STUDY_LIMITS.nodesPerStudy} までです`,
                    type: "error",
                });
                return;
            }
            if (currentNode.ply + 1 > STUDY_LIMITS.lineLength) {
                onMessageChange({
                    text: `手順は ${STUDY_LIMITS.lineLength} 手までです`,
                    type: "error",
                });
                return;
            }
            onApplyOps([{ type: "addMoves", parentId: currentNodeId, moves: [usiMove] }]);
        }
        navigateTo(childId);
    };

    const { handleSquareSelect, handlePromotionChoice, handleHandSelect } = useMoveExecution({
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
        getPassRightsOption: () => ({}),
        updateClocksForNextTurn: noop,
        turnStartTimeRef,
        isEngineTurn: () => false,
        selection,
        setSelection,
        promotionSelection,
        setPromotionSelection,
        setLastMove: noop,
        setMessage: onMessageChange,
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
        disabled: pvPreview !== null || deleteTargetId !== null || isSettingsOpen,
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
    const positionResult = pickStudyPositionResult(doc, currentNodeId, displayLayerId);

    const graphMarkers: EvalGraphMarker[] = [];
    for (const highlight of highlights) {
        const index = line.indexOf(highlight.nodeId);
        if (index < 0) continue;
        const tone = highlight.kind ?? (highlight.bookmarked ? "bookmark" : null);
        if (!tone) continue;
        const kindText = tone === "blunder" ? "悪手" : tone === "dubious" ? "疑問手" : "しおり";
        graphMarkers.push({
            ply: index,
            tone,
            label: `${studyHighlightTitle(tree, highlight)}（${kindText}）`,
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
        onApplyOps([
            {
                type: "setBookmark",
                nodeId: currentNodeId,
                value: !(storedNode?.bookmarked ?? false),
            },
        ]);
    };
    const changeComment = (nodeId: string, value: string): void => {
        onApplyOps([{ type: "setComment", nodeId, value }]);
    };
    const addPvAsVariation = (pv: string[]): void => {
        const moves: string[] = [];
        let cursor = position;
        const room = Math.min(
            STUDY_LIMITS.lineLength - currentNode.ply,
            STUDY_LIMITS.nodesPerStudy - totalCount,
        );
        for (const move of pv) {
            if (moves.length >= room || !isStudyUsiMove(move)) break;
            const applied = applyMoveWithState(cursor, move, { validateTurn: false });
            if (!applied.ok) break;
            moves.push(move);
            cursor = applied.next;
        }
        if (moves.length === 0) {
            onMessageChange({ text: "この読み筋は変化として追加できません", type: "error" });
            return;
        }
        onApplyOps([{ type: "addMoves", parentId: currentNodeId, moves }]);
        navigateTo(studyChildNodeId(currentNodeId, moves[0]));
        onMessageChange({
            text: `読み筋を変化として追加しました（${moves.length} 手）`,
            type: "success",
        });
    };
    const previewPv = (request: StudyPvRequest): void => {
        const evalData = studyScoreToKifuEval(request.score);
        setPvPreview({
            pv: request.pv,
            startPosition: position,
            ply: currentNode.ply,
            evalCp: evalData?.scoreCp,
            evalMate: evalData?.scoreMate,
        });
    };
    const backToMainLine = (): void => {
        // 変化の中を見ていたら本譜から外れる直前の局面へ戻り、そこから先は本譜をたどる。
        let lastMainIndex = 0;
        for (let index = 1; index < line.length; index++) {
            if (tree.nodes.get(line[index - 1])?.children[0] !== line[index]) break;
            lastMainIndex = index;
        }
        navigateTo(currentIndex <= lastMainIndex ? currentNodeId : line[lastMainIndex], {
            resetLine: true,
        });
    };
    const confirmDeleteVariation = (): void => {
        const targetId = deleteTargetId;
        setDeleteTargetId(null);
        if (targetId === null) return;
        const target = tree.nodes.get(targetId);
        if (!target || target.parentId === null) return;
        // 消す変化の中を見ていたら、枝分かれの手前へ戻ってから消す。
        if (studyPathTo(tree, currentNodeId).includes(targetId)) {
            navigateTo(target.parentId, { resetLine: true });
        } else if (line.includes(targetId)) {
            setLineState([]);
        }
        onApplyOps([{ type: "deleteSubtree", nodeId: targetId }]);
    };
    const selectHighlight = (nodeId: string): void => {
        navigateTo(nodeId);
        // スマートフォンでは、移った先の局面の候補手をすぐ見られるようにする。
        if (isMobile) setMobileTab("candidates");
    };

    const startFull = (): void => {
        void analysis.startFull();
    };
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
    const playersLabel = studyPlayersLabel(doc.meta);
    const settingsButtonLabel =
        doc.layers.length > 1 && displayLayer ? displayLayer.display.label : null;

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
                    label="盤面を反転"
                    pressed={flipBoard}
                    onClick={() => setFlipBoard(!flipBoard)}
                >
                    <FlipIcon />
                </StudyIconButton>
            </div>
        </div>
    );
    const boardMessage = message ? (
        <p
            role={message.type === "error" ? "alert" : "status"}
            className={cn(
                "w-full whitespace-pre-line rounded-md px-2 py-1 text-xs",
                message.type === "error"
                    ? "bg-destructive/10 text-destructive"
                    : message.type === "warning"
                      ? "bg-status-warning-bg text-status-warning"
                      : "bg-status-success-bg text-status-success",
            )}
        >
            {message.text}
        </p>
    ) : null;
    const navBar = (
        <NavBar
            index={currentIndex}
            total={line.length - 1}
            onToStart={goToStart}
            onBack={goBack}
            onForward={goForward}
            onToEnd={goToEnd}
            large={isMobile}
        />
    );
    const boardProps = {
        grid,
        flipBoard,
        lastMove,
        selection,
        promotionSelection,
        displaySettings,
        isEditModeActive: false,
        isMatchRunning: false,
        // スマートフォンでは縦の余裕が無いので、持っていない駒の枠は出さない。
        hideEmptyHandPieces: isMobile,
        editFromSquare: null,
        candidateNote: null,
        onSquareSelect,
        onPromotionChoice: handlePromotionChoice,
        onHandSelect,
        topHand: handInfo("top"),
        bottomHand: handInfo("bottom"),
    };

    const highlightsPanel = (
        <StudyHighlightsPanel
            tree={tree}
            highlights={highlights}
            currentNodeId={currentNodeId}
            analyzedCount={analyzedCount}
            totalCount={totalCount}
            settingsLabel={analysis.settingsLabel}
            analysisMode={analysis.mode}
            isPreparing={analysis.isPreparing}
            progress={analysis.progress}
            onSelect={selectHighlight}
            onStartFull={startFull}
            onCancel={cancelAnalysis}
            hideHeading={isMobile}
            className={isMobile ? "max-h-[70vh]" : "max-h-[22rem]"}
        />
    );
    const graphPanel = (
        <section
            aria-label="評価値グラフ"
            className="flex flex-col gap-1.5 rounded-xl border border-wafuu-border bg-card p-3 shadow-sm"
        >
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <h2 className="font-display text-base font-semibold text-wafuu-sumi">
                    評価値グラフ
                </h2>
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
                height={isMobile ? 64 : 104}
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
            onSelect={(nodeId) => navigateTo(nodeId)}
            onBackToMainLine={backToMainLine}
            onRequestDeleteVariation={setDeleteTargetId}
            className={isMobile ? "max-h-[60vh]" : "max-h-[26rem] xl:max-h-[calc(100dvh-9rem)]"}
        />
    );
    const candidatesPanel = (
        <StudyCandidatesPanel
            node={currentNode}
            stored={storedNode}
            positionResult={positionResult}
            analysisMode={analysis.mode}
            isPreparing={analysis.isPreparing}
            liveDepth={analysis.live?.nodeId === currentNodeId ? analysis.live.depth : undefined}
            onStartDeep={() => void analysis.startDeep(currentNodeId)}
            onCancel={cancelAnalysis}
            onPreviewPv={previewPv}
            onAddPvAsVariation={addPvAsVariation}
            onCommentChange={(value) => changeComment(currentNodeId, value)}
        />
    );

    const deleteTarget = deleteTargetId ? tree.nodes.get(deleteTargetId) : undefined;

    return (
        <TooltipProvider delayDuration={TOOLTIP_DELAY_DURATION_MS}>
            <div className="mx-auto flex w-full max-w-[1320px] flex-col gap-3 px-3 py-3 md:px-4">
                <header className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                        <TitleInput
                            key={doc.title}
                            title={doc.title}
                            onCommit={(value) => onApplyOps([{ type: "setTitle", value }])}
                        />
                        {settingsButtonLabel ? (
                            <button
                                type="button"
                                onClick={() => setIsSettingsOpen(true)}
                                aria-haspopup="dialog"
                                className="flex h-8 max-w-[45%] shrink-0 items-center gap-1.5 rounded-md border border-wafuu-border bg-background px-2 text-xs text-wafuu-sumi transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                                <SettingsIcon />
                                <span className="sr-only">解析の設定:</span>
                                <span className="truncate">{settingsButtonLabel}</span>
                            </button>
                        ) : (
                            <StudyIconButton
                                label="解析の設定"
                                aria-haspopup="dialog"
                                onClick={() => setIsSettingsOpen(true)}
                            >
                                <SettingsIcon />
                            </StudyIconButton>
                        )}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1.5 text-xs text-muted-foreground">
                        {playersLabel && <span className="truncate">{playersLabel}</span>}
                        <span className="truncate">
                            {originLink ?? studyOriginLabel(doc.origin)}
                        </span>
                        <StudySaveIndicator
                            status={saveStatus}
                            onLogin={onLogin}
                            className="md:ml-auto"
                        />
                    </div>
                </header>

                <StudySaveNotice status={saveStatus} onRetry={onRetrySave} onDiscard={onDiscard} />

                {unrestoredCount > 0 && (
                    <output className="block rounded-lg border border-status-warning-border bg-status-warning-bg px-3 py-2 text-sm text-status-warning">
                        このノートには、盤面を再現できず表示していない変化が {unrestoredCount}{" "}
                        件あります（データは消していません）。
                    </output>
                )}

                {isMobile ? (
                    <div className="flex flex-col gap-3">
                        <div className="flex flex-col items-center gap-2">
                            {boardStatus}
                            <MobileBoardSection
                                {...boardProps}
                                position={position}
                                boardSectionRef={boardSectionRef}
                                isDraggingPiece={false}
                            />
                            {boardMessage}
                            {navBar}
                        </div>
                        <div
                            role="tablist"
                            aria-label="表示の切り替え"
                            className="grid grid-cols-3 gap-1 rounded-lg border border-wafuu-border bg-wafuu-washi-warm p-1"
                        >
                            {MOBILE_TABS.map((tab) => (
                                <button
                                    key={tab.id}
                                    type="button"
                                    role="tab"
                                    aria-selected={mobileTab === tab.id}
                                    onClick={() => setMobileTab(tab.id)}
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
                        <div role="tabpanel">
                            {mobileTab === "highlights" && highlightsPanel}
                            {mobileTab === "moves" && moveList}
                            {mobileTab === "candidates" && candidatesPanel}
                        </div>
                        {graphPanel}
                    </div>
                ) : (
                    <div className="grid items-start gap-3 md:grid-cols-[auto_minmax(0,1fr)] xl:grid-cols-[auto_minmax(280px,1fr)_350px]">
                        <div className="flex w-fit flex-col gap-3 md:row-span-2 xl:row-span-1">
                            <div
                                ref={boardSectionRef}
                                className="flex flex-col items-center gap-2 [--shogi-cell-size:44px]"
                            >
                                {boardStatus}
                                <PCBoardContent {...boardProps} />
                                {boardMessage}
                                {navBar}
                            </div>
                            {/* 候補手の読み筋の長さで左の列が広がらないよう、幅は盤に合わせる。 */}
                            <div className="w-0 min-w-full">{candidatesPanel}</div>
                        </div>
                        <div className="flex min-w-0 flex-col gap-3">
                            {highlightsPanel}
                            {graphPanel}
                        </div>
                        <div className="min-w-0 md:col-start-2 xl:col-start-3">{moveList}</div>
                    </div>
                )}
            </div>

            <StudyAnalysisSettings
                open={isSettingsOpen}
                onOpenChange={setIsSettingsOpen}
                isMobile={isMobile}
                doc={doc}
                displayLayerId={displayLayerId}
                onDisplayLayerChange={onDisplayLayerChange}
                form={analysis.form}
                settingsLabel={analysis.settingsLabel}
                canStart={analysis.mode === null && !analysis.isPreparing}
                onStartFull={startFull}
            />

            <AlertDialog
                open={deleteTargetId !== null}
                onOpenChange={(open) => {
                    if (!open) setDeleteTargetId(null);
                }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>この変化を削除しますか？</AlertDialogTitle>
                        <AlertDialogDescription>
                            {deleteTarget && deleteTargetId
                                ? `${deleteTarget.ply}手目 ${studyMoveLabel(tree, deleteTargetId)} からの変化と、その解析結果・コメント・しおりを削除します。元に戻せません。`
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
                />
            )}
        </TooltipProvider>
    );
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
}

/** ノートごとに覚えておく表示の状態。 */
export interface StudyWorkspaceViewState {
    /** 表示中の解析レイヤー。 */
    selectedLayerId: string | null;
    /** 見ていた局面（保存用の `nodeId`）。 */
    currentNodeId: string | null;
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
    ...viewProps
}: StudyWorkspaceProps): ReactElement {
    const [preferredLayerId, setPreferredLayerId] = useState<string | null>(
        initialView?.selectedLayerId ?? null,
    );
    const viewNodeIdRef = useRef<string | null>(initialView?.currentNodeId ?? null);
    const [message, setMessage] = useState<Message | null>(null);

    const displayLayerId = chooseStudyDisplayLayer(doc.layers, preferredLayerId);
    const { tree, unrestoredCount } = buildStudyViewTree(doc, displayLayerId);

    const changeDisplayLayer = (layerId: string): void => {
        setPreferredLayerId(layerId);
        onViewChange?.({ selectedLayerId: layerId, currentNodeId: viewNodeIdRef.current });
    };

    const { controller, download } = useStudyAnalysis({
        doc,
        tree,
        engineOptions,
        manifestUrl,
        engine,
        defaultNnuePresetKey,
        onApplyOps,
        onFlush,
        // 全体の解析を始めたら、その設定の結果を表示に切り替える。1 局面だけの深い解析では
        // 切り替えない（評価値グラフと注目局面は全体の解析の結果のまま見せる）。
        onLayerStarted: (layerId, mode) => {
            if (mode === "full") changeDisplayLayer(layerId);
        },
        setMessage,
    });

    return (
        <>
            <StudyWorkspaceView
                {...viewProps}
                doc={doc}
                tree={tree}
                unrestoredCount={unrestoredCount}
                onApplyOps={onApplyOps}
                displayLayerId={displayLayerId}
                onDisplayLayerChange={changeDisplayLayer}
                analysis={controller}
                message={message}
                onMessageChange={setMessage}
                initialNodeId={initialView?.currentNodeId ?? null}
                onCurrentNodeChange={(nodeId) => {
                    viewNodeIdRef.current = nodeId;
                    onViewChange?.({ selectedLayerId: displayLayerId, currentNodeId: nodeId });
                }}
            />
            <MatchNnueDownloadDialog state={download} purpose="analysis" />
        </>
    );
}
