import { Link, useLocation } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { useAuthSession } from "../hooks/useAuthSession";
import { loginSearch } from "../lib/loginReturn";

interface HeaderNavProps {
    /**
     * 未ログインのときの「ログイン」の進み先を、画面ごとに差し替える。
     * 省略時は、いま開いている画面を戻り先にしてログインの画面へ進む（ログイン後に元の画面へ
     * 戻る）。進む前に済ませたい処理がある画面が渡す。
     */
    login?: {
        /** 進み先（例: `/auth?next=...`）。 */
        href: string;
        /** 押したときの処理。渡した側が、処理を済ませてから `href` へ進む。 */
        onNavigate: () => void;
    };
}

const LINK_CLASS =
    "inline-flex h-8 min-w-0 max-w-32 items-center truncate rounded-md px-2 text-sm text-wafuu-sumi-light transition-colors hover:bg-muted/50 hover:text-wafuu-sumi";

const PRIMARY_LINK_CLASS =
    "inline-flex h-8 items-center whitespace-nowrap rounded-md px-2.5 text-sm transition-colors hover:bg-muted/50 hover:text-wafuu-sumi";

/**
 * 主な行き先（対局・研究ノート・観戦）。メニューを開かなくても見えるようにヘッダーに並べる。
 * 幅の狭い画面では出さない（メニューから行く）。
 */
function PrimaryLinks(): ReactElement {
    const { pathname } = useLocation();
    const items = [
        { to: "/play", label: "対局", active: pathname.startsWith("/play") },
        { to: "/studies", label: "研究ノート", active: pathname.startsWith("/studies") },
        { to: "/rshogi-viewer", label: "観戦", active: pathname.startsWith("/rshogi-viewer") },
    ] as const;
    return (
        <div className="hidden items-center gap-1 md:flex">
            {items.map((item) => (
                <Link
                    key={item.to}
                    to={item.to}
                    aria-current={item.active ? "page" : undefined}
                    className={`${PRIMARY_LINK_CLASS} ${
                        item.active ? "font-semibold text-wafuu-shu" : "text-wafuu-sumi"
                    }`}
                >
                    {item.label}
                </Link>
            ))}
            <span aria-hidden className="mx-1 h-4 w-px bg-wafuu-border" />
        </div>
    );
}

export function HeaderNav({ login }: HeaderNavProps = {}): ReactElement {
    const { session } = useAuthSession();
    const isAuthenticated = session?.authenticated === true;
    const authLabel = session?.authenticated ? session.user.displayName : "ログイン";

    return (
        <nav aria-label="ヘッダーアクション" className="flex items-center gap-2">
            <PrimaryLinks />
            {login && !isAuthenticated ? (
                <a
                    href={login.href}
                    onClick={(event) => {
                        // 修飾キーつき（別のタブで開く、など）は、ブラウザに任せる。
                        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
                            return;
                        }
                        event.preventDefault();
                        login.onNavigate();
                    }}
                    className={LINK_CLASS}
                >
                    {authLabel}
                </a>
            ) : isAuthenticated ? (
                <Link to="/auth" className={LINK_CLASS}>
                    {authLabel}
                </Link>
            ) : (
                <Link to="/auth" search={loginSearch} className={LINK_CLASS}>
                    {authLabel}
                </Link>
            )}
        </nav>
    );
}
