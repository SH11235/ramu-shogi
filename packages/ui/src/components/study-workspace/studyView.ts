/**
 * 研究ノートの画面が使う純粋関数（表示用の整形と、文書からの導出）。
 *
 * 画面は保存用の文書（`StudyDocument`）を唯一の元データにする。盤面・棋譜の表示に使う
 * `KifuTree` は文書から毎回作り直し、実行時のノード ID は保存用の `nodeId` と同じになる
 * （`studyDocumentToKifuTree` が復元したノードにそのまま `nodeId` を使うため）。
 */

import {
    type KifuNode,
    type KifuTree,
    type Player,
    type Square,
    type StudyAnalysisResult,
    type StudyDocument,
    type StudyHighlight,
    type StudyLayer,
    type StudyScore,
    studyDocumentToKifuTree,
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

/**
 * 文書から画面用の棋譜ツリーを作る。
 *
 * ノードの評価値には表示中のレイヤーの結果だけを載せる（対局時の評価値は別の列で見せる）。
 * 現在位置は持たせない（画面の状態として別に持つ）。
 */
export function buildStudyViewTree(
    doc: StudyDocument,
    displayLayerId: string | null,
): {
    tree: KifuTree /** 開始局面から再生できず、表示できなかった枝の数。 */;
    unrestoredCount: number;
} {
    const restored = studyDocumentToKifuTree(doc, {
        layerId: displayLayerId ?? STUDY_NO_LAYER_ID,
    });
    return { tree: restored.tree, unrestoredCount: restored.errors.length };
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

/** 手順が本譜（各ノードの先頭の子をたどった手順）と同じか。 */
export function isStudyMainLine(tree: KifuTree, line: readonly string[]): boolean {
    for (let index = 1; index < line.length; index++) {
        const parent = tree.nodes.get(line[index - 1]);
        if (parent?.children[0] !== line[index]) return false;
    }
    return true;
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
    /** 表示中のレイヤーの結果か。false なら、別の設定でより深く読んだ結果。 */
    fromDisplayLayer: boolean;
}

/**
 * いま見ている局面の候補手として出す解析結果を選ぶ。
 *
 * 基本は表示中のレイヤーの結果。「この局面を深く解析」した結果は時間の長い別のレイヤーに入るので、
 * 表示中のレイヤーより深く読めている結果があれば、そちらを出す（どの設定の結果かは画面に出す）。
 */
export function pickStudyPositionResult(
    doc: StudyDocument,
    nodeId: string,
    displayLayerId: string | null,
): StudyPositionResult | null {
    let picked: StudyPositionResult | null = null;
    for (const layer of doc.layers) {
        if (!Object.hasOwn(layer.results, nodeId)) continue;
        const result = layer.results[nodeId];
        const candidate: StudyPositionResult = {
            layer,
            result,
            fromDisplayLayer: layer.id === displayLayerId,
        };
        if (picked === null) {
            picked = candidate;
            continue;
        }
        const deeper = result.depth - picked.result.depth;
        if (deeper > 0 || (deeper === 0 && candidate.fromDisplayLayer)) picked = candidate;
    }
    return picked;
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
