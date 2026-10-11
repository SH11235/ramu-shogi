/**
 * 2 つの研究ノート文書の差分を、操作の列にする。
 *
 * サーバーに操作を拒否された（上限超過・入力不正）あとの復帰や、作成のあとにレイヤーと結果を
 * 送るのに使う。拒否された操作の列を引きずらずに、「いまの文書の状態」だけを送れる。
 */

import type { StudyAnalysisResult, StudyDocument, StudyNode, StudyOp } from "./types";
import { utf8ByteLength } from "./utf8";

const EMPTY_NODE: Pick<StudyNode, "comment" | "bookmarked" | "source"> = {
    comment: "",
    bookmarked: false,
    source: null,
};

/** 保存される JSON にしたときの大きさ（UTF-8 のバイト数）。 */
const jsonLength = (value: unknown): number => utf8ByteLength(JSON.stringify(value));

/**
 * `from` に適用すると `to` と同じ中身になる操作の列を返す。
 *
 * - ツリー: 消えた枝は `deleteSubtree`、増えたノードは `addMoves`、兄弟の順序、コメント・しおり・
 *   対局時の評価値。
 * - 表題。
 * - レイヤー: 消えたレイヤーは `deleteLayer`、増えたレイヤーは `ensureLayer`、`to` の結果のうち
 *   `from` と違うものは `putAnalysis`（採用優先度で `from` 側が勝つ結果は、適用しても変わらない）。
 *
 * 操作は「小さくする操作が先、大きくする操作が後」の順に並べる。操作の列は途中で切って
 * 何回かに分けて送られ、サーバーは 1 回ごとに大きさ・件数の上限を確かめる。この順なら、
 * `from` と `to` がどちらも上限内であれば、途中のどの時点も上限を超えない
 * （文書の大きさは、まず減り、そのあと `to` の大きさまで増えるだけになる）。
 *
 * `to` に無い個別の解析結果を消す操作は無いので、それは差分に含まれない。
 */
export function diffStudyDocuments(from: StudyDocument, to: StudyDocument): StudyOp[] {
    const fromNodes = from.tree.nodes;
    const toNodes = to.tree.nodes;
    const has = (nodes: Record<string, StudyNode>, id: string): boolean => Object.hasOwn(nodes, id);

    /** 小さくする（か、大きさを変えない）操作。先に送る。 */
    const shrinking: StudyOp[] = [];
    /** 大きくする操作。後に送る。 */
    const growing: StudyOp[] = [];

    // 消えた枝（親が残っている一番上のノードだけ。配下は一緒に消える）。
    for (const [nodeId, node] of Object.entries(fromNodes)) {
        if (node.parentId === null || has(toNodes, nodeId)) continue;
        if (has(toNodes, node.parentId)) shrinking.push({ type: "deleteSubtree", nodeId });
    }
    // 消えたレイヤー。
    for (const layer of from.layers) {
        if (!to.layers.some((item) => item.id === layer.id)) {
            shrinking.push({ type: "deleteLayer", layerId: layer.id });
        }
    }

    // `to` を根から葉へたどる（親が先）。
    const ordered: string[] = [];
    const stack: string[] = [to.tree.rootId];
    const visited = new Set<string>();
    while (stack.length > 0) {
        const nodeId = stack.pop() as string;
        if (visited.has(nodeId) || !has(toNodes, nodeId)) continue;
        visited.add(nodeId);
        ordered.push(nodeId);
        const { children } = toNodes[nodeId];
        for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
    }

    // 既にあるノードの属性のうち、短くなる（か同じ長さの）ものは先に、長くなるものは後に。
    // 増えたノードの属性は、ノードを足したあとにしか設定できないので後に回す。
    const attributeGrowth: StudyOp[] = [];
    for (const nodeId of ordered) {
        const node = toNodes[nodeId];
        const existed = has(fromNodes, nodeId);
        const base = existed ? fromNodes[nodeId] : EMPTY_NODE;
        const push = (op: StudyOp, shrinks: boolean): void => {
            (existed && shrinks ? shrinking : attributeGrowth).push(op);
        };
        if (node.comment !== base.comment) {
            push(
                { type: "setComment", nodeId, value: node.comment },
                jsonLength(node.comment) <= jsonLength(base.comment),
            );
        }
        if (node.bookmarked !== base.bookmarked) {
            // JSON では true の方が false より短い。
            push({ type: "setBookmark", nodeId, value: node.bookmarked }, node.bookmarked);
        }
        if (!sameJson(node.source, base.source)) {
            push(
                { type: "setSource", nodeId, value: node.source },
                jsonLength(node.source) <= jsonLength(base.source),
            );
        }
    }
    const titleShrinks = jsonLength(to.title) <= jsonLength(from.title);
    if (to.title !== from.title && titleShrinks) {
        shrinking.push({ type: "setTitle", value: to.title });
    }

    // 増えたノード。
    for (const nodeId of ordered) {
        const node = toNodes[nodeId];
        if (node.parentId === null || node.usiMove === null || has(fromNodes, nodeId)) continue;
        growing.push({ type: "addMoves", parentId: node.parentId, moves: [node.usiMove] });
    }
    // 兄弟の順序（大きさは変わらない。増えた子が揃ってから）。
    for (const nodeId of ordered) {
        const node = toNodes[nodeId];
        if (node.children.length <= 1) continue;
        const before = has(fromNodes, nodeId) ? fromNodes[nodeId] : undefined;
        // 上の削除と追加を適用したあとの並び: 残った子のあとに、増えた子が追加した順で並ぶ。
        const kept = (before?.children ?? []).filter((id) => node.children.includes(id));
        const added = node.children.filter((id) => !kept.includes(id));
        const expected = [...kept, ...added];
        if (node.children.some((id, index) => id !== expected[index])) {
            growing.push({ type: "reorderChildren", parentId: nodeId, value: [...node.children] });
        }
    }
    growing.push(...attributeGrowth);
    if (to.title !== from.title && !titleShrinks) {
        growing.push({ type: "setTitle", value: to.title });
    }

    // レイヤーと結果。置き換えで短くなる結果は先に、新しい結果・長くなる結果は後に。
    const laterResults: StudyOp[] = [];
    for (const layer of to.layers) {
        const before = from.layers.find((item) => item.id === layer.id);
        const layerGrowth: StudyOp[] = [];
        for (const nodeId of ordered) {
            if (!Object.hasOwn(layer.results, nodeId)) continue;
            const result = layer.results[nodeId];
            const previous: StudyAnalysisResult | null =
                before && Object.hasOwn(before.results, nodeId) ? before.results[nodeId] : null;
            if (previous !== null && sameJson(previous, result)) continue;
            const op: StudyOp = { type: "putAnalysis", layerId: layer.id, nodeId, result };
            if (previous !== null && jsonLength(result) <= jsonLength(previous)) shrinking.push(op);
            else layerGrowth.push(op);
        }
        if (!before) {
            laterResults.push({ type: "ensureLayer", spec: layer.spec, display: layer.display });
        }
        laterResults.push(...layerGrowth);
    }
    growing.push(...laterResults);

    return [...shrinking, ...growing];
}

function sameJson(a: unknown, b: unknown): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}
