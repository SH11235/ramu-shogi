import type { GameResult } from "@shogi/app-core";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlayScreenConfig } from "../ShogiMatchContext";
import { ShogiMatchProvider } from "../ShogiMatchContext";
import type { KifMove } from "../utils/kifFormat";
import { PlayEndStamp } from "./PlayEndStamp";
import { PlayResultDialog } from "./PlayResultDialog";

const sides = {
    sente: { role: "human" },
    gote: { role: "engine" },
};
vi.mock("../contexts/MatchStateContext", () => ({
    useMatchState: () => ({ sides, displaySettings: { showEngineReading: true } }),
}));
vi.mock("../contexts/MatchSettingsContext", () => ({
    useMatchSettings: () => ({
        timeSettings: {
            sente: { mainMs: 600_000, byoyomiMs: 0, incrementMs: 0, enabled: true },
            gote: { mainMs: 0, byoyomiMs: 10_000, incrementMs: 0, enabled: true },
        },
        engineSearchLimits: { sente: { kind: "clock" }, gote: { kind: "clock" } },
        engineThreads: { sente: 0, gote: 4 },
        engineOptions: [],
    }),
}));
let kifMoves: KifMove[] = [];
vi.mock("../contexts/NavigationContext", () => ({
    useNavigation: () => ({ handleCopyKif: () => "", kifMoves }),
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
    beforeEach(() => {
        vi.useFakeTimers();
        kifMoves = [];
    });
    afterEach(() => vi.useRealTimers());

    it("stamps the reason on the board first, then opens with the next actions", () => {
        renderDialog(CHECKMATE);
        expect(screen.getByText("詰み")).toBeTruthy();
        expect(screen.queryByRole("dialog")).toBeNull();

        act(() => vi.advanceTimersByTime(700));
        expect(screen.getByRole("dialog", { name: "あなたの勝ち" })).toBeTruthy();
        expect(screen.getByText("先手・10分 切れ負け")).toBeTruthy();
        expect(screen.getByRole("button", { name: "設定を変える" })).toBeTruthy();
        expect(screen.getByRole("button", { name: "ノート" })).toBeTruthy();
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

    it("shows the AI's evaluation trend and average reading when the AI moves were recorded", () => {
        kifMoves = [
            { ply: 1, kifText: "", displayText: "☗7六歩(77)", usiMove: "7g7f" },
            {
                ply: 2,
                kifText: "",
                displayText: "☖3四歩(33)",
                usiMove: "3c3d",
                engineSearch: { depth: 12, nodes: 1_000_000, nps: 1_200_000, scoreCp: -40 },
            },
            { ply: 3, kifText: "", displayText: "☗2六歩(27)", usiMove: "2g2f" },
            {
                ply: 4,
                kifText: "",
                displayText: "☖8四歩(83)",
                usiMove: "8c8d",
                engineSearch: { depth: 14, nodes: 1_500_000, nps: 1_400_000, scoreCp: 120 },
            },
        ];
        renderDialog(CHECKMATE);
        act(() => vi.advanceTimersByTime(700));
        expect(screen.getByRole("heading", { name: "評価値の推移" })).toBeTruthy();
        expect(screen.getByText("AI 平均 深さ 13（2 手）")).toBeTruthy();
        expect(screen.getByText("この端末で 平均 130万局面/秒")).toBeTruthy();
    });

    it("lists the opponent, how much it reads and the player's side and time", () => {
        renderDialog(CHECKMATE);
        act(() => vi.advanceTimersByTime(700));
        expect(screen.getByText("相手")).toBeTruthy();
        expect(screen.getByText("簡易AI レベル 20")).toBeTruthy();
        expect(screen.getByText("1手10秒・スレッド 4")).toBeTruthy();
        expect(screen.getByText("先手・10分 切れ負け")).toBeTruthy();
    });

    it("closes the dialog before starting the next game", () => {
        const play = renderDialog(CHECKMATE, { openStudy: null });
        act(() => vi.advanceTimersByTime(700));
        expect(screen.queryByRole("button", { name: "ノート" })).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "もう一局" }));
        expect(play.closeResultDialog).toHaveBeenCalledTimes(1);
        expect(play.rematch).toHaveBeenCalledTimes(1);
    });
});
