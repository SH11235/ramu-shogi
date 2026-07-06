import type { NnueFormat } from "@shogi/app-core";
import {
    createIndexedDBNnueStorage,
    detect_nnue_format,
    is_nnue_compatible,
} from "@shogi/engine-wasm";
import { NnueProvider } from "@shogi/ui/providers/NnueContext";
import { Outlet } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { AuthSessionProvider } from "./hooks/useAuthSession";
import { useUserSettingsSync } from "./hooks/useUserSettingsSync";

// Web版のストレージも同期的に初期化可能
const nnueStorage = createIndexedDBNnueStorage();

const validateNnueHeader = async (header: Uint8Array, fileSize: number) => ({
    format: detect_nnue_format(header, BigInt(fileSize)) as NnueFormat,
    isCompatible: is_nnue_compatible(header, BigInt(fileSize)),
});

function AppProvidersInner(): ReactElement {
    useUserSettingsSync();

    return (
        <NnueProvider storage={nnueStorage} validateNnueHeader={validateNnueHeader}>
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
