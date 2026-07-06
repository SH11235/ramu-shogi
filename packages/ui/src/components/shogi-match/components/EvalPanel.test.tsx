import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { EvalHistory } from "../utils/kifFormat";
import { EvalPanel } from "./EvalPanel";

const evalHistory: EvalHistory[] = [
    { ply: 0, evalCp: 0, evalMate: null },
    { ply: 1, evalCp: 84, evalMate: null },
];

describe("EvalPanel", () => {
    it("検討/観戦(reviewMode)ではスコアボードを常時表示する", () => {
        render(<EvalPanel evalHistory={evalHistory} currentPly={1} reviewMode />);
        expect(screen.getByTestId("eval-scoreboard")).toBeTruthy();
        expect(screen.getByTestId("eval-scoreboard-value").textContent).toBe("+0.8");
    });

    it("対局ページ(reviewMode 未指定)ではスコアボードを出さない(チート防止)", () => {
        render(<EvalPanel evalHistory={evalHistory} currentPly={1} />);
        expect(screen.queryByTestId("eval-scoreboard")).toBeNull();
    });
});
