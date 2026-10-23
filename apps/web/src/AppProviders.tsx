import type { NnueFormat } from "@shogi/app-core";
import {
    createIndexedDBNnueStorage,
    detect_nnue_format,
    is_nnue_compatible,
} from "@shogi/engine-wasm";
import { NnueProvider } from "@shogi/ui/providers/NnueContext";
import { Outlet } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { StatusBanner } from "./components/StatusBanner";
import { AuthSessionProvider } from "./hooks/useAuthSession";
import { useStudySessionSync } from "./hooks/useStudySessionSync";
import { useUserSettingsSync } from "./hooks/useUserSettingsSync";

// Web版のストレージも同期的に初期化可能
const nnueStorage = createIndexedDBNnueStorage();

const validateNnueHeader = async (header: Uint8Array, fileSize: number) => ({
    format: detect_nnue_format(header, BigInt(fileSize)) as NnueFormat,
    isCompatible: is_nnue_compatible(header, BigInt(fileSize)),
});

function AppProvidersInner(): ReactElement {
    const { syncError, retrySync } = useUserSettingsSync();
    useStudySessionSync();

    return (
        <NnueProvider storage={nnueStorage} validateNnueHeader={validateNnueHeader}>
            {syncError && (
                <div className="px-4 py-2">
                    <StatusBanner variant="error">
                        <div className="flex flex-wrap items-center gap-2">
                            <span>{syncError}</span>
                            <button
                                type="button"
                                className="font-medium underline"
                                onClick={retrySync}
                            >
                                再確認
                            </button>
                        </div>
                    </StatusBanner>
                </div>
            )}
            <Outlet />
        </NnueProvider>
    );
}

export function AppProviders(): ReactElement {
    return (
        <AuthSessionProvider>
            <AppProvidersInner />
        </AuthSessionProvider>
    );
}
