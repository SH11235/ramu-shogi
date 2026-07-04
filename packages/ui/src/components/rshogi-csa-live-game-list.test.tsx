import type { RshogiLiveGameSummary } from "@shogi/match-client";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RshogiCsaLiveGameList } from "./rshogi-csa-live-game-list";

const SAMPLE_LIVE_GAMES: RshogiLiveGameSummary[] = [
    {
        gameId: "live-room-1-1234",
        senteName: "alice",
        goteName: "bob",
        startedAtMs: Date.UTC(2026, 3, 28, 12, 34),
        timeControl: {
            kind: "fischer",
            mainSeconds: 300,
            byoyomiSeconds: 0,
            incrementSeconds: 10,
        },
        source: "kifu",
    },
    {
        gameId: "live-room-2-9999",
        senteName: "carol",
        goteName: "dave",
        startedAtMs: Date.UTC(2026, 3, 28, 13, 0),
        timeControl: {
            kind: "countdown",
            mainSeconds: 600,
            byoyomiSeconds: 30,
        },
        source: "floodgate",
    },
];

describe("RshogiCsaLiveGameList", () => {
    it("renders one row per live game with sente/gote names, clock and source", () => {
        render(<RshogiCsaLiveGameList games={SAMPLE_LIVE_GAMES} onSelectGame={vi.fn()} />);
        expect(screen.getByText("☗ alice vs ☖ bob")).toBeDefined();
        expect(screen.getByText("☗ carol vs ☖ dave")).toBeDefined();
        // 進行中バッジは 1 行につき 1 つ。
        expect(screen.getAllByText("対局中")).toHaveLength(2);
        expect(screen.getByText("source: kifu")).toBeDefined();
        expect(screen.getByText("source: floodgate")).toBeDefined();
    });

    it("invokes onSelectGame with the gameId when a row is clicked", () => {
        const onSelectGame = vi.fn();
        render(<RshogiCsaLiveGameList games={SAMPLE_LIVE_GAMES} onSelectGame={onSelectGame} />);
        const button = screen.getByText("☗ alice vs ☖ bob").closest("button");
        expect(button).toBeDefined();
        if (button) fireEvent.click(button);
        expect(onSelectGame).toHaveBeenCalledWith("live-room-1-1234");
    });

    it("shows empty message when there are no live games and not loading", () => {
        render(
            <RshogiCsaLiveGameList
                games={[]}
                onSelectGame={vi.fn()}
                emptyMessage="進行中の対局はありません"
            />,
        );
        expect(screen.getByText("進行中の対局はありません")).toBeDefined();
    });

    it("shows load-more button only when hasMore=true and onLoadMore is provided", () => {
        const onLoadMore = vi.fn();
        const { rerender } = render(
            <RshogiCsaLiveGameList
                games={SAMPLE_LIVE_GAMES}
                onSelectGame={vi.fn()}
                onLoadMore={onLoadMore}
                hasMore={true}
            />,
        );
        const button = screen.getByText("もっと読み込む");
        fireEvent.click(button);
        expect(onLoadMore).toHaveBeenCalledTimes(1);

        rerender(
            <RshogiCsaLiveGameList
                games={SAMPLE_LIVE_GAMES}
                onSelectGame={vi.fn()}
                onLoadMore={onLoadMore}
                hasMore={false}
            />,
        );
        expect(screen.queryByText("もっと読み込む")).toBeNull();
    });
});
