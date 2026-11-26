import {
    computeStudyHighlights,
    type StudyDocument,
    type StudyHighlightKind,
} from "@shogi/app-core";
import {
    countStudyUnanalyzed,
    isSameStudyAi,
    pickStudyDeeperResult,
    pickStudyDeepestResult,
    pickStudyPositionResult,
    type StudyPositionResult,
    studyDeeperLayerIds,
} from "./studyView";

/**
 * 表示中の解析の設定から読み取る、ノート全体の悪手・疑問手の印・解析の済み具合と、いまの局面の
 * 候補手・より深く読んだ結果。
 */
export function deriveStudyPositionInsights({
    doc,
    currentNodeId,
    displayLayerId,
    deepRead,
}: {
    doc: StudyDocument;
    currentNodeId: string;
    displayLayerId: string | null;
    /** 1 局面の読みで、直近に結果を書いた局面と設定。 */
    deepRead: StudyDeepReadRef | null;
}) {
    // 同じ AI でより深く読んだ結果があれば、悪手・疑問手はそれで判定し直す。
    const highlights = computeStudyHighlights(doc, displayLayerId, {
        deeperLayerIds: studyDeeperLayerIds(doc, displayLayerId),
    });
    const highlightKinds = new Map<string, StudyHighlightKind>();
    for (const highlight of highlights) {
        if (highlight.kind) highlightKinds.set(highlight.nodeId, highlight.kind);
    }
    const displayLayer = doc.layers.find((layer) => layer.id === displayLayerId);
    const totalCount = Object.keys(doc.tree.nodes).length;
    const unanalyzedCount = countStudyUnanalyzed(doc, displayLayerId);
    const analyzedCount = displayLayer === undefined ? 0 : totalCount - unanalyzedCount;
    const positionResult = pickStudyPositionResult(doc, currentNodeId, displayLayerId);

    // 候補手の一覧は局面の帯と同じ結果にする（帯と欄で別の値が出ないように）。表示中の設定の結果と
    // 違うものを選んだときは、それを深く読んだ結果として出し、表示中の設定の結果は 1 行で添える。
    const picked = pickStudyBandResult({
        doc,
        nodeId: currentNodeId,
        displayLayerId,
        deepRead,
    });
    const deeperResult =
        picked !== null && picked.layer.id !== positionResult?.layer.id ? picked : null;

    return {
        highlights,
        highlightKinds,
        displayLayer,
        totalCount,
        unanalyzedCount,
        analyzedCount,
        positionResult,
        deeperResult,
    };
}

/** 1 局面の読みで、直近に結果を書いた局面と設定（レイヤー）。 */
export interface StudyDeepReadRef {
    nodeId: string;
    layerId: string;
}

/**
 * 局面の帯と候補手の欄に出す保存済みの読み（読んでいる途中でなければ、この値を出す）。表示中の設定と、
 * 同じ AI で探索の上限だけ大きい設定の中から、いちばん深く読めたものを選ぶ（AI が違うと深さは比べられ
 * ないので、別の AI の結果は深くても選ばない）。ただし、この局面を直前に別の AI で読んで結果を書いたら、
 * その結果を出す（読んだのに結果が見当たらない、にならないように）。深さが同じなら直前の読み、
 * 表示中の設定、同じ AI で深く読んだ設定の順に採る。
 * 評価値グラフの線と別の AI の丸も、局面ごとにこれで選ぶ（帯の値とグラフが食い違わないように）。
 */
export function pickStudyBandResult({
    doc,
    nodeId,
    displayLayerId,
    deepRead,
}: {
    doc: StudyDocument;
    nodeId: string;
    displayLayerId: string | null;
    deepRead: StudyDeepReadRef | null;
}): StudyPositionResult | null {
    const freshLayer =
        deepRead !== null && deepRead.nodeId === nodeId && deepRead.layerId !== displayLayerId
            ? doc.layers.find((layer) => layer.id === deepRead.layerId)
            : undefined;
    const fresh =
        freshLayer && Object.hasOwn(freshLayer.results, nodeId)
            ? { layer: freshLayer, result: freshLayer.results[nodeId] }
            : null;
    const display = doc.layers.find((layer) => layer.id === displayLayerId);
    if (fresh && (!display || !isSameStudyAi(fresh.layer, display))) return fresh;
    return pickStudyDeepestResult([
        fresh,
        pickStudyPositionResult(doc, nodeId, displayLayerId),
        pickStudyDeeperResult(doc, nodeId, displayLayerId),
    ]);
}
