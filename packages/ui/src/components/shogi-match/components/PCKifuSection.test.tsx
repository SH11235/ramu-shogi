import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShogiMatchProvider } from "../ShogiMatchContext";
import type { GameMode } from "../types";
import { PCKifuSection } from "./PCKifuSection";

let gameMode: GameMode = "reviewing";

vi.mock("../contexts/MatchStateContext", () => ({
    useMatchState: () => ({ gameMode }),
}));
vi.mock("../contexts/AnalysisContext", () => ({
    useAnalysis: () => ({
        analysisSettings: { parallelWorkers: 0, batchAnalysisTimeMs: 1000 },
        nnueList: [],
        presetConfigs: [],
        analysisNnueSelection: { presetKey: null, nnueId: null },
        analyzingState: { type: "none" },
        batchAnalysis: null,
    }),
}));
vi.mock("../contexts/NavigationContext", () => ({
    useNavigation: () => ({
        navigationState: { currentPly: 0, totalPly: 0 },
        navigationHandlers: {},
        kifMoves: [],
        displayEvalHistory: [],
        positionHistory: [],
        displaySettings: {},
        isMatchRunning: gameMode === "playing",
    }),
}));
vi.mock("./EvalGraph", () => ({ EvalGraph: () => <div data-testid="eval-graph" /> }));
vi.mock("./EvalGraphModal", () => ({ EvalGraphModal: () => null }));
vi.mock("./KifuPanel", () => ({ KifuPanel: () => null }));
vi.mock("./CurrentPositionAiHintPanel", () => ({ CurrentPositionAiHintPanel: () => null }));

afterEach(cleanup);

function renderSection(mode: GameMode, config: { evalGraphPinned?: boolean } = {}) {
    gameMode = mode;
    const ui = () => (
        <ShogiMatchProvider config={config}>
            <PCKifuSection />
        </ShogiMatchProvider>
    );
    const view = render(ui());
    return {
        setMode: (next: GameMode) => {
            gameMode = next;
            view.rerender(ui());
        },
    };
}

const expanded = () =>
    screen.getByRole("button", { name: /評価値グラフ/ }).getAttribute("aria-expanded");

describe("PCKifuSection: 評価値グラフを最初に開いておくか", () => {
    it.each<GameMode>([
        "playing",
        "paused",
    ])("対局中（%s）は既定で閉じている（開閉はできる）", (mode) => {
        renderSection(mode);
        expect(expanded()).toBe("false");
    });

    it.each<GameMode>([
        "reviewing",
        "editing",
    ])("対局していないとき（%s）は既定で開いている（開閉はできる）", (mode) => {
        renderSection(mode);
        expect(expanded()).toBe("true");
    });

    it("検討中に開いていたグラフは、対局を始めると閉じ、対局が終わるとまた開く", () => {
        const view = renderSection("reviewing");
        expect(expanded()).toBe("true");

        view.setMode("playing");
        expect(expanded()).toBe("false");

        view.setMode("reviewing");
        expect(expanded()).toBe("true");
    });

    it("棋譜ビューア（evalGraphPinned）では常に開いていて、折りたたみの操作が無い", () => {
        renderSection("reviewing", { evalGraphPinned: true });

        expect(screen.getByText("評価値グラフ")).toBeTruthy();
        expect(screen.getByTestId("eval-graph")).toBeTruthy();
        expect(screen.queryByRole("button", { name: /評価値グラフ/ })).toBeNull();
        expect(screen.queryByText("（クリックで展開）")).toBeNull();
    });
});
