import { renderHook } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRoomConnection } from "./useRoomConnection";

const mockCreateRoomClient = vi.fn();
const mockGetStoredResumeToken = vi.fn();
const mockGetStoredSeat = vi.fn();
const mockStoreSeat = vi.fn();

vi.mock("@shogi/match-client", () => ({
    createRoomClient: (...args: Parameters<typeof mockCreateRoomClient>) =>
        mockCreateRoomClient(...args),
    getStoredResumeToken: (...args: Parameters<typeof mockGetStoredResumeToken>) =>
        mockGetStoredResumeToken(...args),
    getStoredSeat: (...args: Parameters<typeof mockGetStoredSeat>) => mockGetStoredSeat(...args),
    storeSeat: (...args: Parameters<typeof mockStoreSeat>) => mockStoreSeat(...args),
}));

function createMockClient() {
    let handler: ((message: unknown) => void) | null = null;

    return {
        client: {
            join: vi.fn(),
            resume: vi.fn(),
            move: vi.fn(),
            resign: vi.fn(),
            consumeAnalysis: vi.fn(),
            updateSettings: vi.fn(),
            ack: vi.fn(),
            sync: vi.fn(),
            ping: vi.fn(),
            disconnect: vi.fn(),
            getStatus: vi.fn().mockReturnValue("connecting"),
            subscribe: vi.fn((nextHandler: (message: unknown) => void) => {
                handler = nextHandler;
                return () => {
                    handler = null;
                };
            }),
        },
        emit(message: unknown) {
            handler?.(message);
        },
    };
}

describe("useRoomConnection", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        mockCreateRoomClient.mockReset();
        mockGetStoredResumeToken.mockReset();
        mockGetStoredSeat.mockReset();
        mockStoreSeat.mockReset();
        mockGetStoredResumeToken.mockReturnValue(null);
        mockGetStoredSeat.mockReturnValue(null);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("handleJoin は open イベント後に join を送る", () => {
        const connection = createMockClient();
        let onOpen: ((event: { reconnect: boolean }) => void) | undefined;

        mockCreateRoomClient.mockImplementation((options) => {
            onOpen = options.onOpen;
            return connection.client;
        });

        const { result } = renderHook(() =>
            useRoomConnection({
                roomId: "room-1",
                initialName: "Alice",
            }),
        );

        act(() => {
            result.current.handleJoin("b");
        });

        expect(connection.client.join).not.toHaveBeenCalled();

        act(() => {
            onOpen?.({ reconnect: false });
        });

        expect(connection.client.join).toHaveBeenCalledWith({
            seat: "b",
            name: "Alice",
        });
    });

    it("resume 自動接続は open イベント後に resume を送る", () => {
        const connection = createMockClient();
        let onOpen: ((event: { reconnect: boolean }) => void) | undefined;

        mockGetStoredResumeToken.mockReturnValue("resume-token");
        mockGetStoredSeat.mockReturnValue("w");
        mockCreateRoomClient.mockImplementation((options) => {
            onOpen = options.onOpen;
            return connection.client;
        });

        renderHook(() =>
            useRoomConnection({
                roomId: "room-2",
                initialName: "Bob",
            }),
        );

        expect(connection.client.resume).not.toHaveBeenCalled();

        act(() => {
            onOpen?.({ reconnect: false });
        });

        expect(connection.client.resume).toHaveBeenCalledWith({
            resumeToken: "resume-token",
            lastEventId: 0,
        });
    });
});
