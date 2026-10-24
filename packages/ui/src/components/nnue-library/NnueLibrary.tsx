import type {
    LayerStacksConfig,
    NnueDownloadProgress,
    NnueFormat,
    NnueMeta,
    PresetWithStatus,
} from "@shogi/app-core";
import { cn } from "@shogi/design-system";
import type { DragEvent, ReactElement, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { useNnueStorage } from "../../hooks/useNnueStorage";
import { usePresetManager } from "../../hooks/usePresetManager";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "../alert-dialog";
import { Button } from "../button";
import { NnueErrorAlert } from "../nnue/NnueErrorAlert";
import { NnueFvScaleInputDialog } from "../nnue/NnueFvScaleInputDialog";
import { Progress } from "../progress";
import { NnueSpeedTable, useNnueSpeedBenchmark } from "./NnueSpeed";
import type { NnueAccountFile, NnueAccountStore, NnueSpeedSupport } from "./types";

interface NnueLibraryProps {
    /** 配布 AI の manifest.json の URL */
    manifestUrl?: string;
    /** 配布 AI のアイコンが無いときに使う画像 */
    fallbackIconUrl?: string;
    /** Web のログイン中だけ渡す、アカウントの保存先 */
    account?: NnueAccountStore;
    /** Desktop 用: ファイル選択ダイアログでパスを得る */
    onRequestFilePath?: () => Promise<string | null>;
    /** 処理中（ダウンロード・追加・削除・アップロード）かどうかが変わったとき */
    onBusyChange?: (busy: boolean) => void;
    /** この端末の AI を変えられない理由（対局中など）。指定時は設定と削除を止める */
    lockedReason?: string;
    /** 渡すと、端末にある AI の行にこの端末での速さ（NPS）を出し、測れるようにする */
    speed?: NnueSpeedSupport;
}

type PendingAdd =
    | { kind: "file"; file: File }
    | { kind: "path"; path: string }
    | { kind: "account"; file: NnueAccountFile };

/** 両方にある AI を消すとき、アカウントの分も消すか（device はこの端末から外すだけ） */
type DeleteScope = "device" | "both";

type PendingDelete =
    | { kind: "device"; meta: NnueMeta; accountFile: NnueAccountFile | null }
    | { kind: "account"; file: NnueAccountFile }
    | { kind: "preset"; preset: PresetWithStatus };

const ALLOWED_EXTENSIONS = [".nnue", ".bin"];

const SUPPORT_ISSUES_URL = "https://github.com/SH11235/rshogi/issues";
// GitHub のアカウントを持たない人も知らせられるように、X の窓口も並べる。
const SUPPORT_X_URL = "https://x.com/ramu_shogi";

/** 公開されている評価関数の例（FV_SCALE は配布元の公開値） */
const FREE_NNUE_RESOURCES = [
    {
        name: "AobaNNUE",
        fvScale: 40,
        downloadUrl: "https://github.com/yssaya/AobaNNUE/releases/tag/v1.1",
    },
];

function formatSize(bytes: number): string {
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    return `${Math.round(bytes / (1024 * 1024))} MB`;
}

/**
 * 形式を「LayerStacks 1536-16-32」「HalfKP 256-32-32」のように書く。名前の末尾に L1 の次元が
 * 付いている形式（HalfKP256 など）は、次元の並びと重なるので名前から外す。
 */
function formatLabel(format: Partial<NnueFormat> | undefined): string | null {
    const architecture = format?.architecture?.trim();
    if (!architecture || architecture.toLowerCase() === "unknown") return null;
    const dims = [format?.l1Dimension, format?.l2Dimension, format?.l3Dimension];
    if (!dims.every((dim) => typeof dim === "number" && dim > 0)) return architecture;
    const name = architecture.endsWith(String(dims[0]))
        ? architecture.slice(0, -String(dims[0]).length)
        : architecture;
    return `${name} ${dims.join("-")}`;
}

function needsModelSettings(meta: NnueMeta): boolean {
    return Boolean(meta.format?.architecture.includes("LayerStacks") && !meta.layerStacks);
}

function fileNameOf(pending: PendingAdd): string {
    if (pending.kind === "file") return pending.file.name;
    if (pending.kind === "path") return pending.path.split(/[/\\]/).pop() ?? pending.path;
    return pending.file.originalFilename;
}

/**
 * 対局の相手・研究の解析に使う AI（評価関数）の一覧と追加。
 * 配布 AI と、利用者が追加した AI（この端末・アカウント）を 1 つの画面で扱う。
 */
export function NnueLibrary({
    manifestUrl,
    fallbackIconUrl,
    account,
    onRequestFilePath,
    lockedReason,
    onBusyChange,
    speed,
}: NnueLibraryProps): ReactElement {
    const {
        nnueList,
        error: storageError,
        importFromFile,
        importFromBlob,
        importFromPath,
        deleteNnue,
        updateDisplayName,
        updateFvScale,
        updateLayerStacks,
        clearError: clearStorageError,
        refreshList,
        storageUsage,
        capabilities,
        loadBlob,
    } = useNnueStorage();
    const {
        presets,
        isLoading: isPresetsLoading,
        downloadingKey,
        downloadProgress,
        error: presetError,
        download: downloadPreset,
        clearError: clearPresetError,
        refresh: refreshPresets,
        isConfigured: isPresetConfigured,
        hasFetchedPresets,
    } = usePresetManager({
        manifestUrl,
        autoFetch: Boolean(manifestUrl),
        onDownloadComplete: () => {
            void refreshList();
        },
    });

    const inputRef = useRef<HTMLInputElement>(null);
    const [isDragOver, setIsDragOver] = useState(false);
    const [pendingAdd, setPendingAdd] = useState<PendingAdd | null>(null);
    const [pendingUnknownFile, setPendingUnknownFile] = useState<File | null>(null);
    const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
    const [editingMeta, setEditingMeta] = useState<NnueMeta | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [localError, setLocalError] = useState<string | null>(null);

    // Desktop はファイルとして端末に置き、Web はブラウザの中（IndexedDB）に置く。
    const deviceLabel = capabilities?.supportsPathImport ? "この端末" : "このブラウザ";
    const canPickPath = Boolean(capabilities?.supportsPathImport && onRequestFilePath);
    const canPickFile = Boolean(capabilities?.supportsFileImport);
    const canAdd = canPickPath || canPickFile;
    const isBusy = busyId !== null || downloadingKey !== null || account?.busyKey != null;
    const speedBenchmark = useNnueSpeedBenchmark(speed);
    // 測っている AI を消したり設定を変えたりしないよう、測っている間はほかの操作を止める。
    const controlsDisabled = isBusy || speedBenchmark.isRunning;
    const speedTable = (
        contentHash: string,
        prepare: () => Promise<NnueMeta | undefined>,
        downloadNote?: string,
    ) =>
        speed ? (
            <NnueSpeedTable
                contentHash={contentHash}
                prepare={prepare}
                downloadNote={downloadNote}
                support={speed}
                benchmark={speedBenchmark}
                disabledReason={lockedReason ?? (isBusy ? "ほかの処理の途中です" : undefined)}
            />
        ) : null;
    // 端末に無い配布 AI は、測るときにダウンロードする（測りたい人にダウンロードを促す）。
    const presetSpeedTable = (preset: PresetWithStatus) => {
        const localMeta =
            preset.localMetas.find((meta) => meta.contentHashSha256 === preset.config.sha256) ??
            preset.localMetas[0];
        if (localMeta) return speedTable(localMeta.contentHashSha256, async () => localMeta);
        const downloadSize = preset.config.size + (preset.config.progressCoefficients?.size ?? 0);
        return speedTable(
            preset.config.sha256,
            async () => {
                setNotice(null);
                return downloadPreset(preset.config.presetKey);
            },
            `測るときに ${formatSize(downloadSize)} をダウンロードします。`,
        );
    };

    useEffect(() => {
        onBusyChange?.(isBusy);
    }, [isBusy, onBusyChange]);

    // 配布一覧の取得が済むまでは、どの配布 AI が一覧から無くなったか分からない。
    const presetsSettled = !isPresetConfigured || (hasFetchedPresets && !isPresetsLoading);
    // 配布一覧に無くなった（配布終了・manifest の取得失敗）配布 AI も、消せるように追加した AI と並べる。
    const addedMetas = nnueList.filter(
        (meta) =>
            meta.source !== "preset" ||
            (presetsSettled &&
                !presets.some((preset) => preset.config.presetKey === meta.presetKey)),
    );
    const accountFiles = account?.isAuthenticated ? account.files : [];
    // アップロードが済んでいないものは、アカウントにある扱いにしない（取り込めないため）。
    const accountFileOf = (meta: NnueMeta) =>
        accountFiles.find(
            (file) => file.status === "completed" && file.sha256Hex === meta.contentHashSha256,
        ) ?? null;
    const accountOnlyFiles = accountFiles.filter(
        (file) =>
            file.status !== "completed" ||
            !addedMetas.some((meta) => meta.contentHashSha256 === file.sha256Hex),
    );
    // 配布 AI と同じ中身のファイル。取り込むと配布 AI の設定を書き換えてしまうので、削除だけにする。
    const presetWithSameFile = (file: NnueAccountFile) =>
        nnueList.find(
            (meta) => meta.source === "preset" && meta.contentHashSha256 === file.sha256Hex,
        ) ?? null;
    const totalSize = nnueList.reduce((sum, meta) => sum + meta.size, 0);

    const acceptFile = (file: File) => {
        setNotice(null);
        const lowerName = file.name.toLowerCase();
        if (ALLOWED_EXTENSIONS.some((ext) => lowerName.endsWith(ext))) {
            setPendingAdd({ kind: "file", file });
        } else {
            setPendingUnknownFile(file);
        }
    };

    const startAdd = async () => {
        if (canPickPath && onRequestFilePath) {
            const path = await onRequestFilePath().catch(() => null);
            if (path) setPendingAdd({ kind: "path", path });
            return;
        }
        inputRef.current?.click();
    };

    // React のイベントはポータルを越えて届く。設定ダイアログの係数ファイル欄へのドロップなどを、
    // AI の追加として受け取らないよう、DOM の上でこの一覧の中にあるときだけ扱う。
    const isOwnDragTarget = (event: DragEvent) =>
        event.currentTarget.contains(event.target as Node | null);
    const handleDragOver = (event: DragEvent) => {
        if (!canPickFile || isBusy || !isOwnDragTarget(event)) return;
        event.preventDefault();
        setIsDragOver(true);
    };
    const handleDrop = (event: DragEvent) => {
        if (!canPickFile || !isOwnDragTarget(event)) return;
        event.preventDefault();
        setIsDragOver(false);
        const file = event.dataTransfer.files[0];
        if (file && !isBusy) acceptFile(file);
    };

    const confirmAdd = async (
        fvScale: number,
        displayName: string,
        layerStacks?: LayerStacksConfig,
    ) => {
        const target = pendingAdd;
        setPendingAdd(null);
        if (!target) return;
        setBusyId("adding");
        try {
            let meta: NnueMeta | undefined;
            if (target.kind === "file") {
                meta = await importFromFile(target.file, fvScale, displayName, layerStacks);
            } else if (target.kind === "path") {
                meta = await importFromPath(target.path, fvScale, displayName, layerStacks);
            } else if (account) {
                const blob = await account.download(target.file.id);
                meta = await importFromBlob(
                    blob,
                    target.file.originalFilename,
                    fvScale,
                    displayName,
                );
                if (meta && layerStacks) await updateLayerStacks(meta.id, layerStacks);
            }
            if (meta) {
                setNotice(`「${meta.displayName}」を追加しました。`);
            }
        } catch {
            // 失敗の内容は useNnueStorage / account の error に出る
        } finally {
            setBusyId(null);
        }
    };

    const uploadToAccount = async (meta: NnueMeta) => {
        if (!account || !loadBlob) return;
        setNotice(null);
        setLocalError(null);
        // 大きなファイルの読み出し中も二重に押せないよう、読み出しの前から操作中にする。
        setBusyId(`upload:${meta.id}`);
        try {
            let blob: Blob;
            try {
                blob = await loadBlob(meta.id);
            } catch {
                setLocalError(`「${meta.displayName}」を読み出せませんでした。`);
                return;
            }
            const file = new File([blob], meta.originalFileName);
            await account.upload(file, meta.id, meta.contentHashSha256);
            setNotice(`「${meta.displayName}」をアカウントに保存しました。`);
        } catch {
            // 失敗の内容は account.error に出る
        } finally {
            setBusyId(null);
        }
    };

    const confirmDelete = async (scope: DeleteScope) => {
        const target = pendingDelete;
        setPendingDelete(null);
        if (!target) return;
        setNotice(null);
        try {
            if (target.kind === "preset") {
                setBusyId(target.preset.config.presetKey);
                try {
                    for (const meta of target.preset.localMetas) await deleteNnue(meta.id);
                } finally {
                    // 配布 AI の状態は一覧の変化では更新されないので、消したら取り直す。
                    await refreshPresets();
                }
            } else if (target.kind === "account") {
                await account?.remove(target.file.id);
            } else {
                setBusyId(target.meta.id);
                await deleteNnue(target.meta.id);
                if (scope === "both" && target.accountFile) {
                    await account?.remove(target.accountFile.id);
                }
            }
        } catch {
            // 失敗の内容は useNnueStorage / account の error に出る
        } finally {
            setBusyId(null);
        }
    };

    const clearErrors = () => {
        setLocalError(null);
        clearStorageError();
        clearPresetError();
        account?.clearError();
    };

    const error = storageError ?? presetError;
    const showPresets = isPresetConfigured && (presets.length > 0 || isPresetsLoading);

    return (
        <section
            aria-label="AI の一覧"
            className="relative flex flex-col gap-10"
            onDragOver={handleDragOver}
            onDragLeave={(event) => {
                if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
                setIsDragOver(false);
            }}
            onDrop={handleDrop}
        >
            {(error || account?.error || localError || notice) && (
                <div className="flex flex-col gap-2" aria-live="polite">
                    <NnueErrorAlert error={error} onClose={clearErrors} />
                    {[account?.error, localError].filter(Boolean).map((message) => (
                        <p
                            key={message}
                            role="alert"
                            className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
                        >
                            {message}
                        </p>
                    ))}
                    {notice && <p className="text-sm text-status-success">{notice}</p>}
                </div>
            )}

            <LibrarySection
                title="追加した AI"
                description="自分で用意した評価関数（NNUE）を追加すると、対局の相手や研究の解析で選べます。"
                note={
                    account &&
                    !account.isAuthenticated && (
                        <>
                            いまは{deviceLabel}の中にだけ保存されます。
                            <a
                                href={account.loginHref}
                                className="text-wafuu-ai underline underline-offset-2 hover:text-wafuu-ai-light"
                            >
                                ログインするとアカウントにも保存できます
                            </a>
                        </>
                    )
                }
                action={
                    canAdd &&
                    (addedMetas.length > 0 || accountOnlyFiles.length > 0) && (
                        <Button
                            size="sm"
                            onClick={() => void startAdd()}
                            disabled={controlsDisabled}
                        >
                            ファイルから追加
                        </Button>
                    )
                }
            >
                {addedMetas.length === 0 && accountOnlyFiles.length === 0 ? (
                    canAdd && (
                        <DropZone
                            active={isDragOver}
                            canDrop={
                                canPickFile &&
                                !(
                                    typeof window !== "undefined" &&
                                    typeof window.matchMedia === "function" &&
                                    window.matchMedia("(pointer: coarse)").matches
                                )
                            }
                            disabled={controlsDisabled}
                            isAdding={busyId === "adding"}
                            onPick={() => void startAdd()}
                            hint={<FreeResources />}
                        />
                    )
                ) : (
                    <ul className="grid gap-3">
                        {addedMetas.map((meta) => {
                            const accountFile = accountFileOf(meta);
                            return (
                                <AddedRow
                                    key={meta.id}
                                    title={meta.displayName}
                                    details={[
                                        formatLabel(meta.format) ?? "形式を確認できませんでした",
                                        formatSize(meta.size),
                                        meta.fvScale ? `FV_SCALE ${meta.fvScale}` : null,
                                    ]}
                                    places={[deviceLabel, ...(accountFile ? ["アカウント"] : [])]}
                                    speedLine={
                                        needsModelSettings(meta)
                                            ? null
                                            : speedTable(meta.contentHashSha256, async () => meta)
                                    }
                                    warning={
                                        needsModelSettings(meta)
                                            ? "使う前にモデル設定（振り分け方式）が必要です"
                                            : meta.format
                                              ? null
                                              : "読み込めるか確認できていません"
                                    }
                                    busyLabel={
                                        account?.busyKey === meta.id ||
                                        busyId === `upload:${meta.id}`
                                            ? `アカウントに保存中... ${account?.uploadProgress ?? 0}%`
                                            : busyId === meta.id
                                              ? "削除中..."
                                              : null
                                    }
                                >
                                    {account?.isAuthenticated &&
                                        meta.source !== "preset" &&
                                        !accountFiles.some(
                                            (file) =>
                                                file.status !== "failed" &&
                                                file.sha256Hex === meta.contentHashSha256,
                                        ) &&
                                        loadBlob && (
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                disabled={controlsDisabled}
                                                onClick={() => void uploadToAccount(meta)}
                                            >
                                                アカウントに保存
                                            </Button>
                                        )}
                                    <Button
                                        size="sm"
                                        variant={needsModelSettings(meta) ? "default" : "outline"}
                                        disabled={controlsDisabled || Boolean(lockedReason)}
                                        title={lockedReason}
                                        aria-label={`「${meta.displayName}」の設定`}
                                        onClick={() => setEditingMeta(meta)}
                                    >
                                        設定
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        disabled={controlsDisabled || Boolean(lockedReason)}
                                        title={lockedReason}
                                        aria-label={`「${meta.displayName}」を削除`}
                                        onClick={() =>
                                            setPendingDelete({ kind: "device", meta, accountFile })
                                        }
                                    >
                                        削除
                                    </Button>
                                </AddedRow>
                            );
                        })}
                        {accountOnlyFiles.map((file) => {
                            const samePreset = presetWithSameFile(file);
                            return (
                                <AddedRow
                                    key={file.id}
                                    title={file.originalFilename.replace(/\.(nnue|bin)$/i, "")}
                                    details={[formatSize(file.sizeBytes)]}
                                    places={["アカウント"]}
                                    warning={
                                        file.status === "pending"
                                            ? "アップロードの途中です。終わらなかったものは、しばらくすると片付きます"
                                            : file.status === "failed"
                                              ? "アップロードが途中で止まりました。削除するか、もう一度保存してください"
                                              : samePreset
                                                ? `配布 AI「${samePreset?.displayName}」と同じファイルです`
                                                : null
                                    }
                                    muted
                                    busyLabel={account?.busyKey === file.id ? "処理中..." : null}
                                >
                                    {file.status === "completed" && !samePreset && (
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            disabled={controlsDisabled}
                                            onClick={() => setPendingAdd({ kind: "account", file })}
                                        >
                                            {deviceLabel}で使う
                                        </Button>
                                    )}
                                    {file.status !== "pending" && (
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            disabled={controlsDisabled}
                                            aria-label={`「${file.originalFilename}」をアカウントから削除`}
                                            onClick={() =>
                                                setPendingDelete({ kind: "account", file })
                                            }
                                        >
                                            削除
                                        </Button>
                                    )}
                                </AddedRow>
                            );
                        })}
                    </ul>
                )}
                {account?.isAuthenticated && account.isLoading && (
                    <p className="text-xs text-muted-foreground">アカウントの AI を読み込み中...</p>
                )}
            </LibrarySection>

            {showPresets && (
                <LibrarySection
                    title="配布 AI"
                    description={`ラム将棋が用意している AI です。はじめて使うときに、${deviceLabel}へダウンロードします。`}
                    note={
                        speed &&
                        "NPS（nodes per second）は 1 秒あたりに読む局面の数で、AI の速さの目安です。ほかのアプリやタブが動いていると低めに出ます。"
                    }
                >
                    {presets.length === 0 ? (
                        <p className="text-sm text-muted-foreground">読み込み中...</p>
                    ) : (
                        <ul className="grid gap-3">
                            {presets.map((preset) => (
                                <PresetRow
                                    key={preset.config.presetKey}
                                    preset={preset}
                                    deviceLabel={deviceLabel}
                                    fallbackIconUrl={fallbackIconUrl}
                                    progress={
                                        downloadingKey === preset.config.presetKey
                                            ? (downloadProgress ?? {
                                                  targetKey: preset.config.presetKey,
                                                  loaded: 0,
                                                  total: preset.config.size,
                                                  phase: "downloading",
                                              })
                                            : null
                                    }
                                    disabled={controlsDisabled}
                                    lockedReason={lockedReason}
                                    speedLine={presetSpeedTable(preset)}
                                    isDeleting={busyId === preset.config.presetKey}
                                    onDownload={() => {
                                        setNotice(null);
                                        void downloadPreset(preset.config.presetKey);
                                    }}
                                    onDelete={() => setPendingDelete({ kind: "preset", preset })}
                                />
                            ))}
                        </ul>
                    )}
                </LibrarySection>
            )}

            <p className="text-xs text-muted-foreground">
                {deviceLabel}に保存している AI: {formatSize(totalSize)}
                {storageUsage?.quota
                    ? `（使える容量の目安 ${formatSize(storageUsage.quota)}）`
                    : ""}
                。{account && "ブラウザのサイトデータを消すと、このブラウザの AI も消えます。"}
                読み込めない形式や不具合は{" "}
                <a
                    href={SUPPORT_ISSUES_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-2 hover:text-foreground"
                >
                    GitHub Issues
                </a>
                か X の{" "}
                <a
                    href={SUPPORT_X_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-2 hover:text-foreground"
                >
                    @ramu_shogi
                </a>{" "}
                へお知らせください。
            </p>

            {isDragOver && addedMetas.length + accountOnlyFiles.length > 0 && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl border-2 border-dashed border-wafuu-shu bg-background/80 text-sm font-medium text-wafuu-shu">
                    ここにドロップして追加
                </div>
            )}

            <input
                ref={inputRef}
                type="file"
                className="hidden"
                accept=".nnue,.bin"
                onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) acceptFile(file);
                    event.target.value = "";
                }}
            />

            {pendingAdd && (
                <NnueFvScaleInputDialog
                    fileName={fileNameOf(pendingAdd)}
                    onConfirm={confirmAdd}
                    onCancel={() => setPendingAdd(null)}
                />
            )}
            {editingMeta && (
                <NnueFvScaleInputDialog
                    editing
                    requireLayerStacks={editingMeta.format?.architecture.includes("LayerStacks")}
                    fileName={editingMeta.displayName}
                    initialFvScale={editingMeta.fvScale}
                    initialLayerStacks={editingMeta.layerStacks}
                    onCancel={() => setEditingMeta(null)}
                    onConfirm={async (fvScale, displayName, layerStacks) => {
                        await updateFvScale(editingMeta.id, fvScale);
                        await updateDisplayName(editingMeta.id, displayName);
                        await updateLayerStacks(editingMeta.id, layerStacks);
                        setEditingMeta(null);
                        setNotice(
                            capabilities?.supportsPathImport
                                ? "設定を保存しました。対局・解析中のエンジンには、アプリを再起動すると反映されます。"
                                : "設定を保存しました。対局・解析中のページは、再読み込みすると新しい設定で動きます。",
                        );
                    }}
                />
            )}
            {pendingUnknownFile && (
                <AlertDialog open onOpenChange={(open) => !open && setPendingUnknownFile(null)}>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>このファイルを追加しますか？</AlertDialogTitle>
                            <AlertDialogDescription>
                                「{pendingUnknownFile.name}」は評価関数でよく使う拡張子（.nnue /
                                .bin）ではありません。
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>やめる</AlertDialogCancel>
                            <AlertDialogAction
                                onClick={() => {
                                    setPendingAdd({ kind: "file", file: pendingUnknownFile });
                                    setPendingUnknownFile(null);
                                }}
                            >
                                追加する
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            )}
            {pendingDelete && (
                <DeleteDialog
                    target={pendingDelete}
                    deviceLabel={deviceLabel}
                    onCancel={() => setPendingDelete(null)}
                    onConfirm={(scope) => void confirmDelete(scope)}
                />
            )}
        </section>
    );
}

function LibrarySection({
    title,
    description,
    note,
    action,
    children,
}: {
    title: string;
    description: ReactNode;
    /** 説明の下に添える小さな補足（ログインの案内など） */
    note?: ReactNode;
    action?: ReactNode;
    children: ReactNode;
}): ReactElement {
    return (
        <section className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
                <div className="flex min-w-0 flex-col gap-1">
                    <h2 className="text-lg font-semibold text-foreground">{title}</h2>
                    <p className="text-sm text-muted-foreground">{description}</p>
                    {note && <p className="text-xs text-muted-foreground">{note}</p>}
                </div>
                {action && <div className="shrink-0">{action}</div>}
            </div>
            {children}
        </section>
    );
}

function PresetRow({
    preset,
    deviceLabel,
    fallbackIconUrl,
    progress,
    disabled,
    lockedReason,
    speedLine,
    isDeleting,
    onDownload,
    onDelete,
}: {
    preset: PresetWithStatus;
    deviceLabel: string;
    fallbackIconUrl?: string;
    progress: NnueDownloadProgress | null;
    disabled: boolean;
    lockedReason?: string;
    speedLine: ReactNode;
    isDeleting: boolean;
    onDownload: () => void;
    onDelete: () => void;
}): ReactElement {
    const { config, status } = preset;
    const iconUrl = config.iconUrl ?? fallbackIconUrl;
    const downloadSize = config.size + (config.progressCoefficients?.size ?? 0);
    const percent =
        progress && progress.total > 0 ? Math.round((progress.loaded / progress.total) * 100) : 0;
    return (
        <li className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-sm sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 items-start gap-3">
                {iconUrl && (
                    <img
                        src={iconUrl}
                        // 配布 AI の画像は別オリジン。COEP（require-corp）の画面でも読めるよう CORS で取る。
                        crossOrigin={config.iconUrl ? "anonymous" : undefined}
                        alt=""
                        className="h-11 w-11 shrink-0 rounded-full border border-border object-cover"
                    />
                )}
                <div className="flex min-w-0 flex-col gap-1">
                    {/* 名前の横に用途・形式・大きさを並べる。幅が足りなければ折り返す。 */}
                    <h3 className="flex flex-wrap items-baseline gap-x-2 text-base font-semibold text-foreground">
                        {config.displayName}
                        {[config.usageLabel, formatLabel(config.format), formatSize(downloadSize)]
                            .filter(Boolean)
                            .map((label) => (
                                <span
                                    key={label}
                                    className="text-xs font-normal text-muted-foreground"
                                >
                                    {label}
                                </span>
                            ))}
                    </h3>
                    <p className="text-sm text-muted-foreground">{config.description}</p>
                    {speedLine}
                </div>
            </div>
            <div className="flex shrink-0 items-center justify-end gap-2 sm:w-48">
                {progress ? (
                    <div className="flex w-full flex-col gap-1" aria-live="polite">
                        <Progress value={progress.phase === "downloading" ? percent : undefined} />
                        <span className="text-xs text-muted-foreground">
                            {progress.phase === "downloading"
                                ? `ダウンロード中... ${percent}%`
                                : "確認して保存中..."}
                        </span>
                    </div>
                ) : (
                    <>
                        {status === "latest" ? (
                            <span className="text-xs text-status-success">
                                {isDeleting ? "削除中..." : `${deviceLabel}にあります`}
                            </span>
                        ) : (
                            <Button
                                size="sm"
                                variant="outline"
                                disabled={disabled}
                                onClick={onDownload}
                            >
                                {status === "update-available" ? "更新" : "ダウンロード"}
                            </Button>
                        )}
                        {/* 旧版だけが残っている（更新できない）ときも消せるようにする */}
                        {preset.localMetas.length > 0 && (
                            <Button
                                size="sm"
                                variant="ghost"
                                disabled={disabled || Boolean(lockedReason)}
                                title={lockedReason}
                                aria-label={`「${config.displayName}」を削除`}
                                onClick={onDelete}
                            >
                                削除
                            </Button>
                        )}
                    </>
                )}
            </div>
        </li>
    );
}

function AddedRow({
    title,
    details,
    places,
    warning,
    busyLabel,
    speedLine,
    muted = false,
    children,
}: {
    title: string;
    details: Array<string | null>;
    places: string[];
    speedLine?: ReactNode;
    warning: string | null;
    busyLabel: string | null;
    muted?: boolean;
    children: ReactNode;
}): ReactElement {
    return (
        <li
            className={cn(
                "flex flex-col gap-3 rounded-xl border border-border p-4 shadow-sm sm:flex-row sm:items-center",
                muted ? "border-dashed bg-transparent shadow-none" : "bg-card",
            )}
        >
            <div className="flex min-w-0 flex-1 flex-col gap-1">
                <h3 className="truncate text-base font-semibold text-foreground">{title}</h3>
                <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {details.filter(Boolean).map((detail) => (
                        <span key={detail}>{detail}</span>
                    ))}
                    <span>保存先: {places.join("・")}</span>
                </p>
                {speedLine}
                {warning && <p className="text-xs text-wafuu-shu">{warning}</p>}
                {busyLabel && (
                    <p aria-live="polite" className="text-xs text-muted-foreground">
                        {busyLabel}
                    </p>
                )}
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{children}</div>
        </li>
    );
}

function DropZone({
    active,
    canDrop,
    disabled,
    isAdding,
    onPick,
    hint,
}: {
    active: boolean;
    canDrop: boolean;
    disabled: boolean;
    isAdding: boolean;
    onPick: () => void;
    hint?: ReactNode;
}): ReactElement {
    return (
        <div
            className={cn(
                "flex flex-col items-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors",
                active ? "border-wafuu-shu bg-wafuu-shu/5" : "border-border",
            )}
        >
            <p className="text-sm font-medium text-foreground">
                {isAdding
                    ? "追加しています..."
                    : canDrop
                      ? "評価関数のファイル（.nnue / .bin）をここにドロップ"
                      : "評価関数のファイル（.nnue / .bin）を選んで追加"}
            </p>
            <Button onClick={onPick} disabled={disabled}>
                ファイルを選ぶ
            </Button>
            {hint}
        </div>
    );
}

function FreeResources(): ReactElement {
    return (
        <p className="text-xs text-muted-foreground">
            公開されている評価関数の例:{" "}
            {FREE_NNUE_RESOURCES.map((resource, index) => (
                <span key={resource.name}>
                    {index > 0 && "、"}
                    <a
                        href={resource.downloadUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline underline-offset-2 hover:text-foreground"
                    >
                        {resource.name}
                    </a>
                    （FV_SCALE {resource.fvScale}）
                </span>
            ))}
        </p>
    );
}

function DeleteDialog({
    target,
    deviceLabel,
    onCancel,
    onConfirm,
}: {
    target: PendingDelete;
    deviceLabel: string;
    onCancel: () => void;
    onConfirm: (scope: DeleteScope) => void;
}): ReactElement {
    const name =
        target.kind === "preset"
            ? target.preset.config.displayName
            : target.kind === "account"
              ? target.file.originalFilename
              : target.meta.displayName;
    const description =
        target.kind === "account"
            ? "アカウントから削除します。ほかの端末に取り込んだものは残ります。"
            : target.kind === "preset"
              ? `${deviceLabel}から削除します。使うときにまたダウンロードできます。`
              : target.accountFile
                ? `${deviceLabel}とアカウントから削除します。アカウントに残すなら「${deviceLabel}から外す」を選んでください。`
                : `${deviceLabel}から削除します。元に戻すには、ファイルをもう一度追加してください。`;
    const hasAccountCopy = target.kind === "device" && target.accountFile !== null;
    return (
        <AlertDialog open onOpenChange={(open) => !open && onCancel()}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>「{name}」を削除しますか？</AlertDialogTitle>
                    <AlertDialogDescription>{description}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>やめる</AlertDialogCancel>
                    {hasAccountCopy && (
                        // 「削除」と書くとアカウントそのものを消すと読まれるので、この端末から「外す」と言う。
                        <AlertDialogAction
                            className="border border-input bg-background text-foreground shadow-none hover:bg-muted/50"
                            onClick={() => onConfirm("device")}
                        >
                            {deviceLabel}から外す
                        </AlertDialogAction>
                    )}
                    <AlertDialogAction
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        onClick={() => onConfirm("both")}
                    >
                        削除
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
