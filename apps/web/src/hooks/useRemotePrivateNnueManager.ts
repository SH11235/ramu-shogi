import type { ListNnueFilesResponse, NnueFileSummary } from "@shogi/api-contract";
import { type RemoteNnueFile, type RemoteNnueManager, useNnueStorage } from "@shogi/ui";
import { useEffect, useEffectEvent, useState } from "react";
import { parseApiError, useAuthSession } from "./useAuthSession";

interface UseRemotePrivateNnueManagerOptions {
    initialFiles?: NnueFileSummary[];
}

function toCompletedFiles(files: NnueFileSummary[]): NnueFileSummary[] {
    return files.filter((file) => file.uploadStatus === "completed");
}

async function fetchRemoteNnueFiles(): Promise<NnueFileSummary[]> {
    const response = await fetch("/api/nnue/files", {
        credentials: "same-origin",
    });
    if (!response.ok) {
        throw new Error(await parseApiError(response));
    }

    const payload = (await response.json()) as ListNnueFilesResponse;
    return toCompletedFiles(payload.files);
}

async function downloadRemoteNnueFile(fileId: string): Promise<Blob> {
    const response = await fetch(`/api/nnue/files/${fileId}`, {
        credentials: "same-origin",
    });
    if (!response.ok) {
        throw new Error(await parseApiError(response));
    }

    return response.blob();
}

export function useRemotePrivateNnueManager(
    options: UseRemotePrivateNnueManagerOptions = {},
): RemoteNnueManager {
    const { initialFiles = [] } = options;
    const { session, isLoadingSession } = useAuthSession();
    const { nnueList, importFromBlob } = useNnueStorage();

    const [files, setFiles] = useState<NnueFileSummary[]>(() => toCompletedFiles(initialFiles));
    const [isLoading, setIsLoading] = useState(false);
    const [importingFileId, setImportingFileId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const isAuthenticated = session?.authenticated === true;

    const refresh = useEffectEvent(async (): Promise<void> => {
        setIsLoading(true);
        setError(null);
        try {
            setFiles(await fetchRemoteNnueFiles());
        } catch (nextError) {
            setError(
                nextError instanceof Error
                    ? nextError.message
                    : "クラウド NNUE 一覧の取得に失敗しました",
            );
        } finally {
            setIsLoading(false);
        }
    });

    useEffect(() => {
        if (isLoadingSession) return;
        if (!isAuthenticated) {
            setFiles([]);
            setIsLoading(false);
            setError(null);
            return;
        }
        void refresh();
    }, [isLoadingSession, isAuthenticated]);

    const importFile = async (file: RemoteNnueFile, fvScale: number, displayName?: string) => {
        if (!isAuthenticated) {
            const message = "クラウド NNUE の取り込みにはログインが必要です";
            setError(message);
            return undefined;
        }

        setImportingFileId(file.id);
        setError(null);
        try {
            const blob = await downloadRemoteNnueFile(file.id);
            return await importFromBlob(blob, file.originalFilename, fvScale, displayName);
        } catch (nextError) {
            setError(
                nextError instanceof Error
                    ? nextError.message
                    : "クラウド NNUE の取り込みに失敗しました",
            );
            return undefined;
        } finally {
            setImportingFileId(null);
        }
    };

    return {
        isAuthenticated,
        isLoading: isLoadingSession || isLoading,
        files: files.map((file) => ({
            id: file.id,
            originalFilename: file.originalFilename,
            sizeBytes: file.sizeBytes,
            sha256Hex: file.sha256Hex,
            createdAt: file.completedAt ?? file.createdAt,
            importedMeta:
                nnueList.find((meta) => meta.contentHashSha256 === file.sha256Hex) ?? null,
        })),
        importingFileId,
        error,
        refresh,
        importFile,
        clearError: () => setError(null),
        loginHref: "/auth",
        manageHref: "/nnue",
    };
}
