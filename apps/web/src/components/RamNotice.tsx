import { cn } from "@shogi/design-system";
import type { ReactElement, ReactNode } from "react";
import { RamMascot } from "./RamMascot";

interface RamNoticeProps {
    tone: "error" | "loading";
    title: ReactNode;
    children?: ReactNode;
    className?: string;
}

/** エラー・読み込み中の面。ラムが困り顔 / 上目づかいで状況を伝える。 */
export function RamNotice({ tone, title, children, className }: RamNoticeProps): ReactElement {
    return (
        <div
            role={tone === "error" ? "alert" : "status"}
            className={cn(
                "flex flex-col items-center gap-4 rounded-3xl border border-card-edge bg-card/80 px-6 py-8 text-center shadow-puffy",
                className,
            )}
        >
            <RamMascot
                decorative
                className="w-28"
                mood={tone === "error" ? "worried" : "happy"}
                thinking={tone === "loading"}
                animated={tone === "loading"}
            />
            <p
                className={cn(
                    "text-balance font-display text-lg font-bold",
                    tone === "error" ? "text-destructive" : "text-wafuu-sumi",
                )}
            >
                {title}
            </p>
            {children}
        </div>
    );
}
