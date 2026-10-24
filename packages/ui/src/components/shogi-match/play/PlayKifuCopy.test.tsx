import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlayScreenConfig } from "../ShogiMatchContext";
import { ShogiMatchProvider } from "../ShogiMatchContext";
import { KifuCopyButtons } from "./PlayKifuCopy";

let navigation: { startSfen: string; usiMoves: string[] };
vi.mock("../contexts/NavigationContext", () => ({
    useNavigation: () => ({
        handleCopyKif: () => "KIF-TEXT",
        kifMoves: navigation.usiMoves.map((usiMove, index) => ({
            ply: index + 1,
            kifText: "",
            displayText: "",
            usiMove,
        })),
        kifuTree: { startSfen: navigation.startSfen },
    }),
}));

const writeText = vi.fn(() => Promise.resolve());

function renderButtons() {
    const play = {
        playerNames: { sente: "あなた", gote: "簡易AI" },
    } as unknown as PlayScreenConfig;
    render(
        <ShogiMatchProvider config={{ play }}>
            <KifuCopyButtons />
        </ShogiMatchProvider>,
    );
}

describe("KifuCopyButtons", () => {
    beforeEach(() => {
        writeText.mockClear();
        Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
        navigation = { startSfen: "startpos", usiMoves: ["7g7f", "3c3d"] };
    });

    it("copies the record in the pressed format", async () => {
        renderButtons();
        await act(async () =>
            fireEvent.click(screen.getByRole("button", { name: "KIF 形式でコピー" })),
        );
        expect(writeText).toHaveBeenLastCalledWith("KIF-TEXT");
        await act(async () =>
            fireEvent.click(screen.getByRole("button", { name: "USI 形式でコピー" })),
        );
        expect(writeText).toHaveBeenLastCalledWith("position startpos moves 7g7f 3c3d");
        await act(async () =>
            fireEvent.click(screen.getByRole("button", { name: "CSA 形式でコピー" })),
        );
        expect(writeText).toHaveBeenLastCalledWith(expect.stringContaining("+7776FU"));
        expect(screen.getByText("CSA をコピーしました")).toBeTruthy();
    });

    it("writes the start position for USI and disables CSA when the game did not start from 平手", () => {
        navigation = {
            startSfen: "lnsgkgsnl/9/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1",
            usiMoves: [],
        };
        renderButtons();
        expect(
            (screen.getByRole("button", { name: "CSA 形式でコピー" }) as HTMLButtonElement)
                .disabled,
        ).toBe(true);
        fireEvent.click(screen.getByRole("button", { name: "USI 形式でコピー" }));
        expect(writeText).toHaveBeenLastCalledWith(
            "position sfen lnsgkgsnl/9/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1",
        );
    });
});
