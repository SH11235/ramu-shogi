import { Link, useLocation } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { useAuthSession } from "../hooks/useAuthSession";

const linkClass =
    "rounded-md border border-border px-3 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground";
const linkAccentClass =
    "rounded-md border border-wafuu-shu px-3 py-0.5 text-xs text-wafuu-shu transition-colors hover:bg-wafuu-shu/10";

export function HeaderNav(): ReactElement {
    const { session } = useAuthSession();
    const { pathname } = useLocation();

    const isGames = pathname.startsWith("/games");
    const isNnue = pathname === "/nnue";
    const isOnline = pathname.startsWith("/online");
    const isAuth = pathname === "/auth";

    return (
        <div className="flex items-center gap-2">
            {!isGames && (
                <Link to="/games" className={linkClass}>
                    棋譜一覧
                </Link>
            )}
            {!isNnue && (
                <Link to="/nnue" className={linkClass}>
                    NNUE
                </Link>
            )}
            {!isOnline && (
                <Link to="/online" className={linkAccentClass}>
                    オンライン対局 →
                </Link>
            )}
            {!isAuth && (
                <Link to="/auth" className={linkClass}>
                    {session?.authenticated ? session.user.displayName : "ログイン"}
                </Link>
            )}
        </div>
    );
}
