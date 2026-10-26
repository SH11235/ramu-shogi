import { cn } from "@shogi/design-system";
import { cardVariants } from "@shogi/ui/components/card";
import type { ReactElement, ReactNode } from "react";

interface SectionProps {
    title?: ReactNode;
    className?: string;
    children: ReactNode;
}

/** カード型セクション。角丸・border・bg・影・見出しスタイルをページ間で揃える。 */
export function Section({ title, className, children }: SectionProps): ReactElement {
    return (
        <section
            className={cn(
                cardVariants({ elevation: "raised" }),
                "flex flex-col gap-3 p-5",
                className,
            )}
        >
            {title && <h2 className="text-lg font-semibold text-foreground">{title}</h2>}
            {children}
        </section>
    );
}
