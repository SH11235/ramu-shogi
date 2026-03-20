import type { ReactElement } from "react";

interface TabHeaderProps<T extends string> {
    tabs: Array<{ id: T; label: string }>;
    activeTab: T;
    onChange: (tabId: T) => void;
}

export function TabHeader<T extends string>({
    tabs,
    activeTab,
    onChange,
}: TabHeaderProps<T>): ReactElement {
    return (
        <div className="flex border-b border-border mb-2">
            {tabs.map((tab) => (
                <button
                    key={tab.id}
                    type="button"
                    onClick={() => onChange(tab.id)}
                    className={`flex-1 py-2 text-sm font-medium transition-colors ${
                        activeTab === tab.id
                            ? "border-b-2 border-wafuu-kincha text-wafuu-kincha"
                            : "text-muted-foreground hover:text-foreground"
                    }`}
                >
                    {tab.label}
                </button>
            ))}
        </div>
    );
}
