/**
 * 研究ノートの画面が使う純粋関数（表示用の整形と、文書からの導出）。
 *
 * 画面は保存用の文書（`StudyDocument`）を唯一の元データにする。盤面・棋譜の表示に使う
 * `KifuTree` は文書から毎回作り直し、実行時のノード ID は保存用の `nodeId` と同じになる
 * （`studyDocumentToKifuTree` が復元したノードにそのまま `nodeId` を使うため）。
 */

import {
    canonicalJSON,
    type KifuNode,
    type KifuTree,
    type Player,
    type Square,
    type StudyAnalysisResult,
    type StudyCandidate,
    type StudyDocument,
    type StudyHighlight,
    type StudyLayer,
    type StudyScore,
    studyDocumentToKifuTree,
    studyResultToKifuEvals,
    studyScoreToKifuEval,
} from "@shogi/app-core";
import {
    type EvalHistory,
    formatEval,
    formatMoveSimple,
    parseToSquare,
} from "../shogi-match/utils/kifFormat";

/** どのレイヤーにも無い ID。「レイヤーの結果だけを評価値にする（対局時の評価値は載せない）」指定に使う。 */
const STUDY_NO_LAYER_ID = "none";

/** 盤面を復元した棋譜ツリー（評価値・コメントは載せていない）と、復元できなかった枝の数。 */
export interface StudyStructureTree {
    tree: KifuTree;
    /** 開始局面から再生できず、表示できなかった枝の数。 */
    unrestoredCount: number;
}

/**
 * 文書のツリーの形（どの手がどの手の先にあるか）を表す文字列。
 * これが同じなら盤面の復元結果も同じなので、復元をやり直さなくてよい。
 */
export function studyStructureKey(doc: StudyDocument): string {
    return `${doc.startSfen}\n${studyStructureOf(doc.tree)}`;
}

const structureCache = new WeakMap<StudyDocument["tree"]["nodes"], string>();

function studyStructureOf(tree: StudyDocument["tree"]): string {
    const cached = structureCache.get(tree.nodes);
    if (cached !== undefined) return cached;
    const parts: string[] = [tree.rootId];
    for (const [nodeId, node] of Object.entries(tree.nodes)) {
        parts.push(`${nodeId}:${node.children.join(",")}`);
    }
    const key = parts.join("|");
    structureCache.set(tree.nodes, key);
    return key;
}

/**
 * 文書から、盤面を復元した棋譜ツリーを作る（重い。ツリーの形が変わったときだけ呼ぶ）。
 * 評価値は載せない（`applyStudyLayerToTree` で重ねる）。
 */
export function buildStudyStructureTree(doc: StudyDocument): StudyStructureTree {
    const restored = studyDocumentToKifuTree(doc, { layerId: STUDY_NO_LAYER_ID });
    return { tree: restored.tree, unrestoredCount: restored.errors.length };
}

/**
 * 復元済みのツリーに、表示中のレイヤーの評価値を重ねる（盤面の復元はやり直さない）。
 * 対局時の評価値は載せない（別の列で見せる）。
 */
export function applyStudyLayerToTree(
    structure: KifuTree,
    doc: StudyDocument,
    displayLayerId: string | null,
): KifuTree {
    const layer = doc.layers.find((item) => item.id === displayLayerId);
    if (!layer) return structure;
    const nodes = new Map(structure.nodes);
    for (const [nodeId, result] of Object.entries(layer.results)) {
        const node = nodes.get(nodeId);
        if (!node) continue;
        const evals = studyResultToKifuEvals(result);
        if (!evals.eval) continue;
        nodes.set(nodeId, {
            ...node,
            eval: evals.eval,
            ...(evals.multiPvEvals ? { multiPvEvals: evals.multiPvEvals } : {}),
        });
    }
    return { ...structure, nodes };
}

/**
 * 文書から画面用の棋譜ツリーを作る（構造の復元 + 表示中のレイヤーの評価値）。
 * 画面では構造を使い回すので、これはテストと単発の用途向け。
 */
export function buildStudyViewTree(
    doc: StudyDocument,
    displayLayerId: string | null,
): StudyStructureTree {
    const structure = buildStudyStructureTree(doc);
    return {
        tree: applyStudyLayerToTree(structure.tree, doc, displayLayerId),
        unrestoredCount: structure.unrestoredCount,
    };
}

/** 対局時の評価値（`source`）による、手順の評価値の列（解析前の評価値グラフ用）。 */
export function studyLineSourceEvalHistory(
    doc: StudyDocument,
    tree: KifuTree,
    line: readonly string[],
): EvalHistory[] {
    return line.map((nodeId, index) => {
        const node = tree.nodes.get(nodeId);
        const mover = node ? studyNodeMover(tree, node) : null;
        const stored = Object.hasOwn(doc.tree.nodes, nodeId) ? doc.tree.nodes[nodeId] : undefined;
        const evalData = studyScoreToKifuEval(stored?.source?.score ?? null);
        return {
            ply: index,
            ...(mover ? { mover } : {}),
            evalCp: evalData?.scoreCp ?? null,
            evalMate: evalData?.scoreMate ?? null,
        };
    });
}

/** 評価値を画面の表記にする（例: `+1.2`、`-詰5`）。欠測は空文字。 */
export function formatStudyScore(score: StudyScore | null | undefined): string {
    const evalData = studyScoreToKifuEval(score ?? null);
    if (!evalData) return "";
    return formatEval(evalData.scoreCp, evalData.scoreMate);
}

/** 評価値がどちらに傾いているか（色分け用。色だけに頼らず、数値と符号も必ず出す）。 */
export function studyScoreSide(score: StudyScore | null | undefined): Player | null {
    if (!score) return null;
    if (score.kind === "mate") return score.winner;
    if (score.value > 0) return "sente";
    if (score.value < 0) return "gote";
    return null;
}

/** ノードの手を指した側。ルートは null。 */
function studyNodeMover(tree: KifuTree, node: KifuNode): Player | null {
    if (node.parentId === null) return null;
    const parent = tree.nodes.get(node.parentId);
    if (!parent) return null;
    return parent.positionAfter.turn;
}

/** ノードの手の表記（例: `☗7六歩(77)`）。ルートは「開始局面」。 */
export function studyMoveLabel(tree: KifuTree, nodeId: string): string {
    const node = tree.nodes.get(nodeId);
    if (!node || node.usiMove === null || node.parentId === null) return "開始局面";
    const parent = tree.nodes.get(node.parentId);
    if (!parent) return node.usiMove;
    const prevTo: Square | undefined = parent.usiMove ? parseToSquare(parent.usiMove) : undefined;
    return formatMoveSimple(node.usiMove, parent.positionAfter.turn, node.boardBefore, prevTo);
}

/** ルートからノードまでの ID の列（ルートを含む）。ノードが無ければルートだけ。 */
export function studyPathTo(tree: KifuTree, nodeId: string): string[] {
    const path: string[] = [];
    let cursor: string | null = tree.nodes.has(nodeId) ? nodeId : tree.rootId;
    while (cursor !== null) {
        const node = tree.nodes.get(cursor);
        if (!node) break;
        path.push(cursor);
        cursor = node.parentId;
    }
    return path.reverse();
}

/**
 * 画面に出す 1 本の手順（ルートから末端まで）を決める。
 *
 * いま見ているノードを必ず通る。前に見ていた手順（`previous`）がそのノードを通っていれば、
 * その先も同じ手順を保つ（手を戻しても、見ていた変化の続きが消えないように）。
 * それ以外は、先頭の子（本譜）をたどって末端まで伸ばす。
 */
export function resolveStudyLine(
    tree: KifuTree,
    currentNodeId: string,
    previous: readonly string[] = [],
): string[] {
    const path = studyPathTo(tree, currentNodeId);
    const line = [...path];
    const currentIndex = path.length - 1;
    // 前の手順が同じ経路を通っていれば、その続きを使う。
    const sharesPath =
        previous.length > currentIndex && path.every((nodeId, index) => previous[index] === nodeId);
    if (sharesPath) {
        for (let index = currentIndex + 1; index < previous.length; index++) {
            const parent = tree.nodes.get(line[line.length - 1]);
            if (!parent?.children.includes(previous[index])) break;
            line.push(previous[index]);
        }
    }
    for (;;) {
        const tail = tree.nodes.get(line[line.length - 1]);
        const next = tail?.children[0];
        if (next === undefined || !tree.nodes.has(next)) break;
        line.push(next);
    }
    return line;
}

/** 対局の本譜（開始局面から先頭の子をたどった手順）にあるノードの ID。 */
export function studyMainLineIds(tree: KifuTree): Set<string> {
    const ids = new Set<string>();
    let cursor: string | undefined = tree.rootId;
    while (cursor !== undefined && !ids.has(cursor)) {
        const node = tree.nodes.get(cursor);
        if (!node) break;
        ids.add(cursor);
        cursor = node.children[0];
    }
    return ids;
}

/**
 * いま見ている枝を消すときの対象（直近の分岐点から先の、最初の手のノード）。
 *
 * いま見ているノードからルートへさかのぼり、兄弟のいる最初のノードを返す。それが本譜の上なら
 * 消せないので null（本譜は、ほかの手順と入れ替えて変化にしてからでないと消せない）。
 */
export function studyDeletableBranchHead(tree: KifuTree, nodeId: string): string | null {
    const mainLine = studyMainLineIds(tree);
    let cursor = tree.nodes.get(nodeId);
    while (cursor && cursor.parentId !== null) {
        const parent = tree.nodes.get(cursor.parentId);
        if (!parent) return null;
        if (parent.children.length > 1 || mainLine.has(parent.id)) {
            return mainLine.has(cursor.id) ? null : cursor.id;
        }
        cursor = parent;
    }
    return null;
}

/** ノードとその配下にある局面の数。 */
export function studySubtreeSize(tree: KifuTree, nodeId: string): number {
    let count = 0;
    const stack = [nodeId];
    while (stack.length > 0) {
        const node = tree.nodes.get(stack.pop() as string);
        if (!node) continue;
        count++;
        for (const childId of node.children) stack.push(childId);
    }
    return count;
}

/** 読み筋の最初の手の表記（その局面から指す手。例: `☗7六歩(77)`）。読み筋が無ければ null。 */
export function studyFirstMoveLabel(node: KifuNode, pv: readonly string[]): string | null {
    const move = pv[0];
    if (move === undefined) return null;
    const prevTo: Square | undefined = node.usiMove ? parseToSquare(node.usiMove) : undefined;
    return formatMoveSimple(move, node.positionAfter.turn, node.positionAfter.board, prevTo);
}

/** 手順の評価値の列（評価値グラフ用）。添字 0 が開始局面。 */
export function studyLineEvalHistory(tree: KifuTree, line: readonly string[]): EvalHistory[] {
    return line.map((nodeId, index) => {
        const node = tree.nodes.get(nodeId);
        const mover = node ? studyNodeMover(tree, node) : null;
        const evalData = node?.eval;
        return {
            ply: index,
            ...(mover ? { mover } : {}),
            evalCp: evalData?.scoreCp ?? null,
            evalMate: evalData?.scoreMate ?? null,
        };
    });
}

/** ノードからの変化の長さ（そのノードを含め、先頭の子をたどった手数）。 */
export function studyVariationLength(tree: KifuTree, nodeId: string): number {
    let length = 0;
    let cursor: string | undefined = nodeId;
    while (cursor !== undefined) {
        const node = tree.nodes.get(cursor);
        if (!node) break;
        length++;
        cursor = node.children[0];
    }
    return length;
}

/** 表示するレイヤーを決める。保存してあった選択が残っていればそれ、無ければ結果の最も多いレイヤー。 */
export function chooseStudyDisplayLayer(
    layers: readonly StudyLayer[],
    preferredLayerId: string | null,
): string | null {
    if (preferredLayerId !== null && layers.some((layer) => layer.id === preferredLayerId)) {
        return preferredLayerId;
    }
    let best: StudyLayer | null = null;
    let bestCount = -1;
    for (const layer of layers) {
        const count = Object.keys(layer.results).length;
        if (count > bestCount) {
            best = layer;
            bestCount = count;
        }
    }
    return best?.id ?? null;
}

export interface StudyPositionResult {
    layer: StudyLayer;
    result: StudyAnalysisResult;
}

/** 2 つの設定が同じ AI・同じ評価関数か（探索の上限と候補手の数は見ない）。 */
function isSameStudyAi(a: StudyLayer, b: StudyLayer): boolean {
    return (
        canonicalJSON(a.spec.engine) === canonicalJSON(b.spec.engine) &&
        canonicalJSON(a.spec.evaluation) === canonicalJSON(b.spec.evaluation) &&
        canonicalJSON(a.spec.rules) === canonicalJSON(b.spec.rules)
    );
}

/** `other` の探索の上限が `base` より大きいか（時間・深さ・ノード数のどれも下回らず、どれかが上回る）。 */
function hasLargerStudyLimits(other: StudyLayer, base: StudyLayer): boolean {
    const keys = ["timeMs", "depth", "nodes"] as const;
    let larger = false;
    for (const key of keys) {
        const a = other.spec.limits[key];
        const b = base.spec.limits[key];
        // 上限なし（null）は「いくらでも読める」なので最大として比べる。
        const left = a ?? Number.POSITIVE_INFINITY;
        const right = b ?? Number.POSITIVE_INFINITY;
        if (left < right) return false;
        if (left > right) larger = true;
    }
    return larger;
}

/**
 * ある局面の、表示中の設定の解析結果。
 *
 * 注目局面の行の「最善」、候補手の「この手の代わりに」、「この局面の候補手」は、どれもこの
 * 結果から出す（欄によって別の設定の結果が混ざると、行とパネルで手や評価値が食い違う）。
 * 別の設定の結果は `pickStudyDeeperResult` で、別の段として添える。
 */
export function pickStudyPositionResult(
    doc: StudyDocument,
    nodeId: string,
    displayLayerId: string | null,
): StudyPositionResult | null {
    const display = doc.layers.find((layer) => layer.id === displayLayerId);
    if (!display || !Object.hasOwn(display.results, nodeId)) return null;
    return { layer: display, result: display.results[nodeId] };
}

/**
 * ある局面の、表示中の設定より深く読んだ解析結果（候補手の欄に、別の段として添える）。
 *
 * 「この局面を深く解析」の結果は、時間の長い別の設定として保存される。**表示中の設定と AI・
 * 評価関数が同じで、探索の上限だけが大きい設定**の結果を対象にし、その中で最も深く読めたものを
 * 返す。別の AI の結果は、その設定を表示に選んだときだけ出る。
 */
export function pickStudyDeeperResult(
    doc: StudyDocument,
    nodeId: string,
    displayLayerId: string | null,
): StudyPositionResult | null {
    const display = doc.layers.find((layer) => layer.id === displayLayerId);
    if (!display) return null;
    let picked: StudyPositionResult | null = null;
    for (const layer of doc.layers) {
        if (layer.id === display.id || !Object.hasOwn(layer.results, nodeId)) continue;
        if (!isSameStudyAi(layer, display) || !hasLargerStudyLimits(layer, display)) continue;
        const result = layer.results[nodeId];
        if (picked === null || result.depth > picked.result.depth) picked = { layer, result };
    }
    return picked;
}

/** 解析結果の 1 位の候補。無ければ null。 */
export function studyBestCandidate(result: StudyAnalysisResult): StudyCandidate | null {
    return (
        result.candidates.find((candidate) => candidate.rank === 1) ?? result.candidates[0] ?? null
    );
}

/** レイヤーに結果のあるノードの数（文書に残っているノードだけ数える）。 */
export function countStudyLayerResults(doc: StudyDocument, layer: StudyLayer): number {
    let count = 0;
    for (const nodeId of Object.keys(layer.results)) {
        if (Object.hasOwn(doc.tree.nodes, nodeId)) count++;
    }
    return count;
}

/** レイヤーでまだ解析が済んでいない（結果が無い・中断した）ノードの数。レイヤーが無ければ全ノード。 */
export function countStudyUnanalyzed(doc: StudyDocument, layerId: string | null): number {
    const layer = layerId === null ? undefined : doc.layers.find((item) => item.id === layerId);
    let count = 0;
    for (const nodeId of Object.keys(doc.tree.nodes)) {
        const result =
            layer && Object.hasOwn(layer.results, nodeId) ? layer.results[nodeId] : undefined;
        if (result?.completion !== "completed") count++;
    }
    return count;
}

/** 注目局面の 1 行の見出し（例: `42手目 ☖8六歩(87)`）。 */
export function studyHighlightTitle(tree: KifuTree, highlight: StudyHighlight): string {
    if (highlight.ply === 0) return "開始局面";
    return `${highlight.ply}手目 ${studyMoveLabel(tree, highlight.nodeId)}`;
}

/** 元棋譜の種別の表示名。 */
export function studyOriginLabel(origin: StudyDocument["origin"]): string {
    switch (origin.kind) {
        case "rshogi_csa":
            return "観戦・棋譜一覧の棋譜";
        case "game_record":
            return "自分の対局";
        case "paste":
            return "貼り付けた棋譜";
        default:
            return "棋譜";
    }
}

/** 対局者の表示（例: `☗RAMU 対 ☖Panda`）。どちらも無ければ null。 */
export function studyPlayersLabel(meta: StudyDocument["meta"]): string | null {
    const black = meta.blackName?.trim();
    const white = meta.whiteName?.trim();
    if (!black && !white) return null;
    return `☗${black || "先手"} 対 ☖${white || "後手"}`;
}
