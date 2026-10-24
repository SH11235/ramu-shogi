import { describe, expect, it } from "vitest";
import { findStartPosition, isHirateStart, startPositionLabel } from "./startPositions";

describe("startPositionLabel", () => {
    it("names 平手 and the handicap starts, and calls an edited position カスタム", () => {
        expect(startPositionLabel("startpos")).toBe("平手");
        expect(
            startPositionLabel(
                "sfen lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1",
            ),
        ).toBe("平手");
        expect(
            startPositionLabel("lnsgkgsnl/1r7/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1"),
        ).toBe("角落ち");
        expect(startPositionLabel("4k4/9/9/9/9/9/9/9/4K4 b G 1")).toBe("カスタム");
        // 平手の盤でも、手数が 1 でなければ平手の開始としない（USI で startpos にすると手数が失われる）。
        expect(
            startPositionLabel("lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 10"),
        ).toBe("カスタム");
    });
});

describe("findStartPosition", () => {
    it("matches a handicap start only when the whole SFEN is the same", () => {
        const bishop = "lnsgkgsnl/1r7/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1";
        expect(findStartPosition(bishop)?.id).toBe("bishop");
        expect(findStartPosition(`sfen  ${bishop}`)?.id).toBe("bishop");
        // 部分一致で比べると「w - 1」が「w - 12」にも当たる。
        expect(findStartPosition(bishop.replace(/ 1$/, " 12"))).toBeUndefined();
    });
});

describe("isHirateStart", () => {
    it("treats a 平手 board with a move number other than 1 as not the 平手 start", () => {
        expect(isHirateStart("startpos")).toBe(true);
        expect(
            isHirateStart("lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1"),
        ).toBe(true);
        expect(
            isHirateStart("lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 12"),
        ).toBe(false);
    });
});
