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
        <div className="mb-3 flex gap-1 rounded-full bg-muted/70 p-1 shadow-[inset_0_1px_3px_hsl(var(--ram-shadow)/0.1)]">
            {tabs.map((tab) => (
                <button
                    key={tab.id}
                    type="button"
                    onClick={() => onChange(tab.id)}
                    className={`flex-1 rounded-full py-1.5 text-sm font-bold transition-[background-color,box-shadow,color] duration-200 motion-reduce:transition-none ${
                        activeTab === tab.id
                            ? "bg-card text-wafuu-sumi shadow-puffy"
                            : "text-muted-foreground hover:text-foreground"
                    }`}
                >
                    {tab.label}
                </button>
            ))}
        </div>
    );
}
