import type { RshogiGameBrowserSearch } from "@shogi/ui";
import { RshogiCsaGameBrowser } from "@shogi/ui";
import { Button } from "@shogi/ui/components/button";
import { type ReactElement, useState } from "react";

// import.meta.env はビルド時定数なのでコンポーネント外で確定できる。
const apiBaseUrl =
    (import.meta.env.VITE_RSHOGI_API_BASE as string | undefined)?.trim() || undefined;

interface Props {
    onBackToLocal: () => void;
    /** 終局済みの対局を選んだとき。 */
    onSelectGame: (gameId: string) => void;
    /** 進行中の対局を選んだとき。 */
    onSelectLiveGame: (gameId: string) => void;
}

/**
 * Desktop 用の rshogi viewer 一覧ビュー。
 *
 * 中身は Web の `/rshogi-viewer` と同じ `RshogiCsaGameBrowser` (進行中の対局 +
 * 検索フォーム + 終局済み一覧)。Web は絞り込み条件を URL のクエリに置くが、
 * Desktop には URL が無いのでこのコンポーネントの state に持つ。
 */
export function RshogiViewerListView({
    onBackToLocal,
    onSelectGame,
    onSelectLiveGame,
}: Props): ReactElement {
    const [search, setSearch] = useState<RshogiGameBrowserSearch>({});

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" onClick={onBackToLocal}>
                    ← ローカル対局へ戻る
                </Button>
                <span className="text-sm font-semibold text-wafuu-sumi">rshogi viewer</span>
                <span className="text-xs text-muted-foreground">
                    進行中の対局と、終局した棋譜を新着順で表示します。
                </span>
            </div>

            <RshogiCsaGameBrowser
                apiBaseUrl={apiBaseUrl}
                search={search}
                onSearchChange={setSearch}
                onSelectGame={onSelectGame}
                onSelectLiveGame={onSelectLiveGame}
            />
        </div>
    );
}
