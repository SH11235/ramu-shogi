import { NnueError, type NnueFormat } from "@shogi/app-core";
import {
    defaultWasmModuleUrl,
    detect_nnue_format,
    ensureWasmModule,
    is_nnue_compatible,
} from "@shogi/engine-wasm";
import { StoredBoardPatternProvider } from "@shogi/ui/components/shogi-match/hooks/useBoardPattern";
import { NnueProvider } from "@shogi/ui/providers/NnueContext";
import { UsageTrackingProvider } from "@shogi/ui/providers/UsageContext";
import { Outlet } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { AppDialogHost } from "./components/AppDialogs";
import { StatusBanner } from "./components/StatusBanner";
import { AuthSessionProvider } from "./hooks/useAuthSession";
import { useStudySessionSync } from "./hooks/useStudySessionSync";
import { useUsageTracking } from "./hooks/useUsageTracking";
import { useUserSettingsSync } from "./hooks/useUserSettingsSync";
import { nnueStorage } from "./platform/nnue-storage";
import {
    assetReturnsNotOk,
    isStaleAssetError,
    reloadForStaleDeploy,
} from "./platform/stale-deploy-reload";
import { usageClient } from "./platform/usage";
import { createUsageTracker } from "./platform/usageTracker";

// エンジンをまだ起動していない画面（AI の一覧など）でも判定できるよう、wasm を先に読み込む。
const validateNnueHeader = async (header: Uint8Array, fileSize: number) => {
    try {
        await ensureWasmModule();
    } catch (error) {
        // 旧デプロイの wasm が消えていれば新しいバンドルを取りに行く（wasm-position-service と同じ判定）。
        // ファイルの形式違いと取り違えないよう、別のエラーとして返す。
        if (isStaleAssetError(error) || (await assetReturnsNotOk(defaultWasmModuleUrl))) {
            reloadForStaleDeploy();
        }
        throw new NnueError("NNUE_VALIDATOR_UNAVAILABLE", "wasm を読み込めませんでした", error);
    }
    return {
        format: detect_nnue_format(header, BigInt(fileSize)) as NnueFormat,
        isCompatible: is_nnue_compatible(header, BigInt(fileSize)),
    };
};

function AppProvidersInner(): ReactElement {
    const { syncError, retrySync } = useUserSettingsSync();
    useStudySessionSync();
    useUsageTracking();

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
            <AppDialogHost />
        </NnueProvider>
    );
}

// 対局の開始の時刻を持つので、画面の描き直しで作り直さない
const usageTracker = createUsageTracker(usageClient);

export function AppProviders(): ReactElement {
    return (
        <AuthSessionProvider>
            <UsageTrackingProvider track={usageTracker}>
                <StoredBoardPatternProvider>
                    <AppProvidersInner />
                </StoredBoardPatternProvider>
            </UsageTrackingProvider>
        </AuthSessionProvider>
    );
}
