import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShogiMatchProvider } from "../ShogiMatchContext";
import { PCBoardSection } from "./PCBoardSection";

const side = { mainMs: 0, byoyomiMs: 0, enabled: false };

vi.mock("../contexts/MatchSettingsContext", () => ({
    // 持ち時間なし（時計は ∞ を出す）
    useMatchSettings: () => ({ timeSettings: { sente: side, gote: side } }),
}));
vi.mock("../contexts/MatchStateContext", () => ({
    useMatchState: () => ({
        boardSectionRef: { current: null },
        isDraggingPiece: false,
        clocks: { sente: side, gote: side, ticking: null, lastUpdatedAt: 0 },
        isMatchRunning: false,
        moves: [],
        position: { turn: "sente" },
        sides: { sente: { role: "human" }, gote: { role: "human" } },
        flipBoard: false,
        onFlipBoardChange: () => {},
        gameMode: "reviewing",
        getHandInfo: () => ({ owner: "sente", hand: {}, isActive: false, isAI: false }),
    }),
}));
vi.mock("./PCBoardContent", () => ({ PCBoardContent: () => <div data-testid="board" /> }));
vi.mock("./MatchControls", () => ({ MatchControls: () => null }));
vi.mock("./SoundToggle", () => ({ SoundToggle: () => null }));

afterEach(cleanup);

function renderSection(config: { viewerMode?: boolean; boardTopContent?: ReactNode }) {
    return render(
        <ShogiMatchProvider config={config}>
            <PCBoardSection candidateNote={null} />
        </ShogiMatchProvider>,
    );
}

describe("PCBoardSection: 盤の上の対局時計", () => {
    it("通常の画面では、持ち時間なしの時計（∞）を先手・後手ぶん出す", () => {
        renderSection({});
        expect(screen.getAllByText("∞")).toHaveLength(2);
    });

    it("棋譜を見るだけの画面では、時計（∞）を出さない", () => {
        renderSection({ viewerMode: true });
        expect(screen.queryByText("∞")).toBeNull();
        expect(screen.getByTestId("board")).toBeTruthy();
    });

    it("盤の上に出す内容があれば、時計の代わりに盤より前（上）へ出す", () => {
        renderSection({
            viewerMode: true,
            boardTopContent: <div data-testid="players">☗ alice / ☖ bob</div>,
        });
        expect(screen.queryByText("∞")).toBeNull();
        const players = screen.getByTestId("players");
        const board = screen.getByTestId("board");
        expect(
            players.compareDocumentPosition(board) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
    });
});
