import type {
    InitializeNnueUploadResponse,
    ListNnueFilesResponse,
    NnueFileSummary,
} from "@shogi/api-contract";
import type { NnueAccountFile, NnueAccountStore } from "@shogi/ui";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { buildLoginHref, currentReturnPath } from "../lib/loginReturn";
import { parseApiError, useAuthSession } from "./useAuthSession";

const CHUNK_SIZE_BYTES = 50 * 1024 * 1024;
const PENDING_REFRESH_MS = 30_000;

async function sha256Hex(file: File): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    return Array.from(new Uint8Array(digest))
        .map((value) => value.toString(16).padStart(2, "0"))
        .join("");
}

function toAccountFile(file: NnueFileSummary): NnueAccountFile {
    return {
        id: file.id,
        originalFilename: file.originalFilename,
        sizeBytes: file.sizeBytes,
        sha256Hex: file.sha256Hex,
        createdAt: file.completedAt ?? file.createdAt,
        status: file.uploadStatus === "deleted" ? "failed" : file.uploadStatus,
    };
}

async function fetchAccountFiles(): Promise<NnueAccountFile[]> {
    const response = await fetch("/api/nnue/files", { credentials: "same-origin" });
    if (!response.ok) throw new Error(await parseApiError(response));
    const payload = (await response.json()) as ListNnueFilesResponse;
    return payload.files.filter((file) => file.uploadStatus !== "deleted").map(toAccountFile);
}

async function uploadFile(
    file: File,
    onProgress: (percent: number) => void,
    knownSha256Hex?: string,
): Promise<void> {
    const initResponse = await fetch("/api/nnue/uploads/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
            originalFilename: file.name,
            sizeBytes: file.size,
            sha256Hex: knownSha256Hex ?? (await sha256Hex(file)),
        }),
    });
    if (!initResponse.ok) throw new Error(await parseApiError(initResponse));

    const init = (await initResponse.json()) as InitializeNnueUploadResponse;
    let parts: Array<{ partNumber: number; etag: string }>;
    try {
        parts = await uploadParts(file, init, onProgress);
    } catch (error) {
        // 途中の記録は削除できない（中断が先に要る）。中断して、同じファイルを保存し直せるようにする。
        await fetch(
            `/api/nnue/uploads/${init.file.id}/abort?uploadId=${encodeURIComponent(init.uploadId)}`,
            { method: "POST", credentials: "same-origin" },
        ).catch(() => undefined);
        throw error;
    }

    // 完了の通知が届かなくてもサーバー側では完了していることがあるので、ここでは片付けない。
    const completeResponse = await fetch(`/api/nnue/uploads/${init.file.id}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ uploadId: init.uploadId, parts }),
    });
    if (!completeResponse.ok) throw new Error(await parseApiError(completeResponse));
}

async function uploadParts(
    file: File,
    init: InitializeNnueUploadResponse,
    onProgress: (percent: number) => void,
): Promise<Array<{ partNumber: number; etag: string }>> {
    const parts: Array<{ partNumber: number; etag: string }> = [];
    const totalParts = Math.ceil(file.size / CHUNK_SIZE_BYTES);
    for (let index = 0; index < totalParts; index++) {
        const partNumber = index + 1;
        const start = index * CHUNK_SIZE_BYTES;
        const end = Math.min(start + CHUNK_SIZE_BYTES, file.size);
        const partResponse = await fetch(
            `/api/nnue/uploads/${init.file.id}/parts/${partNumber}?uploadId=${encodeURIComponent(init.uploadId)}`,
            { method: "PUT", credentials: "same-origin", body: file.slice(start, end) },
        );
        if (!partResponse.ok) throw new Error(await parseApiError(partResponse));
        const part = (await partResponse.json()) as { partNumber: number; etag: string };
        parts.push({ partNumber: part.partNumber, etag: part.etag });
        onProgress(Math.round((end / file.size) * 100));
    }
    return parts;
}

const messageOf = (error: unknown, fallback: string): string =>
    error instanceof Error ? error.message : fallback;

/** ログインしたアカウントに保存する評価関数。未ログインでは空の一覧とログインの案内を返す。 */
export function useAccountNnue(): NnueAccountStore {
    const { session, isLoadingSession } = useAuthSession();
    const isAuthenticated = session?.authenticated === true;
    const [files, setFiles] = useState<NnueAccountFile[]>([]);
    // 一覧を変えるたびに進める。取得を始めた時点より後に変わっていたら、その取得結果は古いので捨てる
    // （定期の取り直しが、あとから削除した行を戻さないように）。
    const listVersionRef = useRef(0);
    const applyFetchedFiles = async (): Promise<void> => {
        const version = ++listVersionRef.current;
        const fetched = await fetchAccountFiles();
        if (version === listVersionRef.current) setFiles(fetched);
    };
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [busyKey, setBusyKey] = useState<string | null>(null);
    const [uploadProgress, setUploadProgress] = useState<number | null>(null);

    const refresh = useEffectEvent(async (): Promise<void> => {
        setIsLoading(true);
        setError(null);
        try {
            await applyFetchedFiles();
        } catch (nextError) {
            setError(messageOf(nextError, "アカウントの AI を読み込めませんでした"));
        } finally {
            setIsLoading(false);
        }
    });

    useEffect(() => {
        if (isLoadingSession) return;
        if (!isAuthenticated) {
            listVersionRef.current++;
            setFiles([]);
            setError(null);
            return;
        }
        void refresh();
    }, [isLoadingSession, isAuthenticated]);

    // 途中のアップロードは、中断や期限切れでサーバー側の状態が後から変わる。残っている間は取り直す。
    const hasPending = files.some((file) => file.status === "pending");
    useEffect(() => {
        if (!isAuthenticated || !hasPending) return;
        const timer = window.setInterval(() => void refresh(), PENDING_REFRESH_MS);
        return () => window.clearInterval(timer);
    }, [isAuthenticated, hasPending]);

    const run = async <T>(key: string, fallback: string, task: () => Promise<T>): Promise<T> => {
        setBusyKey(key);
        setError(null);
        try {
            return await task();
        } catch (nextError) {
            setError(messageOf(nextError, fallback));
            throw nextError;
        } finally {
            setBusyKey(null);
            setUploadProgress(null);
        }
    };

    return {
        isAuthenticated,
        isLoading: isLoadingSession || isLoading,
        files,
        error,
        busyKey,
        uploadProgress,
        loginHref: buildLoginHref(currentReturnPath()),
        upload: (file, key, knownSha256Hex) =>
            run(key, "アカウントに保存できませんでした", async () => {
                setUploadProgress(0);
                try {
                    await uploadFile(file, setUploadProgress, knownSha256Hex);
                } finally {
                    // 失敗しても、途中で残った記録や完了していた分を一覧に映す。
                    await applyFetchedFiles().catch(() => undefined);
                }
            }),
        download: (fileId) =>
            run(fileId, "アカウントから取り込めませんでした", async () => {
                const response = await fetch(`/api/nnue/files/${fileId}`, {
                    credentials: "same-origin",
                });
                if (!response.ok) throw new Error(await parseApiError(response));
                return response.blob();
            }),
        remove: (fileId) =>
            run(fileId, "アカウントから削除できませんでした", async () => {
                const response = await fetch(`/api/nnue/files/${fileId}`, {
                    method: "DELETE",
                    credentials: "same-origin",
                });
                if (!response.ok) throw new Error(await parseApiError(response));
                listVersionRef.current++;
                setFiles((current) => current.filter((file) => file.id !== fileId));
            }),
        clearError: () => setError(null),
    };
}
