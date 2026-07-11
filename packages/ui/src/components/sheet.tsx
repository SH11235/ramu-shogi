import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "@shogi/design-system";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentPropsWithoutRef, ComponentRef, ReactElement } from "react";
import { forwardRef } from "react";
import { useSurfaceTheme } from "./surface-theme";

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;
const SheetPortal = DialogPrimitive.Portal;

const SheetOverlay = forwardRef<
    ComponentRef<typeof DialogPrimitive.Overlay>,
    ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(function SheetOverlay({ className, ...props }, ref): ReactElement {
    return (
        <DialogPrimitive.Overlay
            className={cn(
                "fixed inset-0 z-50 bg-foreground/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=open]:fade-in",
                className,
            )}
            ref={ref}
            {...props}
        />
    );
});

const sheetVariants = cva(
    "fixed z-[51] gap-4 bg-card p-6 text-foreground shadow-xl transition ease-in-out data-[state=closed]:duration-300 data-[state=open]:duration-500 data-[state=open]:animate-in data-[state=closed]:animate-out",
    {
        variants: {
            side: {
                top: "inset-x-0 top-0 border-b border-border data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top",
                bottom: "inset-x-0 bottom-0 border-t border-border data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
                left: "inset-y-0 left-0 h-full w-3/4 border-r border-border data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-w-sm",
                right: "inset-y-0 right-0 h-full w-3/4 border-l border-border data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:max-w-sm",
            },
        },
        defaultVariants: {
            side: "right",
        },
    },
);

export const SheetContent = forwardRef<
    ComponentRef<typeof DialogPrimitive.Content>,
    ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & VariantProps<typeof sheetVariants>
>(function SheetContent({ side = "right", className, children, ...props }, ref): ReactElement {
    const surfaceTheme = useSurfaceTheme();
    return (
        <SheetPortal>
            <SheetOverlay />
            <DialogPrimitive.Content
                aria-describedby={undefined}
                className={cn(surfaceTheme, sheetVariants({ side }), className)}
                ref={ref}
                {...props}
            >
                {children}
            </DialogPrimitive.Content>
        </SheetPortal>
    );
});

export function SheetHeader({
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

export function SheetFooter({
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

export const SheetTitle = forwardRef<
    ComponentRef<typeof DialogPrimitive.Title>,
    ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(function SheetTitle({ className, ...props }, ref): ReactElement {
    return (
        <DialogPrimitive.Title
            className={cn("text-lg font-semibold text-foreground", className)}
            ref={ref}
            {...props}
        />
    );
});

export const SheetDescription = forwardRef<
    ComponentRef<typeof DialogPrimitive.Description>,
    ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(function SheetDescription({ className, ...props }, ref): ReactElement {
    return (
        <DialogPrimitive.Description
            className={cn("text-sm text-muted-foreground", className)}
            ref={ref}
            {...props}
        />
    );
});
