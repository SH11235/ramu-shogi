import { renderHook, waitFor } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRshogiLiveGameList } from "./useRshogiLiveGameList";

const mockFetchRshogiLiveGameList = vi.fn();

vi.mock("@shogi/match-client", () => ({
    fetchRshogiLiveGameList: (
        ...args: Parameters<typeof mockFetchRshogiLiveGameList>
    ): ReturnType<typeof mockFetchRshogiLiveGameList> => mockFetchRshogiLiveGameList(...args),
}));

const game = (gameId: string) => ({
    gameId,
    senteName: "sente",
    goteName: "gote",
});

afterEach(() => {
    mockFetchRshogiLiveGameList.mockReset();
});

describe("useRshogiLiveGameList", () => {
    it("マウント時に先頭ページを取得して games に反映する", async () => {
        mockFetchRshogiLiveGameList.mockResolvedValueOnce({
            liveGames: [game("g1"), game("g2")],
            nextCursor: "2",
        });
        const { result, unmount } = renderHook(() => useRshogiLiveGameList("https://example.com"));

        await waitFor(() => expect(result.current.isLoading).toBe(false));
        expect(result.current.games.map((g) => g.gameId)).toEqual(["g1", "g2"]);
        expect(result.current.hasMore).toBe(true);
        expect(result.current.errorMessage).toBeNull();
        unmount();
    });

    it("loadMore で次ページを末尾に追記し、末尾ページで hasMore が false になる", async () => {
        mockFetchRshogiLiveGameList
            .mockResolvedValueOnce({ liveGames: [game("g1")], nextCursor: "1" })
            .mockResolvedValueOnce({ liveGames: [game("g2")], nextCursor: undefined });
        const { result, unmount } = renderHook(() => useRshogiLiveGameList("https://example.com"));
        await waitFor(() => expect(result.current.isLoading).toBe(false));

        await act(async () => {
            await result.current.loadMore();
        });
        expect(result.current.games.map((g) => g.gameId)).toEqual(["g1", "g2"]);
        expect(result.current.hasMore).toBe(false);
        // 2 回目の fetch には cursor が渡っている。
        expect(mockFetchRshogiLiveGameList).toHaveBeenLastCalledWith(
            expect.objectContaining({ cursor: "1" }),
        );
        unmount();
    });

    it("取得エラーで errorMessage が入る", async () => {
        mockFetchRshogiLiveGameList.mockRejectedValueOnce(new Error("boom"));
        const { result, unmount } = renderHook(() => useRshogiLiveGameList("https://example.com"));

        await waitFor(() => expect(result.current.errorMessage).toBe("boom"));
        expect(result.current.isLoading).toBe(false);
        unmount();
    });

    it("refresh で先頭ページを取り直す", async () => {
        mockFetchRshogiLiveGameList
            .mockResolvedValueOnce({ liveGames: [game("g1")], nextCursor: undefined })
            .mockResolvedValueOnce({ liveGames: [game("g9")], nextCursor: undefined });
        const { result, unmount } = renderHook(() => useRshogiLiveGameList("https://example.com"));
        await waitFor(() => expect(result.current.games).toHaveLength(1));

        act(() => {
            result.current.refresh();
        });
        await waitFor(() => expect(result.current.games.map((g) => g.gameId)).toEqual(["g9"]));
        expect(mockFetchRshogiLiveGameList).toHaveBeenCalledTimes(2);
        unmount();
    });

    it("アンマウント後に解決した loadMore は state を更新しない (abort ガード)", async () => {
        mockFetchRshogiLiveGameList.mockResolvedValueOnce({
            liveGames: [game("g1")],
            nextCursor: "1",
        });
        const { result, unmount } = renderHook(() => useRshogiLiveGameList("https://example.com"));
        await waitFor(() => expect(result.current.isLoading).toBe(false));

        // 解決を保留したまま loadMore を発火し、途中でアンマウントする。
        let resolveLoadMore: (v: unknown) => void = () => {};
        mockFetchRshogiLiveGameList.mockImplementationOnce(
            (options: { signal?: AbortSignal }) =>
                new Promise((resolve, reject) => {
                    resolveLoadMore = resolve;
                    options.signal?.addEventListener("abort", () =>
                        reject(new DOMException("aborted", "AbortError")),
                    );
                }),
        );
        let pending: Promise<void> = Promise.resolve();
        act(() => {
            pending = result.current.loadMore();
        });
        unmount();
        // アンマウントで abort 済み。解決/拒否どちらが先でも throw せず完了する。
        resolveLoadMore({ liveGames: [game("g2")], nextCursor: undefined });
        await act(async () => {
            await pending;
        });
    });
});
