import { cn } from "@shogi/design-system";
import type { KeyboardEvent, ReactElement } from "react";

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
    // 選択中のタブが一覧に無いときも、先頭のタブには Tab キーで届くようにする
    const focusableIndex = Math.max(
        0,
        tabs.findIndex((tab) => tab.id === activeTab),
    );
    // WAI-ARIA のタブ: Tab キーで止まるのは選択中のタブだけで、タブの間は左右・Home・End で移って選ぶ
    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        const current = focusableIndex;
        const nextIndex = {
            ArrowRight: (current + 1) % tabs.length,
            ArrowLeft: (current - 1 + tabs.length) % tabs.length,
            Home: 0,
            End: tabs.length - 1,
        }[event.key];
        if (nextIndex === undefined) return;
        // 棋譜の矢印キー送りは document で聞いているので、タブの移動で背後の局面を動かさない
        event.stopPropagation();
        event.preventDefault();
        onChange(tabs[nextIndex].id);
        event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')[nextIndex]?.focus();
    };

    return (
        <div
            role="tablist"
            onKeyDown={handleKeyDown}
            className={cn("flex border-b border-border", className)}
        >
            {tabs.map((tab, index) => {
                const selected = activeTab === tab.id;
                return (
                    <button
                        key={tab.id}
                        type="button"
                        role="tab"
                        aria-selected={selected}
                        tabIndex={index === focusableIndex ? 0 : -1}
                        onClick={() => onChange(tab.id)}
                        className={cn(
                            "flex-1 py-2 text-sm font-medium transition-colors",
                            selected
                                ? "border-b-2 border-wafuu-kincha text-wafuu-kincha"
                                : "text-muted-foreground hover:text-foreground",
                        )}
                    >
                        {tab.label}
                    </button>
                );
            })}
        </div>
    );
}
