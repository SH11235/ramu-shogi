import { describe, expect, it } from "vitest";
import { describeEval } from "./PlayHintCard";

describe("describeEval（ヒントの評価値を、手番の人から見た言葉にする）", () => {
    it("評価値は先手から見た値なので、後手番では符号を返して読む", () => {
        expect(describeEval({ evalCp: 800 }, "sente")).toEqual({ text: "有利", tone: "good" });
        expect(describeEval({ evalCp: 800 }, "gote")).toEqual({ text: "不利", tone: "bad" });
        expect(describeEval({ evalCp: -800 }, "gote")).toEqual({ text: "有利", tone: "good" });
    });

    it("小さな差は互角とする", () => {
        expect(describeEval({ evalCp: 149 }, "sente").text).toBe("互角");
        expect(describeEval({ evalCp: -149 }, "sente").text).toBe("互角");
    });

    it("差の大きさで言葉を変える", () => {
        expect(describeEval({ evalCp: 300 }, "sente").text).toBe("やや有利");
        expect(describeEval({ evalCp: -300 }, "sente").text).toBe("やや不利");
        expect(describeEval({ evalCp: 1500 }, "sente").text).toBe("優勢");
        expect(describeEval({ evalCp: -1500 }, "sente").text).toBe("劣勢");
        expect(describeEval({ evalCp: 3000 }, "sente").text).toBe("勝勢");
        expect(describeEval({ evalCp: -3000 }, "sente").text).toBe("敗勢");
    });

    it("詰みは評価値より優先して、どちらの詰みかを書く", () => {
        expect(describeEval({ evalMate: 5, evalCp: 100 }, "sente")).toEqual({
            text: "詰みがあります",
            tone: "good",
        });
        expect(describeEval({ evalMate: 5 }, "gote")).toEqual({
            text: "詰まされそうです",
            tone: "bad",
        });
    });

    it("評価値が無ければ何も書かない", () => {
        expect(describeEval({}, "sente").text).toBe("");
    });
});
