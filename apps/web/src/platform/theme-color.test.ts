import { afterEach, describe, expect, it } from "vitest";
import { applyThemeColor } from "./theme-color";

afterEach(() => {
    document.head.querySelector('meta[name="theme-color"]')?.remove();
    document.documentElement.style.removeProperty("--wafuu-washi-warm");
});

describe("applyThemeColor", () => {
    it("ヘッダーの背景のトークンから、アドレスバーの色を作る", () => {
        document.documentElement.style.setProperty("--wafuu-washi-warm", "35 45% 92%");
        applyThemeColor();
        expect(
            document.head.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content,
        ).toBe("hsl(35 45% 92%)");
    });

    it("トークンが読めなければ何もしない", () => {
        applyThemeColor();
        expect(document.head.querySelector('meta[name="theme-color"]')).toBeNull();
    });
});
