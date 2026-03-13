import type {
    InitializeNnueUploadResponse,
    ListNnueFilesResponse,
    NnueFileSummary,
} from "@shogi/api-contract";
import { getRouteApi } from "@tanstack/react-router";
import type { ChangeEvent, ReactElement } from "react";
import { useState } from "react";
import { AuthRequiredCard } from "../../components/AuthRequiredCard";
import { PageHeader } from "../../components/PageHeader";
import { parseApiError } from "../../hooks/useAuthSession";

const routeApi = getRouteApi("/nnue");
const CHUNK_SIZE_BYTES = 50 * 1024 * 1024;

function formatBytes(bytes: number): string {
    if (bytes >= 1024 * 1024 * 1024) {
        return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

async function sha256Hex(file: File): Promise<string> {
    const buffer = await file.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", buffer);
    return Array.from(new Uint8Array(digest))
        .map((value) => value.toString(16).padStart(2, "0"))
        .join("");
}

async function fetchNnueFiles(): Promise<ListNnueFilesResponse> {
    const response = await fetch("/api/nnue/files", {
        credentials: "same-origin",
    });
    if (!response.ok) {
        throw new Error(await parseApiError(response));
    }

    return (await response.json()) as ListNnueFilesResponse;
}

async function uploadNnueFile(file: File, onProgress: (progress: number) => void): Promise<void> {
    const hash = await sha256Hex(file);
    const initResponse = await fetch("/api/nnue/uploads/init", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        credentials: "same-origin",
        body: JSON.stringify({
            originalFilename: file.name,
            sizeBytes: file.size,
            sha256Hex: hash,
        }),
    });

    if (!initResponse.ok) {
        throw new Error(await parseApiError(initResponse));
    }

    const initPayload = (await initResponse.json()) as InitializeNnueUploadResponse;
    const parts: Array<{ partNumber: number; etag: string }> = [];
    const totalParts = Math.ceil(file.size / CHUNK_SIZE_BYTES);

    for (let index = 0; index < totalParts; index++) {
        const partNumber = index + 1;
        const start = index * CHUNK_SIZE_BYTES;
        const end = Math.min(start + CHUNK_SIZE_BYTES, file.size);
        const chunk = file.slice(start, end);

        const partResponse = await fetch(
            `/api/nnue/uploads/${initPayload.file.id}/parts/${partNumber}?uploadId=${encodeURIComponent(initPayload.uploadId)}`,
            {
                method: "PUT",
                credentials: "same-origin",
                body: chunk,
            },
        );
        if (!partResponse.ok) {
            throw new Error(await parseApiError(partResponse));
        }

        const partPayload = (await partResponse.json()) as {
            partNumber: number;
            etag: string;
        };
        parts.push({ partNumber: partPayload.partNumber, etag: partPayload.etag });
        onProgress(Math.round((end / file.size) * 100));
    }

    const completeResponse = await fetch(`/api/nnue/uploads/${initPayload.file.id}/complete`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        credentials: "same-origin",
        body: JSON.stringify({
            uploadId: initPayload.uploadId,
            parts,
        }),
    });

    if (!completeResponse.ok) {
        throw new Error(await parseApiError(completeResponse));
    }
}

async function downloadNnueFile(fileId: string): Promise<Blob> {
    const response = await fetch(`/api/nnue/files/${fileId}`, {
        credentials: "same-origin",
    });
    if (!response.ok) {
        throw new Error(await parseApiError(response));
    }

    return response.blob();
}

async function deleteNnueFile(fileId: string): Promise<void> {
    const response = await fetch(`/api/nnue/files/${fileId}`, {
        method: "DELETE",
        credentials: "same-origin",
    });
    if (!response.ok) {
        throw new Error(await parseApiError(response));
    }
}

export default function NnueFilesPage(): ReactElement {
    const loaderData = routeApi.useLoaderData() as {
        needsAuth: boolean;
        files: NnueFileSummary[];
    };
    const [files, setFiles] = useState(loaderData.files);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [status, setStatus] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const authHref = "/auth?next=%2Fnnue";

    function handleFileChange(event: ChangeEvent<HTMLInputElement>): void {
        setSelectedFile(event.target.files?.[0] ?? null);
    }

    async function refreshFiles(): Promise<void> {
        const payload = await fetchNnueFiles();
        setFiles(payload.files);
    }

    async function handleUpload(): Promise<void> {
        if (!selectedFile || isUploading) return;
        const fileToUpload = selectedFile;

        setIsUploading(true);
        setUploadProgress(0);
        setStatus(null);
        setError(null);

        await uploadNnueFile(fileToUpload, setUploadProgress)
            .then(async () => {
                await refreshFiles();
                setSelectedFile(null);
                setStatus("NNUE ファイルをアップロードしました。");
            })
            .catch((nextError: unknown) => {
                setError(
                    nextError instanceof Error
                        ? nextError.message
                        : "NNUE アップロードに失敗しました",
                );
            });

        setIsUploading(false);
    }

    async function handleDownload(file: NnueFileSummary): Promise<void> {
        setStatus(null);
        setError(null);

        await downloadNnueFile(file.id)
            .then((blob) => {
                const url = URL.createObjectURL(blob);
                const anchor = document.createElement("a");
                anchor.href = url;
                anchor.download = file.originalFilename;
                anchor.click();
                URL.revokeObjectURL(url);
            })
            .catch((nextError: unknown) => {
                setError(
                    nextError instanceof Error
                        ? nextError.message
                        : "NNUE ダウンロードに失敗しました",
                );
            });
    }

    async function handleDelete(file: NnueFileSummary): Promise<void> {
        setStatus(null);
        setError(null);

        await deleteNnueFile(file.id)
            .then(async () => {
                await refreshFiles();
                setStatus("NNUE ファイルを削除しました。");
            })
            .catch((nextError: unknown) => {
                setError(
                    nextError instanceof Error ? nextError.message : "NNUE 削除に失敗しました",
                );
            });
    }

    return (
        <>
            <PageHeader
                items={[{ label: "ラム将棋", to: "/" }, { label: "NNUE ファイル" }]}
                right={
                    <a
                        href={authHref}
                        className="rounded-md border border-border px-3 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                    >
                        ログイン
                    </a>
                }
            />
            <main className="mx-auto flex max-w-[960px] flex-col gap-6 px-4 py-8">
                <div className="flex flex-col gap-2">
                    <h1 className="text-2xl font-bold text-foreground">NNUE ファイル</h1>
                    <p className="text-sm text-muted-foreground">
                        アカウントに紐づく private NNUE を upload / download / delete できます。
                    </p>
                </div>

                {status && (
                    <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700">
                        {status}
                    </div>
                )}

                {error && (
                    <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                        {error}
                    </div>
                )}

                {loaderData.needsAuth ? (
                    <AuthRequiredCard
                        title="ログインすると private NNUE と保存済み棋譜を端末を跨いで使えます"
                        description="アップロードした private NNUE はアカウントに保存され、別の端末からでも download や browser import ができます。あわせて、保存したオンライン対局の棋譜も同じアカウントで参照できます。"
                        details={[
                            "private NNUE を upload / download / browser import できます。",
                            "別の端末でログインしても、同じ private NNUE を取り込んで使えます。",
                            "保存したオンライン対局の棋譜もアカウントに紐づいて共有されます。",
                        ]}
                        nextPath="/nnue"
                        loginLabel="GoogleでログインしてNNUEを管理"
                    />
                ) : (
                    <>
                        <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
                            <div className="flex flex-col gap-3">
                                <h2 className="text-lg font-semibold text-foreground">
                                    アップロード
                                </h2>
                                <input
                                    type="file"
                                    accept=".bin"
                                    onChange={handleFileChange}
                                    className="text-sm text-foreground file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-2 file:text-sm file:font-medium file:text-secondary-foreground"
                                />
                                {selectedFile && (
                                    <div className="text-sm text-muted-foreground">
                                        {selectedFile.name} / {formatBytes(selectedFile.size)}
                                    </div>
                                )}
                                {isUploading && (
                                    <div className="text-sm text-muted-foreground">
                                        アップロード中... {uploadProgress}%
                                    </div>
                                )}
                                <div className="text-xs text-muted-foreground">
                                    50MB ごとの chunk に分割して upload します。
                                </div>
                                <button
                                    type="button"
                                    onClick={() => void handleUpload()}
                                    disabled={!selectedFile || isUploading}
                                    className="w-fit rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
                                >
                                    {isUploading ? "アップロード中..." : "アップロード"}
                                </button>
                            </div>
                        </section>

                        <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
                            <h2 className="mb-3 text-lg font-semibold text-foreground">
                                アカウント NNUE 一覧
                            </h2>
                            {files.length === 0 ? (
                                <p className="text-sm text-muted-foreground">
                                    保存済みの NNUE はありません。
                                </p>
                            ) : (
                                <div className="grid gap-3">
                                    {files.map((file) => (
                                        <div
                                            key={file.id}
                                            className="rounded-md border border-border px-4 py-3"
                                        >
                                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                                <div className="flex flex-col gap-1">
                                                    <div className="text-sm font-medium text-foreground">
                                                        {file.originalFilename}
                                                    </div>
                                                    <div className="text-xs text-muted-foreground">
                                                        {formatBytes(file.sizeBytes)} /{" "}
                                                        {file.uploadStatus}
                                                    </div>
                                                </div>
                                                <div className="flex flex-wrap gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => void handleDownload(file)}
                                                        className="rounded-md border border-input px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/50"
                                                    >
                                                        ダウンロード
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => void handleDelete(file)}
                                                        className="rounded-md border border-destructive/30 px-3 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10"
                                                    >
                                                        削除
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </section>
                    </>
                )}
            </main>
        </>
    );
}
