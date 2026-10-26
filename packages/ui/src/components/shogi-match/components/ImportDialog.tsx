import type { ReactElement, ReactNode } from "react";
import { CloseIconButton } from "../../close-icon-button";
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle } from "../../dialog";

interface ImportDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    children: ReactNode;
}

/** PC 版の「棋譜/局面インポート」のダイアログ */
export function ImportDialog({ open, onOpenChange, children }: ImportDialogProps): ReactElement {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex max-h-[85vh] w-[min(520px,calc(100%-24px))] flex-col p-0">
                <DialogHeader className="sticky top-0 flex flex-row items-center justify-between border-b border-border bg-background px-6 py-4">
                    <DialogTitle>棋譜/局面インポート</DialogTitle>
                    <DialogClose asChild>
                        <CloseIconButton />
                    </DialogClose>
                </DialogHeader>

                {/* minHeight: 0 は flexbox 内でスクロールを機能させるために必要 */}
                <div className="flex-1 min-h-0 overflow-auto p-6">{children}</div>
            </DialogContent>
        </Dialog>
    );
}
