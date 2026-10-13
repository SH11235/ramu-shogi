import { describe, expect, it } from "vitest";
import { describeTimeRule } from "./PlayPlayerBar";

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
    });
});
