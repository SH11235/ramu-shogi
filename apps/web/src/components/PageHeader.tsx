import { Link } from "@tanstack/react-router";
import type { ReactElement, ReactNode } from "react";
import { NavDrawer } from "./NavDrawer";
import { RamMascot } from "./RamMascot";

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
        <header className="sticky top-0 z-30 border-b border-wafuu-border/60 bg-background/75 px-4 backdrop-blur-md">
            <div className="flex h-12 items-center justify-between text-sm">
                <div className="flex min-w-0 items-center gap-2">
                    <NavDrawer />
                    <Link
                        to="/"
                        aria-label="ラム将棋 トップへ"
                        className="grid size-8 shrink-0 place-items-center rounded-full bg-ram-cream/70 transition-transform duration-300 hover:-rotate-6 hover:scale-110 motion-reduce:transition-none"
                    >
                        <RamMascot animated={false} className="size-7" />
                    </Link>
                    <nav aria-label="パンくずリスト" className="flex min-w-0 items-center gap-1">
                        {items.map((item, i) => (
                            <span key={item.label} className="flex min-w-0 items-center gap-1">
                                {i > 0 && (
                                    <span className="mx-0.5 shrink-0 select-none text-wafuu-border">
                                        ›
                                    </span>
                                )}
                                {item.to ? (
                                    <Link
                                        to={item.to}
                                        className="truncate text-wafuu-sumi-light transition-colors hover:text-wafuu-sumi"
                                    >
                                        {item.label}
                                    </Link>
                                ) : (
                                    <span className="truncate font-display text-[15px] font-bold text-wafuu-sumi">
                                        {item.label}
                                    </span>
                                )}
                            </span>
                        ))}
                    </nav>
                </div>
                {right}
            </div>
        </header>
    );
}
