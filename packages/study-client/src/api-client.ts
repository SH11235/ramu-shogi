/**
 * 研究ノート API の fetch 実装。
 *
 * 既存の backend 呼び出し（`apps/web` の各ページ）と同じ流儀に合わせている:
 * 同一オリジンの `/api/...`、`credentials: "same-origin"`（セッション Cookie）、
 * 本文は `Content-Type: application/json`。
 */

import { RATE_LIMITED_MESSAGE } from "@shogi/app-core";
import type {
    CreateStudyRequest,
    CreateStudyResponse,
    GetStudyResponse,
    ListStudiesParams,
    ListStudiesResponse,
    StudyApi,
    StudyApiErrorBody,
    StudyApiResult,
    StudyLimitsResponse,
    StudyOpsRequest,
    StudyOpsResponse,
} from "./api-types";

export interface StudyApiClientOptions {
    /** 既定は `globalThis.fetch`。 */
    fetch?: typeof fetch;
    /** API のオリジン。既定は空文字（同一オリジン）。 */
    baseUrl?: string;
}

const readErrorBody = async (response: Response): Promise<StudyApiErrorBody> => {
    try {
        const payload: unknown = await response.json();
        if (payload !== null && typeof payload === "object") {
            return payload as StudyApiErrorBody;
        }
    } catch {
        // 本文が JSON でないエラー（プロキシの 502 など）。
    }
    return {};
};

export function createStudyApiClient(options: StudyApiClientOptions = {}): StudyApi {
    const baseUrl = options.baseUrl ?? "";

    const request = async <T>(
        method: "GET" | "POST" | "DELETE",
        path: string,
        body?: unknown,
    ): Promise<StudyApiResult<T>> => {
        const doFetch = options.fetch ?? globalThis.fetch;
        let response: Response;
        try {
            response = await doFetch(`${baseUrl}${path}`, {
                method,
                credentials: "same-origin",
                ...(body === undefined
                    ? {}
                    : {
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify(body),
                      }),
            });
        } catch (error) {
            return {
                ok: false,
                status: 0,
                error: {
                    error: "NETWORK_ERROR",
                    message: error instanceof Error ? error.message : String(error),
                },
            };
        }
        if (!response.ok) {
            const error = await readErrorBody(response);
            // 本文の message は英語で、zone のレート制限では本文が HTML で message も無いので、画面に出す文言に差し替える
            if (response.status === 429) error.message = RATE_LIMITED_MESSAGE;
            return { ok: false, status: response.status, error };
        }
        if (response.status === 204) {
            return { ok: true, status: 204, data: null as T };
        }
        try {
            return { ok: true, status: response.status, data: (await response.json()) as T };
        } catch (error) {
            return {
                ok: false,
                status: 0,
                error: {
                    error: "INVALID_RESPONSE",
                    message: error instanceof Error ? error.message : String(error),
                },
            };
        }
    };

    const studyPath = (studyId: string): string => `/api/studies/${encodeURIComponent(studyId)}`;

    return {
        list(params: ListStudiesParams = {}) {
            const query = new URLSearchParams();
            if (params.limit !== undefined) query.set("limit", String(params.limit));
            if (params.cursor !== undefined) query.set("cursor", params.cursor);
            if (params.originKind !== undefined) query.set("originKind", params.originKind);
            if (params.originRef !== undefined) query.set("originRef", params.originRef);
            const queryText = query.toString();
            const suffix = queryText === "" ? "" : `?${queryText}`;
            return request<ListStudiesResponse>("GET", `/api/studies${suffix}`);
        },
        create(body: CreateStudyRequest) {
            return request<CreateStudyResponse>("POST", "/api/studies", body);
        },
        get(studyId: string) {
            return request<GetStudyResponse>("GET", studyPath(studyId));
        },
        postOps(studyId: string, body: StudyOpsRequest) {
            return request<StudyOpsResponse>("POST", `${studyPath(studyId)}/ops`, body);
        },
        delete(studyId: string) {
            return request<null>("DELETE", studyPath(studyId));
        },
        limits() {
            return request<StudyLimitsResponse>("GET", "/api/studies/limits");
        },
    };
}
