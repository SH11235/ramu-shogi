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

const EXTERNAL_GAMES: RshogiGameSummary[] = [
    {
        gameId: "wdoor-20261009000001-0a1b2c3d4e",
        senteName: "RAMU",
        goteName: "SampleEngine",
        source: "wdoor",
        event: "floodgate-300-10F",
        originUrl: "https://wdoor.c.u-tokyo.ac.jp/shogi/x/a.csa",
    },
    {
        gameId: "upload-00112233445566aa",
        senteName: "A",
        goteName: "B",
        source: "upload",
        event: "WCSC36",
    },
    { gameId: "upload-8899aabbccddeeff", senteName: "C", goteName: "D", source: "upload" },
    { gameId: "future-1", senteName: "E", goteName: "F", source: "future-source" },
];

describe("RshogiCsaGameList: 対局場所とイベントタグ", () => {
    it("対局場所を画面上の呼び名で出し、内部値の source は出さない", () => {
        render(
            <RshogiCsaGameList games={[...SAMPLE_GAMES, ...EXTERNAL_GAMES]} onSelect={vi.fn()} />,
        );
        expect(screen.getAllByText("rshogi サーバー")).toHaveLength(1);
        expect(screen.getAllByText("Floodgate")).toHaveLength(1);
        // upload は event があっても「その他」。イベント名はタグ側だけに出す。
        expect(screen.getAllByText("その他")).toHaveLength(2);
        expect(screen.getAllByText("WCSC36")).toHaveLength(1);
        // 未知の source は値をそのまま出す。
        expect(screen.getByText("future-source")).toBeDefined();
        expect(screen.queryByText(/source:/)).toBeNull();
    });

    it("持ち時間 (clock) が無い棋譜でも落ちずに「不明」と出す", () => {
        render(<RshogiCsaGameList games={EXTERNAL_GAMES} onSelect={vi.fn()} />);
        expect(screen.getAllByText("持ち時間: 不明")).toHaveLength(EXTERNAL_GAMES.length);
    });

    it("onSelectEvent があるとタグはボタンになり、押すとイベント名だけを返す", () => {
        const onSelect = vi.fn();
        const onSelectEvent = vi.fn();
        render(
            <RshogiCsaGameList
                games={EXTERNAL_GAMES}
                onSelect={onSelect}
                onSelectEvent={onSelectEvent}
            />,
        );

        const tag = screen.getByRole("button", { name: "イベント「WCSC36」で絞り込む" });
        // キーボードで到達でき、カードのボタンの中に入れ子になっていない。
        tag.focus();
        expect(document.activeElement).toBe(tag);
        expect(tag.parentElement?.closest("button")).toBeNull();

        fireEvent.click(tag);
        expect(onSelectEvent).toHaveBeenCalledWith("WCSC36");
        expect(onSelect).not.toHaveBeenCalled();

        // カード本体は従来どおり単局ページへ進む。
        const row = screen.getByText("☗ A vs ☖ B").closest("button");
        if (row) fireEvent.click(row);
        expect(onSelect).toHaveBeenCalledWith("upload-00112233445566aa");
    });

    it("onSelectEvent が無ければタグは押せないラベルとして出す", () => {
        render(<RshogiCsaGameList games={EXTERNAL_GAMES} onSelect={vi.fn()} />);
        expect(screen.getByText("WCSC36")).toBeDefined();
        expect(screen.queryByRole("button", { name: /で絞り込む/ })).toBeNull();
    });

    it("event の無い棋譜にはタグを出さない", () => {
        render(
            <RshogiCsaGameList
                games={[EXTERNAL_GAMES[2]]}
                onSelect={vi.fn()}
                onSelectEvent={vi.fn()}
            />,
        );
        expect(screen.queryByRole("button", { name: /で絞り込む/ })).toBeNull();
    });
});

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
