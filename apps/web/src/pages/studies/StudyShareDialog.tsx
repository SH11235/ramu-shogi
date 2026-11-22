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
import { useEffect, useRef, useState } from "react";

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
    const readVersion = useRef(0);
    const pendingSave = useRef<Promise<unknown> | null>(null);
    const confirmingSave = useRef(false);

    useEffect(() => {
        if (unavailableReason !== null) return;
        let cancelled = false;
        setVisibility(null);
        setNotSaved(false);
        setError(null);
        setStatus(null);
        const loadVisibility = async (): Promise<void> => {
            const version = ++readVersion.current;
            if (pendingSave.current) await pendingSave.current;
            if (cancelled || version !== readVersion.current) return;
            try {
                const result = await api.get(studyId);
                if (cancelled || version !== readVersion.current) return;
                if (result.ok) {
                    confirmingSave.current = false;
                    setVisibility(result.data.study.visibility);
                    setNotSaved(false);
                    setError(null);
                    return;
                }
                if (!confirmingSave.current && (result.status === 404 || result.status === 410)) {
                    setVisibility(null);
                    setNotSaved(true);
                    setError(null);
                    return;
                }
            } catch {
                if (cancelled || version !== readVersion.current) return;
            }
            setVisibility(null);
            setNotSaved(false);
            setStatus(null);
            setError("公開設定を読み込めませんでした。");
        };
        const onFocus = (): void => {
            setStatus(null);
            void loadVisibility();
        };
        const onVisibilityChange = (): void => {
            if (document.visibilityState === "visible") onFocus();
        };
        void loadVisibility();
        window.addEventListener("focus", onFocus);
        document.addEventListener("visibilitychange", onVisibilityChange);
        return () => {
            cancelled = true;
            window.removeEventListener("focus", onFocus);
            document.removeEventListener("visibilitychange", onVisibilityChange);
        };
    }, [api, studyId, unavailableReason, reloadCount]);

    const changeVisibility = async (next: StudyVisibility): Promise<void> => {
        if (unavailableReason !== null || visibility === null || pendingSave.current) return;
        // 更新前に始めた GET で、保存後の表示を上書きしない。
        readVersion.current += 1;
        setIsSaving(true);
        setError(null);
        setStatus(null);
        const save = api.setVisibility(studyId, { visibility: next }).catch(() => null);
        pendingSave.current = save;
        const result = await save;
        pendingSave.current = null;
        setIsSaving(false);
        if (result?.ok) {
            setVisibility(next);
            setStatus("公開設定を保存しました。");
        } else {
            confirmingSave.current = true;
            setVisibility(null);
            setReloadCount((count) => count + 1);
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
