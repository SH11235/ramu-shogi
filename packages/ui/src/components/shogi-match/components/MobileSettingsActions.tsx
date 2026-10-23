import { cn } from "@shogi/design-system";
import type { ReactElement } from "react";

type MobileSettingsActionsVariant = "navigation" | "fab";

interface MobileSettingsActionsProps {
    variant: MobileSettingsActionsVariant;
    /** 対局設定ボタンクリック */
    onSettingsClick?: () => void;
    /** AI（評価関数）ボタンクリック */
    onNnueManagerClick?: () => void;
}

export function MobileSettingsActions({
    variant,
    onSettingsClick,
    onNnueManagerClick,
}: MobileSettingsActionsProps): ReactElement | null {
    if (!onSettingsClick && !onNnueManagerClick) {
        return null;
    }

    const isNavigation = variant === "navigation";
    const navButtonBase = "w-10 h-10 flex items-center justify-center rounded-lg text-lg";
    const fabButtonClassName =
        "w-9 h-9 rounded-full bg-background/60 backdrop-blur-sm border border-border/30 shadow-sm flex items-center justify-center text-muted-foreground/70 hover:text-muted-foreground hover:bg-background/80 active:scale-95 transition-all";

    const settingsTitle = isNavigation ? "設定" : undefined;
    const settingsAriaLabel = isNavigation ? "設定を開く" : "対局設定を開く";

    return (
        <>
            {onNnueManagerClick && (
                <button
                    type="button"
                    onClick={onNnueManagerClick}
                    className={
                        isNavigation
                            ? cn(
                                  navButtonBase,
                                  "border border-border bg-background",
                                  "transition-colors",
                                  "hover:bg-muted active:bg-muted/80",
                              )
                            : fabButtonClassName
                    }
                    title="AI（評価関数）"
                    aria-label="AI（評価関数）を開く"
                >
                    <span role="img" aria-label="フォルダ">
                        📁
                    </span>
                </button>
            )}

            {onSettingsClick && (
                <button
                    type="button"
                    onClick={onSettingsClick}
                    className={
                        isNavigation
                            ? cn(
                                  navButtonBase,
                                  "border border-border bg-background",
                                  "transition-colors",
                                  "hover:bg-muted active:bg-muted/80",
                              )
                            : fabButtonClassName
                    }
                    title={settingsTitle}
                    aria-label={settingsAriaLabel}
                >
                    {isNavigation ? (
                        <>⚙️</>
                    ) : (
                        <svg
                            width="20"
                            height="20"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                        >
                            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                            <circle cx="12" cy="12" r="3" />
                        </svg>
                    )}
                </button>
            )}
        </>
    );
}
