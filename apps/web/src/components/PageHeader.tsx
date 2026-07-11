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
            <div className="flex h-10 items-center justify-between text-sm">
                <div className="flex min-w-0 items-center gap-2">
                    <NavDrawer />
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
                                    <span className="truncate font-medium text-wafuu-sumi">
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
