import { cn } from "@shogi/design-system";
import type { ComponentPropsWithRef, ReactElement } from "react";
import { ChevronIcon } from "./chevron-icon";

const selectControlClassName =
    "w-full min-w-0 rounded-lg border border-wafuu-border bg-wafuu-washi py-2 pl-3 pr-10 text-xs text-wafuu-sumi focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

/**
 * 共通の外観を持つネイティブセレクト。iOS Safari のフォーカス時の拡大は、指で操作する端末で
 * 入力欄を 16px にする共通の指定（design-system の theme.css）が防ぐので、ここでは文字の大きさを決めない。
 */
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
