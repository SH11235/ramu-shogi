import type { ReactElement } from "react";

// ログイン必須の導線に付ける共通バッジ。リンク先で AuthRequiredCard や /auth
// リダイレクトに当たる前に、リンク時点で要否が分かるようにする。
export function AuthBadge(): ReactElement {
    return (
        <span className="shrink-0 rounded-full border border-wafuu-border px-1.5 py-0.5 text-[10px] leading-none text-muted-foreground">
            要ログイン
        </span>
    );
}
