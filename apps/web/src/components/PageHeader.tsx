import { Link } from "@tanstack/react-router";
import type { ReactElement, ReactNode } from "react";

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
                <nav aria-label="パンくずリスト" className="flex items-center gap-1">
                    {items.map((item, i) => (
                        <span key={item.label} className="flex items-center gap-1">
                            {i > 0 && (
                                <span className="mx-0.5 select-none text-wafuu-border">›</span>
                            )}
                            {item.to ? (
                                <Link
                                    to={item.to}
                                    className="text-wafuu-sumi-light transition-colors hover:text-wafuu-sumi"
                                >
                                    {item.label}
                                </Link>
                            ) : (
                                <span className="font-medium text-wafuu-sumi">{item.label}</span>
                            )}
                        </span>
                    ))}
                </nav>
                {right && <div>{right}</div>}
            </div>
        </header>
    );
}
