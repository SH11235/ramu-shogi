import { Button } from "../button";
import type { RemoteNnueFile } from "./types";

interface RemoteNnueListItemProps {
    file: RemoteNnueFile;
    onImport: (file: RemoteNnueFile) => void;
    isImporting: boolean;
    disabled?: boolean;
}

function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function RemoteNnueListItem({
    file,
    onImport,
    isImporting,
    disabled = false,
}: RemoteNnueListItemProps) {
    const isImported = file.importedMeta !== null;

    return (
        <div className="flex flex-col gap-2 rounded-md border border-border p-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center gap-2">
                        <span className="truncate font-medium text-foreground">
                            {file.originalFilename}
                        </span>
                        <span
                            className={`rounded px-1.5 py-0.5 text-[11px] ${
                                isImported
                                    ? "bg-[hsl(var(--success,142_76%_36%)/0.1)] text-[hsl(var(--success,142_76%_36%))]"
                                    : "bg-muted text-muted-foreground"
                            }`}
                        >
                            {isImported ? "取り込み済み" : "未取り込み"}
                        </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-[13px] text-muted-foreground">
                        <span>{formatSize(file.sizeBytes)}</span>
                        <span>{new Date(file.createdAt).toLocaleString("ja-JP")}</span>
                    </div>
                    {file.importedMeta && (
                        <div className="mt-1 text-xs text-muted-foreground">
                            ブラウザ保存名: {file.importedMeta.displayName}
                            {file.importedMeta.fvScale !== undefined &&
                                ` / FV_SCALE ${file.importedMeta.fvScale}`}
                        </div>
                    )}
                </div>

                <Button
                    type="button"
                    variant={isImported ? "secondary" : "default"}
                    size="sm"
                    onClick={() => onImport(file)}
                    disabled={disabled || isImporting || isImported}
                    className="shrink-0"
                >
                    {isImporting ? "取り込み中..." : isImported ? "取り込み済み" : "取り込む"}
                </Button>
            </div>
        </div>
    );
}
