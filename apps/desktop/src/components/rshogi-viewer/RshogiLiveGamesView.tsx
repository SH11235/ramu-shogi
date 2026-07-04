import { RshogiCsaLiveGameList, useRshogiLiveGameList } from "@shogi/ui";
import { Button } from "@shogi/ui/components/button";
import type { ReactElement } from "react";

// web 側 (`RshogiLiveGamesPage`) と同じくモジュールスコープで解決する
// (import.meta.env はビルド時定数のためコンポーネント外で確定できる)。
const apiBaseUrl =
    (import.meta.env.VITE_RSHOGI_API_BASE as string | undefined)?.trim() || undefined;

interface Props {
    onBackToLocal: () => void;
    onSelectGame: (gameId: string) => void;
}

/**
 * Desktop 用の rshogi 進行中対局一覧ビュー。
 *
 * 取得・60 秒自動更新・手動更新・ページングは web 側 `RshogiLiveGamesPage` と
 * 共有のフック (`useRshogiLiveGameList`) に委譲する。行クリックで `onSelectGame`
 * を呼び、呼出側 (`App.tsx`) が live 観戦ビューへ遷移する。
 */
export function RshogiLiveGamesView({ onBackToLocal, onSelectGame }: Props): ReactElement {
    const { games, isLoading, errorMessage, hasMore, refresh, loadMore } =
        useRshogiLiveGameList(apiBaseUrl);

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" onClick={onBackToLocal}>
                    ← ローカル対局へ戻る
                </Button>
                <Button variant="outline" size="sm" onClick={refresh} disabled={isLoading}>
                    {isLoading ? "更新中..." : "更新"}
                </Button>
                <span className="text-sm font-semibold text-wafuu-sumi">rshogi viewer (live)</span>
                <span className="text-xs text-muted-foreground">
                    進行中の対局を開始が新しい順で表示します (反映まで最大 60 秒)。
                </span>
            </div>

            {errorMessage && (
                <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                    {errorMessage}
                </div>
            )}

            <RshogiCsaLiveGameList
                games={games}
                onSelectGame={onSelectGame}
                onLoadMore={() => void loadMore()}
                isLoading={isLoading}
                hasMore={hasMore}
                emptyMessage="現在進行中の対局はありません。"
            />
        </div>
    );
}
