import {
    createPresetManager,
    NNUE_HEADER_SIZE,
    type NnueDownloadProgress,
    NnueError,
    type NnueSelection,
    type PresetManager,
    type ResolvedNnue,
} from "@shogi/app-core";
import { useCallback, useMemo, useRef, useState } from "react";
import { useNnueContextOptional } from "../providers/NnueContext";

interface UseLazyNnueLoaderReturn {
    /**
     * NNUE を解決する（必要ならダウンロード）
     * @param selection NNUE 選択状態
     * @returns 解決済みの ResolvedNnue（nnueId と fvScale）、または null（駒得評価）
     */
    resolveNnue: (selection: NnueSelection) => Promise<ResolvedNnue | null>;
    /** ダウンロード中かどうか */
    isDownloading: boolean;
    /** ダウンロード進捗 */
    downloadProgress: NnueDownloadProgress | null;
    /** ダウンロード中のプリセット表示名 */
    downloadingPresetName: string | null;
    /** エラー */
    error: NnueError | null;
    /** エラーをクリア */
    clearError: () => void;
}

interface UseLazyNnueLoaderOptions {
    /** manifest.json の URL */
    manifestUrl?: string;
    /** ダウンロード完了時のコールバック */
    onDownloadComplete?: () => void;
}

/**
 * NNUE 遅延ロードフック
 *
 * NnueSelection を受け取り、実際の nnueId を返す。
 * プリセット指定の場合、IndexedDB に無ければダウンロードする。
 */
export function useLazyNnueLoader(options: UseLazyNnueLoaderOptions = {}): UseLazyNnueLoaderReturn {
    const { manifestUrl, onDownloadComplete } = options;
    const context = useNnueContextOptional();
    const storage = context?.storage ?? null;
    const validateNnueHeader = context?.validateNnueHeader ?? null;

    const [isDownloading, setIsDownloading] = useState(false);
    const [downloadProgress, setDownloadProgress] = useState<NnueDownloadProgress | null>(null);
    const [downloadingPresetName, setDownloadingPresetName] = useState<string | null>(null);
    const [error, setError] = useState<NnueError | null>(null);

    // 進行中のダウンロード Promise をトラッキング（同時呼び出しの排他制御用）
    const pendingDownloadsRef = useRef<Map<string, Promise<string | null>>>(new Map());

    // PresetManager インスタンスを作成
    const manager = useMemo<PresetManager | null>(() => {
        if (!manifestUrl || !storage) return null;
        return createPresetManager({
            manifestUrl,
            storage,
            onProgress: setDownloadProgress,
        });
    }, [manifestUrl, storage]);

    /**
     * ダウンロードを実行する内部関数（排他制御の対象）
     */
    const executeDownload = useCallback(
        async (presetKey: string, nnueIdFallback: string | null): Promise<string | null> => {
            if (!storage || !manager) {
                return nnueIdFallback;
            }

            try {
                setIsDownloading(true);
                setDownloadProgress(null);
                setError(null);

                // プリセット名を取得して表示用に設定
                const manifest = await manager.getManifest();
                const presetConfig = manifest.presets.find((p) => p.presetKey === presetKey);
                setDownloadingPresetName(presetConfig?.displayName ?? presetKey);

                // 重複チェック（ハッシュベース）
                const isDuplicate = await manager.isDuplicate(presetKey);
                if (isDuplicate && presetConfig) {
                    // 同じハッシュのファイルが既にある
                    const byHash = await storage.listByContentHash(presetConfig.sha256);
                    if (byHash.length > 0) {
                        setIsDownloading(false);
                        setDownloadProgress(null);
                        setDownloadingPresetName(null);
                        return byHash[0].id;
                    }
                }

                // ダウンロード実行
                const meta = await manager.download(presetKey);

                // ヘッダ検証（フォーマット情報の更新）
                if (validateNnueHeader && storage.capabilities.supportsLoad && storage.load) {
                    try {
                        const data = await storage.load(meta.id);
                        const header = data.subarray(
                            0,
                            Math.min(NNUE_HEADER_SIZE, data.byteLength),
                        );
                        const result = await validateNnueHeader(header);
                        if (result.isCompatible && result.format) {
                            await storage.updateMeta(meta.id, { format: result.format });
                        }
                    } catch {
                        // 検証失敗時はフォーマット情報を更新しない
                    }
                }

                setIsDownloading(false);
                setDownloadProgress(null);
                setDownloadingPresetName(null);

                // ダウンロード完了を通知（nnueList の更新など）
                onDownloadComplete?.();

                return meta.id;
            } catch (e) {
                const err =
                    e instanceof NnueError
                        ? e
                        : new NnueError(
                              "NNUE_DOWNLOAD_FAILED",
                              `プリセット "${presetKey}" のダウンロードに失敗しました`,
                              e,
                          );
                setError(err);
                setIsDownloading(false);
                setDownloadProgress(null);
                setDownloadingPresetName(null);

                // ダウンロード失敗時は nnueId にフォールバック（あれば使用、なければ駒得評価）
                console.error("Failed to download preset NNUE:", err);
                return nnueIdFallback;
            }
        },
        [manager, storage, validateNnueHeader, onDownloadComplete],
    );

    /**
     * nnueId から ResolvedNnue を作成するヘルパー
     */
    const createResolvedNnue = useCallback(
        async (nnueId: string): Promise<ResolvedNnue> => {
            if (!storage) {
                return { nnueId };
            }
            const meta = await storage.getMeta(nnueId);
            return {
                nnueId,
                fvScale: meta?.fvScale,
            };
        },
        [storage],
    );

    /**
     * NNUE を解決する
     *
     * 1. presetKey が null → nnueId をそのまま返す（fvScale も取得）
     * 2. presetKey が設定されている:
     *    a. IndexedDB に該当 presetKey の NNUE があるか確認
     *    b. あれば → その id と fvScale を返す
     *    c. なければ → ダウンロード → 保存された id と fvScale を返す
     *
     * 同じ presetKey への同時リクエストは、最初のダウンロード完了を待って同じ結果を返す
     */
    const resolveNnue = useCallback(
        async (selection: NnueSelection): Promise<ResolvedNnue | null> => {
            // プリセット指定でない場合は nnueId をそのまま返す（fvScale も取得）
            if (!selection.presetKey) {
                if (!selection.nnueId) {
                    return null;
                }
                return createResolvedNnue(selection.nnueId);
            }

            // storage がない場合は nnueId にフォールバック
            if (!storage) {
                console.warn("NNUE storage is not available, falling back to nnueId");
                if (!selection.nnueId) {
                    return null;
                }
                return { nnueId: selection.nnueId };
            }

            const presetKey = selection.presetKey;

            // IndexedDB に該当 presetKey の NNUE があるか確認
            const existing = await storage.listByPresetKey(presetKey);
            if (existing.length > 0) {
                // 最新の作成日時のものを返す
                const sorted = [...existing].sort((a, b) => b.createdAt - a.createdAt);
                const meta = sorted[0];
                return {
                    nnueId: meta.id,
                    fvScale: meta.fvScale,
                };
            }

            // manifest がない場合は nnueId にフォールバック
            if (!manager) {
                console.warn("Preset manager is not available, falling back to nnueId");
                if (!selection.nnueId) {
                    return null;
                }
                return { nnueId: selection.nnueId };
            }

            // 既に同じ presetKey のダウンロードが進行中なら、その Promise を待つ
            const pendingDownloads = pendingDownloadsRef.current;
            const existingPromise = pendingDownloads.get(presetKey);
            if (existingPromise) {
                const nnueId = await existingPromise;
                if (!nnueId) {
                    return null;
                }
                return createResolvedNnue(nnueId);
            }

            // 新しいダウンロードを開始
            const downloadPromise = executeDownload(presetKey, selection.nnueId).finally(() => {
                // ダウンロード完了後に Map から削除
                pendingDownloads.delete(presetKey);
            });
            pendingDownloads.set(presetKey, downloadPromise);

            const nnueId = await downloadPromise;
            if (!nnueId) {
                return null;
            }
            return createResolvedNnue(nnueId);
        },
        [manager, storage, executeDownload, createResolvedNnue],
    );

    const clearError = useCallback(() => {
        setError(null);
    }, []);

    return {
        resolveNnue,
        isDownloading,
        downloadProgress,
        downloadingPresetName,
        error,
        clearError,
    };
}
