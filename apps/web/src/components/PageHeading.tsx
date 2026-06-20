import { cn } from "@shogi/design-system";
import type { ReactElement, ReactNode } from "react";

interface PageHeadingProps {
    title: ReactNode;
    description?: ReactNode;
    /** 説明文の下、同じ見出しブロック内に並べる補足 (件数表示など)。 */
    children?: ReactNode;
    className?: string;
}

/** ページ見出し (h1) と任意の説明文。全ページで h1 の見た目を揃える。 */
export function PageHeading({
    title,
    description,
    children,
    className,
}: PageHeadingProps): ReactElement {
    return (
        <div className={cn("flex flex-col gap-2", className)}>
            <h1 className="text-2xl font-bold text-foreground">{title}</h1>
            {description && <p className="text-sm text-muted-foreground">{description}</p>}
            {children}
        </div>
    );
}
