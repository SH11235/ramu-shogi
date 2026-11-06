import { describe, expect, it } from "vitest";
import { parseStudySfen } from "../study/sfen";
import { parseKifPv } from "./kif-pv";

describe("parseKifPv", () => {
    // 銀が 6八・5八・4八 の 3 枚。どれも 5七 へ動ける。
    const state = parseStudySfen("4k4/9/9/9/9/9/9/3SSS3/4K4 b - 1");

    it("同じ駒が複数動けるときは、右・左・直で移動元を決める", () => {
        expect(parseKifPv(state, "▲５七銀直", null)).toEqual(["5h5g"]);
        expect(parseKifPv(state, "▲５七銀右", null)).toEqual(["4h5g"]);
        expect(parseKifPv(state, "▲５七銀左", null)).toEqual(["6h5g"]);
    });

    it("移動元が決まらない手・指せない手の手前で打ち切る", () => {
        expect(parseKifPv(state, "▲５七銀", null)).toEqual([]);
        expect(parseKifPv(state, "▲５七銀直△５二玉(51)▲１一銀", null)).toEqual(["5h5g", "5a5b"]);
    });

    it("後手の右・左は後手から見た向きで決める", () => {
        // 後手の金が 6一・4一 にあり、どちらも 5二 へ動ける。後手から見て右は 6一。
        const gote = parseStudySfen("4k4/9/9/9/9/9/9/9/4K4 w - 1");
        const golds = parseStudySfen("3g1g3/4k4/9/9/9/9/9/9/4K4 w - 1");
        expect(parseKifPv(gote, "△５二玉", null)).toEqual(["5a5b"]);
        expect(parseKifPv(golds, "△５一金右", null)).toEqual(["6a5a"]);
        expect(
            parseKifPv(parseStudySfen("3g1g3/9/4k4/9/9/9/9/9/4K4 w - 1"), "△５二金右", null),
        ).toEqual(["6a5b"]);
        expect(
            parseKifPv(parseStudySfen("3g1g3/9/4k4/9/9/9/9/9/4K4 w - 1"), "△５二金左", null),
        ).toEqual(["4a5b"]);
    });

    it("同じ筋の 2 枚は、右・左だけでは決めない", () => {
        const twoOnFile = parseStudySfen("k8/9/9/5S3/9/5S3/9/9/K8 b - 1");
        expect(parseKifPv(twoOnFile, "▲５五銀右", null)).toEqual([]);
        expect(parseKifPv(twoOnFile, "▲５五銀上", null)).toEqual(["4f5e"]);
    });

    it("移動元付きの表記と「同」を読む", () => {
        expect(parseKifPv(state, "▲５七銀(48)△５二玉(51)", null)).toEqual(["4h5g", "5a5b"]);
        const capture = parseStudySfen("4k4/9/9/9/4p4/9/9/4R4/4K4 b - 1");
        expect(parseKifPv(capture, "▲同　飛", "5e")).toEqual(["5h5e"]);
    });
});
