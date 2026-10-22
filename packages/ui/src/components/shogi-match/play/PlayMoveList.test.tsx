import { cleanup, render, screen, within } from "@testing-library/react";
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

vi.mock("../contexts/NavigationContext", () => ({
    useNavigation: () => ({
        kifMoves,
        navigationState: { currentPly: 2 },
        handlePlySelect: () => undefined,
    }),
}));

afterEach(cleanup);

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
});
