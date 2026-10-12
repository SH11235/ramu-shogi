import { describe, expect, it } from "vitest";
import { buildPassRightsOptionForLegalMoves } from "./passRightsSettings";

const disabled = { enabled: false, senteInitialCount: 2, goteInitialCount: 2 };

describe("buildPassRightsOptionForLegalMoves", () => {
    it("設定が有効なら、設定の初期値を渡す", () => {
        expect(
            buildPassRightsOptionForLegalMoves(
                { enabled: true, senteInitialCount: 3, goteInitialCount: 1 },
                ["7g7f"],
            ),
        ).toEqual({ passRights: { sente: 3, gote: 1 } });
    });

    it("設定が無効でパスも無ければ、何も渡さない", () => {
        expect(buildPassRightsOptionForLegalMoves(disabled, ["7g7f", "3c3d"])).toEqual({});
    });

    it("設定が無効で棋譜にパスがあれば、各側が使った回数 + 1 を渡す", () => {
        expect(buildPassRightsOptionForLegalMoves(disabled, ["pass", "3c3d", "PASS"])).toEqual({
            passRights: { sente: 3, gote: 1 },
        });
    });

    it("後手番から始まる局面では、最初の手を後手の手として数える", () => {
        const sfen = "4k4/9/9/9/9/9/9/9/4K4 w - 1";
        for (const startSfen of [sfen, `sfen ${sfen}`]) {
            expect(
                buildPassRightsOptionForLegalMoves(disabled, ["pass", "5i5h", "pass"], startSfen),
            ).toEqual({ passRights: { sente: 1, gote: 3 } });
        }
    });
});
