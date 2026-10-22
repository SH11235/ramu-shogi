import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { KifMove } from "../utils/kifFormat";
import { PlayMoveList } from "./PlayMoveList";

const kifMoves: KifMove[] = [
    {
        ply: 1,
        kifText: "▲７六歩(77)",
        displayText: "☗7六歩(77)",
        usiMove: "7g7f",
        elapsedMs: 3200,
        evalCp: 45,
    },
    { ply: 2, kifText: "△３四歩(33)", displayText: "☖3四歩(33)", usiMove: "3c3d" },
];

let currentPly = 2;
const handlePlySelect = vi.fn();

vi.mock("../contexts/NavigationContext", () => ({
    useNavigation: () => ({
        kifMoves,
        navigationState: { currentPly },
        handlePlySelect,
    }),
}));

afterEach(() => {
    cleanup();
    currentPly = 2;
    handlePlySelect.mockClear();
});

const rows = (): string[] =>
    within(screen.getByRole("list", { name: "棋譜" }))
        .getAllByRole("listitem")
        .map((item) => item.textContent ?? "");

describe("PlayMoveList", () => {
    it("1 手 1 行で、消費時間を右の列に出す（無い手は —）", () => {
        render(<PlayMoveList selectable={false} />);
        expect(rows()).toEqual(["1☗7六歩(77)3.2秒", "2☖3四歩(33)—"]);
    });

    it("評価値の列は showEval のときだけ出す", () => {
        render(<PlayMoveList selectable={false} showEval />);
        expect(rows()).toEqual(["1☗7六歩(77)3.2秒+45", "2☖3四歩(33)——"]);
    });

    it("対局中は見ている手までを出し、その手に aria-current を付ける", () => {
        currentPly = 1;
        render(<PlayMoveList selectable={false} upToCurrent />);
        expect(rows()).toEqual(["1☗7六歩(77)3.2秒"]);
        expect(screen.queryByRole("button")).toBeNull();
        const current = screen
            .getByRole("list", { name: "棋譜" })
            .querySelector('[aria-current="true"]');
        expect(current?.textContent).toBe("1☗7六歩(77)3.2秒");
    });

    it("終局後は手を押すとその局面へ移る", () => {
        render(<PlayMoveList selectable />);
        fireEvent.click(screen.getByRole("button", { name: /7六歩/ }));
        expect(handlePlySelect).toHaveBeenCalledWith(1);
    });
});
