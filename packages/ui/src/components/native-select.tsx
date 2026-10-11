import { cn } from "@shogi/design-system";
import type { ComponentPropsWithRef, ReactElement } from "react";
import { ChevronIcon } from "./chevron-icon";

const selectControlClassName =
    "w-full min-w-0 rounded-lg border border-wafuu-border bg-wafuu-washi py-2 pl-3 pr-10 text-xs text-wafuu-sumi focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

export function NativeSelect({
    className,
    wrapperClassName,
    ...props
}: ComponentPropsWithRef<"select"> & { wrapperClassName?: string }): ReactElement {
    return (
        <span className={cn("relative flex min-w-0 items-center", wrapperClassName)}>
            <select
                {...props}
                className={cn(selectControlClassName, "appearance-none", className)}
            />
            <ChevronIcon className="pointer-events-none absolute right-3" />
        </span>
    );
}

export { selectControlClassName };
