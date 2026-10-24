import { type ReactElement, useState } from "react";
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
    (bytes / (1024 * 1024)).toLocaleString("ja-JP", { maximumFractionDigits: 1 });

/** ダウンロードの目的ごとの文言。既定は対局の開始。 */
const PURPOSE_TEXT = {
    match: {
        description: "対局を始めるには、",
        after: "ダウンロード後、自動で対局を開始します。",
        action: "ダウンロードして対局開始",
    },
    analysis: {
        description: "解析を始めるには、",
        after: "ダウンロード後、自動で解析を始めます。",
        action: "ダウンロードして解析",
    },
    speed: {
        description: "測るには、",
        after: "ダウンロード後、自動で測ります。",
        action: "ダウンロードして測る",
    },
} as const;

export function MatchNnueDownloadDialog({
    state,
    purpose = "match",
    alternative,
}: {
    state: Pick<
        ReturnType<typeof useMatchNnueDownload>,
        "presets" | "busy" | "progress" | "completedBytes" | "error" | "cancel" | "download"
    >;
    /** 何のためのダウンロードか（文言だけが変わる）。 */
    purpose?: keyof typeof PURPOSE_TEXT;
    /**
     * ダウンロードせずに進める別の道（研究ノートの「簡易 AI で解析する」）。
     * 指定したときだけ、その選択肢を出す。
     */
    alternative?: { label: string; onSelect: () => void };
}): ReactElement {
    const text = PURPOSE_TEXT[purpose];
    const { cancel, download } = state;
    const open = state.presets.length > 0;
    // 閉じるアニメーションの間も、空の内容（名前なし・0 MB・0%）ではなく閉じる直前の内容を出す。
    const view = {
        presets: state.presets,
        busy: state.busy,
        progress: state.progress,
        completedBytes: state.completedBytes,
        error: state.error,
    };
    const [lastShown, setLastShown] = useState(view);
    if (open && (Object.keys(view) as (keyof typeof view)[]).some((k) => view[k] !== lastShown[k]))
        setLastShown(view);
    const { presets, busy, progress, completedBytes, error } = open ? view : lastShown;
    const total = presets.reduce((sum, preset) => sum + presetDownloadSize(preset), 0);
    const loaded = Math.min(total, completedBytes + (progress?.loaded ?? 0));
    const percent = total > 0 ? Math.floor((loaded / total) * 100) : 0;
    const names = presets.map((preset) => preset.displayName).join("・");
    return (
        <Dialog
            open={open}
            onOpenChange={(open) => {
                if (!open && !busy) cancel();
            }}
        >
            <DialogContent
                className="w-[min(440px,calc(100%-24px))]"
                hasDescription
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
                        <DialogDescription className="pt-2">
                            {text.description}約 {mb(total)} MB のダウンロードが必要です。
                            {text.after}
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
                                {error ? "再試行" : text.action}
                            </Button>
                        </DialogFooter>
                    )}
                    {!busy && alternative && (
                        <button
                            type="button"
                            onClick={alternative.onSelect}
                            className="self-center rounded-sm text-sm text-wafuu-ai underline underline-offset-2 hover:text-wafuu-ai-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                            {alternative.label}
                        </button>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
