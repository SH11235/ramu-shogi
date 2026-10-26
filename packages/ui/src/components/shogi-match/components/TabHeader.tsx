import { cn } from "@shogi/design-system";
import type { ReactElement } from "react";

interface TabHeaderProps<T extends string> {
    tabs: Array<{ id: T; label: string }>;
    activeTab: T;
    onChange: (tabId: T) => void;
    className?: string;
}

export function TabHeader<T extends string>({
    tabs,
    activeTab,
    onChange,
    className,
}: TabHeaderProps<T>): ReactElement {
    return (
        <div role="tablist" className={cn("flex border-b border-border", className)}>
            {tabs.map((tab) => (
                <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={activeTab === tab.id}
                    onClick={() => onChange(tab.id)}
                    className={cn(
                        "flex-1 py-2 text-sm font-medium transition-colors",
                        activeTab === tab.id
                            ? "border-b-2 border-wafuu-kincha text-wafuu-kincha"
                            : "text-muted-foreground hover:text-foreground",
                    )}
                >
                    {tab.label}
                </button>
            ))}
        </div>
    );
}
