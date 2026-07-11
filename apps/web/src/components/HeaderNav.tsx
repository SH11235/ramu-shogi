import { Link } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { useAuthSession } from "../hooks/useAuthSession";

export function HeaderNav(): ReactElement {
    const { session } = useAuthSession();
    const authLabel = session?.authenticated ? session.user.displayName : "ログイン";

    return (
        <nav aria-label="ヘッダーアクション" className="flex items-center gap-2">
            <Link
                to="/auth"
                className="inline-flex h-8 min-w-0 max-w-32 items-center truncate rounded-md px-2 text-sm text-wafuu-sumi-light transition-colors hover:bg-muted/50 hover:text-wafuu-sumi"
            >
                {authLabel}
            </Link>
        </nav>
    );
}
