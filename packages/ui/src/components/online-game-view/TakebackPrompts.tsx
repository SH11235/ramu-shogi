import type { ReactElement } from "react";
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

/** 待ったを申請した側に、相手の応答を待っている間だけ出す */
export function TakebackPendingBanner({
    canCancel,
    onCancel,
}: {
    canCancel: boolean;
    onCancel: () => void;
}): ReactElement {
    return (
        <div className="flex items-center justify-between rounded-lg border border-wafuu-kincha/40 bg-wafuu-kincha/10 px-3 py-2 text-sm">
            <span className="text-wafuu-kincha">待った申請中... 相手の応答を待っています</span>
            <button
                type="button"
                onClick={onCancel}
                disabled={!canCancel}
                className="ml-3 text-xs text-muted-foreground underline hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
            >
                取り消す
            </button>
        </div>
    );
}

/** 申請された側の承認ダイアログ。答えるまで閉じない（Esc や外側のクリックでは閉じない） */
export function TakebackApprovalDialog({
    open,
    onRespond,
}: {
    open: boolean;
    onRespond: (accept: boolean) => void;
}): ReactElement {
    return (
        <AlertDialog open={open}>
            <AlertDialogContent
                className="w-[min(300px,calc(100%-32px))]"
                onEscapeKeyDown={(event) => event.preventDefault()}
            >
                <AlertDialogHeader>
                    <AlertDialogTitle>待ったの申請</AlertDialogTitle>
                    <AlertDialogDescription>
                        相手が直前の手を取り消したいと申請しています
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel onClick={() => onRespond(false)}>拒否する</AlertDialogCancel>
                    <AlertDialogAction onClick={() => onRespond(true)}>承認する</AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
