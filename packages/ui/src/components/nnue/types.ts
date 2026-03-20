import type { NnueMeta } from "@shogi/app-core";

export interface RemoteNnueFile {
    id: string;
    originalFilename: string;
    sizeBytes: number;
    sha256Hex: string;
    createdAt: string;
    importedMeta: NnueMeta | null;
}

export interface RemoteNnueManager {
    isAuthenticated: boolean;
    isLoading: boolean;
    files: RemoteNnueFile[];
    importingFileId: string | null;
    error: string | null;
    refresh: () => Promise<void>;
    importFile: (
        file: RemoteNnueFile,
        fvScale: number,
        displayName?: string,
    ) => Promise<NnueMeta | undefined>;
    clearError: () => void;
    loginHref?: string;
    manageHref?: string;
}
