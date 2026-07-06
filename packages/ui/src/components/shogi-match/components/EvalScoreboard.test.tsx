import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EvalScoreboard, evalAdvantage, evalToSenteWinRate } from "./EvalScoreboard";

describe("evalToSenteWinRate", () => {
    it("評価値 0 は互角の 0.5", () => {
        expect(evalToSenteWinRate(0, null)).toBe(0.5);
    });

    it("評価値なし(未解析)は 0.5", () => {
        expect(evalToSenteWinRate(null, null)).toBe(0.5);
    });

    it("先手の詰みは 1、後手の詰みは 0", () => {
        expect(evalToSenteWinRate(null, 3)).toBe(1);
        expect(evalToSenteWinRate(null, -5)).toBe(0);
        // 詰みは評価値より優先される
        expect(evalToSenteWinRate(-9999, 1)).toBe(1);
    });

    it("正の評価値は 0.5 より大きく、負は小さい（対称）", () => {
        const plus = evalToSenteWinRate(600, null);
        const minus = evalToSenteWinRate(-600, null);
        expect(plus).toBeGreaterThan(0.5);
        expect(minus).toBeLessThan(0.5);
        expect(plus + minus).toBeCloseTo(1, 10);
    });

    it("極端な評価値でも 0〜1 に収まる", () => {
        expect(evalToSenteWinRate(1_000_000, null)).toBeLessThanOrEqual(1);
        expect(evalToSenteWinRate(-1_000_000, null)).toBeGreaterThanOrEqual(0);
    });
});

describe("evalAdvantage", () => {
    it("正=先手 / 負=後手 / 0・null=互角", () => {
        expect(evalAdvantage(84, null)).toBe("sente");
        expect(evalAdvantage(-33, null)).toBe("gote");
        expect(evalAdvantage(0, null)).toBe("even");
        expect(evalAdvantage(null, null)).toBe("even");
    });

    it("詰みは符号で優勢側を決める", () => {
        expect(evalAdvantage(null, 7)).toBe("sente");
        expect(evalAdvantage(null, -1)).toBe("gote");
    });
});

describe("EvalScoreboard", () => {
    it("先手優勢: 朱の文字色と formatEval 表記で表示する", () => {
        render(<EvalScoreboard entry={{ ply: 6, evalCp: 84, evalMate: null }} />);
        const value = screen.getByTestId("eval-scoreboard-value");
        expect(value.textContent).toBe("+0.8");
        expect(value.className).toContain("text-wafuu-shu");
    });

    it("後手優勢: 藍の文字色", () => {
        render(<EvalScoreboard entry={{ ply: 2, evalCp: -33, evalMate: null }} />);
        const value = screen.getByTestId("eval-scoreboard-value");
        expect(value.textContent).toBe("-0.3");
        expect(value.className).toContain("text-wafuu-ai");
    });

    it("未解析はダッシュ表示で、形勢バーは充填せず muted(互角と区別)", () => {
        render(<EvalScoreboard />);
        expect(screen.getByTestId("eval-scoreboard-value").textContent).toBe("—");
        // 朱の充填は描画されない
        expect(screen.queryByTestId("eval-scoreboard-bar-sente")).toBeNull();
        expect(screen.getByRole("img", { name: "形勢バー: 未解析" })).toBeTruthy();
    });

    it("互角(評価値0)は朱藍 50% のバーを描画する(未解析と区別)", () => {
        render(<EvalScoreboard entry={{ ply: 1, evalCp: 0, evalMate: null }} />);
        expect(screen.getByTestId("eval-scoreboard-bar-sente").style.width).toBe("50%");
    });

    it("先手の詰みはバー 100% 充填", () => {
        render(<EvalScoreboard entry={{ ply: 99, evalCp: null, evalMate: 3 }} />);
        expect(screen.getByTestId("eval-scoreboard-value").textContent).toBe("+詰3");
        expect(screen.getByTestId("eval-scoreboard-bar-sente").style.width).toBe("100%");
    });
});
