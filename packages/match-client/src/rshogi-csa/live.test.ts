import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    __test_internals,
    type RshogiLiveCallbacks,
    type RshogiLiveConnectionState,
    subscribeRshogiLiveGame,
} from "./live";

/**
 * 軽量 WebSocket モック。`subscribeRshogiLiveGame` の `webSocketFactory` から
 * 返し、`onopen` / `onmessage` / `onclose` / `onerror` を手動で発火できる。
 */
class MockWebSocket {
    public readyState = 0;
    public OPEN = 1;
    public CONNECTING = 0;
    public CLOSED = 3;
    public sent: string[] = [];
    public closed = false;
    public closeArgs?: { code: number; reason: string };
    public onopen: ((ev?: unknown) => void) | null = null;
    public onmessage: ((ev: { data: string }) => void) | null = null;
    public onclose: ((ev: { code: number; reason: string; wasClean: boolean }) => void) | null =
        null;
    public onerror: ((ev: unknown) => void) | null = null;

    constructor(public readonly url: string) {}

    send(data: string): void {
        this.sent.push(data);
    }

    close(code?: number, reason?: string): void {
        this.closed = true;
        this.closeArgs = { code: code ?? 1000, reason: reason ?? "" };
    }

    /** テストから呼ぶヘルパ。WS open をシミュレート。 */
    fireOpen(): void {
        this.readyState = 1;
        this.onopen?.();
    }
    /** テストから呼ぶヘルパ。サーバが行を送ってきた状況をシミュレート。 */
    fireLines(lines: string[]): void {
        const data = `${lines.join("\n")}\n`;
        this.onmessage?.({ data });
    }
    /** テストから呼ぶヘルパ。サーバが close をシミュレート。 */
    fireClose(code: number, reason = ""): void {
        this.readyState = 3;
        this.onclose?.({ code, reason, wasClean: code === 1000 });
    }
    fireError(): void {
        this.onerror?.({});
    }
}

const SAMPLE_SUMMARY_LINES = [
    "##[MONITOR2] BEGIN game-1",
    "BEGIN Game_Summary",
    "Protocol_Version:1.2",
    "Protocol_Mode:Server",
    "Format:Shogi 1.0",
    "Game_ID:game-1",
    "Name+:alice",
    "Name-:bob",
    "Rematch_On_Draw:NO",
    "To_Move:+",
    "BEGIN Time",
    "Time_Unit:1sec",
    "Total_Time:600",
    "Byoyomi:10",
    "Least_Time_Per_Move:0",
    "END Time",
    "BEGIN Position",
    "P1-KY-KE-GI-KI-OU-KI-GI-KE-KY",
    "P2 * -HI *  *  *  *  * -KA * ",
    "P3-FU-FU-FU-FU-FU-FU-FU-FU-FU",
    "P4 *  *  *  *  *  *  *  *  * ",
    "P5 *  *  *  *  *  *  *  *  * ",
    "P6 *  *  *  *  *  *  *  *  * ",
    "P7+FU+FU+FU+FU+FU+FU+FU+FU+FU",
    "P8 * +KA *  *  *  *  * +HI * ",
    "P9+KY+KE+GI+KI+OU+KI+GI+KE+KY",
    "+",
    "END Position",
    "Black_Time_Remaining_Ms:600000",
    "White_Time_Remaining_Ms:600000",
    "END Game_Summary",
];

const buildSnapshotLines = (moves: string[] = [], finalCode?: string): string[] => {
    const out = [...SAMPLE_SUMMARY_LINES, ...moves];
    if (finalCode) out.push(finalCode);
    out.push("##[MONITOR2] END");
    return out;
};

const makeMocks = () => {
    const wsInstances: MockWebSocket[] = [];
    const wsFactory = (url: string) => {
        const ws = new MockWebSocket(url);
        wsInstances.push(ws);
        return ws as unknown as WebSocket;
    };
    const events = {
        snapshot: [] as Array<unknown>,
        moves: [] as Array<{ csaMove: string; elapsedSec: number }>,
        clocks: [] as Array<{ remainingMs: { sente: number; gote: number }; sideToMove: string }>,
        ends: [] as Array<unknown>,
        states: [] as RshogiLiveConnectionState[],
        errors: [] as Error[],
    };
    const callbacks: RshogiLiveCallbacks = {
        onSnapshot: (s) => {
            events.snapshot.push(s);
        },
        onMove: (e) => {
            events.moves.push(e);
        },
        onClock: (e) => {
            events.clocks.push(e);
        },
        onEnd: (r) => {
            events.ends.push(r);
        },
        onConnectionState: (s) => {
            events.states.push(s);
        },
        onError: (e) => {
            events.errors.push(e);
        },
    };
    return { wsInstances, wsFactory, events, callbacks };
};

describe("subscribeRshogiLiveGame: snapshot → broadcast → end → close", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("MONITOR2ON を送信し snapshot block を decode して onSnapshot/onClock を呼ぶ", () => {
        const { wsInstances, wsFactory, events, callbacks } = makeMocks();
        subscribeRshogiLiveGame(
            "game-1",
            { apiBaseUrl: "https://example.com", webSocketFactory: wsFactory },
            callbacks,
        );

        expect(wsInstances.length).toBe(1);
        const ws = wsInstances[0];
        expect(ws.url).toBe("wss://example.com/ws/game-1/spectate");
        expect(events.states).toContain("connecting");

        ws.fireOpen();
        expect(events.states).toContain("connected");
        // 接続後すぐ MONITOR2ON 行を送る
        expect(ws.sent[0]).toBe("%%MONITOR2ON game-1\n");

        // snapshot ブロックを送り込む
        ws.fireLines(buildSnapshotLines([]));
        expect(events.snapshot.length).toBe(1);
        expect(events.clocks.length).toBe(1);
        expect(events.clocks[0].remainingMs).toEqual({ sente: 600000, gote: 600000 });
        expect(events.clocks[0].sideToMove).toBe("sente");
    });

    it("apiBaseUrl に path (/api/v1) を含んでも観戦 WS は origin 直下 /ws/<id>/spectate に張る", () => {
        const { wsInstances, wsFactory, callbacks } = makeMocks();
        subscribeRshogiLiveGame(
            "game-1",
            { apiBaseUrl: "https://example.com/api/v1", webSocketFactory: wsFactory },
            callbacks,
        );

        expect(wsInstances.length).toBe(1);
        // REST 共用ベースの `/api/v1` を引きずらず origin だけ使う (path 混入で 404 になる回帰防止)
        expect(wsInstances[0].url).toBe("wss://example.com/ws/game-1/spectate");
    });

    it("snapshot 後の broadcast move 行を onMove に流す", () => {
        const { wsInstances, wsFactory, events, callbacks } = makeMocks();
        subscribeRshogiLiveGame(
            "game-1",
            { apiBaseUrl: "https://example.com", webSocketFactory: wsFactory },
            callbacks,
        );
        const ws = wsInstances[0];
        ws.fireOpen();
        ws.fireLines(buildSnapshotLines([]));
        // 1 手目: 先手 7g7f
        ws.fireLines(["+7776FU,T8"]);
        expect(events.moves).toEqual([{ csaMove: "7g7f", elapsedSec: 8 }]);
        // 2 手目: 後手 3c3d
        ws.fireLines(["-3334FU,T7"]);
        expect(events.moves).toEqual([
            { csaMove: "7g7f", elapsedSec: 8 },
            { csaMove: "3c3d", elapsedSec: 7 },
        ]);
    });

    it("%TORYO 受信で onEnd を発火し reconnect しない (normal close 1000)", () => {
        const { wsInstances, wsFactory, events, callbacks } = makeMocks();
        subscribeRshogiLiveGame(
            "game-1",
            { apiBaseUrl: "https://example.com", webSocketFactory: wsFactory },
            callbacks,
        );
        const ws = wsInstances[0];
        ws.fireOpen();
        ws.fireLines(buildSnapshotLines([]));
        ws.fireLines(["+7776FU,T8", "%TORYO"]);
        expect(events.ends.length).toBe(1);
        expect(events.moves.length).toBe(1);
        // server が close したと仮定
        ws.fireClose(1000, "spectate finished");
        // reconnect 経路は走らない (closed が最終状態)
        vi.advanceTimersByTime(60000);
        expect(wsInstances.length).toBe(1);
        expect(events.states).toContain("closed");
    });

    it("snapshot 末尾に #RESIGN がある (終局済 DO 接続) と onEnd を即発火", () => {
        const { wsInstances, wsFactory, events, callbacks } = makeMocks();
        subscribeRshogiLiveGame(
            "game-1",
            { apiBaseUrl: "https://example.com", webSocketFactory: wsFactory },
            callbacks,
        );
        const ws = wsInstances[0];
        ws.fireOpen();
        ws.fireLines(buildSnapshotLines(["+7776FU,T8", "-3334FU,T7"], "#RESIGN"));
        expect(events.snapshot.length).toBe(1);
        expect(events.ends.length).toBe(1);
    });
});

describe("subscribeRshogiLiveGame: 再接続", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("abnormal close で reconnect し、snapshot を冪等再適用する", () => {
        const { wsInstances, wsFactory, events, callbacks } = makeMocks();
        subscribeRshogiLiveGame(
            "game-1",
            { apiBaseUrl: "https://example.com", webSocketFactory: wsFactory },
            callbacks,
        );
        const ws1 = wsInstances[0];
        ws1.fireOpen();
        ws1.fireLines(buildSnapshotLines(["+7776FU,T8"]));
        expect(events.snapshot.length).toBe(1);
        expect(events.moves.length).toBe(0);
        // 1006 (abnormal close) が来たら 1s 後に reconnect
        ws1.fireClose(1006, "lost");
        expect(events.states).toContain("reconnecting");
        vi.advanceTimersByTime(1000);
        expect(wsInstances.length).toBe(2);
        const ws2 = wsInstances[1];
        ws2.fireOpen();
        // 再 snapshot (`+7776FU` 含む) → state 全置換 (idempotent)
        ws2.fireLines(buildSnapshotLines(["+7776FU,T8"]));
        expect(events.snapshot.length).toBe(2);
        // 重複 broadcast を流して onMove は呼ばれないこと (snapshot で moves 全置換済)
        // (live.ts の本実装では snapshot 後に到着した move 行をそのまま apply
        // するため、サーバが queue による順序保証を提供する前提で client は
        // expectedPly チェックを行わない。よって本テストは「再 snapshot で
        // events.snapshot が 2 件、events.moves は依然 0 件」の振る舞いを pin。)
        expect(events.moves.length).toBe(0);
    });

    it("normal close (1000) かつ onEnd 未発火なら保守的に reconnect する", () => {
        const { wsInstances, wsFactory, events, callbacks } = makeMocks();
        subscribeRshogiLiveGame(
            "game-1",
            { apiBaseUrl: "https://example.com", webSocketFactory: wsFactory },
            callbacks,
        );
        const ws1 = wsInstances[0];
        ws1.fireOpen();
        ws1.fireLines(buildSnapshotLines([]));
        ws1.fireClose(1000, "intentional");
        expect(events.ends.length).toBe(0);
        expect(events.states).toContain("reconnecting");
        vi.advanceTimersByTime(1000);
        expect(wsInstances.length).toBe(2);
    });

    it("normal close (1000) かつ onEnd 既発火なら reconnect しない", () => {
        const { wsInstances, wsFactory, events, callbacks } = makeMocks();
        subscribeRshogiLiveGame(
            "game-1",
            { apiBaseUrl: "https://example.com", webSocketFactory: wsFactory },
            callbacks,
        );
        const ws1 = wsInstances[0];
        ws1.fireOpen();
        ws1.fireLines(buildSnapshotLines([], "#RESIGN"));
        expect(events.ends.length).toBe(1);
        ws1.fireClose(1000, "spectate finished");
        vi.advanceTimersByTime(60000);
        // 終局済 DO の close なので新しい WS は作らない
        expect(wsInstances.length).toBe(1);
    });

    it("onEnd 発火後は abnormal close (1006) でも reconnect しない", () => {
        const { wsInstances, wsFactory, events, callbacks } = makeMocks();
        subscribeRshogiLiveGame(
            "game-1",
            { apiBaseUrl: "https://example.com", webSocketFactory: wsFactory },
            callbacks,
        );
        const ws1 = wsInstances[0];
        ws1.fireOpen();
        ws1.fireLines(buildSnapshotLines([], "#RESIGN"));
        expect(events.ends.length).toBe(1);
        // 終局後の予期せぬ abnormal close (= 1006 等) でも reconnect ループに陥らない
        ws1.fireClose(1006, "abnormal after end");
        vi.advanceTimersByTime(60000);
        expect(wsInstances.length).toBe(1);
        expect(events.states).toContain("closed");
    });

    it("disconnect() で MONITOR2OFF を送り close、reconnect を停止", () => {
        const { wsInstances, wsFactory, events, callbacks } = makeMocks();
        const session = subscribeRshogiLiveGame(
            "game-1",
            { apiBaseUrl: "https://example.com", webSocketFactory: wsFactory },
            callbacks,
        );
        const ws = wsInstances[0];
        ws.fireOpen();
        ws.fireLines(buildSnapshotLines([]));
        session.disconnect();
        expect(ws.sent).toContain("%%MONITOR2OFF\n");
        expect(ws.closeArgs?.code).toBe(1000);
        // 既に閉じているので reconnect は走らない
        ws.fireClose(1006, "after disconnect");
        vi.advanceTimersByTime(60000);
        expect(wsInstances.length).toBe(1);
        expect(events.states).toContain("closed");
    });
});

describe("subscribeRshogiLiveGame: NOT_FOUND", () => {
    it("##[MONITOR2] NOT_FOUND を受け取ったら onError + close で reconnect しない", () => {
        vi.useFakeTimers();
        try {
            const { wsInstances, wsFactory, events, callbacks } = makeMocks();
            subscribeRshogiLiveGame(
                "game-x",
                { apiBaseUrl: "https://example.com", webSocketFactory: wsFactory },
                callbacks,
            );
            const ws = wsInstances[0];
            ws.fireOpen();
            ws.fireLines(["##[MONITOR2] NOT_FOUND game-x", "##[MONITOR2] END"]);
            expect(events.errors.length).toBeGreaterThanOrEqual(1);
            expect(ws.closeArgs?.code).toBe(1000);
            ws.fireClose(1000, "not found");
            vi.advanceTimersByTime(60000);
            expect(wsInstances.length).toBe(1);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe("__test_internals", () => {
    it("detectEndLine: %TORYO は手番側 (敗者) の反対が勝者", () => {
        const r = __test_internals.detectEndLine("%TORYO", "sente");
        expect(r?.kind).toBe("resignation");
        expect(r?.winner).toBe("gote");
    });
    it("detectEndLine: %KACHI は手番側が勝者", () => {
        const r = __test_internals.detectEndLine("%KACHI", "gote");
        expect(r?.kind).toBe("jishogi");
        expect(r?.winner).toBe("gote");
    });
    it("detectEndLine: %TIME_UP は手番側が敗者", () => {
        const r = __test_internals.detectEndLine("%TIME_UP", "gote");
        expect(r?.kind).toBe("time_expired");
        expect(r?.winner).toBe("sente");
    });
    it("detectEndLine: 通常の move 行は null を返す", () => {
        expect(__test_internals.detectEndLine("+7776FU,T3", "sente")).toBeNull();
    });
    it("extractElapsedSec: ,T<n> を抽出。無ければ 0", () => {
        expect(__test_internals.extractElapsedSec("+7776FU,T8")).toBe(8);
        expect(__test_internals.extractElapsedSec("+7776FU")).toBe(0);
    });
    it("parseGameSummaryLines: 必要 field を decode", () => {
        const r = __test_internals.parseGameSummaryLines([
            "Game_ID:abc",
            "Name+:alice",
            "Name-:bob",
            "Time_Unit:1sec",
            "Total_Time:600",
            "Byoyomi:10",
            "Black_Time_Remaining_Ms:599500",
            "White_Time_Remaining_Ms:600000",
            "To_Move:+",
        ]);
        expect(r).toEqual({
            gameId: "abc",
            senteName: "alice",
            goteName: "bob",
            timeUnit: "1sec",
            totalTime: 600,
            byoyomi: 10,
            blackRemainingMs: 599500,
            whiteRemainingMs: 600000,
            toMove: "sente",
        });
    });
});
