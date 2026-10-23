import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAccountNnue } from "./useAccountNnue";

vi.mock("./useAuthSession", () => ({
    useAuthSession: () => ({ session: { authenticated: true }, isLoadingSession: false }),
    parseApiError: async () => "error",
}));

const summary = (id: string, uploadStatus: "completed" | "pending") => ({
    id,
    originalFilename: `${id}.bin`,
    sizeBytes: 1,
    sha256Hex: id,
    uploadStatus,
    createdAt: "2026-01-01T00:00:00Z",
    completedAt: null,
});

const listResponse = (files: ReturnType<typeof summary>[]) =>
    new Response(JSON.stringify({ files }), { status: 200 });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe("useAccountNnue", () => {
    it("途中のアップロードがある間の取り直しは、あとから削除した行を戻さない", async () => {
        fetchMock.mockResolvedValueOnce(
            listResponse([summary("pending", "pending"), summary("done", "completed")]),
        );
        const { result } = renderHook(() => useAccountNnue());
        await waitFor(() => expect(result.current.files).toHaveLength(2));

        // 定期の取り直しの応答を遅らせ、その間に削除する。
        let resolveSlowList: (response: Response) => void = () => {};
        fetchMock.mockImplementationOnce(
            () =>
                new Promise<Response>((resolve) => {
                    resolveSlowList = resolve;
                }),
        );
        await act(async () => {
            vi.advanceTimersByTime(30_000);
        });
        fetchMock.mockResolvedValueOnce(new Response("{}", { status: 200 }));
        await act(async () => {
            await result.current.remove("done");
        });
        await act(async () => {
            resolveSlowList(listResponse([summary("done", "completed")]));
        });

        expect(result.current.files.map((file) => file.id)).toEqual(["pending"]);
    });
});
