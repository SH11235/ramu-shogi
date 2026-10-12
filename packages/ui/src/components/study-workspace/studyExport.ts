/**
 * 研究ノートの書き出し（クリップボードへのコピー用の文字列を作る）。
 *
 * - KIF: いま表示している手順（本譜、または選んだ変化）を、表示中の解析結果の評価値と、
 *   コメントつきで書き出す。変化の枝分かれは含めない（KIF の 1 本の手順として読める形にする）。
 * - SFEN: いま見ている局面までの手順を、USI の `position` の形で書き出す。
 */

import { type KifuTree, STUDY_HIRATE_SFEN, type StudyDocument } from "@shogi/app-core";
import {
    convertMovesToKif,
    exportToKifString,
    type NodeData,
} from "../shogi-match/utils/kifFormat";

/** 表示している手順（ルートから末端までのノード ID）を KIF の文字列にする。 */
export function exportStudyLineToKif(
    doc: StudyDocument,
    tree: KifuTree,
    line: readonly string[],
): string {
    const root = tree.nodes.get(line[0] ?? tree.rootId);
    const moves: string[] = [];
    const boards = [];
    const nodeData = new Map<number, NodeData>();
    const comments = new Map<number, string>();
    for (let index = 0; index < line.length; index++) {
        const nodeId = line[index];
        const stored = Object.hasOwn(doc.tree.nodes, nodeId) ? doc.tree.nodes[nodeId] : undefined;
        if (stored && stored.comment !== "") comments.set(index, stored.comment);
        if (index === 0) continue;
        const node = tree.nodes.get(nodeId);
        const parent = tree.nodes.get(line[index - 1]);
        if (!node || !parent || node.usiMove === null) break;
        moves.push(node.usiMove);
        boards.push(parent.positionAfter.board);
        const elapsedMs = stored?.source?.elapsedMs ?? undefined;
        if (node.eval || elapsedMs !== undefined) {
            nodeData.set(index, {
                scoreCp: node.eval?.scoreCp,
                scoreMate: node.eval?.scoreMate,
                depth: node.eval?.depth,
                elapsedMs,
            });
        }
    }
    const startTurn = root?.positionAfter.turn ?? "sente";
    return exportToKifString(convertMovesToKif(moves, boards, nodeData, startTurn), boards, {
        senteName: doc.meta.blackName?.trim() || undefined,
        goteName: doc.meta.whiteName?.trim() || undefined,
        includeEval: true,
        startSfen: tree.startSfen,
        comments,
    });
}

/** 開始局面と、いま見ている局面までの手順を、USI の `position` の形にする。 */
export function exportStudyPositionToSfen(startSfen: string, moves: readonly string[]): string {
    const trimmed = startSfen.trim();
    // 平手は、SFEN で保存されていても `startpos` と書く（短く、読む側も平手だと分かる）。
    const isHirate = trimmed === "startpos" || trimmed === STUDY_HIRATE_SFEN;
    const start = isHirate ? "startpos" : `sfen ${trimmed.replace(/^sfen\s+/, "")}`;
    return moves.length > 0 ? `position ${start} moves ${moves.join(" ")}` : `position ${start}`;
}
