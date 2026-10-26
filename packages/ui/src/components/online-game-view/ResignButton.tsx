import type { ReactElement } from "react";
import { useState } from "react";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "../alert-dialog";

interface ResignButtonProps {
    /** つながっていない間は押せない */
    disabled: boolean;
    isMyTurn: boolean;
    canResign: boolean;
    onResign: () => void;
}

/**
 * 投了は取り消せないので、確かめてから送る（スマホでは隣の「棋譜」「待った」と押し間違えやすい）。
 * 終局したら呼び出し側がボタンごと消すので、確かめている途中でも閉じる（相手の投了・時間切れ）
 */
export function ResignButton({
    disabled,
    isMyTurn,
    canResign,
    onResign,
}: ResignButtonProps): ReactElement {
    const [isConfirmOpen, setIsConfirmOpen] = useState(false);
    return (
        <AlertDialog open={isConfirmOpen} onOpenChange={setIsConfirmOpen}>
            <AlertDialogTrigger asChild>
                <button
                    type="button"
                    disabled={disabled}
                    className="rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    投了
                </button>
            </AlertDialogTrigger>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>投了しますか？</AlertDialogTitle>
                    <AlertDialogDescription>
                        {/* 切れている間（自分の手番でも押せない）は、上の接続の案内に任せる。 */}
                        {isMyTurn
                            ? "対局を終了します。取り消せません。"
                            : "相手の手番の間は投了できません。自分の手番になってから投了してください。"}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>キャンセル</AlertDialogCancel>
                    <AlertDialogAction onClick={onResign} disabled={!canResign}>
                        投了する
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
