import { type KifuNode, type KifuTree, studyChildNodeId } from "@shogi/app-core";
import { useEffect, useRef, useState } from "react";
import type { Message, PromotionSelection, Selection } from "../shogi-match/types";
import { resolveStudyLine, studyMainLineIds, studyPathTo } from "./studyView";
import type { StudyApplyOpsResult } from "./useStudyAnalysis";

/**
 * 見ている局面と、表示中の手順（本譜・変化のどれをたどるか）。盤で選んでいる駒も、局面を移ると
 * 選び直しになるのでここで持つ。
 *
 * 見ていた局面が（他の端末での削除や、保存層の拒否で）文書から無くなったら、残っている所まで戻る。
 */
export function useStudyNodeNavigation({
    tree,
    initialNodeId,
    onCurrentNodeChange,
    onMessageChange,
    onLeave,
    locked,
}: {
    tree: KifuTree;
    initialNodeId: string | null | undefined;
    onCurrentNodeChange: ((nodeId: string) => void) | undefined;
    onMessageChange: (message: Message | null) => void;
    /** いまの局面から別の局面へ移る直前に、離れる局面を渡して呼ぶ。 */
    onLeave: (leaving: KifuNode) => void;
    /** 編集できない間は、盤で選んでいる駒を外す。 */
    locked: boolean;
}) {
    const [requestedNodeId, setRequestedNodeId] = useState<string>(
        () => initialNodeId ?? tree.rootId,
    );
    // 移る前に見ていた局面。足した手が保存層に拒否されて消えたとき、ここへ戻る。
    const [fallbackNodeId, setFallbackNodeId] = useState<string | null>(null);
    const [lineState, setLineState] = useState<string[]>([]);
    const [selection, setSelection] = useState<Selection | null>(null);
    const [promotionSelection, setPromotionSelection] = useState<PromotionSelection | null>(null);

    // 見ている局面までの経路（ルートから）。その局面が文書から消えたとき、残っている最も近い
    // 祖先（分岐点）へ移るのに使う。消えたあとではツリーからたどれないので、あるうちに覚えておく。
    const seenPathRef = useRef<string[]>([]);
    // この画面で足した手のうち、保存の結果がまだ分からないもの（保存層に拒否されて消えた手を、
    // 「別の画面で削除された」と取り違えないために覚えておく）。
    const unconfirmedAddsRef = useRef(new Set<string>());

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

    useEffect(() => {
        if (!locked) return;
        setSelection(null);
        setPromotionSelection(null);
    }, [locked]);

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
        if (nodeId !== currentNodeId) onLeave(currentNode);
        setLineState(options?.resetLine ? [] : line);
        setFallbackNodeId(currentNodeId);
        setRequestedNodeId(nodeId);
        setSelection(null);
        setPromotionSelection(null);
        onCurrentNodeChange?.(nodeId);
    };
    /** 表示中の手順の `ply` 番目（0 = 開始局面）の局面へ移る。 */
    const navigateToPly = (ply: number): void => {
        const nodeId = line[ply];
        if (nodeId !== undefined) navigateTo(nodeId);
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

    const mainLine = studyMainLineIds(tree);
    const onMainLine = line.every((nodeId) => mainLine.has(nodeId));
    const backToMainLine = (): void => {
        // 変化の中を見ていたら本譜から外れる直前の局面へ戻り、そこから先は本譜をたどる。
        let lastMainIndex = 0;
        for (let index = 1; index < line.length; index++) {
            if (!mainLine.has(line[index])) break;
            lastMainIndex = index;
        }
        navigateTo(currentIndex <= lastMainIndex ? currentNodeId : line[lastMainIndex], {
            resetLine: true,
        });
    };

    return {
        currentNodeId,
        currentNode,
        line,
        currentIndex,
        movesToCurrent,
        /** 変化（本譜から外れた手順）を見ていない。 */
        onMainLine,
        navigateTo,
        navigateToPly,
        goBack,
        goForward,
        goToStart,
        goToEnd,
        backToMainLine,
        /** 表示中の手順を、いまの局面から先は本譜をたどる形に戻す。 */
        resetLine: () => setLineState([]),
        trackAddedNodes,
        selection,
        setSelection,
        promotionSelection,
        setPromotionSelection,
    };
}
