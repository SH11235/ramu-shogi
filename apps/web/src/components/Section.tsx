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
                "flex flex-col gap-3 rounded-xl border border-border bg-card p-5 shadow-sm",
                className,
            )}
        >
            {title && <h2 className="text-lg font-semibold text-foreground">{title}</h2>}
            {children}
        </section>
    );
}
