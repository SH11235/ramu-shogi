import type { NnueMeta } from "@shogi/app-core";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRemotePrivateNnueManager } from "./useRemotePrivateNnueManager";

const mockUseAuthSession = vi.fn();
const mockParseApiError = vi.fn();
const mockUseNnueStorage = vi.fn();
const mockFetch = vi.fn();

vi.mock("./useAuthSession", () => ({
    useAuthSession: () => mockUseAuthSession(),
    parseApiError: (...args: Parameters<typeof mockParseApiError>) => mockParseApiError(...args),
}));

vi.mock("@shogi/ui", async () => {
    const actual = await vi.importActual<typeof import("@shogi/ui")>("@shogi/ui");
    return {
        ...actual,
        useNnueStorage: () => mockUseNnueStorage(),
    };
});

const createLocalMeta = (overrides: Partial<NnueMeta> = {}): NnueMeta => ({
    id: "local-nnue-1",
    displayName: "Local NNUE",
    originalFileName: "local.bin",
    size: 1024,
    contentHashSha256: "hash-1",
    source: "user-uploaded",
    createdAt: Date.now(),
    verified: false,
    ...overrides,
});

describe("useRemotePrivateNnueManager", () => {
    beforeEach(() => {
        vi.stubGlobal("fetch", mockFetch);
        mockFetch.mockReset();
        mockParseApiError.mockResolvedValue("api error");
        mockUseAuthSession.mockReturnValue({
            session: {
                authenticated: true,
                user: { id: "user-1" },
            },
            isLoadingSession: false,
        });
        mockUseNnueStorage.mockReturnValue({
            nnueList: [],
            importFromBlob: vi.fn(),
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("completed な remote private NNUE だけを一覧化し、local hash と結合する", async () => {
        const localMeta = createLocalMeta();
        mockUseNnueStorage.mockReturnValue({
            nnueList: [localMeta],
            importFromBlob: vi.fn(),
        });
        mockFetch.mockResolvedValue({
            ok: true,
            json: () =>
                Promise.resolve({
                    files: [
                        {
                            id: "file-1",
                            originalFilename: "suisho5.bin",
                            sizeBytes: 123,
                            sha256Hex: "hash-1",
                            uploadStatus: "completed",
                            createdAt: "2026-03-13T00:00:00.000Z",
                            completedAt: "2026-03-13T01:00:00.000Z",
                        },
                        {
                            id: "file-2",
                            originalFilename: "pending.bin",
                            sizeBytes: 456,
                            sha256Hex: "hash-2",
                            uploadStatus: "pending",
                            createdAt: "2026-03-13T00:00:00.000Z",
                            completedAt: null,
                        },
                    ],
                }),
        });

        const { result } = renderHook(() => useRemotePrivateNnueManager());

        await waitFor(() => {
            expect(result.current.files).toHaveLength(1);
        });

        expect(result.current.files[0]).toMatchObject({
            id: "file-1",
            originalFilename: "suisho5.bin",
            sha256Hex: "hash-1",
        });
        expect(result.current.files[0].importedMeta?.id).toBe(localMeta.id);
    });

    it("importFile で remote blob を download して local import に渡す", async () => {
        const importFromBlob = vi.fn().mockResolvedValue(createLocalMeta({ id: "imported-1" }));
        mockUseNnueStorage.mockReturnValue({
            nnueList: [],
            importFromBlob,
        });
        mockFetch
            .mockResolvedValueOnce({
                ok: true,
                json: () =>
                    Promise.resolve({
                        files: [
                            {
                                id: "file-1",
                                originalFilename: "suisho5.bin",
                                sizeBytes: 123,
                                sha256Hex: "hash-1",
                                uploadStatus: "completed",
                                createdAt: "2026-03-13T00:00:00.000Z",
                                completedAt: "2026-03-13T01:00:00.000Z",
                            },
                        ],
                    }),
            })
            .mockResolvedValueOnce({
                ok: true,
                blob: () => Promise.resolve(new Blob(["nnue"])),
            });

        const { result } = renderHook(() => useRemotePrivateNnueManager());

        await waitFor(() => {
            expect(result.current.files).toHaveLength(1);
        });

        await act(async () => {
            await result.current.importFile(result.current.files[0], 24, "水匠5");
        });

        expect(mockFetch).toHaveBeenNthCalledWith(2, "/api/nnue/files/file-1", {
            credentials: "same-origin",
        });
        expect(importFromBlob).toHaveBeenCalledWith(expect.any(Blob), "suisho5.bin", 24, "水匠5");
    });
});
