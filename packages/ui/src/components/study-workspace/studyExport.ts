/**
 * 研究ノートの書き出し（クリップボードへのコピー用の文字列を作る）。
 *
 * - KIF: いま表示している手順（本譜、または選んだ変化）を、表示中の解析結果の評価値と、
 *   コメントつきで書き出す。変化の枝分かれは含めない（KIF の 1 本の手順として読める形にする）。
 * - CSA: KIF と同じ手順・評価値・コメントを CSA で書き出す。CSA にはパスの書き方が無いので、
 *   パスを含む手順は書き出さない。
 * - SFEN: いま見ている局面までの手順を、USI の `position` の形で書き出す。
 */

import {
    CSA_MATE_EVAL_THRESHOLD,
    formatCsaMove,
    formatCsaStartPosition,
    isPassMove,
    type KifuTree,
    STUDY_HIRATE_SFEN,
    type StudyDocument,
} from "@shogi/app-core";
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

/** 表示している手順にパスがあるか（あれば CSA では書き出せない）。 */
export function studyLineHasPass(tree: KifuTree, line: readonly string[]): boolean {
    return line.some((nodeId) => {
        const move = tree.nodes.get(nodeId)?.usiMove;
        return move != null && isPassMove(move);
    });
}

const csaCommentLines = (comment: string | undefined): string[] =>
    comment
        ? comment
              .split(/\r?\n/)
              // `'*` で始まる行は評価値として読まれるので、本文が `*` で始まるときは間を空ける。
              .map((text) => (text.startsWith("*") ? `' ${text}` : `'${text}`))
        : [];

/**
 * 表示している手順を CSA の文字列にする。評価値は先手視点の `'** <評価値>` の行（詰みは
 * ±100000）で、指し手の直後に書く。パスを含む手順では例外を投げる（先に `studyLineHasPass` で確かめる）。
 */
export function exportStudyLineToCsa(
    doc: StudyDocument,
    tree: KifuTree,
    line: readonly string[],
): string {
    const root = tree.nodes.get(line[0] ?? tree.rootId);
    if (!root) throw new Error("研究ノートの開始局面が見つかりません");
    const lines = ["V2.2"];
    const blackName = doc.meta.blackName?.trim();
    const whiteName = doc.meta.whiteName?.trim();
    if (blackName) lines.push(`N+${blackName}`);
    if (whiteName) lines.push(`N-${whiteName}`);
    lines.push(...formatCsaStartPosition(root.positionAfter));
    for (let index = 0; index < line.length; index++) {
        const nodeId = line[index];
        const stored = Object.hasOwn(doc.tree.nodes, nodeId) ? doc.tree.nodes[nodeId] : undefined;
        if (index > 0) {
            const node = tree.nodes.get(nodeId);
            const parent = tree.nodes.get(line[index - 1]);
            if (!node || !parent || node.usiMove === null) break;
            const before = parent.positionAfter;
            lines.push(formatCsaMove(node.usiMove, before.board, before.turn));
            const elapsedMs = stored?.source?.elapsedMs;
            if (elapsedMs != null) lines.push(`T${Math.max(0, Math.round(elapsedMs / 1000))}`);
            const mate = node.eval?.scoreMate;
            // 詰みの手数 0（もう詰んでいる）は符号で勝つ側を表せないので、詰まされた手番から決める。
            const mateSign =
                mate == null
                    ? 0
                    : mate !== 0
                      ? Math.sign(mate)
                      : node.positionAfter.turn === "sente"
                        ? -1
                        : 1;
            const score = mate != null ? mateSign * CSA_MATE_EVAL_THRESHOLD : node.eval?.scoreCp;
            if (score != null && Number.isFinite(score)) lines.push(`'** ${score}`);
        }
        if (stored) lines.push(...csaCommentLines(stored.comment));
    }
    return `${lines.join("\n")}\n`;
}

/** 開始局面と、いま見ている局面までの手順を、USI の `position` の形にする。 */
export function exportStudyPositionToSfen(startSfen: string, moves: readonly string[]): string {
    const trimmed = startSfen.trim();
    // 平手は、SFEN で保存されていても `startpos` と書く（短く、読む側も平手だと分かる）。
    const isHirate = trimmed === "startpos" || trimmed === STUDY_HIRATE_SFEN;
    const start = isHirate ? "startpos" : `sfen ${trimmed.replace(/^sfen\s+/, "")}`;
    return moves.length > 0 ? `position ${start} moves ${moves.join(" ")}` : `position ${start}`;
}
