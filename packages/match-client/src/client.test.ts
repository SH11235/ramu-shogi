import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoomClient } from "./client";
import type { ServerMessage } from "./types";

// ─── Mock WebSocket ───────────────────────────────────────────────────────────

class MockWebSocket {
    static OPEN = 1;
    static CLOSED = 3;

    readyState: number = MockWebSocket.OPEN;
    url: string;
    sentMessages: string[] = [];

    private listeners: Record<string, ((...args: unknown[]) => void)[]> = {};

    constructor(url: string) {
        this.url = url;
    }

    addEventListener(event: string, handler: (...args: unknown[]) => void): void {
        if (!this.listeners[event]) this.listeners[event] = [];
        this.listeners[event].push(handler);
    }

    removeEventListener(event: string, handler: (...args: unknown[]) => void): void {
        if (this.listeners[event]) {
            this.listeners[event] = this.listeners[event].filter((h) => h !== handler);
        }
    }

    send(data: string): void {
        this.sentMessages.push(data);
    }

    close(): void {
        this.readyState = MockWebSocket.CLOSED;
        this.emit("close");
    }

    emit(event: string, ...args: unknown[]): void {
        for (const handler of this.listeners[event] ?? []) {
            handler(...args);
        }
    }

    emitOpen(): void {
        this.readyState = MockWebSocket.OPEN;
        this.emit("open");
    }

    emitMessage(data: unknown): void {
        this.emit("message", { data: JSON.stringify(data) });
    }
}

// ─── テストヘルパー ────────────────────────────────────────────────────────────

function createMockWsFactory(): {
    factory: (url: string) => MockWebSocket;
    instances: MockWebSocket[];
} {
    const instances: MockWebSocket[] = [];
    const factory = (url: string): MockWebSocket => {
        const ws = new MockWebSocket(url);
        instances.push(ws);
        return ws;
    };
    return { factory, instances };
}

// ─── テスト ───────────────────────────────────────────────────────────────────

describe("createRoomClient", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        // sessionStorage をリセット
        try {
            sessionStorage.clear();
        } catch {
            // node 環境では sessionStorage が存在しない
        }
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("初期状態は 'connecting'", () => {
        const { factory, instances } = createMockWsFactory();
        const client = createRoomClient(
            { wsUrl: "ws://localhost/api/rooms/room1/ws" },
            factory as unknown as (url: string) => WebSocket,
        );
        expect(client.getStatus()).toBe("connecting");
        expect(instances).toHaveLength(1);
        client.disconnect();
    });

    it("open イベントで 'connected' になる", () => {
        const { factory, instances } = createMockWsFactory();
        const client = createRoomClient(
            { wsUrl: "ws://localhost/api/rooms/room1/ws" },
            factory as unknown as (url: string) => WebSocket,
        );
        instances[0].emitOpen();
        expect(client.getStatus()).toBe("connected");
        client.disconnect();
    });

    it("初回 open 時に onOpen を呼ぶ", () => {
        const { factory, instances } = createMockWsFactory();
        const onOpen = vi.fn();
        const client = createRoomClient(
            {
                wsUrl: "ws://localhost/api/rooms/room1/ws",
                onOpen,
            },
            factory as unknown as (url: string) => WebSocket,
        );

        instances[0].emitOpen();

        expect(onOpen).toHaveBeenCalledWith({ reconnect: false });
        client.disconnect();
    });

    it("再接続でも resumeToken が無ければ onOpen を reconnect=false (新規接続扱い) で呼ぶ", () => {
        // onOpen の `reconnect` は「resume に成功したか」を表す。resumeToken を保存して
        // いない (joined 未受信) 再接続は新規接続として扱われ reconnect=false になる。
        const { factory, instances } = createMockWsFactory();
        const onOpen = vi.fn();
        const client = createRoomClient(
            {
                wsUrl: "ws://localhost/api/rooms/room1/ws",
                autoReconnect: true,
                onOpen,
            },
            factory as unknown as (url: string) => WebSocket,
        );

        instances[0].emitOpen();
        instances[0].close();
        vi.advanceTimersByTime(1000);
        instances[1].emitOpen();

        expect(onOpen).toHaveBeenNthCalledWith(1, { reconnect: false });
        expect(onOpen).toHaveBeenNthCalledWith(2, { reconnect: false });
        client.disconnect();
    });

    it("send は clientMsgId を自動インクリメントして送信する", () => {
        const { factory, instances } = createMockWsFactory();
        const client = createRoomClient(
            { wsUrl: "ws://localhost/api/rooms/room1/ws" },
            factory as unknown as (url: string) => WebSocket,
        );
        instances[0].emitOpen();

        client.join({ seat: "b", name: "Alice" });
        client.join({ seat: "w", name: "Bob" });

        const msg1 = JSON.parse(instances[0].sentMessages[0]);
        const msg2 = JSON.parse(instances[0].sentMessages[1]);
        expect(msg1.clientMsgId).toBe(1);
        expect(msg2.clientMsgId).toBe(2);
        client.disconnect();
    });

    it("subscribe でメッセージを受信し、unsubscribe で解除できる", () => {
        const { factory, instances } = createMockWsFactory();
        const client = createRoomClient(
            { wsUrl: "ws://localhost/api/rooms/room1/ws" },
            factory as unknown as (url: string) => WebSocket,
        );
        instances[0].emitOpen();

        const received: ServerMessage[] = [];
        const unsubscribe = client.subscribe((msg) => received.push(msg));

        const testMsg: ServerMessage = {
            v: 1,
            t: "pong",
            payload: { ts: 1000, serverTs: 1001 },
        };
        instances[0].emitMessage(testMsg);
        expect(received).toHaveLength(1);
        expect(received[0]).toEqual(testMsg);

        unsubscribe();
        instances[0].emitMessage(testMsg);
        expect(received).toHaveLength(1); // 解除後は届かない

        client.disconnect();
    });

    it("close 後に自動再接続をスケジュールする", () => {
        const { factory, instances } = createMockWsFactory();
        const client = createRoomClient(
            { wsUrl: "ws://localhost/api/rooms/room1/ws", autoReconnect: true },
            factory as unknown as (url: string) => WebSocket,
        );
        instances[0].emitOpen();
        instances[0].close();

        expect(client.getStatus()).toBe("reconnecting");
        expect(instances).toHaveLength(1); // まだ再接続していない

        vi.advanceTimersByTime(1000); // 最初のバックオフ 1s
        expect(instances).toHaveLength(2); // 再接続した

        client.disconnect();
    });

    it("autoReconnect: false のとき再接続しない", () => {
        const { factory, instances } = createMockWsFactory();
        const client = createRoomClient(
            { wsUrl: "ws://localhost/api/rooms/room1/ws", autoReconnect: false },
            factory as unknown as (url: string) => WebSocket,
        );
        instances[0].emitOpen();
        instances[0].close();

        expect(client.getStatus()).toBe("disconnected");
        vi.advanceTimersByTime(5000);
        expect(instances).toHaveLength(1); // 再接続しない

        client.disconnect();
    });

    it("disconnect() で即座に切断し再接続しない", () => {
        const { factory, instances } = createMockWsFactory();
        const client = createRoomClient(
            { wsUrl: "ws://localhost/api/rooms/room1/ws" },
            factory as unknown as (url: string) => WebSocket,
        );
        instances[0].emitOpen();
        client.disconnect();

        expect(client.getStatus()).toBe("disconnected");
        vi.advanceTimersByTime(10000);
        expect(instances).toHaveLength(1);
    });

    it("ping は ts を含む payload を送信する", () => {
        const { factory, instances } = createMockWsFactory();
        const client = createRoomClient(
            { wsUrl: "ws://localhost/api/rooms/room1/ws" },
            factory as unknown as (url: string) => WebSocket,
        );
        instances[0].emitOpen();

        const now = Date.now();
        client.ping();

        const msg = JSON.parse(instances[0].sentMessages[0]);
        expect(msg.t).toBe("ping");
        expect(msg.payload.ts).toBeGreaterThanOrEqual(now);
        client.disconnect();
    });

    it("joined メッセージの resumeToken を受け取ってハンドラに伝える", () => {
        const { factory, instances } = createMockWsFactory();
        const client = createRoomClient(
            { wsUrl: "ws://localhost/api/rooms/room1/ws" },
            factory as unknown as (url: string) => WebSocket,
        );
        instances[0].emitOpen();

        const received: ServerMessage[] = [];
        client.subscribe((msg) => received.push(msg));

        const joinedMsg: ServerMessage = {
            v: 1,
            t: "joined",
            payload: {
                roomId: "room1",
                seat: "b",
                resumeToken: "test-token-123",
                youAre: "player",
            },
        };
        instances[0].emitMessage(joinedMsg);
        expect(received[0]).toEqual(joinedMsg);
        client.disconnect();
    });

    it("move メッセージを正しいペイロードで送信する", () => {
        const { factory, instances } = createMockWsFactory();
        const client = createRoomClient(
            { wsUrl: "ws://localhost/api/rooms/room1/ws" },
            factory as unknown as (url: string) => WebSocket,
        );
        instances[0].emitOpen();

        client.move({
            eventId: 5,
            usi: "7g7f",
            sfen: "lnsgkgsnl/1r5b1/ppppppppp/9/9/2P6/PP1PPPPPP/1B5R1/LNSGKGSNL b - 2",
        });

        const msg = JSON.parse(instances[0].sentMessages[0]);
        expect(msg.t).toBe("move");
        expect(msg.payload.usi).toBe("7g7f");
        expect(msg.payload.sfen).toBeDefined();
        client.disconnect();
    });

    it("WebSocket が OPEN でないとき send は何もしない", () => {
        const { factory, instances } = createMockWsFactory();
        const client = createRoomClient(
            { wsUrl: "ws://localhost/api/rooms/room1/ws" },
            factory as unknown as (url: string) => WebSocket,
        );
        // open を発火せず readyState = OPEN のまま試みる（初期は OPEN だが、ここでは接続前）
        // 実際の WebSocket は接続前は readyState !== OPEN なので MockWS を閉じてテスト
        instances[0].readyState = 0; // CONNECTING
        client.join({ seat: "b", name: "Test" });
        expect(instances[0].sentMessages).toHaveLength(0);
        client.disconnect();
    });

    it("不正な JSON を受信しても例外をスローしない", () => {
        const { factory, instances } = createMockWsFactory();
        const client = createRoomClient(
            { wsUrl: "ws://localhost/api/rooms/room1/ws" },
            factory as unknown as (url: string) => WebSocket,
        );
        instances[0].emitOpen();

        expect(() => {
            instances[0].emit("message", { data: "invalid json{{" });
        }).not.toThrow();

        client.disconnect();
    });

    describe("購読者がいない間のメッセージ", () => {
        const onlineEvent = (eventId: number): ServerMessage => ({
            v: 1,
            t: "event",
            payload: {
                kind: "player_online",
                eventId,
                serverTs: 0,
                seat: "b",
            },
        });

        it("購読者の入れ替わりの間に届いた event を次の購読者へ届いた順に 1 度だけ渡す", () => {
            const { factory, instances } = createMockWsFactory();
            const client = createRoomClient(
                { wsUrl: "ws://localhost/api/rooms/room1/ws" },
                factory as unknown as (url: string) => WebSocket,
            );
            instances[0].emitOpen();

            const first: ServerMessage[] = [];
            const unsubscribe = client.subscribe((msg) => first.push(msg));
            instances[0].emitMessage(onlineEvent(1));
            unsubscribe();

            instances[0].emitMessage(onlineEvent(2));
            instances[0].emitMessage(onlineEvent(3));

            const second: ServerMessage[] = [];
            client.subscribe((msg) => second.push(msg));
            const third: ServerMessage[] = [];
            client.subscribe((msg) => third.push(msg));
            instances[0].emitMessage(onlineEvent(4));

            expect(first).toEqual([onlineEvent(1)]);
            expect(second).toEqual([onlineEvent(2), onlineEvent(3), onlineEvent(4)]);
            expect(third).toEqual([onlineEvent(4)]);
            client.disconnect();
        });

        it("購読者がいない間に届いた snapshot も保持し、pong と error は保持しない", () => {
            const { factory, instances } = createMockWsFactory();
            const client = createRoomClient(
                { wsUrl: "ws://localhost/api/rooms/room1/ws" },
                factory as unknown as (url: string) => WebSocket,
            );
            instances[0].emitOpen();

            const snapshot = { v: 1, t: "snapshot", payload: { eventId: 5 } };
            instances[0].emitMessage(snapshot);
            instances[0].emitMessage({ v: 1, t: "pong", payload: { ts: 1, serverTs: 2 } });
            instances[0].emitMessage({
                v: 1,
                t: "error",
                payload: { code: "DESYNC", message: "" },
            });

            const received: ServerMessage[] = [];
            client.subscribe((msg) => received.push(msg));

            expect(received).toEqual([snapshot]);
            client.disconnect();
        });

        it("disconnect すると保持していたメッセージを捨てる", () => {
            const { factory, instances } = createMockWsFactory();
            const client = createRoomClient(
                { wsUrl: "ws://localhost/api/rooms/room1/ws" },
                factory as unknown as (url: string) => WebSocket,
            );
            instances[0].emitOpen();
            instances[0].emitMessage(onlineEvent(1));
            client.disconnect();

            const received: ServerMessage[] = [];
            client.subscribe((msg) => received.push(msg));

            expect(received).toEqual([]);
        });

        it("保持できる件数を超えたら一部だけ渡さず、最後に渡したイベントの後を sync で取り直す", () => {
            const { factory, instances } = createMockWsFactory();
            const client = createRoomClient(
                { wsUrl: "ws://localhost/api/rooms/room1/ws" },
                factory as unknown as (url: string) => WebSocket,
            );
            instances[0].emitOpen();

            const unsubscribe = client.subscribe(() => {});
            instances[0].emitMessage(onlineEvent(7));
            unsubscribe();
            for (let eventId = 8; eventId <= 8 + 300; eventId++) {
                instances[0].emitMessage(onlineEvent(eventId));
            }

            const received: ServerMessage[] = [];
            client.subscribe((msg) => received.push(msg));

            expect(received).toEqual([]);
            const sent = instances[0].sentMessages.map((raw) => JSON.parse(raw));
            expect(sent.filter((msg) => msg.t === "sync")).toEqual([
                expect.objectContaining({ t: "sync", payload: { sinceEventId: 7 } }),
            ]);

            instances[0].emitMessage(onlineEvent(400));
            expect(received).toEqual([onlineEvent(400)]);
            client.disconnect();
        });
    });
});
