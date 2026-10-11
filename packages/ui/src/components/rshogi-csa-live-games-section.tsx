/**
 * 終局済み一覧の上に置く「進行中の対局」セクション。
 *
 * Web / Desktop 共通。取得・60 秒ごとの自動更新・ページングは
 * `useRshogiLiveGameList` に任せる。進行中の対局が 0 件のあいだ (読み込み中や
 * 取得失敗を含む) は何も描画せず、終局済み一覧の表示を妨げない。
 */

import type { ReactElement } from "react";
import { useRshogiLiveGameList } from "../hooks/useRshogiLiveGameList";
import { RshogiCsaLiveGameList } from "./rshogi-csa-live-game-list";

interface RshogiCsaLiveGamesSectionProps {
    /** rshogi 配信 API のベース URL。空のときはモック fixture を使う。 */
    apiBaseUrl?: string;
    /** 行クリック時に gameId を返す (観戦ページへ進む)。 */
    onSelectGame: (gameId: string) => void;
}

export function RshogiCsaLiveGamesSection({
    apiBaseUrl,
    onSelectGame,
}: RshogiCsaLiveGamesSectionProps): ReactElement | null {
    const { games, isLoading, errorMessage, hasMore, refresh, loadMore } =
        useRshogiLiveGameList(apiBaseUrl);

    if (games.length === 0) return null;

    return (
        <section aria-labelledby="rshogi-live-games-heading" className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h2
                    id="rshogi-live-games-heading"
                    className="text-base font-semibold text-wafuu-sumi"
                >
                    進行中の対局
                </h2>
                <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground">
                        {errorMessage ? "最新の状態を取得できませんでした" : "60 秒ごとに自動更新"}
                    </span>
                    <button
                        type="button"
                        onClick={refresh}
                        disabled={isLoading}
                        className="rounded-md border border-wafuu-border px-3 py-1 text-xs text-wafuu-sumi transition-colors hover:bg-wafuu-kincha/10 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {isLoading ? "更新中..." : "更新"}
                    </button>
                </div>
            </div>
            <RshogiCsaLiveGameList
                games={games}
                onSelectGame={onSelectGame}
                onLoadMore={() => void loadMore()}
                isLoading={isLoading}
                hasMore={hasMore}
            />
        </section>
    );
}
