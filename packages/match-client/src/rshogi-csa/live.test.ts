import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    __test_internals,
    type RshogiLiveCallbacks,
    type RshogiLiveConnectionState,
    RshogiLiveRoomFullError,
    type RshogiLiveSnapshot,
    type RshogiLiveStaticFallbackReason,
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
        snapshot: [] as RshogiLiveSnapshot[],
        moves: [] as Array<{
            csaMove: string;
            elapsedSec: number;
            comment?: { raw: string; evalCp?: number; pv?: string[] };
        }>,
        moveComments: [] as Array<{
            ply: number;
            comment: { raw: string; evalCp?: number; pv?: string[] };
        }>,
        clocks: [] as Array<{ remainingMs: { sente: number; gote: number }; sideToMove: string }>,
        ends: [] as Array<unknown>,
        states: [] as RshogiLiveConnectionState[],
        errors: [] as Error[],
        staticFallbacks: [] as RshogiLiveStaticFallbackReason[],
    };
    const callbacks: RshogiLiveCallbacks = {
        onSnapshot: (s) => {
            events.snapshot.push(s);
        },
        onMove: (e) => {
            events.moves.push(e);
        },
        onMoveComment: (e) => {
            events.moveComments.push(e);
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
        onStaticFallbackRequested: (reason) => {
            events.staticFallbacks.push(reason);
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

    it("To_Move が後手の snapshot を後手の move 行から復元する", () => {
        const { wsInstances, wsFactory, events, callbacks } = makeMocks();
        subscribeRshogiLiveGame(
            "game-1",
            { apiBaseUrl: "https://example.com", webSocketFactory: wsFactory },
            callbacks,
        );
        const ws = wsInstances[0];
        ws.fireOpen();
        const snapshotLines = buildSnapshotLines(["-3334FU,T7"])
            .filter((line) => line !== "+")
            .map((line) => (line === "To_Move:+" ? "To_Move:-" : line));

        ws.fireLines(snapshotLines);

        expect(events.errors).toEqual([]);
        expect(events.snapshot).toHaveLength(1);
        expect(events.snapshot[0].moves).toEqual(["3c3d"]);
        expect(events.snapshot[0].state.board["3d"]).toEqual({ owner: "gote", type: "P" });
        expect(events.snapshot[0].state.turn).toBe("sente");
        expect(events.snapshot[0].clocks.sideToMove).toBe("sente");
    });

    it("position 開始手番マーカーを To_Move より優先する", () => {
        const { wsInstances, wsFactory, events, callbacks } = makeMocks();
        subscribeRshogiLiveGame(
            "game-1",
            { apiBaseUrl: "https://example.com", webSocketFactory: wsFactory },
            callbacks,
        );
        const ws = wsInstances[0];
        ws.fireOpen();
        const snapshotLines = buildSnapshotLines(["-3334FU,T7"]).map((line) =>
            line === "+" ? "-" : line,
        );

        ws.fireLines(snapshotLines);

        expect(events.errors).toEqual([]);
        expect(events.snapshot[0].moves).toEqual(["3c3d"]);
        expect(events.snapshot[0].state.turn).toBe("sente");
    });

    it("奇数手 snapshot の時計表示に replay 後の現在手番を使う", () => {
        const { wsInstances, wsFactory, events, callbacks } = makeMocks();
        subscribeRshogiLiveGame(
            "game-1",
            { apiBaseUrl: "https://example.com", webSocketFactory: wsFactory },
            callbacks,
        );
        const ws = wsInstances[0];
        ws.fireOpen();

        ws.fireLines(buildSnapshotLines(["+7776FU,T8"]));

        expect(events.snapshot[0].clocks.sideToMove).toBe("gote");
        expect(events.clocks[0].sideToMove).toBe("gote");
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

    it("broadcast move 直後の ##[CLOCK] でサーバー残時間を毎手再同期する", () => {
        const { wsInstances, wsFactory, events, callbacks } = makeMocks();
        subscribeRshogiLiveGame(
            "game-1",
            { apiBaseUrl: "https://example.com", webSocketFactory: wsFactory },
            callbacks,
        );
        const ws = wsInstances[0];
        ws.fireOpen();
        ws.fireLines(buildSnapshotLines([]));

        ws.fireLines([
            "+7776FU,T8",
            '##[CLOCK] {"black_remaining_ms":595123,"white_remaining_ms":600000,"side_to_move":"gote","ply":1}',
        ]);

        expect(events.errors).toEqual([]);
        expect(events.moves).toEqual([{ csaMove: "7g7f", elapsedSec: 8 }]);
        expect(events.clocks).toHaveLength(2);
        expect(events.clocks[1]).toEqual({
            remainingMs: { sente: 595_123, gote: 600_000 },
            sideToMove: "gote",
            ply: 1,
        });
    });

    it("MONITOR2 END 前に flush された queued move/clock を snapshot の権威値にする", () => {
        const { wsInstances, wsFactory, events, callbacks } = makeMocks();
        subscribeRshogiLiveGame(
            "game-1",
            { apiBaseUrl: "https://example.com", webSocketFactory: wsFactory },
            callbacks,
        );
        const ws = wsInstances[0];
        ws.fireOpen();

        // summary clock は着手前だが、snapshot 構築中に ply1 が競合して pending
        // queue の move/clock が END より前へ flush された実 server 順序を再現する。
        ws.fireLines(
            buildSnapshotLines([
                "+7776FU,T8",
                '##[CLOCK] {"black_remaining_ms":595123,"white_remaining_ms":600000,"side_to_move":"gote","ply":1}',
            ]),
        );

        expect(events.errors).toEqual([]);
        expect(events.snapshot).toHaveLength(1);
        expect(events.snapshot[0].moves).toEqual(["7g7f"]);
        expect(events.snapshot[0].clocks).toEqual({
            sente: 595_123,
            gote: 600_000,
            sideToMove: "gote",
        });
        expect(events.clocks[0]).toEqual({
            remainingMs: { sente: 595_123, gote: 600_000 },
            sideToMove: "gote",
        });
    });

    it("snapshot 内の不正 CLOCK は通知し、summary clock で snapshot を継続する", () => {
        const { wsInstances, wsFactory, events, callbacks } = makeMocks();
        subscribeRshogiLiveGame(
            "game-1",
            { apiBaseUrl: "https://example.com", webSocketFactory: wsFactory },
            callbacks,
        );
        const ws = wsInstances[0];
        ws.fireOpen();

        ws.fireLines(buildSnapshotLines(["##[CLOCK] not-json"]));

        expect(events.snapshot).toHaveLength(1);
        expect(events.snapshot[0].clocks).toEqual({
            sente: 600_000,
            gote: 600_000,
            sideToMove: "sente",
        });
        expect(events.errors).toHaveLength(1);
        expect(events.errors[0].message).toContain("invalid spectator clock update in snapshot");
    });

    it("盤面より未来の ##[CLOCK] は適用せずエラー通知する", () => {
        const { wsInstances, wsFactory, events, callbacks } = makeMocks();
        subscribeRshogiLiveGame(
            "game-1",
            { apiBaseUrl: "https://example.com", webSocketFactory: wsFactory },
            callbacks,
        );
        const ws = wsInstances[0];
        ws.fireOpen();
        ws.fireLines(buildSnapshotLines([]));

        ws.fireLines([
            '##[CLOCK] {"black_remaining_ms":595123,"white_remaining_ms":600000,"side_to_move":"gote","ply":1}',
        ]);

        expect(events.clocks).toHaveLength(1);
        expect(events.errors).toHaveLength(1);
        expect(events.errors[0].message).toContain("does not match live position");
    });

    it("snapshot queue から届く盤面より古い ##[CLOCK] は静かに無視する", () => {
        const { wsInstances, wsFactory, events, callbacks } = makeMocks();
        subscribeRshogiLiveGame(
            "game-1",
            { apiBaseUrl: "https://example.com", webSocketFactory: wsFactory },
            callbacks,
        );
        const ws = wsInstances[0];
        ws.fireOpen();
        ws.fireLines(buildSnapshotLines(["+7776FU,T8", "-3334FU,T7"]));

        ws.fireLines([
            '##[CLOCK] {"black_remaining_ms":592000,"white_remaining_ms":600000,"side_to_move":"gote","ply":1}',
        ]);

        expect(events.clocks).toHaveLength(1);
        expect(events.errors).toEqual([]);
    });

    it("broadcast move の適用失敗を通知し、後続 move の購読を継続する", () => {
        const { wsInstances, wsFactory, events, callbacks } = makeMocks();
        subscribeRshogiLiveGame(
            "game-1",
            { apiBaseUrl: "https://example.com", webSocketFactory: wsFactory },
            callbacks,
        );
        const ws = wsInstances[0];
        ws.fireOpen();
        ws.fireLines(buildSnapshotLines([]));

        ws.fireLines(["+7776FU,T8", "+7776FU,T99", "-3334FU,T7"]);

        expect(events.errors).toHaveLength(1);
        expect(events.errors[0].message).toMatch(/CSA move rejected:.*unexpected turn/);
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
        expect(events.staticFallbacks).toEqual(["terminal-snapshot"]);
    });

    it("snapshot 末尾に #ABNORMAL があると abnormal/ABNORMAL で終局扱いにして reconnect しない", () => {
        const { wsInstances, wsFactory, events, callbacks } = makeMocks();
        subscribeRshogiLiveGame(
            "game-1",
            { apiBaseUrl: "https://example.com", webSocketFactory: wsFactory },
            callbacks,
        );
        const ws = wsInstances[0];
        ws.fireOpen();
        ws.fireLines(buildSnapshotLines([], "#ABNORMAL"));
        expect(events.ends).toEqual([{ kind: "abnormal", endReason: "ABNORMAL" }]);
        expect(events.snapshot[0].finalResult).toEqual({
            kind: "abnormal",
            endReason: "ABNORMAL",
        });
        expect(events.staticFallbacks).toEqual(["terminal-snapshot"]);

        ws.fireClose(1000, "spectate finished");
        vi.advanceTimersByTime(60000);
        expect(wsInstances.length).toBe(1);
        expect(events.states).toContain("closed");
    });

    it("未知の snapshot result_code でも終局扱いにして reconnect しない", () => {
        const { wsInstances, wsFactory, events, callbacks } = makeMocks();
        subscribeRshogiLiveGame(
            "game-1",
            { apiBaseUrl: "https://example.com", webSocketFactory: wsFactory },
            callbacks,
        );
        const ws = wsInstances[0];
        ws.fireOpen();
        ws.fireLines(buildSnapshotLines([], "#FUTURE_CODE"));
        expect(events.ends).toEqual([{ kind: "abort", endReason: "FUTURE_CODE" }]);
        expect(events.staticFallbacks).toEqual(["terminal-snapshot"]);

        ws.fireClose(1000, "spectate finished");
        vi.advanceTimersByTime(60000);
        expect(wsInstances.length).toBe(1);
    });
});

describe("subscribeRshogiLiveGame: Floodgate コメント (eval / PV)", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    const openWithSnapshot = () => {
        const mocks = makeMocks();
        subscribeRshogiLiveGame(
            "game-1",
            { apiBaseUrl: "https://example.com", webSocketFactory: mocks.wsFactory },
            mocks.callbacks,
        );
        const ws = mocks.wsInstances[0];
        ws.fireOpen();
        ws.fireLines(buildSnapshotLines([]));
        return { ...mocks, ws };
    };

    it("live: move 行の直後の `'` コメント行を直前 ply に紐付けて onMoveComment を呼ぶ", () => {
        const { ws, events } = openWithSnapshot();
        // 1 手目 (先手, ply=1) とそのコメント
        ws.fireLines(["+7776FU,T8", "'* 123 +7776FU -3334FU"]);
        expect(events.moves).toEqual([{ csaMove: "7g7f", elapsedSec: 8 }]);
        expect(events.moveComments).toEqual([
            {
                ply: 1,
                comment: { raw: "* 123 +7776FU -3334FU", evalCp: 123, pv: ["+7776FU", "-3334FU"] },
            },
        ]);
        // 2 手目 (後手, ply=2) とそのコメント。eval は先手視点固定なので負値も来うる。
        ws.fireLines(["-3334FU,T7", "'* -45 -3334FU"]);
        expect(events.moveComments[1]).toEqual({
            ply: 2,
            comment: { raw: "* -45 -3334FU", evalCp: -45, pv: ["-3334FU"] },
        });
    });

    it("live: onMove は即時発火し、コメントは onMoveComment で後追い配信される", () => {
        const { ws, events } = openWithSnapshot();
        ws.fireLines(["+7776FU,T8", "'* 100"]);
        expect(events.moves[0]).toEqual({ csaMove: "7g7f", elapsedSec: 8 });
        expect(events.moveComments[0]).toEqual({ ply: 1, comment: { raw: "* 100", evalCp: 100 } });
    });

    it("live: 解析不能なコメントは raw のみ保持し evalCp/pv は undefined", () => {
        const { ws, events } = openWithSnapshot();
        ws.fireLines(["+7776FU,T8", "'なにか自由なコメント"]);
        expect(events.moveComments[0]).toEqual({
            ply: 1,
            comment: { raw: "なにか自由なコメント" },
        });
        expect(events.moveComments[0].comment.evalCp).toBeUndefined();
        expect(events.moveComments[0].comment.pv).toBeUndefined();
    });

    it("live: `'` 行は move としても終局としても扱われない (誤検知しない)", () => {
        const { ws, events } = openWithSnapshot();
        // move の前に届いた `'`, `%TORYO` に見えかねない `'` を送っても move/onEnd に流れない
        ws.fireLines(["'* 999 先頭コメントは紐付け先なし"]);
        ws.fireLines(["+7776FU,T8"]);
        ws.fireLines(["'%TORYO っぽいがコメント"]);
        expect(events.moves).toEqual([{ csaMove: "7g7f", elapsedSec: 8 }]);
        expect(events.ends.length).toBe(0);
        // 先頭 (move 未適用時) の `'` は握り潰され、move 後の 1 件だけ ply=1 に付く
        expect(events.moveComments).toEqual([
            { ply: 1, comment: { raw: "%TORYO っぽいがコメント" } },
        ]);
    });

    it("snapshot: move 行の直後の `'` を moveDetails に inline で載せる", () => {
        const { events } = (() => {
            const mocks = makeMocks();
            subscribeRshogiLiveGame(
                "game-1",
                { apiBaseUrl: "https://example.com", webSocketFactory: mocks.wsFactory },
                mocks.callbacks,
            );
            const ws = mocks.wsInstances[0];
            ws.fireOpen();
            ws.fireLines(
                buildSnapshotLines(["+7776FU,T8", "'* 30 -3334FU", "-3334FU,T7", "'* -20 +2726FU"]),
            );
            return mocks;
        })();
        const snap = events.snapshot[0];
        expect(snap.moves).toEqual(["7g7f", "3c3d"]);
        expect(snap.moveDetails).toEqual([
            {
                csaMove: "7g7f",
                elapsedSec: 8,
                comment: { raw: "* 30 -3334FU", evalCp: 30, pv: ["-3334FU"] },
            },
            {
                csaMove: "3c3d",
                elapsedSec: 7,
                comment: { raw: "* -20 +2726FU", evalCp: -20, pv: ["+2726FU"] },
            },
        ]);
    });

    it("snapshot: 適用不能な手が混ざる snapshot 全体を棄却する", () => {
        const { events } = (() => {
            const mocks = makeMocks();
            subscribeRshogiLiveGame(
                "game-1",
                { apiBaseUrl: "https://example.com", webSocketFactory: mocks.wsFactory },
                mocks.callbacks,
            );
            const ws = mocks.wsInstances[0];
            ws.fireOpen();
            ws.fireLines(
                buildSnapshotLines([
                    "+7776FU,T8",
                    "+7776FU,T99",
                    "'* 999 ずれ検出用",
                    "-3334FU,T7",
                    "'* -20 +2726FU",
                ]),
            );
            return mocks;
        })();
        expect(events.snapshot).toHaveLength(0);
        expect(events.errors).toHaveLength(1);
        expect(events.errors[0].message).toMatch(/CSA move rejected:.*unexpected turn/);
    });

    it("snapshot: コメントも T も無い旧サーバ形式は moveDetails が elapsedSec=0/comment 無しで揃う", () => {
        const { events } = (() => {
            const mocks = makeMocks();
            subscribeRshogiLiveGame(
                "game-1",
                { apiBaseUrl: "https://example.com", webSocketFactory: mocks.wsFactory },
                mocks.callbacks,
            );
            const ws = mocks.wsInstances[0];
            ws.fireOpen();
            // T サフィックスもコメント行も無い (production 旧サーバ)
            ws.fireLines(buildSnapshotLines(["+7776FU", "-3334FU"]));
            return mocks;
        })();
        const snap = events.snapshot[0];
        expect(snap.moveDetails).toEqual([
            { csaMove: "7g7f", elapsedSec: 0, comment: undefined },
            { csaMove: "3c3d", elapsedSec: 0, comment: undefined },
        ]);
    });

    it("no-comment な live stream は従来と同一 (onMoveComment は呼ばれない)", () => {
        const { ws, events } = openWithSnapshot();
        ws.fireLines(["+7776FU,T8", "-3334FU,T7"]);
        expect(events.moves).toEqual([
            { csaMove: "7g7f", elapsedSec: 8 },
            { csaMove: "3c3d", elapsedSec: 7 },
        ]);
        expect(events.moveComments.length).toBe(0);
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

    it("終局検知されない flap (接続成功→即 close) でも上限で打ち切り connected↔reconnecting を無限往復しない", () => {
        const { wsInstances, wsFactory, events, callbacks } = makeMocks();
        subscribeRshogiLiveGame(
            "game-1",
            { apiBaseUrl: "https://example.com", webSocketFactory: wsFactory },
            callbacks,
        );
        // backoff 列と同じ回数だけ reconnect が走り、その後は打ち切られる。
        const backoff = [1000, 2000, 4000, 8000, 16000, 30000];
        // 初回接続 → 終局コードを含まない snapshot → close (endFired は false のまま)
        wsInstances[0].fireOpen();
        wsInstances[0].fireLines(buildSnapshotLines([]));
        wsInstances[0].fireClose(1006, "flap");
        // 各 backoff 遅延で reconnect → 接続成功 → 即 close を繰り返す。
        // onopen で attempt をリセットしないため delay は単調増加する。
        for (let i = 0; i < backoff.length; i++) {
            vi.advanceTimersByTime(backoff[i]);
            expect(wsInstances.length).toBe(i + 2);
            const ws = wsInstances[i + 1];
            ws.fireOpen();
            ws.fireLines(buildSnapshotLines([]));
            ws.fireClose(1006, "flap");
        }
        // 上限到達後はどれだけ時間を進めても新しい WS を張らず closed で確定する。
        vi.advanceTimersByTime(60000);
        expect(wsInstances.length).toBe(backoff.length + 1);
        expect(events.states.at(-1)).toBe("closed");
        expect(events.errors.some((e) => e.message.includes("上限"))).toBe(true);
        expect(events.staticFallbacks).toEqual(["reconnect-limit-reached"]);
    });

    it("安定接続 (STABLE_CONNECTION_MS 継続) 後は attempt がリセットされ、散発的な切断では上限に達しない", () => {
        const { wsInstances, wsFactory, callbacks } = makeMocks();
        subscribeRshogiLiveGame(
            "game-1",
            { apiBaseUrl: "https://example.com", webSocketFactory: wsFactory },
            callbacks,
        );
        // 上限 (=backoff 段数 6) を超える回数、安定接続→切断→再接続 を繰り返す。
        const cycles = 9;
        let ws = wsInstances[0];
        for (let i = 0; i < cycles; i++) {
            ws.fireOpen();
            ws.fireLines(buildSnapshotLines([]));
            // 30s 継続 = 安定接続とみなされ reconnectAttempt がリセットされる。
            vi.advanceTimersByTime(30000);
            ws.fireClose(1006, "blip");
            // attempt はリセット済みなので毎回 backoff[0]=1000 で reconnect する。
            vi.advanceTimersByTime(1000);
            ws = wsInstances[wsInstances.length - 1];
        }
        // 上限超の回数を切断・再接続しても closed で止まらず新 WS を張り続ける。
        expect(wsInstances.length).toBe(cycles + 1);
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
            expect(events.staticFallbacks).toEqual(["not-found"]);
            expect(ws.closeArgs?.code).toBe(1000);
            ws.fireClose(1000, "not found");
            vi.advanceTimersByTime(60000);
            expect(wsInstances.length).toBe(1);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe("subscribeRshogiLiveGame: room full", () => {
    it("close code 1013 + reason room full なら満席エラーとして閉じ、reconnect しない", () => {
        vi.useFakeTimers();
        try {
            const { wsInstances, wsFactory, events, callbacks } = makeMocks();
            subscribeRshogiLiveGame(
                "game-1",
                { apiBaseUrl: "https://example.com", webSocketFactory: wsFactory },
                callbacks,
            );
            const ws = wsInstances[0];
            ws.fireOpen();
            ws.fireClose(1013, "room full");

            vi.advanceTimersByTime(60000);
            expect(events.states.at(-1)).toBe("closed");
            expect(events.errors[0]).toBeInstanceOf(RshogiLiveRoomFullError);
            expect(events.errors[0].message).toContain("観戦者数が上限");
            expect(wsInstances.length).toBe(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it("MONITOR2 の room full エラー行も満席として扱う", () => {
        vi.useFakeTimers();
        try {
            const { wsInstances, wsFactory, events, callbacks } = makeMocks();
            subscribeRshogiLiveGame(
                "game-1",
                { apiBaseUrl: "https://example.com", webSocketFactory: wsFactory },
                callbacks,
            );
            const ws = wsInstances[0];
            ws.fireOpen();
            ws.fireLines(["##[MONITOR2] ERROR 503 room full"]);

            expect(ws.closeArgs?.reason).toBe("room full");
            expect(events.states.at(-1)).toBe("closed");
            expect(events.errors[0]).toBeInstanceOf(RshogiLiveRoomFullError);
            ws.fireClose(1000, "room full");
            vi.advanceTimersByTime(60000);
            expect(wsInstances.length).toBe(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it("room full 以外の満席らしい文言は契約外として扱わない", () => {
        vi.useFakeTimers();
        try {
            const { wsInstances, wsFactory, events, callbacks } = makeMocks();
            subscribeRshogiLiveGame(
                "game-1",
                { apiBaseUrl: "https://example.com", webSocketFactory: wsFactory },
                callbacks,
            );
            const ws = wsInstances[0];
            ws.fireOpen();
            ws.fireLines([
                "##[MONITOR2] ERROR too many spectators",
                "##[MONITOR2] ERROR spectator full",
                "##[MONITOR2] ERROR 満席",
            ]);

            expect(ws.closeArgs).toBeUndefined();
            expect(events.errors).toEqual([]);
            expect(events.states.at(-1)).toBe("connected");
        } finally {
            vi.useRealTimers();
        }
    });

    it("room full ではない MONITOR2 ERROR 行は接続を維持する", () => {
        vi.useFakeTimers();
        try {
            const { wsInstances, wsFactory, events, callbacks } = makeMocks();
            subscribeRshogiLiveGame(
                "game-1",
                { apiBaseUrl: "https://example.com", webSocketFactory: wsFactory },
                callbacks,
            );
            const ws = wsInstances[0];
            ws.fireOpen();
            ws.fireLines(["##[MONITOR2] ERROR temporary backend warning"]);

            expect(ws.closeArgs).toBeUndefined();
            expect(events.errors).toEqual([]);
            expect(events.states.at(-1)).toBe("connected");
            ws.fireLines(buildSnapshotLines(["+7776FU,T8"]));
            expect(events.snapshot.length).toBe(1);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe("parseSpectatorClockUpdate", () => {
    it("structured clock wire を decode し、不正 payload を拒否する", () => {
        expect(
            __test_internals.parseSpectatorClockUpdate(
                '##[CLOCK] {"black_remaining_ms":445123,"white_remaining_ms":405987,"side_to_move":"sente","ply":48}',
            ),
        ).toEqual({
            remainingMs: { sente: 445_123, gote: 405_987 },
            sideToMove: "sente",
            ply: 48,
        });
        expect(__test_internals.parseSpectatorClockUpdate("##[CLOCK] not-json")).toBeNull();
        expect(
            __test_internals.parseSpectatorClockUpdate(
                '##[CLOCK] {"black_remaining_ms":-1,"white_remaining_ms":0,"side_to_move":"sente","ply":1}',
            ),
        ).toBeNull();
    });
});

describe("subscribeRshogiLiveGame: モック (apiBaseUrl 未指定 + gameId が mock- prefix)", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("固定 snapshot を配信し、eval コメント付き moveDetails を載せる", () => {
        const { events, callbacks } = makeMocks();
        // apiBaseUrl 未指定 + `mock-` prefix → WS を張らずモックが動く
        subscribeRshogiLiveGame("mock-demo-game", {}, callbacks);
        // connecting は同期で通知される
        expect(events.states).toContain("connecting");
        expect(events.snapshot.length).toBe(0);

        // タイマー tick で snapshot / clock が届く
        vi.advanceTimersByTime(0);
        expect(events.states).toContain("connected");
        expect(events.snapshot.length).toBe(1);
        expect(events.clocks.length).toBe(1);

        const snap = events.snapshot[0];
        // 15 手すべてが decode され moveDetails と同順・同長で並ぶ
        expect(snap.moves.length).toBe(15);
        expect(snap.moveDetails.length).toBe(15);

        // 1 手目: 消費秒と先手視点 eval / PV が載る
        expect(snap.moveDetails[0]).toEqual({
            csaMove: "7g7f",
            elapsedSec: 3,
            comment: { raw: "* 30 -3334FU +2726FU", evalCp: 30, pv: ["-3334FU", "+2726FU"] },
        });
        // ply6 は後手有利 (先手視点で負値) の連続下げの起点
        expect(snap.moveDetails[5].comment?.evalCp).toBe(-25);
        expect(snap.moveDetails[6].comment?.evalCp).toBe(-40);
        expect(snap.moveDetails[9].comment?.evalCp).toBe(-90);
        // 最終手は詰みセンチネル ±100000 (先手が詰みを発見)。wire レベルでは生値の
        // まま届き、表示用の丸め (±2000) は viewer 側 (rshogi-csa-live-viewer) で行う。
        const last = snap.moveDetails[snap.moveDetails.length - 1];
        expect(last.comment?.evalCp).toBe(100000);

        // Game_ID を省いているので meta.gameId は購読 gameId にフォールバックする
        expect(snap.meta.gameId).toBe("mock-demo-game");
        // 15 手 (奇数) 適用後の手番は後手
        expect(snap.clocks.sideToMove).toBe("gote");
        expect(events.clocks[0].remainingMs).toEqual({ sente: 540000, gote: 552000 });
    });

    it("disconnect() で保留中の配信を止め closed を通知する", () => {
        const { events, callbacks } = makeMocks();
        const session = subscribeRshogiLiveGame("mock-demo-game", {}, callbacks);
        // snapshot 配信前に切断すると snapshot は届かない
        session.disconnect();
        vi.advanceTimersByTime(0);
        expect(events.snapshot.length).toBe(0);
        expect(events.states.at(-1)).toBe("closed");
    });

    it("timer impl を this 非束縛で呼ぶ (browser window.setTimeout の Illegal invocation 回帰防止)", () => {
        // ブラウザの window.setTimeout/clearTimeout は this が window 以外に束縛される
        // と TypeError: Illegal invocation を throw する。`deps.setTimeoutImpl(...)` の
        // ようなメソッド呼びだと this=deps になり実ブラウザで落ちる (Node/happy-dom は
        // this を見ないため素通りする)。その挙動を再現する shim で回帰を固定する。
        const strictThis = <T extends (...args: never[]) => unknown>(fn: T): T =>
            function (this: unknown, ...args: never[]) {
                if (this !== undefined && this !== globalThis) {
                    throw new TypeError("Illegal invocation");
                }
                return fn(...args);
            } as T;
        const strictImpls = {
            setTimeoutImpl: strictThis(setTimeout) as typeof setTimeout,
            clearTimeoutImpl: strictThis(clearTimeout) as typeof clearTimeout,
        };
        // setTimeoutImpl 経由の snapshot 配信が throw せず届く
        const delivered = makeMocks();
        subscribeRshogiLiveGame("mock-demo-game", strictImpls, delivered.callbacks);
        vi.advanceTimersByTime(0);
        expect(delivered.events.errors).toEqual([]);
        expect(delivered.events.snapshot.length).toBe(1);
        // clearTimeoutImpl 経路 (timer 保留中の disconnect) も throw しない
        const cancelled = makeMocks();
        const session = subscribeRshogiLiveGame("mock-demo-game", strictImpls, cancelled.callbacks);
        session.disconnect();
        expect(cancelled.events.errors).toEqual([]);
        expect(cancelled.events.states.at(-1)).toBe("closed");
    });

    it("mock- prefix でない gameId は apiBaseUrl 未指定だとエラーで閉じる (偽対局を配信しない)", () => {
        const { events, callbacks } = makeMocks();
        // 設定漏れ (VITE_RSHOGI_API_BASE 未設定) の実 gameId → PR 前と同じエラー経路
        subscribeRshogiLiveGame("real-game-123", {}, callbacks);
        vi.advanceTimersByTime(60000);
        expect(events.snapshot.length).toBe(0);
        expect(events.errors.length).toBe(1);
        expect(events.errors[0].message).toContain("apiBaseUrl is required");
        expect(events.states).toEqual(["connecting", "closed"]);
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
    it("parseLiveComment: Floodgate 形 `'* <eval> <pv...>` を eval/pv に分解 (eval は先手視点)", () => {
        expect(__test_internals.parseLiveComment("'* 123 +7776FU -3334FU")).toEqual({
            raw: "* 123 +7776FU -3334FU",
            evalCp: 123,
            pv: ["+7776FU", "-3334FU"],
        });
        // 負値 (後手有利) も先手視点固定でそのまま
        expect(__test_internals.parseLiveComment("'* -250")).toEqual({
            raw: "* -250",
            evalCp: -250,
        });
    });
    it("parseLiveComment: eval のみ (PV 無し) は pv undefined", () => {
        const c = __test_internals.parseLiveComment("'* 0");
        expect(c.evalCp).toBe(0);
        expect(c.pv).toBeUndefined();
    });
    it("parseLiveComment: Floodgate 形でない/整数でないコメントは raw のみ", () => {
        expect(__test_internals.parseLiveComment("'ただのコメント")).toEqual({
            raw: "ただのコメント",
        });
        expect(__test_internals.parseLiveComment("'* abc +7776FU")).toEqual({
            raw: "* abc +7776FU",
        });
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
    it("parseGameSummaryLines: Time_Unit:1min (StopWatch) を分単位のまま受理する", () => {
        const r = __test_internals.parseGameSummaryLines([
            "Time_Unit:1min",
            "Total_Time:15",
            "Byoyomi:1",
        ]);
        expect(r.timeUnit).toBe("1min");
        expect(r.totalTime).toBe(15);
        expect(r.byoyomi).toBe(1);
    });
});

describe("deriveTimeControl: kind 判定と単位換算 (REST decodeClock 語彙に合わせる)", () => {
    it("Increment 行あり → fischer (Time_Unit:1sec、増分は秒)", () => {
        expect(
            __test_internals.deriveTimeControl({
                timeUnit: "1sec",
                totalTime: 600,
                increment: 10,
            }),
        ).toEqual({
            kind: "fischer",
            mainSeconds: 600,
            byoyomiSeconds: 0,
            byoyomiMilliseconds: undefined,
            incrementSeconds: 10,
        });
    });
    it("Increment:0 は fischer 扱いせず countdown として扱う", () => {
        expect(
            __test_internals.deriveTimeControl({
                timeUnit: "1sec",
                totalTime: 600,
                byoyomi: 10,
                increment: 0,
            }),
        ).toEqual({
            kind: "countdown",
            mainSeconds: 600,
            byoyomiSeconds: 10,
            byoyomiMilliseconds: undefined,
            incrementSeconds: undefined,
        });
    });
    it("Byoyomi 行あり Time_Unit:1sec → countdown", () => {
        const tc = __test_internals.deriveTimeControl({
            timeUnit: "1sec",
            totalTime: 600,
            byoyomi: 10,
        });
        expect(tc?.kind).toBe("countdown");
        expect(tc?.mainSeconds).toBe(600);
        expect(tc?.byoyomiSeconds).toBe(10);
        expect(tc?.byoyomiMilliseconds).toBeUndefined();
        expect(tc?.incrementSeconds).toBeUndefined();
    });
    it("Time_Unit:1msec → countdown_msec (ms→秒換算 + byoyomiMilliseconds 保持)", () => {
        const tc = __test_internals.deriveTimeControl({
            timeUnit: "1msec",
            totalTime: 10_000,
            byoyomi: 100,
        });
        expect(tc?.kind).toBe("countdown_msec");
        expect(tc?.mainSeconds).toBe(10);
        // round(100 / 1000) = 0 秒だが、生 ms は byoyomiMilliseconds に残す
        expect(tc?.byoyomiSeconds).toBe(0);
        expect(tc?.byoyomiMilliseconds).toBe(100);
    });
    it("Time_Unit:1min → stopwatch (分→秒換算)", () => {
        const tc = __test_internals.deriveTimeControl({
            timeUnit: "1min",
            totalTime: 15,
            byoyomi: 1,
        });
        expect(tc?.kind).toBe("stopwatch");
        expect(tc?.mainSeconds).toBe(900);
        expect(tc?.byoyomiSeconds).toBe(60);
        expect(tc?.byoyomiMilliseconds).toBeUndefined();
    });
    it("Byoyomi も Increment も無い → sudden-death countdown (byoyomiSeconds 0)", () => {
        const tc = __test_internals.deriveTimeControl({ timeUnit: "1sec", totalTime: 300 });
        expect(tc?.kind).toBe("countdown");
        expect(tc?.mainSeconds).toBe(300);
        expect(tc?.byoyomiSeconds).toBe(0);
    });
    it("時間フィールドが皆無なら timeControl ごと undefined", () => {
        expect(__test_internals.deriveTimeControl({})).toBeUndefined();
        expect(__test_internals.deriveTimeControl({ timeUnit: "1sec" })).toBeUndefined();
    });
    it("snapshot 経由でも meta.timeControl.kind が付く (fischer / countdown)", () => {
        const fischer = __test_internals.decodeSnapshotBlock("g", [
            "BEGIN Game_Summary",
            "BEGIN Time",
            "Time_Unit:1sec",
            "Total_Time:600",
            "Increment:10",
            "END Time",
            "END Game_Summary",
        ]);
        expect(fischer.snapshot.meta.timeControl?.kind).toBe("fischer");
        expect(fischer.snapshot.meta.timeControl?.incrementSeconds).toBe(10);

        const countdown = __test_internals.decodeSnapshotBlock("g", [
            "BEGIN Game_Summary",
            "BEGIN Time",
            "Time_Unit:1sec",
            "Total_Time:600",
            "Byoyomi:10",
            "END Time",
            "END Game_Summary",
        ]);
        expect(countdown.snapshot.meta.timeControl?.kind).toBe("countdown");
        expect(countdown.snapshot.meta.timeControl?.byoyomiSeconds).toBe(10);
    });
});
