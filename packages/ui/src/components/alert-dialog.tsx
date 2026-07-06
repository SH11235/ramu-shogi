import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import { cn } from "@shogi/design-system";
import type { ComponentPropsWithoutRef, ComponentRef, ReactElement } from "react";
import { forwardRef } from "react";
import { buttonVariants } from "./button";
import { useSurfaceTheme } from "./surface-theme";

export const AlertDialog = AlertDialogPrimitive.Root;
export const AlertDialogTrigger = AlertDialogPrimitive.Trigger;
const AlertDialogPortal = AlertDialogPrimitive.Portal;

const AlertDialogOverlay = forwardRef<
    ComponentRef<typeof AlertDialogPrimitive.Overlay>,
    ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Overlay>
>(function AlertDialogOverlay({ className, ...props }, ref): ReactElement {
    return (
        <AlertDialogPrimitive.Overlay
            className={cn(
                "fixed inset-0 z-50 bg-black/70 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=open]:fade-in",
                className,
            )}
            ref={ref}
            {...props}
        />
    );
});

export const AlertDialogContent = forwardRef<
    ComponentRef<typeof AlertDialogPrimitive.Content>,
    ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Content>
>(function AlertDialogContent({ className, children, ...props }, ref): ReactElement {
    // Portal で body 直下へ出るため、開いた場所の局所テーマを引き継ぐ
    const surfaceTheme = useSurfaceTheme();
    return (
        <AlertDialogPortal>
            <AlertDialogOverlay />
            <AlertDialogPrimitive.Content
                className={cn(
                    surfaceTheme,
                    "fixed left-1/2 top-1/2 z-[51] grid w-[min(420px,calc(100%-32px))] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl border border-border bg-card p-6 text-foreground shadow-[0_24px_70px_rgba(0,0,0,0.35)] duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=open]:fade-in data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
                    className,
                )}
                ref={ref}
                {...props}
            >
                {children}
            </AlertDialogPrimitive.Content>
        </AlertDialogPortal>
    );
});

export function AlertDialogHeader({
    className,
    ...props
}: React.HTMLAttributes<HTMLDivElement>): ReactElement {
    return (
        <div
            className={cn("flex flex-col space-y-2 text-center sm:text-left", className)}
            {...props}
        />
    );
}

export function AlertDialogFooter({
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

export const AlertDialogTitle = forwardRef<
    ComponentRef<typeof AlertDialogPrimitive.Title>,
    ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Title>
>(function AlertDialogTitle({ className, ...props }, ref): ReactElement {
    return (
        <AlertDialogPrimitive.Title
            className={cn("text-lg font-semibold text-foreground", className)}
            ref={ref}
            {...props}
        />
    );
});

export const AlertDialogDescription = forwardRef<
    ComponentRef<typeof AlertDialogPrimitive.Description>,
    ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Description>
>(function AlertDialogDescription({ className, ...props }, ref): ReactElement {
    return (
        <AlertDialogPrimitive.Description
            className={cn("text-sm text-muted-foreground", className)}
            ref={ref}
            {...props}
        />
    );
});

export const AlertDialogAction = forwardRef<
    ComponentRef<typeof AlertDialogPrimitive.Action>,
    ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Action>
>(function AlertDialogAction({ className, ...props }, ref): ReactElement {
    return (
        <AlertDialogPrimitive.Action
            className={cn(buttonVariants(), className)}
            ref={ref}
            {...props}
        />
    );
});

export const AlertDialogCancel = forwardRef<
    ComponentRef<typeof AlertDialogPrimitive.Cancel>,
    ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Cancel>
>(function AlertDialogCancel({ className, ...props }, ref): ReactElement {
    return (
        <AlertDialogPrimitive.Cancel
            className={cn(buttonVariants({ variant: "outline" }), className)}
            ref={ref}
            {...props}
        />
    );
});
