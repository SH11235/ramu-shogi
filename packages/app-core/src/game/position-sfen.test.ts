import { describe, expect, it } from "vitest";
import { parseStudySfen } from "../study/sfen";
import { positionToSfen } from "./position-sfen";

describe("positionToSfen", () => {
    it.each([
        "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1",
        "1pG1B4/Gs+P6/pP7/n1ls5/3k5/nL4+r1b/1+p1p+R4/1S7/2N5K b SP2gn2l11p 1",
        "4k4/9/4P4/9/9/9/9/9/4K4 w G 1",
    ])("SFEN を読んで書き戻すと元に戻る: %s", (sfen) => {
        expect(positionToSfen(parseStudySfen(sfen))).toBe(sfen);
    });
});
