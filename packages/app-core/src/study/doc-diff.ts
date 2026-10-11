/**
 * 2 つの研究ノート文書の差分を、操作の列にする。
 *
 * サーバーに操作を拒否された（上限超過・入力不正）あとの復帰に使う: サーバーの最新の文書と
 * ローカルの文書の差分から送信待ちを作り直すと、拒否された操作の列を引きずらずに、
 * 「いまのローカルの状態」だけを送れる。
 */

import type { StudyDocument, StudyNode, StudyOp } from "./types";

const EMPTY_NODE: Pick<StudyNode, "comment" | "bookmarked" | "source"> = {
    comment: "",
    bookmarked: false,
    source: null,
};

const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * `from` に適用すると `to` と同じ中身になる操作の列を返す。
 *
 * - ツリー: 消えた枝は `deleteSubtree`、増えたノードは `addMoves`、兄弟の順序、コメント・しおり・
 *   対局時の評価値。
 * - 表題。
 * - レイヤー: 消えたレイヤーは `deleteLayer`、増えたレイヤーは `ensureLayer`、`to` の結果のうち
 *   `from` と違うものは `putAnalysis`（採用優先度で `from` 側が勝つ結果は、適用しても変わらない）。
 *
 * `to` に無い個別の解析結果を消す操作は無いので、それは差分に含まれない。
 */
export function diffStudyDocuments(from: StudyDocument, to: StudyDocument): StudyOp[] {
    const ops: StudyOp[] = [];
    const fromNodes = from.tree.nodes;
    const toNodes = to.tree.nodes;
    const has = (nodes: Record<string, StudyNode>, id: string): boolean => Object.hasOwn(nodes, id);

    // 消えた枝（親が残っている一番上のノードだけ。配下は一緒に消える）。
    for (const [nodeId, node] of Object.entries(fromNodes)) {
        if (node.parentId === null || has(toNodes, nodeId)) continue;
        if (has(toNodes, node.parentId)) ops.push({ type: "deleteSubtree", nodeId });
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

    // 増えたノード。
    for (const nodeId of ordered) {
        const node = toNodes[nodeId];
        if (node.parentId === null || node.usiMove === null || has(fromNodes, nodeId)) continue;
        ops.push({ type: "addMoves", parentId: node.parentId, moves: [node.usiMove] });
    }

    // 兄弟の順序と、ノードの属性。
    for (const nodeId of ordered) {
        const node = toNodes[nodeId];
        const before = has(fromNodes, nodeId) ? fromNodes[nodeId] : undefined;
        if (node.children.length > 1) {
            // 上の削除と追加を適用したあとの並び: 残った子のあとに、増えた子が追加した順で並ぶ。
            const kept = (before?.children ?? []).filter((id) => node.children.includes(id));
            const added = node.children.filter((id) => !kept.includes(id));
            const expected = [...kept, ...added];
            if (node.children.some((id, index) => id !== expected[index])) {
                ops.push({ type: "reorderChildren", parentId: nodeId, value: [...node.children] });
            }
        }
        const base = before ?? EMPTY_NODE;
        if (node.comment !== base.comment) {
            ops.push({ type: "setComment", nodeId, value: node.comment });
        }
        if (node.bookmarked !== base.bookmarked) {
            ops.push({ type: "setBookmark", nodeId, value: node.bookmarked });
        }
        if (!sameJson(node.source, base.source)) {
            ops.push({ type: "setSource", nodeId, value: node.source });
        }
    }

    if (to.title !== from.title) ops.push({ type: "setTitle", value: to.title });

    for (const layer of from.layers) {
        if (!to.layers.some((item) => item.id === layer.id)) {
            ops.push({ type: "deleteLayer", layerId: layer.id });
        }
    }
    for (const layer of to.layers) {
        const before = from.layers.find((item) => item.id === layer.id);
        if (!before) ops.push({ type: "ensureLayer", spec: layer.spec, display: layer.display });
        for (const nodeId of ordered) {
            if (!Object.hasOwn(layer.results, nodeId)) continue;
            const result = layer.results[nodeId];
            const previous =
                before && Object.hasOwn(before.results, nodeId) ? before.results[nodeId] : null;
            if (previous === null || !sameJson(previous, result)) {
                ops.push({ type: "putAnalysis", layerId: layer.id, nodeId, result });
            }
        }
    }

    return ops;
}
