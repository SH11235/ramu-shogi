import { describe, expect, it } from "vitest";
import { createInitialPositionState } from "../game/board";
import { parseStudySfen } from "../study/sfen";
import {
    findBookBranchesAsync,
    normalizeBookKey,
    parseBook,
    parseBookExplore,
    positionToBookKey,
    serializeBookExplore,
} from "./book";

const initial = positionToBookKey(createInitialPositionState());
const sparse = "4k4/9/9/4+p4/9/4+R4/9/9/4K4 w";
describe("book", () => {
    it("分かれ目を手番ごとに走査し、中止を反映する", async () => {
        const book = parseBook(`sfen ${initial}\n7g7f\n2g2f\nsfen ${sparse} -\n5a4a\n5a6a`);
        expect(await findBookBranchesAsync(book)).toEqual({
            sente: [initial],
            gote: [`${sparse} -`],
        });
        await expect(findBookBranchesAsync(book, () => true)).rejects.toThrow("中止");
    });
    it("手がない局面と全手が不正な局面は警告して統計から除外する", () => {
        const result = parseBook(`sfen ${initial}\nsfen ${sparse} -\ninvalid`);
        expect(result.positions.size).toBe(0);
        expect(result.stats).toEqual({ positions: 0, moves: 0, sente: 0, gote: 0, branches: 0 });
        expect(
            result.warnings.filter((warning) => warning.message.includes("手のない局面")),
        ).toHaveLength(2);
    });
    it("BOM、タブと追加列を受け入れる", () => {
        const result = parseBook(`\uFEFFsfen\t${initial}\t1\n7g7f\tnone\t12\t3\t4\textra\tdata`);
        expect(result.warnings).toEqual([]);
        expect(result.positions.get(initial)).toEqual([
            { usi: "7g7f", value: 12, depth: 3, count: 4 },
        ]);
    });
    it("負の深さ・採択数は警告して 0 にする", () => {
        const result = parseBook(`sfen ${initial}\n7g7f none -12 -3 4\n2g2f none 1 2 -5`);
        expect(result.warnings.map((warning) => warning.line)).toEqual([2, 3]);
        expect(result.positions.get(initial)).toEqual([
            { usi: "7g7f", value: -12, depth: 0, count: 4 },
            { usi: "2g2f", value: 1, depth: 2, count: 0 },
        ]);
    });
    it("プリセットで持ち駒あり・手数なしを受け入れ、手なしは警告する", () => {
        const key = `${sparse.replace(" w", " b")} 2P`;
        const result = parseBookExplore(`sfen ${key} P*5e\nsfen ${initial} 1`);
        expect(result.positions.get(key)).toEqual(["P*5e"]);
        expect(result.positions.size).toBe(1);
        expect(result.warnings.map((warning) => warning.line)).toEqual([2]);
    });
    it("CRLF、コメント、欠けた列、重複局面を処理する", () => {
        const result = parseBook(
            `#YANEURAOU-DB2016 1.00\r\n\r\n sfen ${initial} 0\r\n2g2f none 100 3 2\r\n7g7f\r\n// comment\r\nsfen ${initial} 99\r\n2g2f none -50\r\n`,
        );
        expect(result.warnings).toEqual([]);
        expect(result.positions.get(initial)).toEqual([
            { usi: "2g2f", value: -50, depth: 0, count: 0 },
            { usi: "7g7f", value: 0, depth: 0, count: 0 },
        ]);
        expect(result.stats).toEqual({ positions: 1, moves: 2, sente: 1, gote: 0, branches: 1 });
    });
    it("持ち駒の順序を正規化し、成り駒と持ち駒を往復する", () => {
        const key = `${sparse} RB2Pr3p`;
        expect(normalizeBookKey(`${sparse} pB2PRr2p 0`)).toBe(key);
        expect(positionToBookKey(parseStudySfen(`${key} 12`))).toBe(key);
        const result = parseBook(`sfen ${key}\nP*5e\nsfen ${sparse} pB2PRr2p\n5a4a none 1 2 3`);
        expect(result.stats).toEqual({ positions: 1, moves: 2, sente: 0, gote: 1, branches: 1 });
    });
    it("不正な行を行番号つきで警告し、不正な局面に続く手を前の局面へ混ぜない", () => {
        const result = parseBook(
            `2g2f\nsfen ${initial}\ninvalid\n2g2f none abc\nsfen broken\n7g7f\nsfen ${initial}\n7g7f none 1 0 2`,
        );
        expect(result.warnings.map((w) => w.line)).toEqual([1, 3, 4, 5, 6]);
        expect(result.positions.get(initial)?.map((m) => m.usi)).toEqual(["7g7f"]);
    });
    it.each([
        `${sparse} 0P`,
        `${sparse} 2`,
        `${sparse} - nope`,
        "9/9/9 b -",
        "4+k4/9/9/9/9/9/9/9/4K4 b -",
        "4+G4/9/9/9/9/9/9/9/4K4 b -",
        "4x4/9/9/9/9/9/9/9/4K4 b -",
        "8/9/9/9/9/9/9/9/4K4 b -",
        "91/9/9/9/9/9/9/9/4K4 b -",
        "8+/9/9/9/9/9/9/9/4K4 b -",
        `${sparse.replace(" w", " x")} -`,
        `${sparse} 01P`,
        `${sparse} 9007199254740991PP`,
    ])("不正なキーを拒否: %s", (key) => {
        expect(() => normalizeBookKey(key)).toThrow();
    });
    it("プリセットの手数省略、後勝ち、重複除去、警告とシリアライズ", () => {
        const result = parseBookExplore(
            ` # comment\r\nsfen ${initial} 1 2g2f\r\nsfen ${initial} 7g7f 7g7f 2g2f\r\nbad\r\nsfen ${sparse} pB2PRr2p 0 P*5e`,
        );
        expect(result.warnings.map((w) => w.line)).toEqual([4]);
        expect(result.positions.get(initial)).toEqual(["7g7f", "2g2f"]);
        expect(parseBookExplore(serializeBookExplore(result.positions)).positions).toEqual(
            result.positions,
        );
        expect(serializeBookExplore(new Map())).toBe("");
    });
});

it("盤面の連続した空きマス数字を警告し、警告を行番号順に返す", () => {
    const book = parseBook("sfen 9/9/9/9/9/9/9/9/9 b -\nsfen 45/9/9/9/9/9/9/9/9 b -\nbad");
    expect(book.positions.size).toBe(0);
    expect(book.warnings.map((warning) => warning.line)).toEqual([1, 2, 3]);
    expect(book.warnings[1].message).toContain("連続");
});
