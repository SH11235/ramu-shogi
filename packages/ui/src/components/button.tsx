import { Slot } from "@radix-ui/react-slot";
import { cn } from "@shogi/design-system";
import type { VariantProps } from "class-variance-authority";
import { cva } from "class-variance-authority";
import type { ButtonHTMLAttributes, ReactElement } from "react";
import { forwardRef } from "react";

const buttonVariants = cva(
    "inline-flex items-center justify-center whitespace-nowrap rounded-full text-sm font-bold transition-[transform,box-shadow,background-color] duration-200 active:translate-y-px motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
    {
        variants: {
            variant: {
                default:
                    "bg-primary text-primary-foreground shadow-[inset_0_2px_0_hsl(var(--sheen)),0_10px_20px_-8px_hsl(var(--primary)/0.65)] hover:-translate-y-px hover:bg-primary/95",
                secondary:
                    "bg-secondary text-secondary-foreground shadow-puffy hover:-translate-y-px hover:bg-secondary/80",
                outline:
                    "border border-card-edge bg-card/80 shadow-puffy hover:-translate-y-px hover:bg-card hover:text-foreground",
                ghost: "text-foreground hover:bg-muted/60",
                destructive:
                    "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90",
            },
            size: {
                default: "h-10 px-4 py-2",
                sm: "h-9 px-3.5",
                lg: "h-12 px-8",
                icon: "h-10 w-10",
            },
        },
        defaultVariants: {
            variant: "default",
            size: "default",
        },
    },
);

interface ButtonProps
    extends ButtonHTMLAttributes<HTMLButtonElement>,
        VariantProps<typeof buttonVariants> {
    asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
    { className, variant, size, asChild = false, ...props },
    ref,
): ReactElement {
    const Component = asChild ? Slot : "button";
    return (
        <Component
            className={cn(buttonVariants({ variant, size }), className)}
            ref={ref}
            {...props}
        />
    );
});

export { buttonVariants };
