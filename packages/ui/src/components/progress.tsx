import * as ProgressPrimitive from "@radix-ui/react-progress";
import { cn } from "@shogi/design-system";
import type { ComponentPropsWithoutRef, ComponentRef, ReactElement } from "react";
import { forwardRef } from "react";

interface ProgressProps
    extends Omit<ComponentPropsWithoutRef<typeof ProgressPrimitive.Root>, "value"> {
    /** 進捗値 (0-100)。undefined の場合は不確定（indeterminate）モード */
    value?: number;
    /** インジケーターのカスタムクラス */
    indicatorClassName?: string;
}

export const Progress = forwardRef<ComponentRef<typeof ProgressPrimitive.Root>, ProgressProps>(
    function Progress({ className, value, indicatorClassName, ...props }, ref): ReactElement {
        const isIndeterminate = value === undefined;
        const indicatorStyle = isIndeterminate ? undefined : { width: `${value ?? 0}%` };

        return (
            <ProgressPrimitive.Root
                ref={ref}
                className={cn(
                    "relative h-2 w-full overflow-hidden rounded-full bg-muted",
                    className,
                )}
                value={isIndeterminate ? undefined : value}
                {...props}
            >
                <ProgressPrimitive.Indicator
                    style={indicatorStyle}
                    className={cn(
                        "h-full rounded-full bg-primary",
                        isIndeterminate
                            ? "w-[40%] animate-[progress-indeterminate_1.5s_ease-in-out_infinite]"
                            : "transition-[width] duration-150 ease-out",
                        indicatorClassName,
                    )}
                />
            </ProgressPrimitive.Root>
        );
    },
);

/**
 * CSS for indeterminate animation (add to global styles or use a style tag):
 *
 * @keyframes progress-indeterminate {
 *   0% { transform: translateX(-100%); }
 *   50% { transform: translateX(150%); }
 *   100% { transform: translateX(-100%); }
 * }
 */
