import {
    type BookTree,
    type BookTreeNode,
    type KifuTree,
    positionToBookKey,
} from "@shogi/app-core";
import type { BookTreeValueOf } from "../book-tree-viewer/BookTreeGraph";
import { formatEval } from "../shogi-match/utils/kifFormat";

/** 研究ノートの木を、定跡の木と同じ形にしたもの。番号と棋譜のノード ID を行き来できる。 */
interface StudyGraph {
    tree: BookTree;
    ids: readonly string[];
    indexOf: ReadonlyMap<string, number>;
    valueFor: BookTreeValueOf;
}

/**
 * 研究ノートの棋譜の木を、定跡の木の図で描ける形に写す。子の並び（先頭が本譜）はそのまま保つ。
 * 番号は親より子が大きくなるように、開始局面から深さ優先で振る（図はこの順を前提に枝の大きさを数える）。
 */
export function studyGraphFromKifuTree(kifu: KifuTree): StudyGraph {
    const nodes: BookTreeNode[] = [];
    const ids: string[] = [];
    const indexOf = new Map<string, number>();
    const firstByKey = new Map<string, number>();
    const stack: { id: string; parent: number | null }[] = [{ id: kifu.rootId, parent: null }];
    for (let item = stack.pop(); item !== undefined; item = stack.pop()) {
        const source = kifu.nodes.get(item.id);
        if (!source || indexOf.has(item.id)) continue;
        const index = nodes.length;
        // 図は `position.ply` を次に指す手の手数として読む（開始局面の次が 1 手目）。
        const position = { ...source.positionAfter, ply: source.ply + 1 };
        const key = positionToBookKey(position);
        nodes.push({
            id: index,
            key,
            position,
            parent: item.parent,
            ...(source.usiMove ? { move: source.usiMove } : {}),
            children: [],
            status: "ready",
        });
        ids.push(item.id);
        indexOf.set(item.id, index);
        if (!firstByKey.has(key)) firstByKey.set(key, index);
        if (item.parent !== null) nodes[item.parent].children.push(index);
        for (let i = source.children.length - 1; i >= 0; i--)
            stack.push({ id: source.children[i], parent: index });
    }
    const tree: BookTree = {
        nodes,
        firstByKey,
        expanded: nodes.length,
        building: false,
        capped: false,
        legalMovesFailed: false,
        roots: [],
        goal: 0,
    };
    // 棋譜の木の評価値は先手から見た値にそろえてある（手順の一覧と同じ表記で出す）。
    const valueFor: BookTreeValueOf = (node) => {
        const data = kifu.nodes.get(ids[node.id])?.eval;
        if (!data) return undefined;
        const text = formatEval(data.scoreCp, data.scoreMate);
        if (text === "") return undefined;
        const value = data.scoreMate ?? data.scoreCp ?? 0;
        return { value: Math.sign(value), text };
    };
    return { tree, ids, indexOf, valueFor };
}
