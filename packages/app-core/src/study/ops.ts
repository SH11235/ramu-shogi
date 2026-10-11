/**
 * 研究ノートの操作（設計書 6.3）を文書に適用する純粋関数。
 *
 * サーバーと同じ規則で動くことが前提（ローカルの文書 = サーバーの文書 + 未送信の操作）。
 * - どの操作も同じ内容を 2 回適用して結果が変わらない（冪等）。
 * - 対象のノードやレイヤーが無い操作は、エラーにせず読み飛ばす。
 * - 入力として成り立たない操作（空の手順、USI の書式でない指し手、ルートの削除）は例外にする。
 * - 何も変わらなかったときは、渡された文書と同じ参照を返す。
 * - 上限（設計書 5.7）は判定しない。上限はサーバーが判定し、超えてもローカルの成果は残す。
 */

import { studyChildNodeId, studyLayerId } from "./ids";
import {
    STUDY_LIMITS,
    type StudyAnalysisResult,
    type StudyDocument,
    type StudyLayer,
    type StudyNode,
    type StudyOp,
    type StudySource,
} from "./types";
import { exceedsUtf8Bytes } from "./utf8";

/** 入力として成り立たない操作を適用しようとした。 */
export class StudyOpError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "StudyOpError";
    }
}

const USI_MOVE_PATTERN = /^(?:[1-9][a-i][1-9][a-i]\+?|[PLNSGBR]\*[1-9][a-i])$/;

/** USI の指し手の書式か（合法性は見ない）。 */
export function isStudyUsiMove(move: unknown): move is string {
    return typeof move === "string" && USI_MOVE_PATTERN.test(move);
}

/**
 * 読み筋を保存できる形にする: USI の書式でない手の手前で切り、上限の手数で切る。
 * 1 手も残らなければ空配列。
 */
export function sanitizeStudyPv(
    pv: readonly string[] | null | undefined,
    maxLength: number,
): string[] {
    const moves: string[] = [];
    for (const move of pv ?? []) {
        if (moves.length >= maxLength || !isStudyUsiMove(move)) break;
        moves.push(move);
    }
    return moves;
}

/**
 * 同じレイヤー・同じノードの解析結果の採用優先度（設計書 5.6）を比べる。
 *
 * 1. `completed` を `aborted` より優先  2. `depth` が深い方
 * 3. `nodes` が多い方（null は最小扱い）  4. `runId` の辞書順で大きい方
 *
 * @returns a が優先なら正、b が優先なら負、同じなら 0
 */
export function compareStudyAnalysisPriority(
    a: Pick<StudyAnalysisResult, "completion" | "depth" | "nodes" | "runId">,
    b: Pick<StudyAnalysisResult, "completion" | "depth" | "nodes" | "runId">,
): number {
    const completionRank = (value: StudyAnalysisResult["completion"]): number =>
        value === "completed" ? 1 : 0;
    const byCompletion = completionRank(a.completion) - completionRank(b.completion);
    if (byCompletion !== 0) return byCompletion;
    if (a.depth !== b.depth) return a.depth - b.depth;
    const nodesA = a.nodes ?? -1;
    const nodesB = b.nodes ?? -1;
    if (nodesA !== nodesB) return nodesA - nodesB;
    if (a.runId === b.runId) return 0;
    return a.runId > b.runId ? 1 : -1;
}

const sameStringArray = (a: readonly string[] | null, b: readonly string[] | null): boolean => {
    if (a === null || b === null) return a === b;
    return a.length === b.length && a.every((value, index) => value === b[index]);
};

const sameSource = (a: StudySource | null, b: StudySource | null): boolean => {
    if (a === null || b === null) return a === b;
    if (a.kind !== b.kind || a.elapsedMs !== b.elapsedMs || !sameStringArray(a.pv, b.pv)) {
        return false;
    }
    if (a.score === null || b.score === null) return a.score === b.score;
    if (a.score.kind === "cp") return b.score.kind === "cp" && a.score.value === b.score.value;
    return (
        b.score.kind === "mate" &&
        a.score.winner === b.score.winner &&
        a.score.plies === b.score.plies
    );
};

const hasNode = (doc: StudyDocument, nodeId: string): boolean =>
    Object.hasOwn(doc.tree.nodes, nodeId);

const withNode = (doc: StudyDocument, nodeId: string, node: StudyNode): StudyDocument => ({
    ...doc,
    tree: { ...doc.tree, nodes: { ...doc.tree.nodes, [nodeId]: node } },
});

function applyAddMoves(doc: StudyDocument, parentId: string, moves: readonly string[]) {
    if (!Array.isArray(moves) || moves.length === 0) {
        throw new StudyOpError("addMoves: 手順は 1 手以上必要です");
    }
    for (const move of moves) {
        if (!isStudyUsiMove(move)) {
            throw new StudyOpError(`addMoves: USI の指し手の書式ではありません: ${String(move)}`);
        }
    }
    if (!hasNode(doc, parentId)) return doc;

    let nodes: Record<string, StudyNode> | null = null;
    let currentId = parentId;
    for (const move of moves) {
        const current: StudyNode = (nodes ?? doc.tree.nodes)[currentId];
        const lookup: Record<string, StudyNode> = nodes ?? doc.tree.nodes;
        const existingId = current.children.find((childId) => lookup[childId]?.usiMove === move);
        if (existingId !== undefined) {
            // 既にある手は足さずにたどる。
            currentId = existingId;
            continue;
        }
        const childId = studyChildNodeId(currentId, move);
        nodes ??= { ...doc.tree.nodes };
        // 新しい兄弟は末尾に入る。
        nodes[currentId] = { ...current, children: [...current.children, childId] };
        nodes[childId] = {
            parentId: currentId,
            usiMove: move,
            children: [],
            comment: "",
            bookmarked: false,
            source: null,
        };
        currentId = childId;
    }
    return nodes ? { ...doc, tree: { ...doc.tree, nodes } } : doc;
}

function applyReorderChildren(doc: StudyDocument, parentId: string, value: readonly string[]) {
    if (!hasNode(doc, parentId)) return doc;
    const parent = doc.tree.nodes[parentId];
    // 現在の子の集合と一致しなければ読み飛ばす。
    if (value.length !== parent.children.length) return doc;
    const requested = new Set(value);
    if (requested.size !== value.length) return doc;
    if (!parent.children.every((childId) => requested.has(childId))) return doc;
    if (sameStringArray(parent.children, value)) return doc;
    return withNode(doc, parentId, { ...parent, children: [...value] });
}

function applyDeleteSubtree(doc: StudyDocument, nodeId: string) {
    if (nodeId === doc.tree.rootId) {
        throw new StudyOpError("deleteSubtree: ルートは削除できません");
    }
    if (!hasNode(doc, nodeId)) return doc;

    const removed = new Set<string>();
    const stack = [nodeId];
    while (stack.length > 0) {
        const id = stack.pop() as string;
        if (removed.has(id)) continue;
        removed.add(id);
        const node = doc.tree.nodes[id];
        if (node) stack.push(...node.children);
    }

    const nodes: Record<string, StudyNode> = {};
    for (const [id, node] of Object.entries(doc.tree.nodes)) {
        if (!removed.has(id)) nodes[id] = node;
    }
    const parentId = doc.tree.nodes[nodeId].parentId;
    if (parentId !== null && nodes[parentId]) {
        const parent = nodes[parentId];
        nodes[parentId] = {
            ...parent,
            children: parent.children.filter((childId) => childId !== nodeId),
        };
    }

    // 全レイヤーの配下の結果も消す。
    const layers = doc.layers.map((layer): StudyLayer => {
        if (!Object.keys(layer.results).some((id) => removed.has(id))) return layer;
        const results: Record<string, StudyAnalysisResult> = {};
        for (const [id, result] of Object.entries(layer.results)) {
            if (!removed.has(id)) results[id] = result;
        }
        return { ...layer, results };
    });

    return { ...doc, tree: { ...doc.tree, nodes }, layers };
}

function applyPutAnalysis(
    doc: StudyDocument,
    layerId: string,
    nodeId: string,
    result: StudyAnalysisResult,
) {
    if (!Array.isArray(result.candidates) || result.candidates.length === 0) {
        throw new StudyOpError("putAnalysis: 候補は 1 本以上必要です");
    }
    const layerIndex = doc.layers.findIndex((layer) => layer.id === layerId);
    if (layerIndex < 0 || !hasNode(doc, nodeId)) return doc;
    const layer = doc.layers[layerIndex];
    const existing = Object.hasOwn(layer.results, nodeId) ? layer.results[nodeId] : undefined;
    if (existing) {
        const priority = compareStudyAnalysisPriority(result, existing);
        // 既存より下なら既存を残す。同じ優先度（同じ探索の再送）も既存のままでよい。
        if (priority <= 0) return doc;
    }
    const layers = [...doc.layers];
    layers[layerIndex] = { ...layer, results: { ...layer.results, [nodeId]: result } };
    return { ...doc, layers };
}

/** 操作を 1 つ適用する。 */
export function applyStudyOp(doc: StudyDocument, op: StudyOp): StudyDocument {
    switch (op.type) {
        case "addMoves":
            return applyAddMoves(doc, op.parentId, op.moves);
        case "setComment": {
            if (!hasNode(doc, op.nodeId)) return doc;
            const node = doc.tree.nodes[op.nodeId];
            if (node.comment === op.value) return doc;
            return withNode(doc, op.nodeId, { ...node, comment: op.value });
        }
        case "setBookmark": {
            if (!hasNode(doc, op.nodeId)) return doc;
            const node = doc.tree.nodes[op.nodeId];
            if (node.bookmarked === op.value) return doc;
            return withNode(doc, op.nodeId, { ...node, bookmarked: op.value });
        }
        case "setSource": {
            if (!hasNode(doc, op.nodeId)) return doc;
            const node = doc.tree.nodes[op.nodeId];
            if (sameSource(node.source, op.value)) return doc;
            return withNode(doc, op.nodeId, { ...node, source: op.value });
        }
        case "reorderChildren":
            return applyReorderChildren(doc, op.parentId, op.value);
        case "deleteSubtree":
            return applyDeleteSubtree(doc, op.nodeId);
        case "ensureLayer": {
            const id = studyLayerId(op.spec);
            // あれば何もしない（表示名も変えない）。
            if (doc.layers.some((layer) => layer.id === id)) return doc;
            return {
                ...doc,
                layers: [...doc.layers, { id, spec: op.spec, display: op.display, results: {} }],
            };
        }
        case "putAnalysis":
            return applyPutAnalysis(doc, op.layerId, op.nodeId, op.result);
        case "deleteLayer": {
            if (!doc.layers.some((layer) => layer.id === op.layerId)) return doc;
            return { ...doc, layers: doc.layers.filter((layer) => layer.id !== op.layerId) };
        }
        case "setTitle":
            return doc.title === op.value ? doc : { ...doc, title: op.value };
        default: {
            const unknown: never = op;
            throw new StudyOpError(`未知の操作です: ${JSON.stringify(unknown)}`);
        }
    }
}

/** 操作を配列の順に適用する。 */
export function applyStudyOps(doc: StudyDocument, ops: readonly StudyOp[]): StudyDocument {
    let next = doc;
    for (const op of ops) {
        next = applyStudyOp(next, op);
    }
    return next;
}

/**
 * 統合先のコメントと手元のコメントを 1 つにする。どちらも失わない:
 * 片方が空なら空でない方、同じ内容なら 1 つ、違う内容なら統合先の後ろに改行 2 つで手元側を
 * つなぐ。つないだ結果が上限（UTF-8 で 4 KiB）を超えるなら統合先を残す。
 * 統合先の中に、手元のコメントの全体が行の区切りに沿って既に入っていれば足さない。
 */
export function mergeStudyComments(existing: string, incoming: string): string {
    if (incoming === "" || incoming === existing) return existing;
    if (existing === "") return incoming;
    // 統合先に、手元のコメントが「行のまとまり」として既に入っていれば、もう一度はつながない
    // （統合のやり直しで二重にしないため。やり直しまでのあいだに統合先へ追記があってもよい）。
    // 行の途中の部分一致では判定しない: 「詰みなし」に「詰み」は入っていないものとして扱う。
    const block = incoming.trim();
    if (block === "" || `\n${existing}\n`.includes(`\n${block}\n`)) return existing;
    const merged = `${existing}\n\n${incoming}`;
    return exceedsUtf8Bytes(merged, STUDY_LIMITS.commentBytes) ? existing : merged;
}

/**
 * 文書の中身を、別の文書の上に再現するための操作の列にする。
 *
 * 同じ元棋譜のノートが既にあると返されたとき（`ORIGIN_EXISTS`）、手元の成果を既存のノートに
 * 統合するのに使う。表題と兄弟の順序は相手側を尊重するので含めない。
 *
 * @param options.mergeInto 統合先の文書。渡すと、同じノードの両方にコメントがあって内容が
 *   違う場合に、統合先のコメントを消さず `mergeStudyComments` でつないだ値を設定する。
 */
export function studyDocumentToOps(
    doc: StudyDocument,
    options: { mergeInto?: StudyDocument } = {},
): StudyOp[] {
    const targetNodes = options.mergeInto?.tree.nodes;
    const ops: StudyOp[] = [];
    const { nodes, rootId } = doc.tree;

    // 葉までの手順を 1 本ずつ足す（途中のノードは「既にある手はたどる」規則で共有される）。
    const stack: Array<{ nodeId: string; moves: string[] }> = [{ nodeId: rootId, moves: [] }];
    const visited = new Set<string>();
    const ordered: string[] = [];
    while (stack.length > 0) {
        const item = stack.pop() as { nodeId: string; moves: string[] };
        if (visited.has(item.nodeId)) continue;
        visited.add(item.nodeId);
        ordered.push(item.nodeId);
        const node = nodes[item.nodeId];
        if (!node) continue;
        if (node.children.length === 0) {
            if (item.moves.length > 0) {
                ops.push({ type: "addMoves", parentId: rootId, moves: item.moves });
            }
            continue;
        }
        for (let i = node.children.length - 1; i >= 0; i--) {
            const childId = node.children[i];
            const child = nodes[childId];
            if (child?.usiMove) {
                stack.push({ nodeId: childId, moves: [...item.moves, child.usiMove] });
            }
        }
    }

    for (const nodeId of ordered) {
        const node = nodes[nodeId];
        if (!node) continue;
        if (node.comment !== "") {
            const existing =
                targetNodes && Object.hasOwn(targetNodes, nodeId)
                    ? targetNodes[nodeId].comment
                    : "";
            ops.push({
                type: "setComment",
                nodeId,
                value: mergeStudyComments(existing, node.comment),
            });
        }
        if (node.bookmarked) ops.push({ type: "setBookmark", nodeId, value: true });
        if (node.source !== null) ops.push({ type: "setSource", nodeId, value: node.source });
    }

    for (const layer of doc.layers) {
        ops.push({ type: "ensureLayer", spec: layer.spec, display: layer.display });
        for (const nodeId of ordered) {
            if (Object.hasOwn(layer.results, nodeId)) {
                ops.push({
                    type: "putAnalysis",
                    layerId: layer.id,
                    nodeId,
                    result: layer.results[nodeId],
                });
            }
        }
    }

    return ops;
}
