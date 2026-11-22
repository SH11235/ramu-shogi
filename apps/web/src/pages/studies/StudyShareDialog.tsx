import type { StudyVisibility } from "@shogi/api-contract";
import type { StudyApiClient } from "@shogi/study-client";
import { Button } from "@shogi/ui/components/button";
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@shogi/ui/components/dialog";
import type { ReactElement } from "react";
import { useEffect, useState } from "react";

const visibilityOptions = [
    { value: "private", label: "非公開" },
    { value: "unlisted", label: "リンクを知っている人が閲覧可" },
] as const;

export function StudyShareDialog({
    studyId,
    api,
    unavailableReason,
    onClose,
}: {
    studyId: string;
    api: Pick<StudyApiClient, "get" | "setVisibility">;
    unavailableReason: string | null;
    onClose: () => void;
}): ReactElement {
    const [visibility, setVisibility] = useState<StudyVisibility | null>(null);
    const [notSaved, setNotSaved] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [reloadCount, setReloadCount] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [status, setStatus] = useState<string | null>(null);

    useEffect(() => {
        if (unavailableReason !== null) return;
        let cancelled = false;
        setVisibility(null);
        setNotSaved(false);
        setError(null);
        setStatus(null);
        void api.get(studyId).then((result) => {
            if (cancelled) return;
            if (result.ok) setVisibility(result.data.study.visibility);
            else if (result.status === 404 || result.status === 410) setNotSaved(true);
            else setError("公開設定を読み込めませんでした。");
        });
        return () => {
            cancelled = true;
        };
    }, [api, studyId, unavailableReason, reloadCount]);

    const changeVisibility = async (next: StudyVisibility): Promise<void> => {
        if (unavailableReason !== null || visibility === null || next === visibility || isSaving)
            return;
        setIsSaving(true);
        setError(null);
        setStatus(null);
        const result = await api.setVisibility(studyId, { visibility: next });
        setIsSaving(false);
        if (result.ok) {
            setVisibility(next);
            setStatus("公開設定を保存しました。");
        } else {
            setError(result.error.message ?? "公開設定を保存できませんでした。");
        }
    };

    const disabledReason =
        unavailableReason ?? (notSaved ? "クラウドに保存すると共有できます。" : null);
    const shareUrl = new URL(`/studies/${encodeURIComponent(studyId)}`, window.location.origin)
        .href;
    const copyShareUrl = async (): Promise<void> => {
        setError(null);
        setStatus(null);
        try {
            await navigator.clipboard.writeText(shareUrl);
            setStatus("共有リンクをコピーしました。");
        } catch {
            setError("共有リンクのコピーに失敗しました。");
        }
    };

    return (
        <Dialog
            open
            onOpenChange={(open) => {
                if (!open && !isSaving) onClose();
            }}
        >
            <DialogContent className="flex w-[min(440px,calc(100%-24px))] flex-col" hasDescription>
                <DialogHeader>
                    <DialogTitle>公開設定</DialogTitle>
                    <DialogDescription>
                        {disabledReason ?? "研究ノートを閲覧できる人を設定します。"}
                    </DialogDescription>
                </DialogHeader>
                {disabledReason === null && (
                    <>
                        {visibility === null && !error && (
                            <p role="status">公開設定を読み込み中…</p>
                        )}
                        {visibility === null && error && (
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => setReloadCount((count) => count + 1)}
                            >
                                もう一度読み込む
                            </Button>
                        )}
                        {visibility !== null && (
                            <div className="grid gap-2">
                                {visibilityOptions.map(({ value, label }) => (
                                    <Button
                                        key={value}
                                        type="button"
                                        variant={visibility === value ? "default" : "outline"}
                                        aria-pressed={visibility === value}
                                        disabled={isSaving}
                                        onClick={() => void changeVisibility(value)}
                                    >
                                        {label}
                                    </Button>
                                ))}
                            </div>
                        )}
                        {visibility === "unlisted" && (
                            <div className="grid gap-2">
                                <div>
                                    <h3 className="font-semibold text-foreground">共有リンク</h3>
                                    <p className="text-sm text-muted-foreground">
                                        このリンクを知っている人は研究ノートを閲覧できます。
                                    </p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <input
                                        aria-label="共有リンク"
                                        className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                                        value={shareUrl}
                                        readOnly
                                        onFocus={(event) => event.target.select()}
                                    />
                                    <Button
                                        type="button"
                                        variant="outline"
                                        disabled={isSaving}
                                        onClick={() => void copyShareUrl()}
                                    >
                                        コピー
                                    </Button>
                                </div>
                            </div>
                        )}
                        {error && (
                            <p role="alert" className="text-sm text-destructive">
                                {error}
                            </p>
                        )}
                        {status && (
                            <p role="status" className="text-sm text-muted-foreground">
                                {status}
                            </p>
                        )}
                    </>
                )}
                <DialogFooter>
                    <DialogClose asChild>
                        <Button type="button" variant="outline" disabled={isSaving}>
                            閉じる
                        </Button>
                    </DialogClose>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
