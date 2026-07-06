import { cn } from "@shogi/design-system";
import { Popover, PopoverContent, PopoverTrigger } from "@shogi/ui/components/popover";
import { Link, useLocation } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { useState } from "react";
import { useAuthSession } from "../hooks/useAuthSession";

// リンクの見た目は「現在ページかどうか」で表示/非表示を切り替えず、常に全導線を
// 出したまま aria-current + 配色で現在地を示す。項目数が遷移で増減しないため
// ヘッダーのレイアウトシフトが起きない。geometry (border/padding) は variant/active
// 間で共通にし、色だけを変えて幅の揺れも防ぐ。
const variantClass = {
    // 主導線 (対局・オンライン): 朱アクセントで優先度を示す
    primary: "border-wafuu-shu/40 text-wafuu-shu hover:bg-wafuu-shu/10",
    // 副導線 (棋譜・NNUE・観戦系・ログイン): 落ち着いた muted 系
    default: "border-border text-muted-foreground hover:bg-muted/50 hover:text-foreground",
} as const;
// 現在ページ: variant に関わらず塗りアクセントで現在地を強調
const activeClass = "border-wafuu-shu bg-wafuu-shu/10 text-wafuu-shu";
// PC ヘッダーの横並びピル / モバイルドロワーの縦積み行。geometry のみ差し替え、
// 配色 (variantClass/activeClass) は共通で再利用する。
const pillClass = "rounded-md border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap";
const rowClass = "block w-full rounded-md border px-3 py-1.5 text-sm font-medium";

type NavVariant = keyof typeof variantClass;

// Link の `to` は登録ルートで型付けされる。ヘッダーで使う遷移先はいずれも
// params/search を要求しない静的パスなので、その literal union に限定する。
type NavTo =
    | "/"
    | "/online"
    | "/games"
    | "/nnue"
    | "/rshogi-viewer/live"
    | "/rshogi-viewer"
    | "/public/games"
    | "/auth";

interface NavItem {
    to: NavTo;
    label: string;
    active: boolean;
    variant?: NavVariant;
}

function NavLink({
    item,
    layout,
    onNavigate,
}: {
    item: NavItem;
    layout: "pill" | "row";
    onNavigate?: () => void;
}): ReactElement {
    const geometry = layout === "pill" ? pillClass : rowClass;
    return (
        <Link
            to={item.to}
            aria-current={item.active ? "page" : undefined}
            onClick={onNavigate}
            className={cn(
                geometry,
                "transition-colors",
                item.active ? activeClass : variantClass[item.variant ?? "default"],
            )}
        >
            {item.label}
        </Link>
    );
}

export function HeaderNav(): ReactElement {
    const { session } = useAuthSession();
    const { pathname } = useLocation();
    const [menuOpen, setMenuOpen] = useState(false);

    // 現在地判定。CSA 観戦系は live 一覧/観戦 と単局ビューアが prefix を共有する。
    // 単局ビューアの動的 param (/rshogi-viewer/$gameId) が "live..." で始まる gameId を
    // ライブと誤判定しないよう、live はセグメント境界で判定する (一覧 `/live` と観戦
    // `/live/<id>` のみ)。ビューアは残りの /rshogi-viewer 配下 (一覧・単局)。
    const isLive =
        pathname === "/rshogi-viewer/live" || pathname.startsWith("/rshogi-viewer/live/");

    const appItems: NavItem[] = [
        { to: "/", label: "対局", active: pathname === "/", variant: "primary" },
        {
            to: "/online",
            label: "オンライン",
            active: pathname.startsWith("/online"),
            variant: "primary",
        },
        { to: "/games", label: "棋譜", active: pathname.startsWith("/games") },
        { to: "/nnue", label: "NNUE", active: pathname === "/nnue" },
    ];
    const csaItems: NavItem[] = [
        { to: "/rshogi-viewer/live", label: "ライブ", active: isLive },
        {
            to: "/rshogi-viewer",
            label: "棋譜ビューア",
            active: pathname.startsWith("/rshogi-viewer") && !isLive,
        },
        { to: "/public/games", label: "公開棋譜", active: pathname.startsWith("/public/games") },
    ];
    const authItem: NavItem = {
        to: "/auth",
        label: session?.authenticated ? session.user.displayName : "ログイン",
        active: pathname === "/auth",
    };

    return (
        <>
            {/* PC: 全導線を横並びピルで常時表示。狭幅では溢れるので min-[880px] 以上のみ。 */}
            <nav
                aria-label="サイト内ナビゲーション"
                className="hidden items-center gap-1.5 min-[880px]:flex"
            >
                {appItems.map((item) => (
                    <NavLink key={item.to} item={item} layout="pill" />
                ))}
                <span aria-hidden className="mx-0.5 h-4 w-px shrink-0 bg-wafuu-border" />
                {/* CSA サーバー連携 (観戦・棋譜) */}
                <span className="select-none text-[10px] text-muted-foreground">観戦</span>
                {csaItems.map((item) => (
                    <NavLink key={item.to} item={item} layout="pill" />
                ))}
                <span aria-hidden className="mx-0.5 h-4 w-px shrink-0 bg-wafuu-border" />
                <NavLink item={authItem} layout="pill" />
            </nav>

            {/* モバイル: 全導線をドロワーに畳む。トリガーは固定幅なのでヘッダーが
                溢れず、ページ全体の横スクロールも起きない。 */}
            <div className="min-[880px]:hidden">
                <Popover open={menuOpen} onOpenChange={setMenuOpen}>
                    <PopoverTrigger asChild>
                        <button
                            type="button"
                            aria-label="メニュー"
                            aria-expanded={menuOpen}
                            className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-base leading-none text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                        >
                            <span aria-hidden>☰</span>
                        </button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-56 p-2">
                        <nav aria-label="サイト内ナビゲーション" className="flex flex-col gap-1">
                            {appItems.map((item) => (
                                <NavLink
                                    key={item.to}
                                    item={item}
                                    layout="row"
                                    onNavigate={() => setMenuOpen(false)}
                                />
                            ))}
                            <div className="my-1 flex items-center gap-2 px-1">
                                <span className="text-[10px] text-muted-foreground">観戦</span>
                                <span className="h-px flex-1 bg-wafuu-border" />
                            </div>
                            {csaItems.map((item) => (
                                <NavLink
                                    key={item.to}
                                    item={item}
                                    layout="row"
                                    onNavigate={() => setMenuOpen(false)}
                                />
                            ))}
                            <span aria-hidden className="my-1 h-px bg-wafuu-border" />
                            <NavLink
                                item={authItem}
                                layout="row"
                                onNavigate={() => setMenuOpen(false)}
                            />
                        </nav>
                    </PopoverContent>
                </Popover>
            </div>
        </>
    );
}
