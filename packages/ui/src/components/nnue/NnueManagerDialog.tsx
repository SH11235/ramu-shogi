import type { ReactElement } from "react";
import { useState } from "react";
import { useNnueStorage } from "../../hooks/useNnueStorage";
import { usePresetManager } from "../../hooks/usePresetManager";
import { Button } from "../button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../dialog";
import { NnueErrorAlert } from "./NnueErrorAlert";
import { NnueFreeResourcesInfo } from "./NnueFreeResourcesInfo";
import { NnueFvScaleInputDialog } from "./NnueFvScaleInputDialog";
import { NnueImportArea } from "./NnueImportArea";
import { NnueListItem } from "./NnueListItem";
import { NnueProgressOverlay } from "./NnueProgressOverlay";
import { NnueSupportInfo } from "./NnueSupportInfo";
import { PresetListItem } from "./PresetListItem";

interface NnueManagerDialogProps {
    /** モーダルが開いているか */
    open: boolean;
    /** モーダルを閉じる時のコールバック */
    onOpenChange: (open: boolean) => void;
    /** プリセット manifest.json の URL（指定時のみプリセット機能が有効） */
    manifestUrl?: string;
    /** Desktop 用: ファイル選択ダイアログを開いてパスを取得するコールバック */
    onRequestFilePath?: () => Promise<string | null>;
    /** ダイアログを開いた理由（表示用メッセージ） */
    openReason?: string;
    /** 理由メッセージをクリアするコールバック */
    onClearOpenReason?: () => void;
    /** 対局中かどうか（対局中は削除禁止） */
    isMatchActive?: boolean;
}

/**
 * NNUE ストレージ使用量と注意事項を表示するコンポーネント
 */
function NnueStorageInfo({ totalSize }: { totalSize: number }): ReactElement {
    return (
        <div className="text-xs text-muted-foreground">
            <div className="rounded-md bg-muted p-3 text-[13px]">
                <div className="mb-2 flex items-center justify-between font-semibold">
                    <span>ストレージについて</span>
                    <span className="font-normal">
                        使用量: {(totalSize / (1024 * 1024)).toFixed(1)} MB
                    </span>
                </div>
                <div className="flex flex-col gap-1.5">
                    <p className="m-0">NNUE ファイルはブラウザのストレージに保存されます。</p>
                    <p className="m-0">
                        ブラウザの設定やストレージ不足により、自動削除される可能性があります。
                    </p>
                </div>
            </div>
        </div>
    );
}

/**
 * NNUE ファイル管理モーダル
 *
 * NNUE 一覧表示、インポート、削除を提供する。
 * NNUE の選択機能は含まない（対局設定や分析設定で行う）。
 */
export function NnueManagerDialog({
    open,
    onOpenChange,
    manifestUrl,
    onRequestFilePath,
    openReason,
    onClearOpenReason,
    isMatchActive = false,
}: NnueManagerDialogProps): ReactElement {
    const reasonMessage = (() => {
        if (!openReason) return null;
        if (openReason === "missing-sente") {
            return "先手の評価関数が未ダウンロードです。NNUE をダウンロードしてください。";
        }
        if (openReason === "missing-gote") {
            return "後手の評価関数が未ダウンロードです。NNUE をダウンロードしてください。";
        }
        if (openReason === "missing-analysis") {
            return "解析用の評価関数が未ダウンロードです。NNUE をダウンロードしてください。";
        }
        return openReason;
    })();
    const {
        nnueList,
        isLoading: isStorageLoading,
        error: storageError,
        importFromFile,
        importFromPath,
        deleteNnue,
        updateDisplayName,
        updateFvScale,
        clearError: clearStorageError,
        refreshList,
        capabilities,
    } = useNnueStorage();

    const {
        presets,
        isLoading: isPresetsLoading,
        downloadingKey,
        downloadProgress,
        error: presetError,
        download: downloadPreset,
        clearError: clearPresetError,
        isConfigured: isPresetConfigured,
    } = usePresetManager({
        manifestUrl,
        autoFetch: open && Boolean(manifestUrl),
        onDownloadComplete: () => {
            // ダウンロード完了時にストレージを更新
            void refreshList();
        },
    });

    const [isImporting, setIsImporting] = useState(false);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    // FV_SCALE 入力待ちのファイル/パス
    const [pendingFile, setPendingFile] = useState<File | null>(null);
    const [pendingPath, setPendingPath] = useState<string | null>(null);

    // ファイル選択時: FV_SCALE 入力ダイアログを表示
    const handleFileSelect = (file: File) => {
        setPendingPath(null); // 排他的に管理
        setPendingFile(file);
    };

    // Desktop 用: ファイルダイアログでパスを取得して FV_SCALE 入力ダイアログを表示
    const handleRequestFilePath = async () => {
        if (!onRequestFilePath) return;
        try {
            const filePath = await onRequestFilePath();
            if (filePath) {
                setPendingFile(null); // 排他的に管理
                setPendingPath(filePath);
            }
        } catch {
            // エラーは useNnueStorage で管理される
        }
    };

    // FV_SCALE と表示名確定時: 実際にインポート
    const handleFvScaleConfirm = async (fvScale: number, displayName: string) => {
        // 先に pending をクリアしてダイアログを閉じる（二重実行を防止）
        const fileToImport = pendingFile;
        const pathToImport = pendingPath;
        setPendingFile(null);
        setPendingPath(null);

        setIsImporting(true);
        try {
            if (fileToImport) {
                await importFromFile(fileToImport, fvScale, displayName);
            } else if (pathToImport) {
                await importFromPath(pathToImport, fvScale, displayName);
            }
        } catch {
            // エラーは useNnueStorage で管理される
        } finally {
            setIsImporting(false);
        }
    };

    // FV_SCALE 入力キャンセル
    const handleFvScaleCancel = () => {
        setPendingFile(null);
        setPendingPath(null);
    };

    const handleDelete = async (id: string) => {
        setDeletingId(id);
        try {
            await deleteNnue(id);
        } catch {
            // エラーは useNnueStorage で管理される
        } finally {
            setDeletingId(null);
        }
    };

    const handleDisplayNameChange = async (id: string, newName: string) => {
        await updateDisplayName(id, newName);
    };

    const handleFvScaleChange = async (id: string, fvScale: number | undefined) => {
        await updateFvScale(id, fvScale);
    };

    const handleClose = () => {
        onOpenChange(false);
    };

    const handleClearError = () => {
        clearStorageError();
        clearPresetError();
    };

    const error = storageError ?? presetError;
    const isOperationInProgress = isImporting || deletingId !== null || downloadingKey !== null;
    const hasPendingImport = pendingFile !== null || pendingPath !== null;
    const pendingFileName = pendingFile?.name ?? pendingPath?.split(/[/\\]/).pop() ?? "";

    // NNUE ファイルの合計サイズを計算
    const totalNnueSize = nnueList.reduce((sum, meta) => sum + meta.size, 0);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex max-h-[80vh] w-[min(520px,calc(100%-24px))] flex-col">
                <DialogHeader>
                    <DialogTitle>評価関数（NNUE) ファイル管理</DialogTitle>
                </DialogHeader>

                <div className="relative flex min-h-[200px] flex-1 flex-col gap-4 overflow-auto">
                    {/* 開いた理由（対局開始時にNNUE未ダウンロードだった場合など） */}
                    {reasonMessage && (
                        <div className="flex items-start gap-2 rounded-md border border-[hsl(var(--warning,38_92%_50%)/0.3)] bg-[hsl(var(--warning,38_92%_50%)/0.1)] p-3">
                            <span className="text-base leading-none">⚠️</span>
                            <div className="flex-1">
                                <p className="m-0 text-[13px] text-foreground">{reasonMessage}</p>
                            </div>
                            {onClearOpenReason && (
                                <button
                                    type="button"
                                    onClick={onClearOpenReason}
                                    className="cursor-pointer rounded p-0.5 text-sm leading-none text-muted-foreground hover:text-foreground"
                                    aria-label="メッセージを閉じる"
                                >
                                    ✕
                                </button>
                            )}
                        </div>
                    )}

                    {/* エラー表示 */}
                    <NnueErrorAlert error={error} onClose={handleClearError} />

                    {/* NNUE 一覧（選択なし、削除のみ） */}
                    {nnueList.length > 0 ? (
                        <div className="flex flex-col gap-2">
                            <div className="mb-1 text-xs font-medium text-muted-foreground">
                                インポート済み ({nnueList.length})
                            </div>
                            {nnueList.map((meta) => (
                                <NnueListItem
                                    key={meta.id}
                                    meta={meta}
                                    selectable={false}
                                    onDelete={() => handleDelete(meta.id)}
                                    isDeleting={deletingId === meta.id}
                                    disabled={isOperationInProgress}
                                    deleteDisabledReason={
                                        isMatchActive ? "対局中は削除できません" : undefined
                                    }
                                    onDisplayNameChange={(newName) =>
                                        handleDisplayNameChange(meta.id, newName)
                                    }
                                    onFvScaleChange={(fvScale) =>
                                        handleFvScaleChange(meta.id, fvScale)
                                    }
                                />
                            ))}
                        </div>
                    ) : (
                        <div className="p-4 text-center text-[13px] text-muted-foreground">
                            インポートされた NNUE ファイルはありません
                        </div>
                    )}

                    {/* プリセット一覧（manifestUrl が設定されている場合のみ） */}
                    {/* 最新版ダウンロード済みのものは除外（インポート済みに表示されるため） */}
                    {isPresetConfigured &&
                        presets.filter((p) => p.status !== "latest").length > 0 && (
                            <div className="flex flex-col gap-2">
                                <div className="mb-1 mt-2 text-xs font-medium text-muted-foreground">
                                    ダウンロード可能なプリセット
                                </div>
                                {presets
                                    .filter((p) => p.status !== "latest")
                                    .map((preset) => (
                                        <PresetListItem
                                            key={preset.config.presetKey}
                                            preset={preset}
                                            selectable={false}
                                            onDownload={downloadPreset}
                                            isDownloading={
                                                downloadingKey === preset.config.presetKey
                                            }
                                            downloadProgress={
                                                downloadingKey === preset.config.presetKey
                                                    ? downloadProgress
                                                    : null
                                            }
                                            disabled={isOperationInProgress}
                                        />
                                    ))}
                            </div>
                        )}

                    {/* プリセット読み込み中 */}
                    {isPresetConfigured && isPresetsLoading && (
                        <div className="p-4 text-center text-[13px] text-muted-foreground">
                            プリセット一覧を読み込み中...
                        </div>
                    )}

                    {/* インポートエリア */}
                    {capabilities && (
                        <NnueImportArea
                            capabilities={capabilities}
                            onFileSelect={handleFileSelect}
                            onRequestFilePath={handleRequestFilePath}
                            isImporting={isImporting}
                            disabled={isOperationInProgress}
                        />
                    )}

                    {/* 無料で手に入る将棋AI */}
                    <NnueFreeResourcesInfo />

                    {/* NNUE 使用量 */}
                    <NnueStorageInfo totalSize={totalNnueSize} />

                    {/* サポート・問い合わせ先 */}
                    <NnueSupportInfo />

                    {/* 進捗オーバーレイ */}
                    <NnueProgressOverlay
                        visible={isStorageLoading && !isImporting}
                        message="読み込み中..."
                    />
                </div>

                <DialogFooter className="justify-center">
                    <Button variant="secondary" onClick={handleClose}>
                        閉じる
                    </Button>
                </DialogFooter>
            </DialogContent>

            {/* FV_SCALE 入力ダイアログ（マウント時に state が初期化されるよう条件レンダリング） */}
            {hasPendingImport && (
                <NnueFvScaleInputDialog
                    fileName={pendingFileName}
                    onConfirm={handleFvScaleConfirm}
                    onCancel={handleFvScaleCancel}
                />
            )}
        </Dialog>
    );
}
