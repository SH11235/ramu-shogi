import {
    applyMoveWithState,
    applyStudyMoveWithState,
    getPositionService,
    isStudyPassMove,
    isStudyUsiMove,
    type KifuTree,
    STUDY_LIMITS,
    STUDY_MAX_PASSES_PER_SIDE,
    STUDY_PASS_MOVE,
    type StudyDocument,
    type StudyOp,
    studyChildNodeId,
    studyLineFitsPassLimit,
    studyPassRightsForLine,
} from "@shogi/app-core";
import { useEffect, useRef } from "react";
import {
    type UseMoveExecutionReturn,
    useMoveExecution,
} from "../shogi-match/hooks/useMoveExecution";
import type { Message } from "../shogi-match/types";
import { LegalMoveCache } from "../shogi-match/utils/legalMoveCache";
import type { StudyPvRequest } from "./StudyCandidatesPanel";
import { studyPathTo } from "./studyView";
import type { StudyApplyOpsResult } from "./useStudyAnalysis";
import type { useStudyNodeNavigation } from "./useStudyNodeNavigation";

export type StudyFetchLegalMoves = (
    sfen: string,
    moves: string[],
    options?: { passRights?: { sente: number; gote: number } },
) => Promise<string[]>;

const noop = (): void => {};

/**
 * 手順を足す編集（盤での指し手・パス・読み筋を変化として追加）と、見ている手順を本譜にする編集。
 * 盤上の操作は既存の検討モードと同じフックを、検討モードとして使う。
 */
export function useStudyMoveEditing({
    doc,
    tree,
    nav,
    locked,
    fetchLegalMoves,
    onApplyOps,
    onMessageChange,
}: {
    doc: StudyDocument;
    tree: KifuTree;
    nav: ReturnType<typeof useStudyNodeNavigation>;
    locked: boolean;
    fetchLegalMoves: StudyFetchLegalMoves | undefined;
    onApplyOps: (ops: StudyOp[]) => StudyApplyOpsResult;
    onMessageChange: (message: Message | null) => void;
}) {
    const { currentNodeId, currentNode, movesToCurrent, line, navigateTo, trackAddedNodes } = nav;
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

    const board: UseMoveExecutionReturn = useMoveExecution({
        position: currentNode.positionAfter,
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
        selection: nav.selection,
        setSelection: nav.setSelection,
        promotionSelection: nav.promotionSelection,
        setPromotionSelection: nav.setPromotionSelection,
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

    const addPvAsVariation = (request: StudyPvRequest): void => {
        const baseNode = tree.nodes.get(request.nodeId);
        if (!baseNode) return;
        const moves: string[] = [];
        let cursor = baseNode.positionAfter;
        const room = Math.min(
            STUDY_LIMITS.lineLength - baseNode.ply,
            STUDY_LIMITS.nodesPerStudy - Object.keys(doc.tree.nodes).length,
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

    return {
        /** 盤・持ち駒の操作（`useMoveExecution` の結果）。 */
        board,
        passFromCurrent,
        addPvAsVariation,
        promoteLineToMain,
    };
}
