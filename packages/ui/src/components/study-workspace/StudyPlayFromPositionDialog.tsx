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

/**
 * 「ここから対局」の前の確認。押すとページを移るので、どの局面から始まるか・移った先で何を選べるか・
 * ノートは残ることを知らせてから移る。
 */
export function StudyPlayFromPositionDialog({
    open,
    positionTitle,
    turnLabel,
    onCancel,
    onConfirm,
}: {
    open: boolean;
    /** 「28手目 ☖8三飛(82)」「開始局面」。 */
    positionTitle: string;
    /** 「☗先手番」「☖後手番」。 */
    turnLabel: string;
    onCancel: () => void;
    onConfirm: () => void;
}): ReactElement {
    return (
        <AlertDialog
            open={open}
            onOpenChange={(next) => {
                if (!next) onCancel();
            }}
        >
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>この局面から対局しますか？</AlertDialogTitle>
                    <div className="flex items-baseline gap-2 rounded-md border border-border bg-muted px-3 py-2">
                        <span className="font-semibold text-wafuu-sumi">{positionTitle}</span>
                        <span className="text-xs text-muted-foreground">{turnLabel}</span>
                    </div>
                    <AlertDialogDescription>
                        対局の画面に移ります。先後・相手・持ち時間は、そこで選べます。このノートには、あとで戻れます。
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>やめる</AlertDialogCancel>
                    <AlertDialogAction onClick={onConfirm}>対局の画面へ</AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
