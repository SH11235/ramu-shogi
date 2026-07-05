import { cn } from "@shogi/design-system";
import { Link, useLocation } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { useAuthSession } from "../hooks/useAuthSession";

// リンクの見た目は「現在ページかどうか」で表示/非表示を切り替えず、常に全導線を
// 出したまま aria-current + 配色で現在地を示す。項目数が遷移で増減しないため
// ヘッダーのレイアウトシフトが起きない。geometry (border/padding) は variant/active
// 間で共通にし、色だけを変えて幅の揺れも防ぐ。
const baseLinkClass =
    "rounded-md border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap transition-colors";
const variantClass = {
    // 主導線 (対局・オンライン): 朱アクセントで優先度を示す
    primary: "border-wafuu-shu/40 text-wafuu-shu hover:bg-wafuu-shu/10",
    // 副導線 (棋譜・NNUE・観戦系・ログイン): 落ち着いた muted 系
    default: "border-border text-muted-foreground hover:bg-muted/50 hover:text-foreground",
} as const;
// 現在ページ: variant に関わらず塗りアクセントで現在地を強調
const activeClass = "border-wafuu-shu bg-wafuu-shu/10 text-wafuu-shu";

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

function NavLink({
    to,
    label,
    active,
    variant = "default",
}: {
    to: NavTo;
    label: string;
    active: boolean;
    variant?: NavVariant;
}): ReactElement {
    return (
        <Link
            to={to}
            aria-current={active ? "page" : undefined}
            className={cn(baseLinkClass, active ? activeClass : variantClass[variant])}
        >
            {label}
        </Link>
    );
}

/** グループ区切りの縦罫 */
function Divider(): ReactElement {
    return <span aria-hidden className="mx-0.5 h-4 w-px shrink-0 bg-wafuu-border" />;
}

export function HeaderNav(): ReactElement {
    const { session } = useAuthSession();
    const { pathname } = useLocation();

    // 現在地判定。CSA 観戦系は live 一覧/観戦 と単局ビューアが prefix を共有する。
    // 単局ビューアの動的 param (/rshogi-viewer/$gameId) が "live..." で始まる gameId を
    // ライブと誤判定しないよう、live はセグメント境界で判定する (一覧 `/live` と観戦
    // `/live/<id>` のみ)。ビューアは残りの /rshogi-viewer 配下 (一覧・単局)。
    const isPlay = pathname === "/";
    const isOnline = pathname.startsWith("/online");
    const isGames = pathname.startsWith("/games");
    const isNnue = pathname === "/nnue";
    const isLive =
        pathname === "/rshogi-viewer/live" || pathname.startsWith("/rshogi-viewer/live/");
    const isViewer = pathname.startsWith("/rshogi-viewer") && !isLive;
    const isPublicGames = pathname.startsWith("/public/games");
    const isAuth = pathname === "/auth";

    return (
        <nav aria-label="サイト内ナビゲーション" className="flex items-center gap-1.5">
            {/* アプリ本体機能 */}
            <NavLink to="/" label="対局" active={isPlay} variant="primary" />
            <NavLink to="/online" label="オンライン" active={isOnline} variant="primary" />
            <NavLink to="/games" label="棋譜" active={isGames} />
            <NavLink to="/nnue" label="NNUE" active={isNnue} />

            <Divider />

            {/* CSA サーバー連携 (観戦・棋譜) */}
            <span className="hidden select-none text-[10px] text-muted-foreground sm:inline">
                観戦
            </span>
            <NavLink to="/rshogi-viewer/live" label="ライブ" active={isLive} />
            <NavLink to="/rshogi-viewer" label="棋譜ビューア" active={isViewer} />
            <NavLink to="/public/games" label="公開棋譜" active={isPublicGames} />

            <Divider />

            {/* アカウント */}
            <NavLink
                to="/auth"
                label={session?.authenticated ? session.user.displayName : "ログイン"}
                active={isAuth}
            />
        </nav>
    );
}
