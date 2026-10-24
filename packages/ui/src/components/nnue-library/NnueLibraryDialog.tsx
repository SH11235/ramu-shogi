import type { ReactElement } from "react";
import { useState } from "react";
import { Button } from "../button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../dialog";
import { NnueLibrary } from "./NnueLibrary";
import type { NnueAccountStore, NnueSpeedSupport } from "./types";

interface NnueLibraryDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    manifestUrl?: string;
    fallbackIconUrl?: string;
    account?: NnueAccountStore;
    onRequestFilePath?: () => Promise<string | null>;
    /** 開いた理由（解析用の AI が未ダウンロードなど） */
    openReason?: string;
    onClearOpenReason?: () => void;
    /** 対局中は、使っている AI を消せないようにする */
    isMatchActive?: boolean;
    speed?: NnueSpeedSupport;
}

function reasonMessage(reason: string): string {
    if (reason === "missing-sente") return "先手の AI がまだダウンロードされていません。";
    if (reason === "missing-gote") return "後手の AI がまだダウンロードされていません。";
    if (reason === "missing-analysis") return "解析に使う AI がまだダウンロードされていません。";
    return reason;
}

/**
 * 画面を離れられないとき（対局中・オンライン対局の部屋・Desktop）に、AI の一覧をその場で開く。
 */
export function NnueLibraryDialog({
    open,
    onOpenChange,
    openReason,
    onClearOpenReason,
    isMatchActive = false,
    ...libraryProps
}: NnueLibraryDialogProps): ReactElement {
    // 閉じると中身ごと作り直され、続いている処理を見失って同じ操作をやり直せてしまう（二重のダウンロード
    // など）。処理が終わるまで閉じさせない。
    const [isBusy, setIsBusy] = useState(false);
    const handleOpenChange = (next: boolean) => {
        if (!next && isBusy) return;
        onOpenChange(next);
    };
    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="flex max-h-[90dvh] w-[min(760px,calc(100%-24px))] flex-col">
                <DialogHeader>
                    <DialogTitle>AI（評価関数）</DialogTitle>
                </DialogHeader>
                <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
                    {openReason && (
                        <div className="flex items-start justify-between gap-3 rounded-md border border-status-warning/30 bg-status-warning/10 px-3 py-2 text-sm text-foreground">
                            <p>{reasonMessage(openReason)}</p>
                            {onClearOpenReason && (
                                <button
                                    type="button"
                                    onClick={onClearOpenReason}
                                    className="text-muted-foreground hover:text-foreground"
                                    aria-label="メッセージを閉じる"
                                >
                                    ✕
                                </button>
                            )}
                        </div>
                    )}
                    <NnueLibrary
                        {...libraryProps}
                        lockedReason={isMatchActive ? "対局中は変更できません" : undefined}
                        onBusyChange={setIsBusy}
                    />
                </div>
                <DialogFooter className="items-center gap-3">
                    {isBusy && (
                        <span className="text-xs text-muted-foreground">
                            処理が終わると閉じられます
                        </span>
                    )}
                    <Button
                        variant="secondary"
                        disabled={isBusy}
                        onClick={() => handleOpenChange(false)}
                    >
                        閉じる
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
