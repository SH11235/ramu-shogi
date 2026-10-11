import { describe, expect, it } from "vitest";
import { formatElapsedTime, formatTime } from "./timeFormat";

describe("formatTime", () => {
    it("MM:SS で表し、負の値は 0 として扱う", () => {
        expect(formatTime(125_000)).toBe("02:05");
        expect(formatTime(5_000)).toBe("00:05");
        expect(formatTime(-1_000)).toBe("00:00");
    });
});

describe("formatElapsedTime", () => {
    it("秒・分秒で表す", () => {
        expect(formatElapsedTime(0)).toBe("0秒");
        expect(formatElapsedTime(3_000)).toBe("3秒");
        expect(formatElapsedTime(65_000)).toBe("1分5秒");
        expect(formatElapsedTime(120_000)).toBe("2分0秒");
    });

    it("10 秒未満で端数があれば小数 1 桁まで出す", () => {
        expect(formatElapsedTime(300)).toBe("0.3秒");
        expect(formatElapsedTime(1_250)).toBe("1.2秒");
        expect(formatElapsedTime(12_400)).toBe("12秒");
    });

    it("負の値は 0 秒として扱う", () => {
        expect(formatElapsedTime(-500)).toBe("0秒");
    });
});
