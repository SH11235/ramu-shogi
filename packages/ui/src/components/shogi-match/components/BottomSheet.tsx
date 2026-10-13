/**
 * スマホ向けボトムシートコンポーネント
 *
 * 設定パネルなどを下からスライドして表示する
 * Radix UI Dialog を使用してz-index管理を統一
 */

import { cn } from "@shogi/design-system";
import type { ReactElement, ReactNode } from "react";
import { Button } from "../../button";
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "../../dialog";

interface BottomSheetProps {
    /** シートを開くかどうか */
    open: boolean;
    /** 開閉状態変更時のコールバック */
    onOpenChange: (open: boolean) => void;
    /** タイトル */
    title: string;
    /** 読み上げ用の説明（画面には出さない）。渡したときだけ付け、シートに関連付ける。 */
    description?: string;
    /** コンテンツ */
    children: ReactNode;
    /** 高さ: 'half' | 'full' | 'auto' */
    height?: "half" | "full" | "auto";
    /** オーバーレイ表示 */
    overlay?: "dim" | "transparent";
    /** シートの見た目 */
    surface?: "solid" | "glass";
}

const heightClassName: Record<NonNullable<BottomSheetProps["height"]>, string> = {
    half: "h-[50vh]",
    full: "h-[85vh]",
    // auto の場合も height を設定し、内部の flex レイアウトを機能させる
    // コンテンツが少ない場合は min-content で縮み、多い場合は 85vh でスクロール
    auto: "h-auto max-h-[85vh]",
};
/**
 * スマホ向けボトムシートコンポーネント
 * 設定パネルなどを下からスライドして表示する
 */
export function BottomSheet({
    open,
    onOpenChange,
    title,
    description,
    children,
    height = "auto",
    overlay = "dim",
    surface = "solid",
}: BottomSheetProps): ReactElement {
    const overlayClassName =
        overlay === "transparent" ? "bg-transparent backdrop-blur-none" : undefined;
    const surfaceClassName =
        surface === "glass" ? "bg-background/[0.05] backdrop-blur-[1px]" : "bg-background";
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                // 説明を渡したときだけ関連付ける（渡さない呼び出しは、これまでどおり）。
                hasDescription={description !== undefined}
                overlayClassName={overlayClassName}
                onOpenAutoFocus={(event) => event.preventDefault()}
                data-state={open ? "open" : "closed"}
                className={cn(
                    "fixed bottom-0 left-0 right-0 top-auto z-50",
                    "w-full max-w-full",
                    "rounded-t-2xl",
                    "overflow-hidden",
                    "border-0 p-0",
                    "flex flex-col",
                    "translate-x-0 translate-y-0",
                    heightClassName[height],
                    surfaceClassName,
                    "duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out",
                    "data-[state=closed]:fade-out data-[state=open]:fade-in",
                    "data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
                )}
            >
                {/* ドラッグハンドル（装飾） */}
                <div className={cn("flex justify-center py-2", surfaceClassName)}>
                    <div className="w-10 h-1 bg-muted rounded-full" />
                </div>

                {/* ヘッダー */}
                <DialogHeader className={cn("px-4 pb-3 border-b border-border", surfaceClassName)}>
                    <DialogTitle className="font-semibold text-lg">{title}</DialogTitle>
                    {description !== undefined && (
                        <DialogDescription className="sr-only">{description}</DialogDescription>
                    )}
                </DialogHeader>

                {/* コンテンツ */}
                <div
                    className={cn(
                        "px-4 pt-4 max-w-full flex-1 min-h-0 overflow-y-auto overscroll-contain touch-pan-y",
                        surfaceClassName,
                        "[webkit-overflow-scrolling:touch]",
                    )}
                >
                    {children}
                </div>

                {/* 閉じるボタン */}
                <div
                    className={cn(
                        "px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] border-t border-border",
                        surfaceClassName,
                    )}
                >
                    <DialogClose asChild>
                        <Button type="button" variant="secondary" className="w-full">
                            閉じる
                        </Button>
                    </DialogClose>
                </div>
            </DialogContent>
        </Dialog>
    );
}
