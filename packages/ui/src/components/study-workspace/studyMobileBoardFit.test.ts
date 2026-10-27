import { describe, expect, it } from "vitest";
import { fitMobileBoard } from "./studyMobileBoardFit";

describe("fitMobileBoard（スマートフォンの盤の寸法）", () => {
    it("小さいマスでは、持ち駒 7 種類の駒台の高さを盤の高さとして確保する", () => {
        const fit = fitMobileBoard(320, 500);
        expect(fit.scale).toBe(1);
        // 駒台は 5.6c + 126px、盤は 9c + 44px。マスが 24px 未満では駒台の方が高い。
        expect(fit.boardHeight).toBe(
            Math.max(fit.cellSize * 9 + 44, Math.ceil(fit.cellSize * 5.6 + 126)),
        );
        expect(fit.boardHeight).toBeGreaterThan(fit.cellSize * 9 + 44);
    });

    it("低い画面では、盤を縮める前に下の欄を削る", () => {
        // 下に 150px を残すと下限のマスでも入らないが、削れば縮めずに入る高さ。
        const fit = fitMobileBoard(375, 360);
        expect(fit.scale).toBe(1);
        expect(fit.cellSize).toBeGreaterThanOrEqual(20);
    });

    it("下の欄を削っても入らないときは縮めるが、駒が読めないほどには縮めない", () => {
        const fit = fitMobileBoard(375, 100);
        expect(fit.cellSize).toBe(20);
        expect(fit.scale).toBe(0.6);
        expect(fit.boardHeight).toBeGreaterThan(0);
    });
});
