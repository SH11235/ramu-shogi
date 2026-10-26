/**
 * いくつかの中から 1 つを選ぶボタンの並び。
 * 見出しは呼び出し側の fieldset / legend で付ける（見出しの置き方が画面ごとに違うため）。
 */

import { cn } from "@shogi/design-system";
import { cva } from "class-variance-authority";
import type { ReactElement, ReactNode } from "react";

const choiceButtonVariants = cva(
    "rounded-md border text-wafuu-sumi transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
    {
        // size より後に selected を置く（選んだ項目の太字を、size の font-medium で打ち消さないため）。
        variants: {
            size: {
                sm: "px-3 py-1.5 text-sm",
                md: "min-h-10 px-2.5 text-sm font-medium md:min-h-9 [@media(max-height:760px)]:md:min-h-8",
                lg: "inline-flex min-h-11 items-center justify-center gap-2 px-2.5 text-sm font-medium",
                card: "flex flex-col items-start gap-0.5 rounded-lg px-3 py-2 text-left",
            },
            // 選んでいる項目は墨で示す。朱・藍は先手・後手の色に取っておくので、選択には使わない。
            selected: {
                true: "border-wafuu-sumi bg-wafuu-washi-warm font-semibold ring-1 ring-inset ring-wafuu-sumi",
                false: "border-wafuu-border bg-background hover:bg-wafuu-washi-warm",
            },
        },
    },
);

const layoutClasses = {
    wrap: "flex flex-wrap gap-1.5",
    fill: "flex flex-wrap gap-1.5",
    stack: "flex flex-col gap-1.5",
} as const;

interface ChoiceOption<T extends string | number> {
    value: T;
    label: ReactNode;
    /** 見た目の文言と読み上げを変えるとき。 */
    ariaLabel?: string;
}

interface ChoiceGroupProps<T extends string | number> {
    options: readonly ChoiceOption<T>[];
    value: T | null;
    onChange: (value: T) => void;
    size?: "sm" | "md" | "lg" | "card";
    layout?: keyof typeof layoutClasses;
    className?: string;
    optionClassName?: string;
}

export function ChoiceGroup<T extends string | number>({
    options,
    value,
    onChange,
    size = "md",
    layout = "wrap",
    className,
    optionClassName,
}: ChoiceGroupProps<T>): ReactElement {
    return (
        <div className={cn(layoutClasses[layout], className)}>
            {options.map((option) => {
                const selected = option.value === value;
                return (
                    <button
                        key={option.value}
                        type="button"
                        aria-pressed={selected}
                        aria-label={option.ariaLabel}
                        onClick={() => onChange(option.value)}
                        className={cn(
                            choiceButtonVariants({ selected, size }),
                            layout === "fill" && "flex-1",
                            optionClassName,
                        )}
                    >
                        {option.label}
                    </button>
                );
            })}
        </div>
    );
}
