import type { ReactElement } from "react";
import { Button } from "../../button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "../../dialog";
import { presetDownloadSize, type useMatchNnueDownload } from "../hooks/useMatchNnueDownload";

const mb = (bytes: number) =>
    (bytes / 1_000_000).toLocaleString("ja-JP", { maximumFractionDigits: 1 });

export function MatchNnueDownloadDialog({
    state,
}: {
    state: ReturnType<typeof useMatchNnueDownload>;
}): ReactElement {
    const { presets, busy, progress, completedBytes, error, cancel, download } = state;
    const total = presets.reduce((sum, preset) => sum + presetDownloadSize(preset), 0);
    const loaded = Math.min(total, completedBytes + (progress?.loaded ?? 0));
    const percent = total > 0 ? Math.floor((loaded / total) * 100) : 0;
    const names = presets.map((preset) => preset.displayName).join("・");
    return (
        <Dialog
            open={presets.length > 0}
            onOpenChange={(open) => {
                if (!open && !busy) cancel();
            }}
        >
            <DialogContent
                className="w-[min(440px,calc(100%-24px))]"
                aria-describedby="match-ai-download-description"
                onEscapeKeyDown={(event) => {
                    if (busy) event.preventDefault();
                }}
                onInteractOutside={(event) => {
                    if (busy) event.preventDefault();
                }}
            >
                <div className="flex flex-col gap-5">
                    <DialogHeader>
                        <DialogTitle>
                            {busy
                                ? "AIをダウンロードしています"
                                : `${names}をダウンロードしますか？`}
                        </DialogTitle>
                        <DialogDescription id="match-ai-download-description" className="pt-2">
                            対局を始めるには、約 {mb(total)} MB
                            のダウンロードが必要です。ダウンロード後、自動で対局を開始します。
                        </DialogDescription>
                    </DialogHeader>
                    {presets.length > 1 && (
                        <ul className="flex flex-col gap-2 text-sm">
                            {presets.map((preset) => (
                                <li key={preset.presetKey} className="flex justify-between gap-4">
                                    <span>{preset.displayName}</span>
                                    <span>{mb(presetDownloadSize(preset))} MB</span>
                                </li>
                            ))}
                        </ul>
                    )}
                    {busy && (
                        <div className="flex flex-col gap-2" aria-live="polite">
                            <progress
                                aria-label="AIのダウンロード進捗"
                                value={loaded}
                                max={total || 1}
                                className="h-2 w-full accent-wafuu-shu"
                            />
                            <p className="text-sm text-muted-foreground">
                                {percent}% · {mb(loaded)} / {mb(total)} MB
                            </p>
                            {progress?.phase === "validating" && (
                                <p className="text-sm text-muted-foreground">
                                    ファイルを確認しています…
                                </p>
                            )}
                            {progress?.phase === "saving" && (
                                <p className="text-sm text-muted-foreground">
                                    端末に保存しています…
                                </p>
                            )}
                        </div>
                    )}
                    {error && (
                        <p role="alert" className="text-sm text-destructive">
                            {error}
                        </p>
                    )}
                    {!busy && (
                        <DialogFooter>
                            <Button variant="outline" onClick={cancel}>
                                キャンセル
                            </Button>
                            <Button onClick={() => void download()}>
                                {error ? "再試行" : "ダウンロードして対局開始"}
                            </Button>
                        </DialogFooter>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
