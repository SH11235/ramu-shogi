/**
 * 研究ノート（study）の保存用の型。
 *
 * backend（`/api/studies`）と同じ JSON の形をそのまま型にしている。フィールド名・値の意味は
 * 設計書（研究ノート 5 章・6 章）の契約で固定されており、ここで変えてはいけない。
 */

/** 評価値（常に先手視点）。欠測は `null` で表し、0 で代用しない。 */
export type StudyScore =
    | { kind: "cp"; value: number }
    | { kind: "mate"; winner: StudyPlayer; plies: number | null };

export type StudyPlayer = "sente" | "gote";

/** 対局時の評価値（棋譜の来歴。解析では上書きしない）。 */
export interface StudySource {
    /** 出どころの種別。初版で使うのは `"csa"`。 */
    kind: string;
    score: StudyScore | null;
    pv: string[] | null;
    elapsedMs: number | null;
}

export interface StudyNode {
    parentId: string | null;
    /** USI の指し手。ルートは null。 */
    usiMove: string | null;
    /** 子の `nodeId`。先頭が本譜。 */
    children: string[];
    comment: string;
    bookmarked: boolean;
    source: StudySource | null;
}

export interface StudyTree {
    version: 1;
    rootId: string;
    nodes: Record<string, StudyNode>;
}

/** 初版は `{"variant":"standard"}` のみ。 */
export interface StudyRules {
    variant: "standard";
}

export type StudyOriginKind = "rshogi_csa" | "game_record" | "paste";

export interface StudyOrigin {
    kind: StudyOriginKind;
    /** 元棋譜の識別子。`paste` は null。 */
    ref: string | null;
}

/** 表示用の自由なメタ情報（値は文字列のみ）。 */
export type StudyMeta = Record<string, string>;

export interface StudyCandidate {
    /** 1 が最善。 */
    rank: number;
    score: StudyScore;
    depth: number;
    seldepth: number | null;
    pv: string[];
}

export interface StudyExecution {
    threads: number | null;
    hashMb: number | null;
    parallelWorkers: number | null;
}

/** 解析結果。1 回の探索が 1 単位。対象は「そのノードの手を指した後の局面」。 */
export interface StudyAnalysisResult {
    runId: string;
    completion: "completed" | "aborted";
    /** 最善候補の深さ。取れなければ 0。 */
    depth: number;
    nodes: number | null;
    timeMs: number | null;
    execution: StudyExecution;
    /** 1 回の探索の候補一式。1 本以上。 */
    candidates: StudyCandidate[];
}

export type StudyEngineKind = "wasm" | "native" | "external";

export interface StudyLayerStacksSpec {
    bucketMode: string;
    progressBuckets: number | null;
}

/** 解析レイヤーの条件。作成後は変わらない。`layerId` はこの値のハッシュ。 */
export interface StudyLayerSpec {
    version: 1;
    engine: { kind: StudyEngineKind; name: string; version: string };
    evaluation: {
        nnueSha256: string | null;
        fvScale: number | null;
        progressSha256: string | null;
        layerStacks: StudyLayerStacksSpec | null;
    };
    /** 実際にエンジンへ渡した探索上限。使わない上限は null。 */
    limits: { timeMs: number | null; depth: number | null; nodes: number | null };
    multiPv: number;
    rules: StudyRules;
}

/** レイヤーの表示用の情報。`spec` に入れない表示名やプリセットキーを持つ。 */
export interface StudyLayerDisplay {
    label: string;
    nnueName?: string;
    presetKey?: string;
}

export interface StudyLayer {
    id: string;
    spec: StudyLayerSpec;
    display: StudyLayerDisplay;
    /** `nodeId` → 解析結果。 */
    results: Record<string, StudyAnalysisResult>;
}

/**
 * 研究ノートの文書。`GET /api/studies/{id}` の `study` から
 * `revision` / `createdAt` / `updatedAt` を除いたもの。
 */
export interface StudyDocument {
    id: string;
    title: string;
    origin: StudyOrigin;
    /** SFEN の 4 フィールド。平手も `startpos` と書かない。作成後は不変。 */
    startSfen: string;
    rules: StudyRules;
    meta: StudyMeta;
    tree: StudyTree;
    layers: StudyLayer[];
}

/** 操作バッチの操作（設計書 6.3 の 10 種類）。 */
export type StudyOp =
    | { type: "addMoves"; parentId: string; moves: string[] }
    | { type: "setComment"; nodeId: string; value: string }
    | { type: "setBookmark"; nodeId: string; value: boolean }
    | { type: "setSource"; nodeId: string; value: StudySource | null }
    | { type: "reorderChildren"; parentId: string; value: string[] }
    | { type: "deleteSubtree"; nodeId: string }
    | { type: "ensureLayer"; spec: StudyLayerSpec; display: StudyLayerDisplay }
    | { type: "putAnalysis"; layerId: string; nodeId: string; result: StudyAnalysisResult }
    | { type: "deleteLayer"; layerId: string }
    | { type: "setTitle"; value: string };

/** 上限の初期値（設計書 5.7）。サーバーが最終判定する。クライアントは切り詰めと事前の案内に使う。 */
export const STUDY_LIMITS = {
    nodesPerStudy: 2000,
    maxPathLength: 1024,
    layersPerStudy: 8,
    commentBytes: 4 * 1024,
    titleLength: 200,
    multiPv: 5,
    pvLength: 40,
    opsPerBatch: 200,
    batchBodyBytes: 512 * 1024,
} as const;

export const STANDARD_STUDY_RULES: StudyRules = { variant: "standard" };

/** 平手の開始局面（SFEN 4 フィールド）。 */
export const STUDY_HIRATE_SFEN = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1";
