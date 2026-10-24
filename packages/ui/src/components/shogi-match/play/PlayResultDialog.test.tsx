import type { GameResult } from "@shogi/app-core";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlayScreenConfig } from "../ShogiMatchContext";
import { ShogiMatchProvider } from "../ShogiMatchContext";
import { PlayEndStamp } from "./PlayEndStamp";
import { PlayResultDialog } from "./PlayResultDialog";

const sides = {
    sente: { role: "human" },
    gote: { role: "engine" },
};
vi.mock("../contexts/MatchStateContext", () => ({ useMatchState: () => ({ sides }) }));
vi.mock("../contexts/MatchSettingsContext", () => ({
    useMatchSettings: () => ({
        timeSettings: {
            sente: { mainMs: 600_000, byoyomiMs: 0, incrementMs: 0, enabled: true },
            gote: { mainMs: 600_000, byoyomiMs: 0, incrementMs: 0, enabled: true },
        },
    }),
}));
vi.mock("../contexts/NavigationContext", () => ({
    useNavigation: () => ({ handleCopyKif: () => "" }),
}));

const CHECKMATE: GameResult = {
    winner: "sente",
    reason: { kind: "checkmate", loser: "gote" },
    totalMoves: 87,
};
const RESIGNED_BY_ME: GameResult = {
    winner: "gote",
    reason: { kind: "resignation", loser: "sente" },
    totalMoves: 40,
};

function renderDialog(result: GameResult, overrides: Partial<PlayScreenConfig> = {}) {
    const play = {
        gameResult: result,
        resultDialogOpen: true,
        closeResultDialog: vi.fn(),
        rematch: vi.fn(),
        newGame: vi.fn(),
        openStudy: vi.fn(),
        hintCount: 0,
        playerNames: { sente: "あなた", gote: "簡易AI" },
        ...overrides,
    } as unknown as PlayScreenConfig;
    render(
        <ShogiMatchProvider config={{ play }}>
            <PlayEndStamp />
            <PlayResultDialog variant="center" />
        </ShogiMatchProvider>,
    );
    return play;
}

describe("PlayResultDialog", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("stamps the reason on the board first, then opens with the next actions", () => {
        renderDialog(CHECKMATE);
        expect(screen.getByText("詰み")).toBeTruthy();
        expect(screen.queryByRole("dialog")).toBeNull();

        act(() => vi.advanceTimersByTime(700));
        expect(screen.getByRole("dialog", { name: "あなたの勝ち" })).toBeTruthy();
        expect(screen.getByText("先手・10分 切れ負け・簡易AI")).toBeTruthy();
        expect(screen.getByRole("button", { name: "設定を変えて対局" })).toBeTruthy();
        expect(screen.getByRole("button", { name: "研究ノートで振り返る" })).toBeTruthy();
    });

    it("opens at once when the screen is pressed during the wait", () => {
        renderDialog(CHECKMATE);
        act(() => {
            fireEvent.pointerDown(document.body);
        });
        expect(screen.getByRole("dialog")).toBeTruthy();
    });

    it("opens at once when a key is pressed during the wait", () => {
        renderDialog(CHECKMATE);
        act(() => {
            fireEvent.keyDown(document.body, { key: "Enter" });
        });
        expect(screen.getByRole("dialog")).toBeTruthy();
    });

    it("skips the stamp and the wait after the player's own resignation", () => {
        renderDialog(RESIGNED_BY_ME);
        expect(screen.queryByText("投了")).toBeNull();
        expect(screen.getByRole("dialog", { name: "あなたの負け" })).toBeTruthy();
    });

    it("closes the dialog before starting the next game", () => {
        const play = renderDialog(CHECKMATE, { openStudy: null });
        act(() => vi.advanceTimersByTime(700));
        expect(screen.queryByRole("button", { name: "研究ノートで振り返る" })).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "もう一局" }));
        expect(play.closeResultDialog).toHaveBeenCalledTimes(1);
        expect(play.rematch).toHaveBeenCalledTimes(1);
    });
});
