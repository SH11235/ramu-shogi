import { describe, expect, it } from "vitest";
import { candidateArrowOption, withCandidateArrowOption } from "./displaySettingsFields";
import { DEFAULT_DISPLAY_SETTINGS } from "./types";

describe("矢印の表示数", () => {
    it("「なし」はスイッチを切るだけにし、数は残す", () => {
        const one = withCandidateArrowOption(DEFAULT_DISPLAY_SETTINGS, "1");
        expect(candidateArrowOption(one)).toBe("1");
        const off = withCandidateArrowOption(one, "0");
        expect(candidateArrowOption(off)).toBe("0");
        expect(off.candidateArrowCount).toBe(1);
        // 研究ノートのスイッチで入れ直すと、前の数に戻る。
        expect(candidateArrowOption({ ...off, showCandidateArrows: true })).toBe("1");
    });

    it("既定は 2 つ", () => {
        expect(candidateArrowOption(DEFAULT_DISPLAY_SETTINGS)).toBe("2");
    });
});
