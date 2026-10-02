import { cn } from "@shogi/design-system";
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
                "flex flex-col gap-3 rounded-3xl border border-card-edge bg-card/80 p-5 shadow-puffy",
                className,
            )}
        >
            {title && <h2 className="font-display text-lg font-bold text-foreground">{title}</h2>}
            {children}
        </section>
    );
}
