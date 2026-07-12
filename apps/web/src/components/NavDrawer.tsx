import { cn } from "@shogi/design-system";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@shogi/ui";
import { Link, useLocation } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { useState } from "react";
import { useAuthSession } from "../hooks/useAuthSession";
import { AuthBadge } from "./AuthBadge";

type NavTo =
    | "/play"
    | "/online"
    | "/games"
    | "/public/games"
    | "/rshogi-viewer/live"
    | "/rshogi-viewer"
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

function isLiveViewerPath(pathname: string): boolean {
    return pathname === "/rshogi-viewer/live" || pathname.startsWith("/rshogi-viewer/live/");
}

function buildNavSections(pathname: string): NavSection[] {
    const isLive = isLiveViewerPath(pathname);

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
                {
                    to: "/games",
                    label: "マイ棋譜",
                    active: pathname.startsWith("/games"),
                    requiresAuth: true,
                },
                {
                    to: "/public/games",
                    label: "公開棋譜",
                    active: pathname.startsWith("/public/games"),
                },
            ],
        },
        {
            label: "観戦",
            items: [
                { to: "/rshogi-viewer/live", label: "ライブ観戦", active: isLive },
                {
                    to: "/rshogi-viewer",
                    label: "CSA 棋譜ビューア",
                    active: pathname.startsWith("/rshogi-viewer") && !isLive,
                },
            ],
        },
        {
            label: "管理",
            items: [
                {
                    to: "/nnue",
                    label: "NNUE モデル",
                    active: pathname === "/nnue",
                    requiresAuth: true,
                },
            ],
        },
    ];
}

function DrawerLink({ item, onNavigate }: { item: NavItem; onNavigate: () => void }): ReactElement {
    return (
        <Link
            to={item.to}
            aria-current={item.active ? "page" : undefined}
            onClick={onNavigate}
            className={cn(
                "flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors",
                item.active ? activeClass : inactiveClass,
            )}
        >
            {item.label}
            {item.requiresAuth && <AuthBadge />}
        </Link>
    );
}

export function NavDrawer(): ReactElement {
    const { session } = useAuthSession();
    const { pathname } = useLocation();
    const [open, setOpen] = useState(false);
    const sections = buildNavSections(pathname);
    const authItem: NavItem = {
        to: "/auth",
        label: session?.authenticated ? session.user.displayName : "ログイン",
        active: pathname === "/auth",
    };

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
            <SheetContent side="left" className="flex w-72 max-w-[calc(100vw-32px)] flex-col p-4">
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
                        <DrawerLink item={authItem} onNavigate={() => setOpen(false)} />
                    </div>
                </nav>
            </SheetContent>
        </Sheet>
    );
}

export { buildNavSections };
