/**
 * 研究ノートから、範囲を選んで新しい研究ノートを作る。
 *
 * ノードの ID は開始局面と指し手から決まるので、開始局面が同じなら（「この局面まで」「まるごと」）
 * 元の ID のまま部分を写せ、解析結果もそのまま付く。「この局面だけ」は、その局面を開始局面にした
 * 新しいルートへ、その局面の解析結果とコメントを付け替える。
 */

import { positionToSfen } from "../game/position-sfen";
import { studyRootNodeId } from "./ids";
import { clampStudyTitle } from "./import";
import { applyStudyMoveWithState } from "./pass";
import { parseStudySfen } from "./sfen";
import type { StudyDocument, StudyLayer, StudyNode, StudyOrigin } from "./types";

/** 写す範囲。「開始局面からこの局面まで」「ノートまるごと」「この局面だけ」。 */
export type StudyCopyRange = "upto" | "all" | "here";

export interface StudyCopySelection {
    /** いま見ている局面。 */
    nodeId: string;
    /** 表示中の手順（ルートから末端まで。`nodeId` を通る）。 */
    line: readonly string[];
    range: StudyCopyRange;
    /** 変化も入れる（「この局面だけ」では使わない）。 */
    includeVariations: boolean;
}

export interface StudyCopyOptions extends StudyCopySelection {
    id: string;
    title: string;
    /** 解析結果・コメント・対局時の評価値も入れる。 */
    includeAnalysis: boolean;
}

/** 選んだ範囲に入る手順と変化の数（画面の説明と図に使う）。 */
export interface StudyCopySummary {
    /** いまの局面の手数。 */
    currentPly: number;
    /** 表示中の手順の手数。 */
    linePlies: number;
    /** 本譜にする手順の手数。 */
    plies: number;
    /** いまの局面より手前で分かれた変化の数と、そのうち入るもの。 */
    variationsBefore: { total: number; included: number };
    /** いまの局面かその先で分かれた変化の数と、そのうち入るもの。 */
    variationsAfter: { total: number; included: number };
}

const PASTE_ORIGIN: StudyOrigin = { kind: "paste", ref: null };

function pathTo(doc: StudyDocument, nodeId: string): string[] {
    const path: string[] = [];
    let id: string | null = nodeId;
    while (id !== null) {
        const node: StudyNode | undefined = doc.tree.nodes[id];
        // 親をたどって輪になる壊れた文書でも、止まらずに回り続けないようにする。
        if (!node || path.includes(id)) throw new Error("局面がノートにありません");
        path.unshift(id);
        id = node.parentId;
    }
    return path;
}

function addSubtree(doc: StudyDocument, nodeId: string, keep: Set<string>): void {
    const stack = [nodeId];
    while (stack.length > 0) {
        const id = stack.pop() as string;
        if (keep.has(id)) continue;
        keep.add(id);
        stack.push(...(doc.tree.nodes[id]?.children ?? []));
    }
}

/** 本譜にする手順（ルートから）。「この局面まで」はいまの局面まで、「まるごと」は表示中の手順の末端まで。 */
function mainPath(doc: StudyDocument, selection: StudyCopySelection): string[] {
    const path = pathTo(doc, selection.nodeId);
    if (selection.range !== "all") return path;
    // 表示中の手順がいまの局面を通らなければ（呼び出し側の食い違い）、いまの局面までにする。
    const index = selection.line.indexOf(selection.nodeId);
    return index === path.length - 1 ? [...selection.line] : path;
}

/** 本譜から分かれる変化の起点（本譜のノードの、本譜でない子）を、分かれる位置ごとに挙げる。 */
function branchesOff(
    doc: StudyDocument,
    path: readonly string[],
): Array<{ index: number; childId: string }> {
    const branches: Array<{ index: number; childId: string }> = [];
    path.forEach((id, index) => {
        for (const childId of doc.tree.nodes[id]?.children ?? []) {
            if (childId !== path[index + 1]) branches.push({ index, childId });
        }
    });
    return branches;
}

function selectNodes(
    doc: StudyDocument,
    selection: StudyCopySelection,
): { path: string[]; keep: Set<string> } {
    const path = mainPath(doc, selection);
    const keep = new Set(path);
    if (!selection.includeVariations || selection.range === "here") return { path, keep };
    const currentIndex = path.indexOf(selection.nodeId);
    for (const branch of branchesOff(doc, path)) {
        // 「この局面まで」は、この局面より手前で分かれた変化だけを、その先まで入れる。
        if (selection.range === "upto" && branch.index >= currentIndex) continue;
        addSubtree(doc, branch.childId, keep);
    }
    return { path, keep };
}

export function summarizeStudyCopy(
    doc: StudyDocument,
    selection: StudyCopySelection,
): StudyCopySummary {
    const fullPath = pathTo(doc, selection.nodeId);
    const currentPly = fullPath.length - 1;
    const linePath =
        selection.line.indexOf(selection.nodeId) === currentPly ? [...selection.line] : fullPath;
    const branches = branchesOff(doc, linePath);
    const before = branches.filter((branch) => branch.index < currentPly).length;
    const after = branches.length - before;
    const variations = selection.includeVariations && selection.range !== "here";
    return {
        currentPly,
        linePlies: linePath.length - 1,
        plies:
            selection.range === "here"
                ? 0
                : selection.range === "upto"
                  ? currentPly
                  : linePath.length - 1,
        variationsBefore: { total: before, included: variations ? before : 0 },
        variationsAfter: {
            total: after,
            included: variations && selection.range === "all" ? after : 0,
        },
    };
}

function copyLayers(
    layers: readonly StudyLayer[],
    resultIdOf: (nodeId: string) => string | null,
): StudyLayer[] {
    return layers
        .map((layer) => {
            const results: StudyLayer["results"] = {};
            for (const [nodeId, result] of Object.entries(layer.results)) {
                const id = resultIdOf(nodeId);
                if (id !== null) results[id] = result;
            }
            return { ...layer, results };
        })
        .filter((layer) => Object.keys(layer.results).length > 0);
}

function positionSfenAt(doc: StudyDocument, nodeId: string): string {
    let position = parseStudySfen(doc.startSfen);
    for (const id of pathTo(doc, nodeId)) {
        const move = doc.tree.nodes[id]?.usiMove;
        if (!move) continue;
        const applied = applyStudyMoveWithState(position, move);
        if (!applied.ok) throw new Error("この局面を再現できません");
        position = applied.next;
    }
    return positionToSfen(position);
}

/**
 * 研究ノートから新しい研究ノートの文書を作る。元の文書は変えない。上限の確かめは呼び出し側で行う。
 * 作ったノートは貼り付けた棋譜と同じ扱い（`paste`）にする（元のノートと同期しない、別のノートにする）。
 */
export function copyStudyDocument(doc: StudyDocument, options: StudyCopyOptions): StudyDocument {
    const base = {
        id: options.id,
        title: clampStudyTitle(options.title),
        origin: PASTE_ORIGIN,
        rules: doc.rules,
        meta: { ...doc.meta },
    };
    if (options.range === "here") {
        const source = doc.tree.nodes[options.nodeId];
        if (!source) throw new Error("局面がノートにありません");
        const startSfen = positionSfenAt(doc, options.nodeId);
        const rootId = studyRootNodeId(startSfen, doc.rules);
        return {
            ...base,
            startSfen,
            tree: {
                version: 1,
                rootId,
                nodes: {
                    [rootId]: {
                        parentId: null,
                        usiMove: null,
                        children: [],
                        comment: options.includeAnalysis ? source.comment : "",
                        bookmarked: false,
                        // 対局時の評価値・読み筋はこの局面のものなので、新しいルートに付け替える。
                        source: options.includeAnalysis ? source.source : null,
                    },
                },
            },
            layers: options.includeAnalysis
                ? copyLayers(doc.layers, (nodeId) => (nodeId === options.nodeId ? rootId : null))
                : [],
        };
    }
    const { path, keep } = selectNodes(doc, options);
    const nodes: Record<string, StudyNode> = {};
    for (const id of keep) {
        const node = doc.tree.nodes[id] as StudyNode;
        const pathIndex = path.indexOf(id);
        const nextOnPath = pathIndex >= 0 ? path[pathIndex + 1] : undefined;
        const children = node.children.filter((childId) => keep.has(childId));
        // 本譜にした手順の子を先頭に置く（変化の中から作っても、その手順が新しいノートの本譜になる）。
        const ordered =
            nextOnPath !== undefined && children.includes(nextOnPath)
                ? [nextOnPath, ...children.filter((childId) => childId !== nextOnPath)]
                : children;
        nodes[id] = {
            ...node,
            children: ordered,
            comment: options.includeAnalysis ? node.comment : "",
            source: options.includeAnalysis ? node.source : null,
        };
    }
    return {
        ...base,
        startSfen: doc.startSfen,
        tree: { version: 1, rootId: doc.tree.rootId, nodes },
        layers: options.includeAnalysis
            ? copyLayers(doc.layers, (nodeId) => (keep.has(nodeId) ? nodeId : null))
            : [],
    };
}
