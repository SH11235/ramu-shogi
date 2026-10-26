/**
 * 実行時の `KifuTree` と保存用の研究ノート文書の相互変換。
 *
 * - 実行時のノード ID（UUID など）と保存用の `nodeId`（手順で決まるハッシュ）の対応表を作る。
 * - 保存用の文書からは、盤面を開始局面から再生して `KifuTree` を復元する。
 * - どちらも `children[0]` が本譜。
 */

import { cloneBoard, type PositionState } from "../game/board";
import type { KifuEval, KifuNode, KifuTree } from "../game/kifu-tree";
import { normalizeStudyStartSfen, studyChildNodeId, studyRootNodeId } from "./ids";
import { isStudyUsiMove, sanitizeStudyPv } from "./ops";
import { applyStudyMoveWithState } from "./pass";
import { kifuEvalToStudyScore, studyScoreToKifuEval } from "./score";
import { parseStudySfen } from "./sfen";
import {
    STANDARD_STUDY_RULES,
    STUDY_LIMITS,
    type StudyAnalysisResult,
    type StudyCandidate,
    type StudyDocument,
    type StudyNode,
    type StudyOp,
    type StudyScore,
    type StudySource,
    type StudyTree,
} from "./types";

/** 実行時のノード ID と保存用の `nodeId` の対応表。 */
export interface StudyNodeIdIndex {
    /** 実行時のノード ID → 保存用の `nodeId` */
    byRuntimeId: ReadonlyMap<string, string>;
    /** 保存用の `nodeId` → 実行時のノード ID */
    byNodeId: ReadonlyMap<string, string>;
}

/**
 * 実行時のツリーを走査して対応表を作る。
 *
 * 実行時のノードは作られたあと手順が変わらないので、前回の対応表（`previous`）を渡すと
 * 既知のノードのハッシュ計算を省ける。研究ノートにできない指し手（パスなど USI の書式で
 * ない手）のノードとその配下は対応表に入らない。同じ親に同じ指し手のノードが複数あれば、
 * 先に現れた方だけが入る。
 */
export function buildStudyNodeIdIndex(
    tree: KifuTree,
    rootNodeId: string,
    previous?: StudyNodeIdIndex,
): StudyNodeIdIndex {
    const byRuntimeId = new Map<string, string>();
    const byNodeId = new Map<string, string>();
    byRuntimeId.set(tree.rootId, rootNodeId);
    byNodeId.set(rootNodeId, tree.rootId);

    const stack: string[] = [tree.rootId];
    while (stack.length > 0) {
        const runtimeId = stack.pop() as string;
        const node = tree.nodes.get(runtimeId);
        const nodeId = byRuntimeId.get(runtimeId);
        if (!node || nodeId === undefined) continue;
        for (let i = node.children.length - 1; i >= 0; i--) {
            const childRuntimeId = node.children[i];
            const child = tree.nodes.get(childRuntimeId);
            if (!child || !isStudyUsiMove(child.usiMove)) continue;
            const cached = previous?.byRuntimeId.get(childRuntimeId);
            const childNodeId = cached ?? studyChildNodeId(nodeId, child.usiMove);
            const owner = byNodeId.get(childNodeId);
            if (owner !== undefined && owner !== childRuntimeId) {
                // 同じ指し手の兄弟。本譜側（添字の小さい方）を残す。外された側は、あとで
                // スタックから取り出されたときに対応が無いので配下ごと読み飛ばされる。
                byRuntimeId.delete(owner);
            }
            byRuntimeId.set(childRuntimeId, childNodeId);
            byNodeId.set(childNodeId, childRuntimeId);
            stack.push(childRuntimeId);
        }
    }
    return { byRuntimeId, byNodeId };
}

const truncatePv = (pv: readonly string[] | undefined): string[] | null => {
    const moves = sanitizeStudyPv(pv, STUDY_LIMITS.pvLength);
    return moves.length > 0 ? moves : null;
};

/** 実行時ツリーの変換時に、ノードの評価値を「対局時の評価値」として持ち込むかの指定。 */
interface KifuTreeToStudyOptions {
    /**
     * 対局時の評価値の出どころ（`source.kind`。CSA 棋譜なら `"csa"`）。
     * 指定すると、先手視点に正規化済みの評価値（棋譜から読んだもの）、なければ AI がその手を
     * 指したときの探索結果（`searchStats`）と、消費時間を `source` に入れる。
     * 局面ごとのエンジン出力（`normalized` が true でない `eval`）は解析結果であり `source` には入れない。
     * null なら `source` を作らない。
     */
    sourceKind: string | null;
}

/**
 * AI がその手を指したときの探索結果を、評価値と読み筋にする。
 * 探索したのは指す前の局面なので、評価値は指した側から見た値で、読み筋はその手から始まる
 * （CSA の棋譜コメントと同じく、読み筋はその手を除いて指した後の局面から始める）。
 */
function searchStatsToSource(
    node: KifuNode,
    mover: PositionState["turn"],
): { score: StudyScore | null; pv: string[] | null } {
    const stats = node.searchStats;
    if (!stats) return { score: null, pv: null };
    const score = kifuEvalToStudyScore(
        { scoreCp: stats.scoreCp, scoreMate: stats.scoreMate },
        mover,
    );
    // 外部エンジンは最後に送った読み筋が bestmove から始まるとは限らない。指した手から
    // 始まらない読み筋は指した後の局面で再生できないので、評価値だけを残す。
    const line = stats.pv?.[0] === node.usiMove ? stats.pv.slice(1) : undefined;
    return { score, pv: score ? truncatePv(line) : null };
}

/** 実行時のノードから「対局時の評価値」を作る。何も無ければ null。 */
function runtimeNodeToSource(
    node: KifuNode,
    parent: KifuNode | undefined,
    sourceKind: string | null,
): StudySource | null {
    if (sourceKind === null) return null;
    const imported = node.eval?.normalized === true ? node.eval : undefined;
    const searched =
        !imported && parent ? searchStatsToSource(node, parent.positionAfter.turn) : null;
    const score = imported
        ? kifuEvalToStudyScore(imported, node.positionAfter.turn)
        : (searched?.score ?? null);
    const pv = imported ? truncatePv(imported.pv) : (searched?.pv ?? null);
    const elapsedMs =
        node.elapsedMs !== undefined && Number.isFinite(node.elapsedMs)
            ? Math.max(0, Math.round(node.elapsedMs))
            : null;
    if (score === null && pv === null && elapsedMs === null) return null;
    return { kind: sourceKind, score, pv, elapsedMs };
}

interface KifuTreeToStudyResult {
    /** 保存用の開始局面（SFEN 4 フィールド） */
    startSfen: string;
    tree: StudyTree;
    index: StudyNodeIdIndex;
}

/**
 * 実行時ツリーを保存用のツリーにする。
 *
 * 研究ノートにできない指し手（USI の書式でもパスでもない手）を含む場合は例外にする。
 */
export function kifuTreeToStudyTree(
    tree: KifuTree,
    options: KifuTreeToStudyOptions,
): KifuTreeToStudyResult {
    const startSfen = normalizeStudyStartSfen(tree.startSfen);
    const rootId = studyRootNodeId(startSfen, STANDARD_STUDY_RULES);
    for (const node of tree.nodes.values()) {
        if (node.usiMove !== null && !isStudyUsiMove(node.usiMove)) {
            throw new Error(`研究ノートにできない指し手が含まれています: ${node.usiMove}`);
        }
    }
    const index = buildStudyNodeIdIndex(tree, rootId);
    const nodes: Record<string, StudyNode> = {};
    for (const [runtimeId, nodeId] of index.byRuntimeId) {
        const node = tree.nodes.get(runtimeId);
        if (!node) continue;
        const isRoot = runtimeId === tree.rootId;
        const children: string[] = [];
        for (const childRuntimeId of node.children) {
            const childId = index.byRuntimeId.get(childRuntimeId);
            if (childId !== undefined && !children.includes(childId)) children.push(childId);
        }
        nodes[nodeId] = {
            parentId: isRoot ? null : (index.byRuntimeId.get(node.parentId ?? "") ?? null),
            usiMove: isRoot ? null : node.usiMove,
            children,
            comment: node.comment ?? "",
            bookmarked: false,
            source: isRoot
                ? null
                : runtimeNodeToSource(
                      node,
                      tree.nodes.get(node.parentId ?? ""),
                      options.sourceKind,
                  ),
        };
    }
    return { startSfen, tree: { version: 1, rootId, nodes }, index };
}

/** 解析結果の候補を実行時の評価値（先手視点）にする。 */
function studyCandidateToKifuEval(
    candidate: StudyCandidate,
    result: Pick<StudyAnalysisResult, "nodes" | "timeMs">,
): KifuEval {
    return {
        ...studyScoreToKifuEval(candidate.score),
        depth: candidate.depth,
        pv: candidate.pv,
        ...(candidate.seldepth !== null ? { seldepth: candidate.seldepth } : {}),
        ...(result.nodes !== null ? { nodes: result.nodes } : {}),
        ...(result.timeMs !== null ? { timeMs: result.timeMs } : {}),
    };
}

/** 解析結果を実行時のノードの評価値（`eval` と `multiPvEvals`）にする。 */
export function studyResultToKifuEvals(result: StudyAnalysisResult): {
    eval: KifuEval | undefined;
    multiPvEvals: (KifuEval | undefined)[] | undefined;
} {
    const multiPvEvals: (KifuEval | undefined)[] = [];
    for (const candidate of result.candidates) {
        if (!Number.isInteger(candidate.rank) || candidate.rank < 1) continue;
        multiPvEvals[candidate.rank - 1] = studyCandidateToKifuEval(candidate, result);
    }
    return {
        eval: multiPvEvals[0],
        multiPvEvals: multiPvEvals.length > 0 ? multiPvEvals : undefined,
    };
}

interface StudyToKifuTreeOptions {
    /**
     * ノードの評価値として載せる解析レイヤー。
     * 指定すると、そのレイヤーの結果だけを評価値にする（結果の無いノードは評価値なし）。
     * 省略・null なら対局時の評価値（`source`）を評価値にする。
     */
    layerId?: string | null;
    /** 復元後の現在位置（保存用の `nodeId`）。無い・省略ならルート。 */
    currentNodeId?: string | null;
}

interface StudyToKifuTreeResult {
    tree: KifuTree;
    index: StudyNodeIdIndex;
    /** 開始局面から再生できなかった指し手（その配下は復元しない）。 */
    errors: Array<{ nodeId: string; usiMove: string; message: string }>;
}

/**
 * 保存用の文書から実行時ツリーを復元する。盤面は開始局面から再生する。
 *
 * 復元したノードの実行時 ID には保存用の `nodeId` をそのまま使う（復元のたびに同じ ID になる）。
 * あとから `addMove` で足したノードは UUID になるので、対応は `buildStudyNodeIdIndex` で引く。
 */
export function studyDocumentToKifuTree(
    doc: StudyDocument,
    options: StudyToKifuTreeOptions = {},
): StudyToKifuTreeResult {
    const startPosition = parseStudySfen(doc.startSfen);
    const layer =
        options.layerId != null ? doc.layers.find((item) => item.id === options.layerId) : null;
    const useLayer = options.layerId != null;
    const { rootId } = doc.tree;
    const nodes = new Map<string, KifuNode>();
    const errors: StudyToKifuTreeResult["errors"] = [];

    const decorate = (nodeId: string, stored: StudyNode, base: KifuNode): KifuNode => {
        const node: KifuNode = { ...base };
        if (stored.comment !== "") node.comment = stored.comment;
        if (stored.source?.elapsedMs != null) node.elapsedMs = stored.source.elapsedMs;
        if (useLayer) {
            const result =
                layer && Object.hasOwn(layer.results, nodeId) ? layer.results[nodeId] : undefined;
            if (result) {
                const evals = studyResultToKifuEvals(result);
                if (evals.eval) node.eval = evals.eval;
                if (evals.multiPvEvals) node.multiPvEvals = evals.multiPvEvals;
            }
        } else if (stored.source) {
            const score = studyScoreToKifuEval(stored.source.score);
            if (score || stored.source.pv) {
                node.eval = {
                    ...(score ?? { normalized: true }),
                    ...(stored.source.pv ? { pv: stored.source.pv } : {}),
                };
            }
        }
        return node;
    };

    const storedRoot = doc.tree.nodes[rootId];
    if (!storedRoot) {
        throw new Error("研究ノートのツリーにルートがありません");
    }
    nodes.set(
        rootId,
        decorate(rootId, storedRoot, {
            id: rootId,
            usiMove: null,
            parentId: null,
            children: [],
            ply: 0,
            positionAfter: startPosition,
            boardBefore: startPosition.board,
        }),
    );

    const stack: string[] = [rootId];
    while (stack.length > 0) {
        const parentId = stack.pop() as string;
        const storedParent = doc.tree.nodes[parentId];
        const parent = nodes.get(parentId);
        if (!storedParent || !parent) continue;
        const children: string[] = [];
        for (const childId of storedParent.children) {
            const stored = doc.tree.nodes[childId];
            if (!stored || stored.usiMove === null || nodes.has(childId)) continue;
            const applied = applyStudyMoveWithState(parent.positionAfter, stored.usiMove);
            if (!applied.ok) {
                errors.push({
                    nodeId: childId,
                    usiMove: stored.usiMove,
                    message: applied.error ?? "指し手を適用できません",
                });
                continue;
            }
            const positionAfter: PositionState = applied.next;
            nodes.set(
                childId,
                decorate(childId, stored, {
                    id: childId,
                    usiMove: stored.usiMove,
                    parentId,
                    children: [],
                    ply: parent.ply + 1,
                    positionAfter,
                    boardBefore: cloneBoard(parent.positionAfter.board),
                }),
            );
            children.push(childId);
            stack.push(childId);
        }
        nodes.set(parentId, { ...parent, children });
    }

    const byRuntimeId = new Map<string, string>();
    for (const id of nodes.keys()) byRuntimeId.set(id, id);
    const currentNodeId =
        options.currentNodeId != null && nodes.has(options.currentNodeId)
            ? options.currentNodeId
            : rootId;

    return {
        tree: { rootId, nodes, currentNodeId, startSfen: doc.startSfen },
        index: { byRuntimeId, byNodeId: new Map(byRuntimeId) },
        errors,
    };
}

/**
 * 実行時ツリーの形（手の追加・削除・兄弟の順序・コメント）を文書に反映する操作の列を作る。
 *
 * 画面は実行時ツリーを編集したあとこれを呼び、返った操作を保存層に流せばよい。
 * 評価値・しおり・対局時の評価値は対象外（それぞれ `putAnalysis` / `setBookmark` / `setSource`）。
 *
 * @param index `buildStudyNodeIdIndex(tree, doc.tree.rootId, 前回の対応表)` の結果
 */
export function diffKifuTreeToStudyOps(
    doc: StudyDocument,
    tree: KifuTree,
    index: StudyNodeIdIndex,
): StudyOp[] {
    const ops: StudyOp[] = [];
    const stored = doc.tree.nodes;

    // 足す: 文書に無いノード。親が文書にある（または先に足される）順に、根から葉へ。
    const stack: string[] = [tree.rootId];
    const orderedRuntimeIds: string[] = [];
    while (stack.length > 0) {
        const runtimeId = stack.pop() as string;
        if (!index.byRuntimeId.has(runtimeId)) continue;
        orderedRuntimeIds.push(runtimeId);
        const node = tree.nodes.get(runtimeId);
        if (!node) continue;
        for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]);
    }
    for (const runtimeId of orderedRuntimeIds) {
        const node = tree.nodes.get(runtimeId);
        const nodeId = index.byRuntimeId.get(runtimeId);
        if (!node || nodeId === undefined || node.parentId === null || node.usiMove === null) {
            continue;
        }
        if (Object.hasOwn(stored, nodeId)) continue;
        const parentId = index.byRuntimeId.get(node.parentId);
        if (parentId === undefined) continue;
        ops.push({ type: "addMoves", parentId, moves: [node.usiMove] });
    }

    // 消す: 実行時ツリーに無いノード（親が残っているものだけ。配下は一緒に消える）。
    // ただし、開始局面から再生できない指し手のノードは、復元の時点で実行時ツリーに載らない
    // （`studyDocumentToKifuTree` の `errors`）。利用者が消したのではないので、削除にしない。
    const unrestorable = new Set<string>();
    for (const [nodeId, node] of Object.entries(stored)) {
        if (node.parentId === null || node.usiMove === null || index.byNodeId.has(nodeId)) {
            continue;
        }
        const parentRuntimeId = index.byNodeId.get(node.parentId);
        if (parentRuntimeId === undefined) continue;
        const parent = tree.nodes.get(parentRuntimeId);
        if (parent && !applyStudyMoveWithState(parent.positionAfter, node.usiMove).ok) {
            unrestorable.add(nodeId);
            continue;
        }
        ops.push({ type: "deleteSubtree", nodeId });
    }

    // 順序とコメント。
    for (const runtimeId of orderedRuntimeIds) {
        const node = tree.nodes.get(runtimeId);
        const nodeId = index.byRuntimeId.get(runtimeId);
        if (!node || nodeId === undefined) continue;
        const children: string[] = [];
        for (const childRuntimeId of node.children) {
            const childId = index.byRuntimeId.get(childRuntimeId);
            if (childId !== undefined) children.push(childId);
        }
        const before = Object.hasOwn(stored, nodeId) ? stored[nodeId] : undefined;
        // 復元できなかった子は実行時ツリーに居ないが、文書には残る。並べ替えの対象
        // （現在の子の集合）から漏れないよう、末尾に置いたものとして扱う。
        for (const childId of before?.children ?? []) {
            if (unrestorable.has(childId)) children.push(childId);
        }
        // 足した直後の並び（既存の子のあとに新しい子が足された順）と違うときだけ並べ替える。
        const expected = before
            ? [
                  ...before.children.filter(
                      (childId) => children.includes(childId) && !unrestorable.has(childId),
                  ),
                  ...children.filter((childId) => !before.children.includes(childId)),
                  ...before.children.filter((childId) => unrestorable.has(childId)),
              ]
            : children;
        const restorableCount = children.filter((childId) => !unrestorable.has(childId)).length;
        if (restorableCount > 1 && children.some((childId, i) => childId !== expected[i])) {
            ops.push({ type: "reorderChildren", parentId: nodeId, value: children });
        }
        const comment = node.comment ?? "";
        if (comment !== (before?.comment ?? "")) {
            ops.push({ type: "setComment", nodeId, value: comment });
        }
    }

    return ops;
}
