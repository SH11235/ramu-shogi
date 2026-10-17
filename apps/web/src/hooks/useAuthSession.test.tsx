import { RATE_LIMITED_MESSAGE } from "@shogi/api-contract";
import { describe, expect, it } from "vitest";
import { parseApiError } from "./useAuthSession";

describe("parseApiError", () => {
    it("429 は本文の英語の message ではなく日本語の文言を返す", async () => {
        const response = Response.json(
            { error: "RATE_LIMITED", message: "Too many requests. Please try again later." },
            { status: 429 },
        );
        expect(await parseApiError(response)).toBe(RATE_LIMITED_MESSAGE);
    });

    it("zone のレート制限で本文が HTML の 429 でも日本語の文言を返す", async () => {
        const response = new Response("<!DOCTYPE html><title>Error 1015</title>", {
            status: 429,
            headers: { "Content-Type": "text/html" },
        });
        expect(await parseApiError(response)).toBe(RATE_LIMITED_MESSAGE);
    });

    it("429 以外は本文の message を返す", async () => {
        const response = Response.json(
            { error: "INVALID_REQUEST", message: "表示名が長すぎます" },
            { status: 400 },
        );
        expect(await parseApiError(response)).toBe("表示名が長すぎます");
    });
});
