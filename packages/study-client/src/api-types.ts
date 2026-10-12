/**
 * 研究ノート API（`/api/studies`）のリクエストと応答の型。
 *
 * 応答の入れ物（作成・一覧・操作バッチ・上限）は、backend の OpenAPI から生成した型
 * （`@shogi/api-contract`）の別名。文書を運ぶ型（作成リクエスト、操作バッチ、ノートの全体）は、
 * 操作の適用や `KifuTree` との変換が使う `@shogi/app-core` の型で組み立てている
 * （`app-core` は依存なしで、生成型を参照できないため）。両者がずれていないことは
 * `api-types.test.ts` が型で確かめる。
 */

import type {
    ApplyStudyOpsResponse,
    CreateStudyResponse as ContractCreateStudyResponse,
    ListStudiesResponse as ContractListStudiesResponse,
    StudySummary as ContractStudySummary,
    GetStudyLimitsResponse,
} from "@shogi/api-contract";
import type {
    StudyAnalysisResult,
    StudyDocument,
    StudyLayerDisplay,
    StudyLayerSpec,
    StudyLimitName,
    StudyMeta,
    StudyOp,
    StudyOrigin,
    StudyOriginKind,
    StudyRules,
    StudyTree,
} from "@shogi/app-core";

/** `POST /api/studies` の本文。 */
export interface CreateStudyRequest {
    id: string;
    title: string;
    origin: StudyOrigin;
    startSfen: string;
    rules: StudyRules;
    meta: StudyMeta;
    tree: StudyTree;
    layers?: Array<{
        spec: StudyLayerSpec;
        display: StudyLayerDisplay;
        results: Record<string, StudyAnalysisResult>;
    }>;
}

/** `201`（新規）または `200`（同じ id が本人のノートとして既にある。`existing: true`）。 */
export type CreateStudyResponse = ContractCreateStudyResponse;

/** `GET /api/studies/{id}` の `study`。 */
export interface StudyDetail extends StudyDocument {
    revision: number;
    createdAt: string;
    updatedAt: string;
}

export interface GetStudyResponse {
    study: StudyDetail;
}

/** 一覧の 1 件。`resultCount` は最も結果の多いレイヤーの件数（解析の進み具合の表示用）。 */
export type StudySummary = ContractStudySummary;

export type ListStudiesResponse = ContractListStudiesResponse;

export interface ListStudiesParams {
    limit?: number;
    cursor?: string;
    originKind?: StudyOriginKind;
    originRef?: string;
}

/** `POST /api/studies/{id}/ops` の本文。 */
export interface StudyOpsRequest {
    batchId: string;
    expectedRevision: number;
    ops: StudyOp[];
}

/** `replayed: true` は、応答が届かなかったバッチの再送だった（既に受理済み）。 */
export type StudyOpsResponse = ApplyStudyOpsResponse;

/** 上限（キーは上限の名前）と使用量。 */
export type StudyLimitsResponse = GetStudyLimitsResponse;

/**
 * エラー応答の本文。`error` はコード:
 * 400 `INVALID_REQUEST` / `INVALID_CURSOR`、403 `ORIGIN_FORBIDDEN`、404 `STUDY_NOT_FOUND`、
 * 409 `REVISION_CONFLICT` / `ORIGIN_EXISTS` / `ID_CONFLICT`、410 `STUDY_DELETED`、
 * 413 `PAYLOAD_TOO_LARGE`、422 `LIMIT_EXCEEDED`。
 */
export interface StudyApiErrorBody {
    error?: string;
    message?: string;
    /** `REVISION_CONFLICT` */
    currentRevision?: number;
    /** `ORIGIN_EXISTS` */
    existingStudyId?: string;
    /** `LIMIT_EXCEEDED` のとき、超えた上限の名前。 */
    limit?: StudyLimitName;
}

/**
 * API 呼び出しの結果。HTTP のステータスで分岐できるよう、例外にせず値で返す。
 * 通信できなかった（オフライン、中断など）場合は `status: 0`。
 */
export type StudyApiResult<T> =
    | { ok: true; status: number; data: T }
    | { ok: false; status: number; error: StudyApiErrorBody };

/** 研究ノート API のクライアント（設計書 6 章の 6 本）。 */
export interface StudyApi {
    list(params?: ListStudiesParams): Promise<StudyApiResult<ListStudiesResponse>>;
    create(body: CreateStudyRequest): Promise<StudyApiResult<CreateStudyResponse>>;
    get(studyId: string): Promise<StudyApiResult<GetStudyResponse>>;
    postOps(studyId: string, body: StudyOpsRequest): Promise<StudyApiResult<StudyOpsResponse>>;
    delete(studyId: string): Promise<StudyApiResult<null>>;
    limits(): Promise<StudyApiResult<StudyLimitsResponse>>;
}
