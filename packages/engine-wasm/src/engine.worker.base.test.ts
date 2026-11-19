import { NNUE_MAX_SIZE_BYTES } from "@shogi/app-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEngineWorker } from "./engine.worker.base";

function setup() {
    const postMessage = vi.fn();
    const scope: { onmessage?: (msg: { data: unknown }) => void; postMessage: typeof postMessage } =
        { postMessage };
    vi.stubGlobal("self", scope);
    const memory = new WebAssembly.Memory({ initial: 1 });
    const allocNnueBuffer = vi.fn(() => 8);
    const loadModelFromPtr = vi.fn();
    const freeNnueBuffer = vi.fn();
    const loadModel = vi.fn();

    createEngineWorker({
        initWasm: async () => ({ memory }),
        applyMoves: vi.fn(),
        disposeEngine: vi.fn(),
        initEngine: vi.fn(),
        configureLayerStacks: vi.fn(),
        loadModel,
        allocNnueBuffer,
        loadModelFromPtr,
        freeNnueBuffer,
        loadPosition: vi.fn(),
        runSearch: vi.fn(),
        setEventHandler: vi.fn(),
        setOption: vi.fn(),
        stopEngine: vi.fn(),
    });

    async function load(
        source: { type: "bytes"; bytes: Uint8Array } | { type: "url"; url: string },
    ) {
        if (!scope.onmessage) throw new Error("Expected worker message handler");
        scope.onmessage({ data: { type: "loadNnue", requestId: "model", source } });
        const ack = await vi.waitFor(() => {
            const message = postMessage.mock.calls.find(([event]) => event.type === "ack");
            if (!message) throw new Error("Expected worker acknowledgement");
            return message[0];
        });
        return ack;
    }

    return { allocNnueBuffer, freeNnueBuffer, load, loadModel, loadModelFromPtr, postMessage };
}

const bytes = new Uint8Array([1, 2, 3]);
const urlSource = { type: "url", url: "https://example.test/model.nnue" } as const;

function mockStream(contentLength: number) {
    const response = new Response(bytes, { headers: { "content-length": String(contentLength) } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    return response;
}

afterEach(() => vi.unstubAllGlobals());

describe("worker NNUE direct write", () => {
    it("reports allocation failure without loading, freeing or locking the stream", async () => {
        const response = mockStream(bytes.length);
        const worker = setup();
        worker.allocNnueBuffer.mockReturnValue(0);

        await expect(worker.load(urlSource)).resolves.toMatchObject({
            error: "Error: Failed to allocate NNUE buffer",
        });
        expect(worker.loadModelFromPtr).not.toHaveBeenCalled();
        expect(worker.loadModel).not.toHaveBeenCalled();
        expect(worker.freeNnueBuffer).not.toHaveBeenCalled();
        expect(response.body?.locked).toBe(false);
    });

    it.each([
        "bytes",
        "url",
    ] as const)("reports a %s model error without freeing twice", async (type) => {
        const worker = setup();
        worker.loadModelFromPtr.mockImplementation(() => {
            throw new Error("Invalid model");
        });
        mockStream(bytes.length);

        await expect(
            worker.load(type === "bytes" ? { type, bytes } : urlSource),
        ).resolves.toMatchObject({ error: "Error: Invalid model" });
        expect(worker.loadModelFromPtr).toHaveBeenCalledWith(8, bytes.length);
        expect(worker.freeNnueBuffer).not.toHaveBeenCalled();
        expect(worker.postMessage).not.toHaveBeenCalledWith(
            expect.objectContaining({ type: "nnueLoaded" }),
        );
    });

    it("frees a buffer when the stream ends before the model can be loaded", async () => {
        const total = bytes.length + 1;
        const response = mockStream(total);
        const worker = setup();

        await expect(worker.load(urlSource)).resolves.toMatchObject({
            error: `Error: Incomplete stream: ${bytes.length}/${total} bytes`,
        });
        expect(worker.loadModelFromPtr).not.toHaveBeenCalled();
        expect(worker.freeNnueBuffer).toHaveBeenCalledExactlyOnceWith(8, total);
        expect(response.body?.locked).toBe(false);
    });

    it("passes a model above the direct-write limit to load_model without allocating", async () => {
        const worker = setup();
        const large = {
            length: NNUE_MAX_SIZE_BYTES + 1,
        } as unknown as Uint8Array;

        await expect(worker.load({ type: "bytes", bytes: large })).resolves.toMatchObject({
            type: "ack",
        });
        expect(worker.allocNnueBuffer).not.toHaveBeenCalled();
        expect(worker.loadModel).toHaveBeenCalledExactlyOnceWith(large);
    });
});
