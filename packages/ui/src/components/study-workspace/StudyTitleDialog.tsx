/**
 * 研究ノートの表題を変えるダイアログ。スマートフォンでは表題を画面に出さない（パンくずに出る）ので、
 * 「その他の操作」から開く。
 */
import { STUDY_LIMITS } from "@shogi/app-core";
import type { ReactElement } from "react";
import { useState } from "react";
import { Button } from "../button";
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "../dialog";

interface StudyTitleDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    /** 変えた表題を保存する（空や変わっていないときは呼ばない）。 */
    onCommit: (title: string) => void;
}

export function StudyTitleDialog({
    open,
    onOpenChange,
    title,
    onCommit,
}: StudyTitleDialogProps): ReactElement {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="w-[min(400px,calc(100%-24px))]" hasDescription>
                {/* 開くたびに、いまの表題から書き始める。 */}
                {open && (
                    <TitleForm
                        title={title}
                        onSubmit={(next) => {
                            if (next !== title) onCommit(next);
                            onOpenChange(false);
                        }}
                    />
                )}
            </DialogContent>
        </Dialog>
    );
}

function TitleForm({
    title,
    onSubmit,
}: {
    title: string;
    onSubmit: (title: string) => void;
}): ReactElement {
    const [draft, setDraft] = useState(title);
    const next = Array.from(draft.trim()).slice(0, STUDY_LIMITS.titleLength).join("");
    return (
        <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
                event.preventDefault();
                if (next !== "") onSubmit(next);
            }}
        >
            <DialogHeader>
                <DialogTitle>表題を変更</DialogTitle>
                <DialogDescription>研究ノートの一覧とページの見出しに出ます。</DialogDescription>
            </DialogHeader>
            <input
                type="text"
                aria-label="研究ノートの表題"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                className="h-10 rounded-md border border-wafuu-border bg-background px-3 text-base text-wafuu-sumi focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <DialogFooter className="flex-row justify-end gap-2">
                <DialogClose asChild>
                    <Button type="button" variant="outline">
                        キャンセル
                    </Button>
                </DialogClose>
                <Button type="submit" disabled={next === ""}>
                    変更する
                </Button>
            </DialogFooter>
        </form>
    );
}
