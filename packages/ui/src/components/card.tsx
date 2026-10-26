import { Slot } from "@radix-ui/react-slot";
import { cn } from "@shogi/design-system";
import type { VariantProps } from "class-variance-authority";
import { cva } from "class-variance-authority";
import type { ComponentPropsWithRef, ReactElement } from "react";

/**
 * 枠で囲んだ欄（カード）の見た目。余白は置き場所で変わるので持たず、使う側が `p-*` で渡す。
 *
 * 角の丸みは、カードが xl、カードの中に入れる小さな枠（inset）が md。
 * 影は 3 段に絞る: ページの流れの中に置くカードは raised（shadow-sm）、画面の脇や上に浮く欄・小窓は
 * floating（shadow-panel）、ダイアログは Dialog 側の shadow-modal。
 */
export const cardVariants = cva("border", {
    variants: {
        variant: {
            default: "rounded-xl border-border bg-card",
            // 研究ノートの欄。白地に和風の枠線。
            wafuu: "rounded-xl border-wafuu-border bg-card",
            // 対局画面の補足情報（棋譜・ヒント）。和紙の地。
            washi: "rounded-xl border-wafuu-border bg-wafuu-washi-warm",
            inset: "rounded-md border-border bg-background",
        },
        elevation: {
            none: "",
            raised: "shadow-sm",
            floating: "shadow-panel",
        },
        interactive: {
            true: "transition-colors hover:bg-muted/20",
            false: "",
        },
    },
    defaultVariants: {
        variant: "default",
        elevation: "none",
        interactive: false,
    },
});

type CardProps = ComponentPropsWithRef<"div"> &
    VariantProps<typeof cardVariants> & {
        /** 子の要素（`section` / `li` / リンクなど）にカードの見た目を付ける。 */
        asChild?: boolean;
    };

export function Card({
    variant,
    elevation,
    interactive,
    asChild = false,
    className,
    ...props
}: CardProps): ReactElement {
    const Component = asChild ? Slot : "div";
    return (
        <Component
            className={cn(cardVariants({ variant, elevation, interactive }), className)}
            {...props}
        />
    );
}
