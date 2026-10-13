import { cn } from "@shogi/design-system";
import { Link } from "@tanstack/react-router";
import type { ReactElement, ReactNode } from "react";
import { NavDrawer } from "./NavDrawer";

interface BreadcrumbItem {
    label: string;
    to?: string;
}

interface PageHeaderProps {
    items: BreadcrumbItem[];
    right?: ReactNode;
}

export function PageHeader({ items, right }: PageHeaderProps): ReactElement {
    return (
        <header className="border-b border-wafuu-border bg-wafuu-washi-warm px-4">
            <div className="flex h-10 items-center justify-between gap-2 text-sm">
                <div className="flex min-w-0 items-center gap-2">
                    <NavDrawer />
                    <nav aria-label="パンくずリスト" className="flex min-w-0 items-center gap-1">
                        {items.map((item, i) => {
                            // スマホの幅では 3 段以上を並べると全部が「ラ…」のように切れるので、
                            // 1 つ上と現在地だけを出す（それより上へはメニューから行ける）。
                            const hiddenOnMobile = i < items.length - 2;
                            const firstOnMobile = i === Math.max(items.length - 2, 0);
                            return (
                                <span
                                    key={item.label}
                                    className={cn(
                                        "min-w-0 items-center gap-1",
                                        hiddenOnMobile ? "hidden sm:flex" : "flex",
                                        // 上の階層は縮めず、長くなりうる現在地のほうを切り詰める。
                                        item.to && "shrink-0",
                                    )}
                                >
                                    {i > 0 && (
                                        <span
                                            className={cn(
                                                "mx-0.5 shrink-0 select-none text-wafuu-border",
                                                firstOnMobile && "hidden sm:inline",
                                            )}
                                        >
                                            ›
                                        </span>
                                    )}
                                    {item.to ? (
                                        <Link
                                            to={item.to}
                                            className="inline-flex h-10 items-center whitespace-nowrap text-wafuu-sumi-light transition-colors hover:text-wafuu-sumi"
                                        >
                                            {item.label}
                                        </Link>
                                    ) : (
                                        <span className="truncate font-medium text-wafuu-sumi">
                                            {item.label}
                                        </span>
                                    )}
                                </span>
                            );
                        })}
                    </nav>
                </div>
                {right}
            </div>
        </header>
    );
}
