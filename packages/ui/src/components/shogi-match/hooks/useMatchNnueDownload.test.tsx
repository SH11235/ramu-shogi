import { NnueError, type PresetConfig } from "@shogi/app-core";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { presetDownloadSize, useMatchNnueDownload } from "./useMatchNnueDownload";

const mocks = vi.hoisted(() => ({ getManifest: vi.fn(), download: vi.fn(), refreshList: vi.fn() }));
vi.mock("@shogi/app-core", async () => ({
    ...(await vi.importActual<typeof import("@shogi/app-core")>("@shogi/app-core")),
    downloadPreset: (config: PresetConfig) => mocks.download(config.presetKey),
    createPresetManager: () => ({ getManifest: mocks.getManifest, download: mocks.download }),
}));
vi.mock("../../../providers/NnueContext", () => ({
    useNnueContextOptional: () => ({ storage: {}, refreshList: mocks.refreshList }),
}));
const preset = (key: string): PresetConfig => ({
    presetKey: key,
    displayName: key,
    description: "",
    url: "https://example.com/model",
    size: 1000,
    sha256: "hash",
    license: "MIT",
    releasedAt: "2026-10-11",
    recommendedFvScale: 24,
});
const selection = (key: string) => ({ presetKey: key, nnueId: null });
const missing = () => new NnueError("NNUE_NOT_DOWNLOADED", "missing");

beforeEach(() => {
    vi.clearAllMocks();
    mocks.refreshList.mockResolvedValue(undefined);
    mocks.getManifest.mockResolvedValue({
        presets: [
            preset("COCO"),
            {
                ...preset("RAMU"),
                progressCoefficients: {
                    url: "https://example.com/progress",
                    size: 200,
                    sha256: "coeff",
                },
            },
        ],
    });
});

describe("match download consent", () => {
    it("ignores concurrent start requests without abandoning the first consent", async () => {
        const resolveNnue = vi.fn().mockRejectedValue(missing());
        const { result } = renderHook(() =>
            useMatchNnueDownload({
                manifestUrl: "https://example.com/manifest",
                resolveNnue,
                setMessage: vi.fn(),
            }),
        );
        let pending: Promise<boolean> = Promise.resolve(true);
        let duplicate = true;
        await act(async () => {
            pending = result.current.ensureMatchNnue([selection("RAMU")]);
            duplicate = await result.current.ensureMatchNnue([selection("COCO")]);
        });
        expect(duplicate).toBe(false);
        expect(result.current.presets.map((config) => config.presetKey)).toEqual(["RAMU"]);
        expect(mocks.getManifest).toHaveBeenCalledOnce();
        act(() => result.current.cancel());
        expect(await pending).toBe(false);
    });
    it("does not fetch or ask when selections are already available", async () => {
        const resolveNnue = vi.fn().mockResolvedValue(null);
        const { result } = renderHook(() =>
            useMatchNnueDownload({
                manifestUrl: "https://example.com/manifest",
                resolveNnue,
                setMessage: vi.fn(),
            }),
        );
        let ready = false;
        await act(async () => {
            ready = await result.current.ensureMatchNnue([selection("COCO")]);
        });
        expect(ready).toBe(true);
        expect(mocks.getManifest).not.toHaveBeenCalled();
        expect(mocks.download).not.toHaveBeenCalled();
    });
    it("deduplicates both seats, includes progress size and never downloads before approval", async () => {
        const setMessage = vi.fn();
        const resolveNnue = vi.fn().mockRejectedValue(missing());
        const { result } = renderHook(() =>
            useMatchNnueDownload({
                manifestUrl: "https://example.com/manifest",
                resolveNnue,
                setMessage,
            }),
        );
        let pending: Promise<boolean> = Promise.resolve(true);
        await act(async () => {
            pending = result.current.ensureMatchNnue([selection("RAMU"), selection("RAMU")]);
        });
        expect(result.current.presets).toHaveLength(1);
        expect(presetDownloadSize(result.current.presets[0])).toBe(1200);
        expect(mocks.download).not.toHaveBeenCalled();
        act(() => result.current.cancel());
        expect(await pending).toBe(false);
        expect(setMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: "error" }));
    });
    it("waits for storage and validation before allowing start", async () => {
        let available = false;
        const resolveNnue = vi.fn(async () => {
            if (!available) throw missing();
            return null;
        });
        mocks.download.mockImplementation(async () => {
            available = true;
        });
        const { result } = renderHook(() =>
            useMatchNnueDownload({
                manifestUrl: "https://example.com/manifest",
                resolveNnue,
                setMessage: vi.fn(),
            }),
        );
        let pending: Promise<boolean> = Promise.resolve(false);
        await act(async () => {
            pending = result.current.ensureMatchNnue([selection("COCO")]);
        });
        await act(async () => {
            await result.current.download();
        });
        expect(await pending).toBe(true);
        expect(mocks.download).toHaveBeenCalledWith("COCO");
        expect(mocks.refreshList).toHaveBeenCalledOnce();
        expect(result.current.presets).toHaveLength(0);
    });
    it("keeps consent pending after failure and retries without redownloading successful files", async () => {
        const available = new Set<string>();
        const resolveNnue = vi.fn(async (value: { presetKey: string | null }) => {
            if (!available.has(value.presetKey ?? "")) throw missing();
            return null;
        });
        let failRamu = true;
        mocks.download.mockImplementation(async (key: string) => {
            if (key === "RAMU" && failRamu) throw new Error("network failed");
            available.add(key);
        });
        const { result } = renderHook(() =>
            useMatchNnueDownload({
                manifestUrl: "https://example.com/manifest",
                resolveNnue,
                setMessage: vi.fn(),
            }),
        );
        let pending: Promise<boolean> = Promise.resolve(false);
        let resolved = false;
        await act(async () => {
            pending = result.current.ensureMatchNnue([selection("COCO"), selection("RAMU")]);
            void pending.then(() => {
                resolved = true;
            });
        });
        await act(async () => {
            await result.current.download();
        });
        expect(resolved).toBe(false);
        expect(result.current.error).toBe("network failed");
        failRamu = false;
        await act(async () => {
            await result.current.download();
        });
        expect(await pending).toBe(true);
        expect(mocks.download.mock.calls.map(([key]) => key)).toEqual(["COCO", "RAMU", "RAMU"]);
    });
    it("does not mistake a damaged or custom model for a missing downloadable preset", async () => {
        const resolveNnue = vi
            .fn()
            .mockRejectedValue(new NnueError("NNUE_RESOLVE_FAILED", "invalid model"));
        const setMessage = vi.fn();
        const { result } = renderHook(() =>
            useMatchNnueDownload({
                manifestUrl: "https://example.com/manifest",
                resolveNnue,
                setMessage,
            }),
        );
        let ready = true;
        await act(async () => {
            ready = await result.current.ensureMatchNnue([selection("COCO")]);
        });
        expect(ready).toBe(false);
        expect(mocks.download).not.toHaveBeenCalled();
        expect(setMessage).toHaveBeenLastCalledWith({ text: "invalid model", type: "error" });
    });
});
