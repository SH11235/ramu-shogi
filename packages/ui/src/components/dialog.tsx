import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "@shogi/design-system";
import type { ComponentPropsWithoutRef, ComponentRef, CSSProperties, ReactElement } from "react";
import { forwardRef } from "react";
import { useSurfaceTheme } from "./surface-theme";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
export const DialogClose = DialogPrimitive.Close;

const DialogOverlay = forwardRef<
    ComponentRef<typeof DialogPrimitive.Overlay>,
    ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(function DialogOverlay({ className, style, ...props }, ref): ReactElement {
    return (
        <DialogPrimitive.Overlay
            style={style}
            className={cn(
                "fixed inset-0 z-50 bg-black/70 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=open]:fade-in",
                className,
            )}
            ref={ref}
            {...props}
        />
    );
});

export const DialogContent = forwardRef<
    ComponentRef<typeof DialogPrimitive.Content>,
    ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
        overlayClassName?: string;
        overlayStyle?: CSSProperties;
    }
>(function DialogContent(
    { className, children, overlayClassName, overlayStyle, style, ...props },
    ref,
): ReactElement {
    // Portal で body 直下へ出るため、開いた場所の局所テーマ(検討室の墨地等)を
    // context 経由で引き継ぎ、Content ルートにクラスとして付け直す
    const surfaceTheme = useSurfaceTheme();
    return (
        <DialogPortal>
            <DialogOverlay className={overlayClassName} style={overlayStyle} />
            <DialogPrimitive.Content
                aria-describedby={undefined}
                style={style}
                className={cn(
                    surfaceTheme,
                    "fixed left-1/2 top-1/2 z-[51] w-[min(960px,calc(100%-24px))] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-xl border border-border bg-card p-6 text-foreground shadow-[0_24px_70px_rgba(0,0,0,0.35)] max-h-[85vh] gap-4 duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=open]:fade-in data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
                    className,
                )}
                ref={ref}
                {...props}
            >
                {children}
            </DialogPrimitive.Content>
        </DialogPortal>
    );
});

export function DialogHeader({
    className,
    ...props
}: React.HTMLAttributes<HTMLDivElement>): ReactElement {
    return (
        <div
            className={cn("flex flex-col space-y-1.5 text-center sm:text-left", className)}
            {...props}
        />
    );
}

export function DialogFooter({
    className,
    ...props
}: React.HTMLAttributes<HTMLDivElement>): ReactElement {
    return (
        <div
            className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}
            {...props}
        />
    );
}

export const DialogTitle = forwardRef<
    ComponentRef<typeof DialogPrimitive.Title>,
    ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(function DialogTitle({ className, ...props }, ref): ReactElement {
    return (
        <DialogPrimitive.Title
            className={cn(
                "text-lg font-semibold leading-none tracking-tight text-foreground",
                className,
            )}
            ref={ref}
            {...props}
        />
    );
});

export const DialogDescription = forwardRef<
    ComponentRef<typeof DialogPrimitive.Description>,
    ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(function DialogDescription({ className, ...props }, ref): ReactElement {
    return (
        <DialogPrimitive.Description
            className={cn("text-sm text-muted-foreground", className)}
            ref={ref}
            {...props}
        />
    );
});
