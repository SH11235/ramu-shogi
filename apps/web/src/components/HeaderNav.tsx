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
                className="inline-flex h-8 min-w-0 max-w-32 items-center truncate rounded-full bg-card/70 px-3.5 text-[13px] font-medium text-wafuu-sumi shadow-puffy transition-colors hover:bg-card"
            >
                {authLabel}
            </Link>
        </nav>
    );
}
