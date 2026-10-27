import {
    computeStudyHighlights,
    type KifuTree,
    type StudyDocument,
    type StudyHighlightKind,
} from "@shogi/app-core";
import {
    countStudyUnanalyzed,
    pickStudyDeeperResult,
    pickStudyPositionResult,
    studyBestCandidate,
    studyDeeperLayerIds,
    studyMoveLabel,
} from "./studyView";

/**
 * 表示中の解析の設定から読み取る、ノート全体の悪手・疑問手の印・解析の済み具合と、いまの局面の
 * 候補手・「この手の代わりに」・より深く読んだ結果。
 *
 * 候補手・「この手の代わりに」・悪手と疑問手の印は、どれも表示中の設定の結果から出す
 * （欄によって別の設定の結果が混ざると、行とパネルで手や評価値が食い違う）。
 */
export function deriveStudyPositionInsights({
    doc,
    tree,
    currentNodeId,
    displayLayerId,
    deepNodeId,
    deepLayerId,
}: {
    doc: StudyDocument;
    tree: KifuTree;
    currentNodeId: string;
    displayLayerId: string | null;
    /** 「この局面を深く解析」を押した局面。 */
    deepNodeId: string | null;
    /** 直近の「この局面を深く解析」で使った解析の設定（レイヤー）。 */
    deepLayerId: string | null;
}) {
    // 同じ AI でより深く読んだ結果があれば、悪手・疑問手はそれで判定し直す。
    const highlights = computeStudyHighlights(doc, displayLayerId, {
        deeperLayerIds: studyDeeperLayerIds(doc, displayLayerId),
    });
    const highlightKinds = new Map<string, StudyHighlightKind>();
    /** 深く読んで、悪手・疑問手ではなかったと分かった手（元の判定）。 */
    const clearedKinds = new Map<string, StudyHighlightKind>();
    for (const highlight of highlights) {
        if (highlight.kind) highlightKinds.set(highlight.nodeId, highlight.kind);
        else if (highlight.revisedFrom) clearedKinds.set(highlight.nodeId, highlight.revisedFrom);
    }
    const currentHighlight = highlights.find((highlight) => highlight.nodeId === currentNodeId);
    const displayLayer = doc.layers.find((layer) => layer.id === displayLayerId);
    const totalCount = Object.keys(doc.tree.nodes).length;
    const unanalyzedCount = countStudyUnanalyzed(doc, displayLayerId);
    const analyzedCount = displayLayer === undefined ? 0 : totalCount - unanalyzedCount;
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

    // いま見ている手が悪手・疑問手なら、1 手前の局面の候補手（代わりに指すべきだった手）を出す。
    const currentNode = tree.nodes.get(currentNodeId);
    const currentKind = highlightKinds.get(currentNodeId);
    const parentNode = currentNode?.parentId ? tree.nodes.get(currentNode.parentId) : undefined;
    const parentResult =
        currentKind && parentNode
            ? pickStudyPositionResult(doc, parentNode.id, displayLayerId)
            : null;
    // 指した手が 1 手前の局面の 1 位の候補と同じなら、代わりの手は無い（判定は相手の応手のあとの
    // 評価値との落差なので、1 位の手でも悪手・疑問手になることがある）。
    const playedIsBest =
        parentResult !== null &&
        studyBestCandidate(parentResult.result)?.pv[0] === currentNode?.usiMove;
    const alternative =
        currentKind && parentNode && parentResult && !playedIsBest
            ? {
                  node: parentNode,
                  result: parentResult,
                  playedLabel: studyMoveLabel(tree, currentNodeId),
                  kindLabel: currentKind === "blunder" ? "悪手" : "疑問手",
              }
            : null;

    return {
        highlights,
        highlightKinds,
        clearedKinds,
        /** 深く読んで判定が変わったとき、その前後。 */
        revision:
            currentHighlight?.revisedFrom !== undefined
                ? { from: currentHighlight.revisedFrom, to: currentHighlight.kind }
                : null,
        displayLayer,
        totalCount,
        unanalyzedCount,
        analyzedCount,
        positionResult,
        deeperResult,
        deeperIsFresh,
        alternative,
        /** 悪手・疑問手と判定した手が、1 手前の局面の 1 位の候補と同じだったときの、その手の表記。 */
        playedBestLabel: currentKind && playedIsBest ? studyMoveLabel(tree, currentNodeId) : null,
    };
}
