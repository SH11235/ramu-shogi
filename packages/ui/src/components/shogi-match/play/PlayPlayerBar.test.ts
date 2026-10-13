import { describe, expect, it } from "vitest";
import { describeRemaining, describeTimeRule } from "./PlayPlayerBar";

describe("describeTimeRule", () => {
    it("持ち時間が分ちょうどなら「分＋1手◯秒」", () => {
        expect(describeTimeRule(600_000, 30_000)).toBe("10分＋1手30秒");
    });

    it("1 分に満たない持ち時間は秒で書く（0分にしない）", () => {
        expect(describeTimeRule(20_000, 5_000)).toBe("20秒＋1手5秒");
    });

    it("分と秒が混ざる持ち時間", () => {
        expect(describeTimeRule(90_000, 5_000)).toBe("1分30秒＋1手5秒");
    });

    it("持ち時間なしは 1 手の秒数だけ", () => {
        expect(describeTimeRule(0, 10_000)).toBe("1手10秒");
    });

    it("秒読みなしは持ち時間だけ", () => {
        expect(describeTimeRule(300_000, 0)).toBe("5分");
        expect(describeTimeRule(20_000, 0)).toBe("20秒");
    });

    it("1 分の境目（秒は切り上げ）", () => {
        expect(describeTimeRule(59_001, 0)).toBe("1分");
        expect(describeTimeRule(60_000, 0)).toBe("1分");
        expect(describeTimeRule(60_001, 0)).toBe("1分1秒");
    });

    it("どちらも 0 なら「1手0秒」", () => {
        expect(describeTimeRule(0, 0)).toBe("1手0秒");
    });
});

describe("describeRemaining", () => {
    it("1 分以上は分:秒", () => {
        expect(describeRemaining(572_000, 30_000)).toBe("残り 09:32");
        expect(describeRemaining(60_000, 30_000)).toBe("残り 01:00");
    });

    it("1 分の境目で表示が止まらない（切り上げに揃える）", () => {
        expect(describeRemaining(60_500, 0)).toBe("残り 01:01");
        expect(describeRemaining(59_500, 0)).toBe("残り 01:00");
        expect(describeRemaining(59_000, 0)).toBe("残り 59秒");
    });

    it("1 分を切ったら秒", () => {
        expect(describeRemaining(17_200, 30_000)).toBe("残り 18秒");
    });

    it("持ち時間が尽きたら秒読みの残り", () => {
        expect(describeRemaining(0, 4_100)).toBe("残り 5秒");
        expect(describeRemaining(0, 0)).toBe("残り 0秒");
    });
});
