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
    // 高さは dvh で決める。vh はアドレスバーを畳んだときの高さなので、アドレスバーが出ている間は
    // シートの上端（見出し）が画面の外へ出る。dvh の無いブラウザ（Safari 15.3 以前）では vh のまま。
    half: "h-[50vh] supports-[height:1dvh]:h-[50dvh]",
    full: "h-[85vh] supports-[height:1dvh]:h-[85dvh]",
    // auto の場合も height を設定し、内部の flex レイアウトを機能させる
    // コンテンツが少ない場合は min-content で縮み、多い場合は 85dvh でスクロール。
    // 高さ 480px 以下の画面（スマホの横向き。667x375 など）では、見出しと「閉じる」で中身の欄が
    // ほとんど残らないので、画面いっぱいまで使う。
    auto: "h-auto max-h-[85vh] supports-[height:1dvh]:max-h-[85dvh] [@media(max-height:480px)]:max-h-[100vh] supports-[height:1dvh]:[@media(max-height:480px)]:max-h-[100dvh]",
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
                    // 横向きの iPhone では左右にノッチがあるので、中身をその内側に置く。
                    "pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]",
                    "flex flex-col",
                    "translate-x-0 translate-y-0",
                    heightClassName[height],
                    surfaceClassName,
                    "duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out",
                    "data-[state=closed]:fade-out data-[state=open]:fade-in",
                    "data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
                )}
            >
                {/* ドラッグハンドル（装飾）。高さの無い画面では、中身の欄を広く取るために出さない。 */}
                <div
                    className={cn(
                        "flex justify-center py-2 [@media(max-height:480px)]:hidden",
                        surfaceClassName,
                    )}
                >
                    <div className="w-10 h-1 bg-muted rounded-full" />
                </div>

                {/* ヘッダー */}
                <DialogHeader
                    className={cn(
                        "px-4 pb-3 border-b border-border [@media(max-height:480px)]:py-2",
                        surfaceClassName,
                    )}
                >
                    <DialogTitle className="font-semibold text-lg">{title}</DialogTitle>
                    {description !== undefined && (
                        <DialogDescription className="sr-only">{description}</DialogDescription>
                    )}
                </DialogHeader>

                {/* コンテンツ */}
                <div
                    className={cn(
                        "px-4 py-4 max-w-full flex-1 min-h-0 overflow-y-auto overscroll-contain touch-pan-y",
                        surfaceClassName,
                        "[webkit-overflow-scrolling:touch]",
                    )}
                >
                    {children}
                </div>

                {/* 閉じるボタン */}
                <div
                    className={cn(
                        "px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] border-t border-border [@media(max-height:480px)]:pt-2 [@media(max-height:480px)]:pb-[calc(0.5rem+env(safe-area-inset-bottom))]",
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
