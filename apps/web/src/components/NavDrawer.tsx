import { cn } from "@shogi/design-system";
// メニューはどの画面でも最初に読む。`@shogi/ui` の入口から読むと対局画面の部品一式まで載るので、直接指す。
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@shogi/ui/components/sheet";
import { Link, useLocation } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { useState } from "react";
import { useAuthSession } from "../hooks/useAuthSession";
import { loginSearch } from "../lib/loginReturn";
import { AuthBadge } from "./AuthBadge";

type NavTo =
    | "/play"
    | "/online"
    | "/studies"
    | "/games"
    | "/rshogi-viewer"
    | "/book-viewer"
    | "/nnue"
    | "/auth";

interface NavItem {
    to: NavTo;
    label: string;
    active: boolean;
    requiresAuth?: boolean;
}

interface NavSection {
    label: string;
    items: NavItem[];
}

const activeClass = "border-wafuu-shu bg-wafuu-shu/10 text-wafuu-shu";
const inactiveClass = "border-transparent text-wafuu-sumi hover:bg-muted/50 hover:text-foreground";

function buildNavSections(pathname: string): NavSection[] {
    const isPlayers =
        pathname === "/rshogi-viewer/players" || pathname.startsWith("/rshogi-viewer/players/");

    return [
        {
            label: "指す",
            items: [
                { to: "/play", label: "対局", active: pathname.startsWith("/play") },
                {
                    to: "/online",
                    label: "オンライン対局",
                    active: pathname.startsWith("/online"),
                },
            ],
        },
        {
            label: "棋譜",
            items: [
                { to: "/book-viewer", label: "定跡ビュアー", active: pathname === "/book-viewer" },
                // 棋譜を AI で解析して残す。未ログインでも使える（ブラウザ内に保存）。
                {
                    to: "/studies",
                    // 「（整備中）」は、研究ノートの本格実装が済んだら外す。
                    label: "研究ノート（整備中）",
                    active: pathname.startsWith("/studies"),
                },
                {
                    to: "/games",
                    label: "マイ棋譜",
                    active: pathname.startsWith("/games"),
                    requiresAuth: true,
                },
            ],
        },
        {
            label: "観戦",
            items: [
                // 進行中の対局と終局済みの棋譜は同じ一覧に出る。単局の観戦ページ
                // (`/rshogi-viewer/live/$gameId`) もこの項目の配下として扱う。
                {
                    to: "/rshogi-viewer",
                    label: "観戦・棋譜一覧",
                    active:
                        (pathname === "/rshogi-viewer" || pathname.startsWith("/rshogi-viewer/")) &&
                        !isPlayers,
                },
                // レーティング (`/rshogi-viewer/players`) は運営者向けのページなので、メニューには
                // 出さない。URL を直接開けば見られる。
            ],
        },
        {
            label: "AI",
            items: [
                // 配布 AI のダウンロードと、評価関数の追加。未ログインでも使える（ブラウザ内に保存）。
                { to: "/nnue", label: "AI（評価関数）", active: pathname === "/nnue" },
            ],
        },
    ];
}

const drawerLinkClass = (active: boolean): string =>
    cn(
        "flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors",
        active ? activeClass : inactiveClass,
    );

function DrawerLink({ item, onNavigate }: { item: NavItem; onNavigate: () => void }): ReactElement {
    return (
        <Link
            to={item.to}
            aria-current={item.active ? "page" : undefined}
            onClick={onNavigate}
            className={drawerLinkClass(item.active)}
        >
            {item.label}
            {item.requiresAuth && <AuthBadge />}
        </Link>
    );
}

/** 未ログインのときの「ログイン」。いま開いている画面を、ログイン後の戻り先にする。 */
function DrawerLoginLink({
    active,
    onNavigate,
}: {
    active: boolean;
    onNavigate: () => void;
}): ReactElement {
    return (
        <Link
            to="/auth"
            search={loginSearch}
            aria-current={active ? "page" : undefined}
            onClick={onNavigate}
            className={drawerLinkClass(active)}
        >
            ログイン
        </Link>
    );
}

export function NavDrawer(): ReactElement {
    const { session } = useAuthSession();
    const { pathname } = useLocation();
    const [open, setOpen] = useState(false);
    const sections = buildNavSections(pathname);
    const isAuthActive = pathname === "/auth";

    return (
        <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
                <button
                    type="button"
                    aria-label="メニュー"
                    aria-expanded={open}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border text-wafuu-sumi transition-colors hover:bg-muted/50 hover:text-foreground"
                >
                    <span className="flex flex-col gap-1" aria-hidden>
                        <span className="h-0.5 w-4 rounded-full bg-current" />
                        <span className="h-0.5 w-4 rounded-full bg-current" />
                        <span className="h-0.5 w-4 rounded-full bg-current" />
                    </span>
                </button>
            </SheetTrigger>
            <SheetContent
                side="left"
                className="flex w-72 max-w-[calc(100vw-32px)] flex-col overflow-y-auto p-4"
            >
                <SheetTitle className="sr-only">メニュー</SheetTitle>
                <nav aria-label="サイト内ナビゲーション" className="flex flex-1 flex-col gap-5">
                    <div className="flex flex-col gap-4">
                        {sections.map((section) => (
                            <section key={section.label} className="flex flex-col gap-1.5">
                                <h2 className="px-3 text-xs font-medium text-muted-foreground">
                                    {section.label}
                                </h2>
                                <div className="flex flex-col gap-1">
                                    {section.items.map((item) => (
                                        <DrawerLink
                                            key={item.to}
                                            item={item}
                                            onNavigate={() => setOpen(false)}
                                        />
                                    ))}
                                </div>
                            </section>
                        ))}
                    </div>
                    <div className="mt-auto border-t border-border pt-4">
                        {session?.authenticated ? (
                            <DrawerLink
                                item={{
                                    to: "/auth",
                                    label: session.user.displayName,
                                    active: isAuthActive,
                                }}
                                onNavigate={() => setOpen(false)}
                            />
                        ) : (
                            <DrawerLoginLink
                                active={isAuthActive}
                                onNavigate={() => setOpen(false)}
                            />
                        )}
                        <Link
                            to="/privacy"
                            onClick={() => setOpen(false)}
                            className="mt-3 block px-3 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                        >
                            プライバシーポリシー
                        </Link>
                    </div>
                </nav>
            </SheetContent>
        </Sheet>
    );
}

export { buildNavSections };
