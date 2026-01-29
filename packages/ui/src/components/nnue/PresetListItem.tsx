import type { NnueDownloadProgress, PresetWithStatus } from "@shogi/app-core";
import { cn } from "@shogi/design-system";
import type { ReactElement } from "react";
import { getDownloadedMeta } from "../../hooks/usePresetManager";
import { Button } from "../button";
import { Progress } from "../progress";

interface PresetListItemProps {
    /** プリセットと状態 */
    preset: PresetWithStatus;
    /** 選択されているか */
    isSelected?: boolean;
    /** 選択時のコールバック（ダウンロード済みの場合のみ有効） */
    onSelect?: (nnueId: string) => void;
    /** ダウンロード時のコールバック */
    onDownload: (presetKey: string) => void;
    /** ダウンロード中かどうか */
    isDownloading: boolean;
    /** ダウンロード進捗 */
    downloadProgress: NnueDownloadProgress | null;
    /** 無効化 */
    disabled?: boolean;
    /** 選択機能を有効にするか（デフォルト: true） */
    selectable?: boolean;
}

function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getPhaseLabel(phase: NnueDownloadProgress["phase"]): string {
    switch (phase) {
        case "downloading":
            return "ダウンロード中";
        case "validating":
            return "検証中";
        case "saving":
            return "保存中";
        default:
            return "処理中";
    }
}

/**
 * プリセット NNUE のリストアイテム
 *
 * ダウンロード状態に応じて表示を切り替える
 */
export function PresetListItem({
    preset,
    isSelected = false,
    onSelect,
    onDownload,
    isDownloading,
    downloadProgress,
    disabled = false,
    selectable = true,
}: PresetListItemProps): ReactElement {
    const { config, status } = preset;
    const { meta: downloadedMeta } = getDownloadedMeta(preset);
    // 選択可能: selectable が true かつダウンロード済み
    const canSelect = selectable && downloadedMeta !== null;

    const handleChange = () => {
        if (disabled || isDownloading) return;
        if (canSelect && downloadedMeta && onSelect) {
            onSelect(downloadedMeta.id);
        }
    };

    const handleDownload = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!isDownloading && !disabled) {
            onDownload(config.presetKey);
        }
    };

    const progressPercent =
        downloadProgress && downloadProgress.total > 0
            ? Math.round((downloadProgress.loaded / downloadProgress.total) * 100)
            : 0;

    const baseClassName = cn(
        "flex flex-col gap-2 rounded-md border p-3 transition-colors",
        isSelected ? "border-primary bg-accent" : "border-border",
        disabled ? "opacity-50" : "",
    );

    const labelClassName = cn(
        "flex items-center gap-3",
        disabled ? "cursor-default" : "cursor-pointer",
    );

    // ステータスバッジを描画
    const renderStatusBadge = () => {
        if (status === "latest") {
            return (
                <span className="rounded bg-[hsl(var(--success,142_76%_36%)/0.1)] px-1.5 py-0.5 text-[11px] text-[hsl(var(--success,142_76%_36%))]">
                    最新
                </span>
            );
        }
        if (status === "update-available") {
            return (
                <span className="rounded bg-[hsl(var(--warning,38_92%_50%)/0.1)] px-1.5 py-0.5 text-[11px] text-[hsl(var(--warning,38_92%_50%))]">
                    更新あり
                </span>
            );
        }
        if (status === "not-downloaded") {
            return (
                <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                    未ダウンロード
                </span>
            );
        }
        return null;
    };

    // コンテンツ部分（名前、バッジ、説明）
    const contentSection = (
        <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-center gap-2">
                <span className="truncate font-medium">{config.displayName}</span>
                {renderStatusBadge()}
            </div>
            <div className="flex items-center gap-3 text-[13px] text-muted-foreground">
                <span>{formatSize(config.size)}</span>
                {config.license && <span>{config.license}</span>}
            </div>
            {config.description && (
                <div className="mt-1 text-xs leading-snug text-muted-foreground">
                    {config.description}
                </div>
            )}
        </div>
    );

    // ファイルサイズが大きい場合（50MB以上）は警告を表示
    const isLargeFile = config.size >= 50 * 1024 * 1024;

    // ダウンロードボタンと警告
    const downloadSection = (status === "not-downloaded" || status === "update-available") && (
        <div className="flex flex-col items-end gap-1">
            {isLargeFile && !isDownloading && (
                <span className="whitespace-nowrap rounded bg-[hsl(var(--warning,38_92%_50%)/0.1)] px-1.5 py-0.5 text-[11px] font-medium text-[hsl(var(--warning,38_92%_50%))]">
                    ⚠ Wi-Fi推奨
                </span>
            )}
            <Button
                variant={status === "update-available" ? "outline" : "default"}
                size="sm"
                onClick={handleDownload}
                disabled={isDownloading || disabled}
                className="shrink-0"
            >
                {isDownloading
                    ? "ダウンロード中..."
                    : status === "update-available"
                      ? "更新"
                      : "ダウンロード"}
            </Button>
        </div>
    );

    // ダウンロード進捗
    const progressSection = isDownloading && downloadProgress && (
        <div className="flex flex-col gap-1">
            <Progress value={progressPercent} className="h-1.5" />
            <div className="flex justify-between text-[11px] text-muted-foreground">
                <span>{getPhaseLabel(downloadProgress.phase)}</span>
                <span>
                    {formatSize(downloadProgress.loaded)} / {formatSize(downloadProgress.total)} (
                    {progressPercent}%)
                </span>
            </div>
        </div>
    );

    // 選択不可の場合は静的な div
    if (!canSelect) {
        return (
            <div className={baseClassName}>
                <div className="flex items-center gap-3">
                    {contentSection}
                    {downloadSection}
                </div>
                {progressSection}
            </div>
        );
    }

    // 選択可能な場合は input type="radio" を使用
    return (
        <div className={cn(baseClassName, !disabled && "hover:bg-muted/50")}>
            <label className={labelClassName}>
                <input
                    type="radio"
                    checked={isSelected}
                    onChange={handleChange}
                    disabled={disabled || isDownloading}
                    className="m-0 h-5 w-5 shrink-0 accent-[hsl(var(--primary,220_90%_56%))]"
                />
                {contentSection}
                {downloadSection}
            </label>
            {progressSection}
        </div>
    );
}
