/**
 * 研究ノートの操作と文書の検証（設計書 5.4 / 5.5 / 5.7）。
 *
 * backend（`apps/api-worker/src/studies/validation.ts` と zod スキーマ）と同じ規則で、
 * サーバーが受け付けない操作を、ローカルに保存する前に弾くためのもの。弾かずに保存すると、
 * その操作が送信待ちの先頭に残り続け、あとから直しても同じバッチごと拒否されてしまう。
 *
 * - 形として成り立たない入力は `StudyOpError`（サーバーの 400 に相当）
 * - 上限超過は `StudyLimitError`（サーバーの 422 に相当。`limit` に上限の名前）
 */

import { canonicalJSON } from "./ids";
import { applyStudyOp, isStudyUsiMove, StudyOpError } from "./ops";
import {
    STUDY_LIMITS,
    type StudyAnalysisResult,
    type StudyDocument,
    type StudyLayerDisplay,
    type StudyLayerSpec,
    type StudyLimitName,
    type StudyOp,
    type StudyScore,
    type StudySource,
    type StudyTree,
} from "./types";

/** 上限（設計書 5.7）を超える操作・文書。`limit` は超えた上限の名前。 */
export class StudyLimitError extends StudyOpError {
    readonly limit: StudyLimitName;

    constructor(limit: StudyLimitName) {
        super(`研究ノートの上限を超えています: ${limit}`);
        this.name = "StudyLimitError";
        this.limit = limit;
    }
}

/** 形の決まっていない JSON 値（`layerStacks`、`display` の追加の項目）の入れ子の深さの上限。 */
export const STUDY_FREE_JSON_MAX_DEPTH = 8;

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

/** クライアント生成の ID（`studyId` / `runId` / `batchId`）として使える、小文字の UUID v4 か。 */
export function isStudyUuid(value: unknown): value is string {
    return typeof value === "string" && UUID_V4_PATTERN.test(value);
}

/** UTF-8 にしたときのバイト数が limit を超えるか（必要なときだけ数える）。 */
function exceedsUtf8Bytes(value: string, limit: number): boolean {
    if (value.length > limit) return true;
    if (value.length * 3 <= limit) return false;
    let bytes = 0;
    for (let i = 0; i < value.length; i++) {
        const code = value.charCodeAt(i);
        if (code < 0x80) bytes += 1;
        else if (code < 0x800) bytes += 2;
        else if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length) {
            const next = value.charCodeAt(i + 1);
            if (next >= 0xdc00 && next <= 0xdfff) {
                bytes += 4;
                i++;
            } else bytes += 3;
        } else bytes += 3;
        if (bytes > limit) return true;
    }
    return false;
}

/**
 * JSON として表せる値だけでできていて、入れ子の深さが `maxDepth` 以下か
 * （スカラーは 0、`[1]` は 1）。再帰を使わずに確かめる。
 */
export function isBoundedStudyJson(
    value: unknown,
    maxDepth: number = STUDY_FREE_JSON_MAX_DEPTH,
): boolean {
    const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
    while (stack.length > 0) {
        const current = stack.pop() as { value: unknown; depth: number };
        const item = current.value;
        if (item === null || typeof item === "string" || typeof item === "boolean") continue;
        if (typeof item === "number") {
            if (!Number.isFinite(item)) return false;
            continue;
        }
        if (typeof item !== "object") return false;
        if (current.depth + 1 > maxDepth) return false;
        if (Array.isArray(item)) {
            for (const child of item) stack.push({ value: child, depth: current.depth + 1 });
            continue;
        }
        const prototype = Object.getPrototypeOf(item);
        if (prototype !== Object.prototype && prototype !== null) return false;
        if (Object.hasOwn(item, "__proto__")) return false;
        for (const child of Object.values(item)) {
            stack.push({ value: child, depth: current.depth + 1 });
        }
    }
    return true;
}

const invalid = (message: string): never => {
    throw new StudyOpError(message);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value);

const isCount = (value: unknown): value is number =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const isCountOrNull = (value: unknown): boolean => value === null || isCount(value);

/** 決まったキーだけを持つオブジェクトか（サーバーは未知のキー・欠けたキーを 400 にする）。 */
function assertExactKeys(value: unknown, keys: readonly string[], what: string): void {
    if (!isRecord(value)) invalid(`${what}: オブジェクトではありません`);
    const actual = Object.keys(value as Record<string, unknown>);
    if (actual.length !== keys.length || !keys.every((key) => actual.includes(key))) {
        invalid(`${what}: 項目が契約と一致しません`);
    }
}

function assertScore(score: StudyScore | null, what: string): void {
    if (score === null) return;
    if (!isRecord(score)) invalid(`${what}: 評価値の形が正しくありません`);
    if (score.kind === "cp") {
        assertExactKeys(score, ["kind", "value"], what);
        if (!Number.isSafeInteger(score.value)) invalid(`${what}: 評価値は整数にします`);
        return;
    }
    if (score.kind === "mate") {
        assertExactKeys(score, ["kind", "winner", "plies"], what);
        if (score.winner !== "sente" && score.winner !== "gote") {
            invalid(`${what}: 詰みの勝者が正しくありません`);
        }
        if (!isCountOrNull(score.plies)) invalid(`${what}: 詰みの手数が正しくありません`);
        return;
    }
    invalid(`${what}: 評価値の種別が正しくありません`);
}

function assertPv(pv: unknown, what: string): void {
    if (!Array.isArray(pv)) invalid(`${what}: 読み筋は配列にします`);
    const moves = pv as unknown[];
    if (moves.length > STUDY_LIMITS.pvLength) throw new StudyLimitError("pvLength");
    if (!moves.every((move) => isStudyUsiMove(move))) {
        invalid(`${what}: 読み筋に USI の書式でない指し手があります`);
    }
}

/** 対局時の評価値（`source`）の形と上限。 */
export function assertStudySource(source: StudySource | null): void {
    if (source === null) return;
    assertExactKeys(source, ["kind", "score", "pv", "elapsedMs"], "source");
    if (typeof source.kind !== "string" || source.kind.length < 1 || source.kind.length > 32) {
        invalid("source: kind は 1〜32 文字にします");
    }
    assertScore(source.score, "source");
    if (source.pv !== null) assertPv(source.pv, "source");
    if (!isCountOrNull(source.elapsedMs)) invalid("source: elapsedMs が正しくありません");
}

/** 解析結果の形と上限（候補は 1〜5 本、rank は重複なしで 1 を含む、読み筋は 40 手まで）。 */
export function assertStudyAnalysisResult(result: StudyAnalysisResult): void {
    assertExactKeys(
        result,
        ["runId", "completion", "depth", "nodes", "timeMs", "execution", "candidates"],
        "解析結果",
    );
    if (!isStudyUuid(result.runId)) invalid("解析結果: runId は小文字の UUID v4 にします");
    if (result.completion !== "completed" && result.completion !== "aborted") {
        invalid("解析結果: completion が正しくありません");
    }
    if (!isCount(result.depth)) invalid("解析結果: depth が正しくありません");
    if (!isCountOrNull(result.nodes) || !isCountOrNull(result.timeMs)) {
        invalid("解析結果: nodes / timeMs が正しくありません");
    }
    assertExactKeys(result.execution, ["threads", "hashMb", "parallelWorkers"], "解析結果");
    if (
        !isCountOrNull(result.execution.threads) ||
        !isCountOrNull(result.execution.hashMb) ||
        !isCountOrNull(result.execution.parallelWorkers)
    ) {
        invalid("解析結果: execution が正しくありません");
    }
    if (!Array.isArray(result.candidates) || result.candidates.length === 0) {
        invalid("解析結果: 候補は 1 本以上必要です");
    }
    if (result.candidates.length > STUDY_LIMITS.multiPv) throw new StudyLimitError("multiPv");
    const ranks = new Set<number>();
    for (const candidate of result.candidates) {
        assertExactKeys(candidate, ["rank", "score", "depth", "seldepth", "pv"], "候補");
        if (!Number.isSafeInteger(candidate.rank) || candidate.rank < 1) {
            invalid("候補: rank は 1 以上の整数にします");
        }
        if (ranks.has(candidate.rank)) invalid("候補: rank が重複しています");
        ranks.add(candidate.rank);
        assertScore(candidate.score, "候補");
        if (!isCount(candidate.depth) || !isCountOrNull(candidate.seldepth)) {
            invalid("候補: depth / seldepth が正しくありません");
        }
        assertPv(candidate.pv, "候補");
    }
    // rank 1 が最善の候補。最善の無い結果は受け付けない。
    if (!ranks.has(1)) invalid("解析結果: rank 1 の候補が必要です");
}

/** 解析レイヤーの `spec` の形と上限。 */
export function assertStudyLayerSpec(spec: StudyLayerSpec): void {
    assertExactKeys(
        spec,
        ["version", "engine", "evaluation", "limits", "multiPv", "rules"],
        "レイヤーの spec",
    );
    if (spec.version !== 1) invalid("レイヤーの spec: version は 1 にします");
    assertExactKeys(spec.engine, ["kind", "name", "version"], "レイヤーの spec.engine");
    if (!["wasm", "native", "external"].includes(spec.engine.kind)) {
        invalid("レイヤーの spec.engine: kind が正しくありません");
    }
    if (
        typeof spec.engine.name !== "string" ||
        spec.engine.name === "" ||
        typeof spec.engine.version !== "string" ||
        spec.engine.version === ""
    ) {
        invalid("レイヤーの spec.engine: name / version は空にできません");
    }
    assertExactKeys(
        spec.evaluation,
        ["nnueSha256", "fvScale", "progressSha256", "layerStacks"],
        "レイヤーの spec.evaluation",
    );
    const { nnueSha256, fvScale, progressSha256, layerStacks } = spec.evaluation;
    for (const hash of [nnueSha256, progressSha256]) {
        if (hash !== null && (typeof hash !== "string" || !SHA256_PATTERN.test(hash))) {
            invalid("レイヤーの spec.evaluation: SHA-256 は 64 文字の小文字 hex にします");
        }
    }
    if (fvScale !== null && !Number.isSafeInteger(fvScale)) {
        invalid("レイヤーの spec.evaluation: fvScale は整数にします");
    }
    if (!isBoundedStudyJson(layerStacks)) {
        invalid("レイヤーの spec.evaluation: layerStacks の入れ子が深すぎるか、JSON にできません");
    }
    assertExactKeys(spec.limits, ["timeMs", "depth", "nodes"], "レイヤーの spec.limits");
    if (
        !isCountOrNull(spec.limits.timeMs) ||
        !isCountOrNull(spec.limits.depth) ||
        !isCountOrNull(spec.limits.nodes)
    ) {
        invalid("レイヤーの spec.limits: 探索上限は 0 以上の整数か null にします");
    }
    if (!Number.isSafeInteger(spec.multiPv) || spec.multiPv < 1) {
        invalid("レイヤーの spec: multiPv は 1 以上の整数にします");
    }
    assertExactKeys(spec.rules, ["variant"], "レイヤーの spec.rules");
    if (spec.rules.variant !== "standard")
        invalid("レイヤーの spec.rules: variant が正しくありません");

    let canonical = "";
    try {
        canonical = canonicalJSON(spec);
    } catch {
        // layerStacks に小数などが入っていると正規化できない（layerId を計算できない）。
        invalid("レイヤーの spec: 数値は整数だけにします");
    }
    if (exceedsUtf8Bytes(canonical, STUDY_LIMITS.layerSpecBytes)) {
        throw new StudyLimitError("layerSpecBytes");
    }
    if (spec.multiPv > STUDY_LIMITS.multiPv) throw new StudyLimitError("multiPv");
}

/** レイヤーの表示用の情報の形と上限（`label` 必須、追加の項目は入れ子の深さ 8 まで）。 */
export function assertStudyLayerDisplay(display: StudyLayerDisplay): void {
    if (!isRecord(display) || typeof display.label !== "string") {
        invalid("レイヤーの display: label が必要です");
    }
    for (const value of Object.values(display as Record<string, unknown>)) {
        if (value !== undefined && !isBoundedStudyJson(value)) {
            invalid("レイヤーの display: 追加の項目の入れ子が深すぎるか、JSON にできません");
        }
    }
    if (exceedsUtf8Bytes(JSON.stringify(display), STUDY_LIMITS.layerDisplayBytes)) {
        throw new StudyLimitError("layerDisplayBytes");
    }
}

/** 表題の上限（Unicode のコードポイントで 200 文字）。 */
export function assertStudyTitle(title: string): void {
    if (typeof title !== "string") invalid("表題は文字列にします");
    if (Array.from(title).length > STUDY_LIMITS.titleLength) {
        throw new StudyLimitError("titleLength");
    }
}

/** コメントの上限（UTF-8 で 4 KiB）。 */
export function assertStudyComment(comment: string): void {
    if (typeof comment !== "string") invalid("コメントは文字列にします");
    if (exceedsUtf8Bytes(comment, STUDY_LIMITS.commentBytes)) {
        throw new StudyLimitError("commentBytes");
    }
}

/**
 * 操作 1 つの入力（文書に依らない部分）を検証する。
 * 文書に依る上限（ノード数、手順の長さ、レイヤー数、JSON の大きさ）は `applyStudyOpsStrict` が見る。
 */
export function assertStudyOpInput(op: StudyOp): void {
    switch (op.type) {
        case "addMoves":
            // 手順の形（1 手以上、USI の書式）は適用時に確かめる。
            return;
        case "setComment":
            assertStudyComment(op.value);
            return;
        case "setBookmark":
            if (typeof op.value !== "boolean") invalid("setBookmark: 値は真偽値にします");
            return;
        case "setSource":
            assertStudySource(op.value);
            return;
        case "reorderChildren":
            if (!Array.isArray(op.value) || !op.value.every((id) => typeof id === "string")) {
                invalid("reorderChildren: 子の nodeId の配列にします");
            }
            return;
        case "deleteSubtree":
        case "deleteLayer":
            return;
        case "ensureLayer":
            assertStudyLayerSpec(op.spec);
            assertStudyLayerDisplay(op.display);
            return;
        case "putAnalysis":
            assertStudyAnalysisResult(op.result);
            return;
        case "setTitle":
            assertStudyTitle(op.value);
            return;
        default: {
            const unknown: never = op;
            invalid(`未知の操作です: ${JSON.stringify(unknown)}`);
        }
    }
}

const depthOf = (tree: StudyTree, nodeId: string): number => {
    let depth = 0;
    let current = Object.hasOwn(tree.nodes, nodeId) ? tree.nodes[nodeId] : undefined;
    while (current && current.parentId !== null && depth <= STUDY_LIMITS.lineLength + 1) {
        depth++;
        current = Object.hasOwn(tree.nodes, current.parentId)
            ? tree.nodes[current.parentId]
            : undefined;
    }
    return depth;
};

/** `addMoves` の手順をたどった先のノード。 */
const endOfLine = (tree: StudyTree, parentId: string, moves: readonly string[]): string => {
    let currentId = parentId;
    for (const move of moves) {
        const next = tree.nodes[currentId]?.children.find(
            (childId) => tree.nodes[childId]?.usiMove === move,
        );
        if (next === undefined) break;
        currentId = next;
    }
    return currentId;
};

const assertTreeBytes = (tree: StudyTree): void => {
    if (exceedsUtf8Bytes(JSON.stringify(tree), STUDY_LIMITS.treeBytes)) {
        throw new StudyLimitError("treeBytes");
    }
};

const assertLayerResultsBytes = (results: Record<string, StudyAnalysisResult>): void => {
    if (exceedsUtf8Bytes(JSON.stringify(results), STUDY_LIMITS.layerResultsBytes)) {
        throw new StudyLimitError("layerResultsBytes");
    }
};

/**
 * 操作を検証しながら配列の順に適用する（サーバーが受け付ける操作だけを通す）。
 *
 * 1 つでも入力不正（`StudyOpError`）・上限超過（`StudyLimitError`）なら例外を投げ、
 * 渡された文書は変えない。対象の無い操作の読み飛ばしと冪等性は `applyStudyOp` と同じ。
 */
export function applyStudyOpsStrict(doc: StudyDocument, ops: readonly StudyOp[]): StudyDocument {
    let current = doc;
    for (const op of ops) {
        assertStudyOpInput(op);
        const next = applyStudyOp(current, op);
        if (next.tree !== current.tree && op.type === "addMoves") {
            if (Object.keys(next.tree.nodes).length > STUDY_LIMITS.nodesPerStudy) {
                throw new StudyLimitError("nodesPerStudy");
            }
            const end = endOfLine(next.tree, op.parentId, op.moves);
            if (depthOf(next.tree, end) > STUDY_LIMITS.lineLength) {
                throw new StudyLimitError("lineLength");
            }
        }
        if (
            next.layers.length > current.layers.length &&
            next.layers.length > STUDY_LIMITS.layersPerStudy
        ) {
            throw new StudyLimitError("layersPerStudy");
        }
        current = next;
    }
    if (current.tree !== doc.tree) assertTreeBytes(current.tree);
    for (const layer of current.layers) {
        const before = doc.layers.find((item) => item.id === layer.id);
        if (before?.results !== layer.results) assertLayerResultsBytes(layer.results);
    }
    return current;
}

/**
 * 文書の全体が、サーバーの作成 API に受け付けられる形と上限に収まっているか検証する。
 * 取り込んだ棋譜をノートにする前の案内（長すぎる棋譜など）に使う。
 */
export function validateStudyDocument(doc: StudyDocument): void {
    if (!isStudyUuid(doc.id)) invalid("研究ノートの ID は小文字の UUID v4 にします");
    assertStudyTitle(doc.title);
    if (doc.origin.kind === "paste" ? doc.origin.ref !== null : !doc.origin.ref) {
        invalid("origin: paste は ref が null、それ以外は ref が必要です");
    }
    if (doc.startSfen.split(" ").length !== 4 || doc.startSfen.trim() !== doc.startSfen) {
        invalid("startSfen は SFEN の 4 フィールドを空白 1 つで区切った形にします");
    }
    if (!Object.values(doc.meta).every((value) => typeof value === "string")) {
        invalid("meta の値は文字列にします");
    }
    if (exceedsUtf8Bytes(JSON.stringify(doc.meta), STUDY_LIMITS.metaBytes)) {
        throw new StudyLimitError("metaBytes");
    }

    const { nodes, rootId } = doc.tree;
    const nodeCount = Object.keys(nodes).length;
    if (nodeCount > STUDY_LIMITS.nodesPerStudy) throw new StudyLimitError("nodesPerStudy");
    if (!Object.hasOwn(nodes, rootId)) invalid("ツリーにルートがありません");
    let visited = 0;
    const stack: Array<{ id: string; depth: number }> = [{ id: rootId, depth: 0 }];
    while (stack.length > 0) {
        const { id, depth } = stack.pop() as { id: string; depth: number };
        const node = nodes[id];
        visited++;
        if (visited > nodeCount) invalid("ツリーに循環があります");
        assertStudyComment(node.comment);
        assertStudySource(node.source);
        for (const childId of node.children) {
            if (!Object.hasOwn(nodes, childId) || nodes[childId].parentId !== id) {
                invalid("ツリーの親子の対応が正しくありません");
            }
            if (depth + 1 > STUDY_LIMITS.lineLength) throw new StudyLimitError("lineLength");
            stack.push({ id: childId, depth: depth + 1 });
        }
    }
    if (visited !== nodeCount) invalid("ツリーにルートからたどれないノードがあります");
    assertTreeBytes(doc.tree);

    if (doc.layers.length > STUDY_LIMITS.layersPerStudy)
        throw new StudyLimitError("layersPerStudy");
    for (const layer of doc.layers) {
        assertStudyLayerSpec(layer.spec);
        assertStudyLayerDisplay(layer.display);
        for (const [nodeId, result] of Object.entries(layer.results)) {
            if (!Object.hasOwn(nodes, nodeId)) invalid("ツリーに無いノードの解析結果があります");
            assertStudyAnalysisResult(result);
        }
        assertLayerResultsBytes(layer.results);
    }
}
