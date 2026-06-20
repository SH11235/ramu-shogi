import { cn } from "@shogi/design-system";
import type { ReactElement, ReactNode } from "react";

type PageContainerWidth = "form" | "narrow" | "standard" | "wide";

// 幅はページ種別ごとの意図でまとめる。form=入力フォーム, narrow=長文,
// standard=一覧/詳細, wide=盤面など横に広い内容。
const widthClass: Record<PageContainerWidth, string> = {
    form: "max-w-[480px]",
    narrow: "max-w-[720px]",
    standard: "max-w-[960px]",
    wide: "max-w-[1100px]",
};

interface PageContainerProps {
    width?: PageContainerWidth;
    className?: string;
    children: ReactNode;
}

/** ページ本文の中央寄せコンテナ。幅・左右 padding・縦の section 間隔を一元化する。 */
export function PageContainer({
    width = "standard",
    className,
    children,
}: PageContainerProps): ReactElement {
    return (
        <main
            className={cn(
                "mx-auto flex w-full flex-col gap-6 px-4 py-8",
                widthClass[width],
                className,
            )}
        >
            {children}
        </main>
    );
}
