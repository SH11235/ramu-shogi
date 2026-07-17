import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveRshogiApiBaseUrl } from "./rshogiApiBaseUrl";

describe("resolveRshogiApiBaseUrl", () => {
    afterEach(() => vi.unstubAllEnvs());

    it("前後の空白を除いて API URL を返す", () => {
        vi.stubEnv("VITE_RSHOGI_API_BASE", "  https://rshogi.example.test/api/v1/  ");
        expect(resolveRshogiApiBaseUrl()).toBe("https://rshogi.example.test/api/v1/");
    });

    it("空文字は未設定として扱う", () => {
        vi.stubEnv("VITE_RSHOGI_API_BASE", "   ");
        expect(resolveRshogiApiBaseUrl()).toBeUndefined();
    });
});
