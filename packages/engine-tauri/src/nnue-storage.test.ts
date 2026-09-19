import type { NnueMeta } from "@shogi/app-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TauriNnueStorageOptions } from "./nnue-storage";
import { createTauriNnueStorage } from "./nnue-storage";

type BufferLike = {
    from: (data: string, encoding?: "binary") => { toString: (encoding: "base64") => string };
};

const fallbackBtoa = (data: string): string => {
    const bufferCtor = (globalThis as { Buffer?: BufferLike }).Buffer;
    if (!bufferCtor) {
        throw new Error("Buffer is not available for base64 encoding");
    }
    return bufferCtor.from(data, "binary").toString("base64");
};

const encodeBase64 = (data: string): string => (globalThis.btoa ?? fallbackBtoa)(data);

const bytesToBase64 = (bytes: Uint8Array): string => {
    let binary = "";
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return encodeBase64(binary);
};

function createLocalStorageMock(): Storage {
    const store = new Map<string, string>();
    return {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
            store.set(key, value);
        },
        removeItem: (key: string) => {
            store.delete(key);
        },
        clear: () => {
            store.clear();
        },
        key: (index: number) => Array.from(store.keys())[index] ?? null,
        get length() {
            return store.size;
        },
    };
}

describe("nnue-storage", () => {
    let originalLocalStorage: Storage | undefined;
    let originalBtoa: typeof btoa | undefined;

    beforeEach(() => {
        originalLocalStorage = globalThis.localStorage;
        originalBtoa = globalThis.btoa;
        globalThis.localStorage = createLocalStorageMock();
        if (!globalThis.btoa) {
            globalThis.btoa = fallbackBtoa;
        }
    });

    afterEach(() => {
        if (originalLocalStorage) {
            globalThis.localStorage = originalLocalStorage;
        } else {
            delete (globalThis as { localStorage?: Storage }).localStorage;
        }
        if (originalBtoa) {
            globalThis.btoa = originalBtoa;
        } else {
            delete (globalThis as { btoa?: typeof btoa }).btoa;
        }
        vi.clearAllMocks();
    });

    it("stores progress coefficients beside NNUE and hydrates them after reopening", async () => {
        const base64 = "AA".repeat(700000);
        const meta: NnueMeta = {
            id: "layer-stacks",
            displayName: "LS",
            originalFileName: "ls.nnue",
            size: 1,
            contentHashSha256: "hash",
            source: "user-uploaded",
            createdAt: 0,
            verified: false,
            layerStacks: {
                bucketMode: "progresskpabs",
                progressBuckets: 9,
                progressCoeffBase64: base64,
            },
        };
        const mockInvoke = vi
            .fn()
            .mockImplementation(async (command: string) =>
                command === "read_nnue_progress"
                    ? base64
                    : command === "list_nnue_files"
                      ? [meta.id]
                      : undefined,
            );
        const storage = createTauriNnueStorage({
            invoke: mockInvoke as TauriNnueStorageOptions["invoke"],
        });
        await storage.save(meta.id, new Uint8Array([0]), meta);
        expect(mockInvoke).toHaveBeenCalledWith("save_nnue_progress", {
            args: { id: meta.id, base64 },
        });
        const saved = localStorage.getItem("shogi-nnue-meta") ?? "";
        expect(saved.length).toBeLessThan(1000);
        expect(saved).not.toContain("progressCoeffBase64");
        const reopened = createTauriNnueStorage({
            invoke: mockInvoke as TauriNnueStorageOptions["invoke"],
        });
        expect((await reopened.getMeta(meta.id))?.layerStacks?.progressCoeffBase64).toBe(base64);
        await reopened.updateMeta(meta.id, { layerStacks: { bucketMode: "kingrank9" } });
        expect(mockInvoke).toHaveBeenCalledWith("save_nnue_progress", {
            args: { id: meta.id, base64: null },
        });
    });

    it("keeps models visible when a coefficient sidecar cannot be read", async () => {
        const meta: NnueMeta = {
            id: "broken",
            displayName: "Broken coefficient",
            originalFileName: "ls.nnue",
            size: 1,
            contentHashSha256: "hash",
            source: "user-uploaded",
            createdAt: 0,
            verified: false,
            layerStacks: { bucketMode: "progresskpabs", progressBuckets: 9 },
        };
        localStorage.setItem(
            "shogi-nnue-meta",
            JSON.stringify([{ ...meta, progressCoefficientsStored: true }]),
        );
        const mockInvoke = vi.fn().mockImplementation(async (command: string) => {
            if (command === "read_nnue_progress") throw new Error("corrupt sidecar");
            return command === "list_nnue_files" ? [meta.id] : undefined;
        });
        const storage = createTauriNnueStorage({
            invoke: mockInvoke as TauriNnueStorageOptions["invoke"],
        });
        expect((await storage.listMeta())[0].id).toBe(meta.id);
        expect((await storage.getMeta(meta.id))?.layerStacks?.progressCoeffBase64).toBeUndefined();
        await storage.updateMeta(meta.id, {
            layerStacks: {
                bucketMode: "progresskpabs",
                progressBuckets: 9,
                progressCoeffBase64: "replacement",
            },
        });
        expect((await storage.getMeta(meta.id))?.layerStacks?.progressCoeffBase64).toBe(
            "replacement",
        );
    });

    it("wraps file import arguments for the native command", async () => {
        const mockInvoke = vi
            .fn()
            .mockImplementation(async (command: string) =>
                command === "import_nnue_from_path"
                    ? { id: "generated", size: 1, path: "destination" }
                    : "hash",
            );
        const storage = createTauriNnueStorage({
            invoke: mockInvoke as TauriNnueStorageOptions["invoke"],
        });
        await storage.importFromPath?.("source.nnue");
        expect(mockInvoke).toHaveBeenCalledWith("import_nnue_from_path", {
            args: { srcPath: "source.nnue", id: expect.any(String) },
        });
    });

    it("encodes binary chunks into base64 without loss", async () => {
        const bytes = new Uint8Array([0x00, 0x41, 0x80, 0x9f, 0xff]);
        const id = "test-id";
        const meta: NnueMeta = {
            id,
            displayName: "test",
            originalFileName: "test.nnue",
            size: bytes.length,
            contentHashSha256: "dummy-hash",
            source: "user-uploaded",
            createdAt: 0,
            verified: false,
        };

        const mockInvoke = vi.fn().mockResolvedValue(undefined);
        const storage = createTauriNnueStorage({
            invoke: mockInvoke as TauriNnueStorageOptions["invoke"],
        });

        await storage.save(id, bytes, meta);

        const saveCall = mockInvoke.mock.calls.find(([command]) => command === "save_nnue_chunk");
        expect(saveCall).toBeDefined();

        if (!saveCall) {
            throw new Error("save_nnue_chunk was not called");
        }

        const envelope = saveCall[1] as {
            args: { dataBase64: string; chunkIndex: number; id: string };
        };
        const payload = envelope.args;
        expect(payload.id).toBe(id);
        expect(payload.chunkIndex).toBe(0);

        const expectedBase64 = bytesToBase64(bytes);
        expect(payload.dataBase64).toBe(expectedBase64);
    });
});
