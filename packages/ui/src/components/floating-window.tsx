import { cn } from "@shogi/design-system";
import type { ReactElement, ReactNode } from "react";
import { useEffect } from "react";
import { cardVariants } from "./card";
import { CloseIconButton } from "./close-icon-button";
import { useDraggableWindow } from "./shogi-match/hooks/useDraggableWindow";

interface WindowSize {
    width: number;
    height: number;
}

interface FloatingWindowProps {
    /** 見出しの帯の左側。文字列なら太字の見出しにする。 */
    title: ReactNode;
    onClose: () => void;
    initialPosition: { x: number; y: number };
    initialSize: WindowSize;
    minWidth: number;
    minHeight: number;
    /**
     * 閉じている間も位置と大きさを覚えておくときに渡す。
     * 呼ぶ側で描くのをやめると、次に開いたときに初めの位置へ戻る。
     */
    open?: boolean;
    /** 見出しの帯の高さ。省くと中身に合わせる（見出しが折り返せば伸びる）。 */
    headerClassName?: string;
    bodyClassName?: string;
    /** 中身を窓の大きさに合わせて描くときは関数で渡す。 */
    children: ReactNode | ((size: WindowSize) => ReactNode);
}

const EDGE_HANDLE_SIZE = 6;

const FLOATING_CLOSE_BUTTON_CLASS =
    "cursor-pointer rounded p-0 px-1.5 py-0.5 hover:bg-accent hover:text-muted-foreground transition-none";

/**
 * 盤の上に重ねて置く、動かせて大きさも変えられる小窓。
 * 背景の操作は止めない（モーダルではない）。Esc で閉じる。
 */
export function FloatingWindow({
    title,
    onClose,
    initialPosition,
    initialSize,
    minWidth,
    minHeight,
    open = true,
    headerClassName,
    bodyClassName,
    children,
}: FloatingWindowProps): ReactElement | null {
    const { geometry, handlers } = useDraggableWindow(initialPosition, initialSize, {
        minWidth,
        minHeight,
        open,
    });
    const { position, size } = geometry;
    const { onMoveStart, createResizeHandler } = handlers;

    useEffect(() => {
        if (!open) return;
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        document.addEventListener("keydown", handleEscape);
        return () => document.removeEventListener("keydown", handleEscape);
    }, [open, onClose]);

    if (!open) return null;

    return (
        <div
            className={cn(
                cardVariants({ elevation: "floating" }),
                "fixed z-window flex flex-col overflow-hidden",
            )}
            style={{
                left: position.x,
                top: position.y,
                width: size.width,
                height: size.height,
            }}
        >
            <div
                className={cn(
                    "flex cursor-move select-none items-center justify-between border-b border-border bg-muted px-3 py-2",
                    headerClassName,
                )}
                onMouseDown={onMoveStart}
                role="toolbar"
                aria-label="ウィンドウ移動ハンドル"
            >
                {typeof title === "string" ? (
                    <span className="text-sm font-semibold">{title}</span>
                ) : (
                    title
                )}
                {/* 帯が bg-muted なので hover は一段濃い色にする。押せる範囲は 32x24px（文字の「✕」の頃と同じ）。 */}
                <CloseIconButton
                    className={FLOATING_CLOSE_BUTTON_CLASS}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={onClose}
                />
            </div>

            <div className={cn("flex-1", bodyClassName)}>
                {typeof children === "function" ? children(size) : children}
            </div>

            {/* マウスで大きさを変えるためのつまみ。キーボードでは操作しないので読み上げから外す。 */}
            <div
                className="absolute top-0 left-3 right-3 cursor-ns-resize"
                style={{ height: EDGE_HANDLE_SIZE }}
                onMouseDown={createResizeHandler("resize-n")}
                aria-hidden="true"
            />
            <div
                className="absolute bottom-0 left-3 right-3 cursor-ns-resize"
                style={{ height: EDGE_HANDLE_SIZE }}
                onMouseDown={createResizeHandler("resize-s")}
                aria-hidden="true"
            />
            <div
                className="absolute left-0 top-3 bottom-3 cursor-ew-resize"
                style={{ width: EDGE_HANDLE_SIZE }}
                onMouseDown={createResizeHandler("resize-w")}
                aria-hidden="true"
            />
            <div
                className="absolute right-0 top-3 bottom-3 cursor-ew-resize"
                style={{ width: EDGE_HANDLE_SIZE }}
                onMouseDown={createResizeHandler("resize-e")}
                aria-hidden="true"
            />
            <div
                className="absolute left-0 top-0 h-3 w-3 cursor-nwse-resize"
                onMouseDown={createResizeHandler("resize-nw")}
                aria-hidden="true"
            >
                <div className="absolute left-1 top-1 h-2 w-2 border-l-2 border-t-2 border-muted-foreground opacity-50" />
            </div>
            <div
                className="absolute right-0 top-0 h-3 w-3 cursor-nesw-resize"
                onMouseDown={createResizeHandler("resize-ne")}
                aria-hidden="true"
            >
                <div className="absolute right-1 top-1 h-2 w-2 border-r-2 border-t-2 border-muted-foreground opacity-50" />
            </div>
            <div
                className="absolute left-0 bottom-0 h-3 w-3 cursor-nesw-resize"
                onMouseDown={createResizeHandler("resize-sw")}
                aria-hidden="true"
            >
                <div className="absolute left-1 bottom-1 h-2 w-2 border-l-2 border-b-2 border-muted-foreground opacity-50" />
            </div>
            <div
                className="absolute right-0 bottom-0 h-3 w-3 cursor-nwse-resize"
                onMouseDown={createResizeHandler("resize-se")}
                aria-hidden="true"
            >
                <div className="absolute right-1 bottom-1 h-2 w-2 border-r-2 border-b-2 border-muted-foreground opacity-50" />
            </div>
        </div>
    );
}
