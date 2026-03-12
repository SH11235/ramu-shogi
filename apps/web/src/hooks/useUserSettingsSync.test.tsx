import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LOCAL_STORAGE_SYNC_EVENT } from "@shogi/ui";
import { useUserSettingsSync } from "./useUserSettingsSync";

const mockUseAuthSession = vi.fn();
const mockParseApiError = vi.fn();
const mockFetch = vi.fn();

vi.mock("./useAuthSession", () => ({
    useAuthSession: () => mockUseAuthSession(),
    parseApiError: (...args: Parameters<typeof mockParseApiError>) => mockParseApiError(...args),
}));

describe("useUserSettingsSync", () => {
    beforeEach(() => {
        vi.stubGlobal("fetch", mockFetch);
        mockUseAuthSession.mockReturnValue({
            session: {
                authenticated: true,
                user: {
                    id: "user-1",
                },
            },
            isLoadingSession: false,
        });
        mockParseApiError.mockResolvedValue("api error");
        localStorage.clear();
        mockFetch.mockReset();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("初期同期済みの値に対する no-op PUT を抑止する", async () => {
        const settingsValue = { limitMs: 600000 };
        localStorage.setItem("shogi-match-time-settings", JSON.stringify(settingsValue));

        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: () =>
                Promise.resolve({
                    documents: [
                        {
                            documentKey: "match.time-settings",
                            value: settingsValue,
                        },
                    ],
                }),
        });

        renderHook(() => useUserSettingsSync());

        await waitFor(() => {
            expect(mockFetch).toHaveBeenCalledTimes(1);
        });

        window.dispatchEvent(
            new CustomEvent(LOCAL_STORAGE_SYNC_EVENT, {
                detail: { key: "shogi-match-time-settings" },
            }),
        );

        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("値が変わった時だけ PUT し、同じ値の再送を抑止する", async () => {
        const initialValue = { theme: "system" };
        const updatedValue = { theme: "light" };
        localStorage.setItem("shogi-display-settings", JSON.stringify(initialValue));

        mockFetch
            .mockResolvedValueOnce({
                ok: true,
                json: () =>
                    Promise.resolve({
                        documents: [
                            {
                                documentKey: "match.display-settings",
                                value: initialValue,
                            },
                        ],
                    }),
            })
            .mockResolvedValue({
                ok: true,
            });

        renderHook(() => useUserSettingsSync());

        await waitFor(() => {
            expect(mockFetch).toHaveBeenCalledTimes(1);
        });

        localStorage.setItem("shogi-display-settings", JSON.stringify(updatedValue));
        window.dispatchEvent(
            new CustomEvent(LOCAL_STORAGE_SYNC_EVENT, {
                detail: { key: "shogi-display-settings" },
            }),
        );

        await waitFor(() => {
            expect(mockFetch).toHaveBeenCalledTimes(2);
        });

        expect(mockFetch).toHaveBeenLastCalledWith("/api/user/settings/match.display-settings", {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
            },
            credentials: "same-origin",
            body: JSON.stringify({ value: updatedValue }),
        });

        window.dispatchEvent(
            new CustomEvent(LOCAL_STORAGE_SYNC_EVENT, {
                detail: { key: "shogi-display-settings" },
            }),
        );

        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(mockFetch).toHaveBeenCalledTimes(2);
    });
});
