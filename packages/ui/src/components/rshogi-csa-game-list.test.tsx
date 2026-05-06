import type { RshogiGameSummary } from "@shogi/match-client";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RshogiCsaGameList } from "./rshogi-csa-game-list";

const SAMPLE_GAMES: RshogiGameSummary[] = [
    {
        gameId: "room-1-1234",
        senteName: "alice",
        goteName: "bob",
        startedAtMs: Date.UTC(2026, 3, 28, 12, 34),
        endedAtMs: Date.UTC(2026, 3, 28, 13, 0),
        timeControl: {
            kind: "fischer",
            mainSeconds: 300,
            byoyomiSeconds: 0,
            incrementSeconds: 10,
        },
        result: { kind: "resignation", winner: "sente", endReason: "RESIGN" },
        movesCount: 142,
        source: "kifu",
    },
    {
        gameId: "room-2-9999",
        senteName: "carol",
        goteName: "dave",
        startedAtMs: Date.UTC(2026, 3, 27, 9, 0),
        timeControl: {
            kind: "countdown",
            mainSeconds: 600,
            byoyomiSeconds: 30,
        },
        result: { kind: "draw", endReason: "DRAW_REPETITION" },
        movesCount: 100,
    },
];

describe("RshogiCsaGameList", () => {
    it("renders one row per game with sente/gote names and result label", () => {
        render(<RshogiCsaGameList games={SAMPLE_GAMES} onSelect={vi.fn()} />);
        expect(screen.getByText("☗ alice vs ☖ bob")).toBeDefined();
        expect(screen.getByText("☗ carol vs ☖ dave")).toBeDefined();
        expect(screen.getByText(/☗勝/)).toBeDefined();
        expect(screen.getByText(/引分/)).toBeDefined();
    });

    it("invokes onSelect with the gameId when a row is clicked", () => {
        const onSelect = vi.fn();
        render(<RshogiCsaGameList games={SAMPLE_GAMES} onSelect={onSelect} />);
        const button = screen.getByText("☗ alice vs ☖ bob").closest("button");
        expect(button).toBeDefined();
        if (button) fireEvent.click(button);
        expect(onSelect).toHaveBeenCalledWith("room-1-1234");
    });

    it("shows empty message when there are no games and not loading", () => {
        render(<RshogiCsaGameList games={[]} onSelect={vi.fn()} emptyMessage="該当なし" />);
        expect(screen.getByText("該当なし")).toBeDefined();
    });

    it("shows load-more button only when hasMore=true and onLoadMore is provided", () => {
        const onLoadMore = vi.fn();
        const { rerender } = render(
            <RshogiCsaGameList
                games={SAMPLE_GAMES}
                onSelect={vi.fn()}
                onLoadMore={onLoadMore}
                hasMore={true}
            />,
        );
        const button = screen.getByText("もっと読み込む");
        fireEvent.click(button);
        expect(onLoadMore).toHaveBeenCalledTimes(1);

        rerender(
            <RshogiCsaGameList
                games={SAMPLE_GAMES}
                onSelect={vi.fn()}
                onLoadMore={onLoadMore}
                hasMore={false}
            />,
        );
        expect(screen.queryByText("もっと読み込む")).toBeNull();
    });
});
