/**
 * 棋譜から初期の研究ノート文書を作る。
 *
 * 取り込んだ棋譜に元から付いていた評価値・読み筋・消費時間は、ノードの `source`
 * （対局時の評価値）に入れる。解析レイヤーには入れない。
 */

import { applyMoveWithState } from "../game/board";
import { parseCsaGameRecord } from "../game/csa-record";
import type { KifuTree } from "../game/kifu-tree";
import { normalizeStudyStartSfen, studyChildNodeId, studyRootNodeId } from "./ids";
import { isStudyUsiMove } from "./ops";
import { parseStudySfen } from "./sfen";
import { kifuTreeToStudyTree, type StudyNodeIdIndex } from "./tree-convert";
import {
    STANDARD_STUDY_RULES,
    STUDY_LIMITS,
    type StudyDocument,
    type StudyMeta,
    type StudyNode,
    type StudyOrigin,
    type StudyScore,
    type StudySource,
} from "./types";

/** 取り込む棋譜の 1 手に付いていた情報（評価値は先手視点）。 */
export interface StudyImportAnnotation {
    score?: StudyScore | null;
    /** 読み筋（USI）。その手を指した後の局面から始まる。 */
    pv?: readonly string[] | null;
    elapsedMs?: number | null;
}

export interface StudyImportInput {
    /** 研究ノートの ID（UUID v4。クライアントが生成する）。 */
    id: string;
    title: string;
    origin: StudyOrigin;
    /** 開始局面。`startpos` も可（保存用の SFEN に直す）。 */
    startSfen: string;
    /** 本譜の指し手（USI）。 */
    moves: readonly string[];
    /** `moves` と同じ順。何も付いていない手は undefined / null。 */
    annotations?: ReadonlyArray<StudyImportAnnotation | null | undefined>;
    /** 対局時の評価値の出どころ（`source.kind`）。既定は `"csa"`。 */
    sourceKind?: string;
    meta?: StudyMeta;
}

const clampTitle = (title: string): string => {
    const trimmed = title.trim();
    const chars = Array.from(trimmed.length > 0 ? trimmed : "研究ノート");
    return chars.slice(0, STUDY_LIMITS.titleLength).join("");
};

const cleanMeta = (meta: StudyMeta | undefined): StudyMeta => {
    const cleaned: StudyMeta = {};
    for (const [key, value] of Object.entries(meta ?? {})) {
        if (typeof value === "string" && value !== "") cleaned[key] = value;
    }
    return cleaned;
};

const toSource = (
    kind: string,
    annotation: StudyImportAnnotation | null | undefined,
): StudySource | null => {
    if (!annotation) return null;
    const score = annotation.score ?? null;
    const pv =
        annotation.pv && annotation.pv.length > 0
            ? annotation.pv.slice(0, STUDY_LIMITS.pvLength)
            : null;
    const elapsedMs =
        annotation.elapsedMs != null && Number.isFinite(annotation.elapsedMs)
            ? Math.max(0, Math.round(annotation.elapsedMs))
            : null;
    if (score === null && pv === null && elapsedMs === null) return null;
    return { kind, score, pv, elapsedMs };
};

/** UUID v4 の研究ノート ID を作る。 */
export function generateStudyId(): string {
    return crypto.randomUUID();
}

/**
 * 開始局面と本譜の手順から研究ノートの文書を作る。
 *
 * 指し手は USI の書式と、開始局面から駒を動かせること（移動元に駒がある、成れる駒か、など）を
 * 確かめ、通らなければ例外にする。王手放置などの厳密な合法性は見ないので、信頼できない入力は
 * 先に `PositionService.replayMovesStrict` か `parseCsaGameRecord` を通すこと。
 */
export function createStudyDocumentFromMoves(input: StudyImportInput): StudyDocument {
    const startSfen = normalizeStudyStartSfen(input.startSfen);
    const sourceKind = input.sourceKind ?? "csa";
    const rootId = studyRootNodeId(startSfen, STANDARD_STUDY_RULES);
    const nodes: Record<string, StudyNode> = {
        [rootId]: {
            parentId: null,
            usiMove: null,
            children: [],
            comment: "",
            bookmarked: false,
            source: null,
        },
    };

    let position = parseStudySfen(startSfen);
    let parentId = rootId;
    input.moves.forEach((move, index) => {
        if (!isStudyUsiMove(move)) {
            throw new Error(`${index + 1} 手目が USI の指し手の書式ではありません: ${move}`);
        }
        const applied = applyMoveWithState(position, move);
        if (!applied.ok) {
            throw new Error(
                `${index + 1} 手目を適用できません: ${move} (${applied.error ?? "unknown"})`,
            );
        }
        position = applied.next;
        const nodeId = studyChildNodeId(parentId, move);
        nodes[parentId] = { ...nodes[parentId], children: [nodeId] };
        nodes[nodeId] = {
            parentId,
            usiMove: move,
            children: [],
            comment: "",
            bookmarked: false,
            source: toSource(sourceKind, input.annotations?.[index]),
        };
        parentId = nodeId;
    });

    return {
        id: input.id,
        title: clampTitle(input.title),
        origin: input.origin,
        startSfen,
        rules: STANDARD_STUDY_RULES,
        meta: cleanMeta(input.meta),
        tree: { version: 1, rootId, nodes },
        layers: [],
    };
}

export interface StudyCsaImportInput {
    id: string;
    /** CSA 棋譜の全文。 */
    csa: string;
    origin: StudyOrigin;
    /** 省略時は対局者名から作る。 */
    title?: string;
    /** 対局者名のほかに足すメタ情報（`playedAt` / `venue` / `event` / `result` など）。 */
    meta?: StudyMeta;
}

/**
 * CSA 棋譜から研究ノートの文書を作る。
 *
 * 指し手は `parseCsaGameRecord` が開始局面に照らして厳密に検証する（指せない手は例外）。
 * 棋譜に付いていた評価値・読み筋・消費時間は `source`（`kind: "csa"`）に入る。
 */
export function createStudyDocumentFromCsa(input: StudyCsaImportInput): StudyDocument {
    const record = parseCsaGameRecord(input.csa);
    const annotations = record.annotations.map((annotation): StudyImportAnnotation | null => {
        if (!annotation) return null;
        const score: StudyScore | null =
            annotation.mateWinner !== undefined
                ? { kind: "mate", winner: annotation.mateWinner, plies: null }
                : annotation.evalCp !== undefined
                  ? { kind: "cp", value: annotation.evalCp }
                  : null;
        return { score, pv: annotation.pv ?? null, elapsedMs: annotation.elapsedMs ?? null };
    });
    const names = [record.senteName, record.goteName].filter(
        (name): name is string => typeof name === "string" && name.trim() !== "",
    );
    return createStudyDocumentFromMoves({
        id: input.id,
        title: input.title ?? (names.length === 2 ? `${names[0]} 対 ${names[1]}` : ""),
        origin: input.origin,
        startSfen: record.startSfen,
        moves: record.moves,
        annotations,
        sourceKind: "csa",
        meta: {
            ...(record.senteName ? { blackName: record.senteName } : {}),
            ...(record.goteName ? { whiteName: record.goteName } : {}),
            ...input.meta,
        },
    });
}

export interface StudyKifuTreeImportInput {
    id: string;
    title: string;
    origin: StudyOrigin;
    /** 画面で開いている実行時の棋譜ツリー（分岐・コメントごと取り込む）。 */
    tree: KifuTree;
    /**
     * 対局時の評価値の出どころ（`source.kind`）。指定すると、棋譜から読んだ評価値
     * （先手視点に正規化済みのもの）と消費時間を `source` に入れる。null なら入れない。
     */
    sourceKind: string | null;
    meta?: StudyMeta;
}

/**
 * 実行時の棋譜ツリーから研究ノートの文書を作る（`/play` に読み込んだ棋譜などの取り込み用）。
 * 返す `index` は、実行時のノード ID と保存用の `nodeId` の対応表。
 */
export function createStudyDocumentFromKifuTree(input: StudyKifuTreeImportInput): {
    doc: StudyDocument;
    index: StudyNodeIdIndex;
} {
    const converted = kifuTreeToStudyTree(input.tree, { sourceKind: input.sourceKind });
    return {
        doc: {
            id: input.id,
            title: clampTitle(input.title),
            origin: input.origin,
            startSfen: converted.startSfen,
            rules: STANDARD_STUDY_RULES,
            meta: cleanMeta(input.meta),
            tree: converted.tree,
            layers: [],
        },
        index: converted.index,
    };
}
