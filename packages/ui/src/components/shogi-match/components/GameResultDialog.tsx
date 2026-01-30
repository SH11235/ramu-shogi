import type { GameResult } from "@shogi/app-core";
import { getReasonText, getWinnerLabel } from "@shogi/app-core";
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

interface GameResultDialogProps {
    result: GameResult | null;
    open: boolean;
    onClose: () => void;
}

export function GameResultDialog({
    result,
    open,
    onClose,
}: GameResultDialogProps): ReactElement | null {
    if (!result) {
        return null;
    }

    const winnerLabel = getWinnerLabel(result.winner);
    const reasonText = getReasonText(result.reason);

    return (
        <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
            <DialogContent className="w-[min(400px,calc(100%-32px))] text-center">
                <DialogHeader>
                    <DialogTitle className="text-center text-xl">対局終了</DialogTitle>
                </DialogHeader>

                <div className="flex flex-col items-center gap-4 py-4">
                    <div className="text-2xl font-bold text-[hsl(var(--wafuu-kin,42_85%_50%))]">
                        {winnerLabel}
                    </div>

                    <div className="h-px w-full bg-border" />

                    <DialogDescription className="text-base text-foreground">
                        {reasonText}
                    </DialogDescription>

                    <div className="text-sm text-muted-foreground">{result.totalMoves}手まで</div>
                </div>

                <DialogFooter className="justify-center">
                    <Button onClick={onClose} className="min-w-[120px]">
                        閉じる
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
