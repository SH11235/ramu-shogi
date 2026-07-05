import type { RshogiGameMeta, RshogiLiveMove, RshogiTimeControl } from "@shogi/match-client";
import { act, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    appendMoveEval,
    applyMoveComment,
    applyMoveToClocks,
    computeRemaining,
    deriveInByoyomi,
    formatByoyomiClock,
    formatOwnEval,
    type LiveClocks,
    moveDetailsToEvals,
    RshogiCsaLiveViewer,
    RshogiLiveMetaPanel,
    RshogiLiveScoreboard,
    setMoveEvalAtPly,
    summarizeMoveDetails,
} from "./rshogi-csa-live-viewer";
import { formatEval, MATE_WITHOUT_PLY } from "./shogi-match/utils/kifFormat";

vi.mock("./shogi-match", () => ({
    ShogiMatch: ({
        initialReview,
        reviewLeftContent,
    }: {
        initialReview?: { moves?: string[] };
        reviewLeftContent?: ReactNode;
    }) => (
        <div data-testid="shogi-match" data-move-count={initialReview?.moves?.length ?? 0}>
            {reviewLeftContent}
        </div>
    ),
}));

const META: RshogiGameMeta = { gameId: "game-1", senteName: "alice", goteName: "bob" };

/** テスト用の clock 生成ヘルパ (秒読みフラグは既定 false)。 */
const mkClocks = (over: Partial<LiveClocks> & Pick<LiveClocks, "sideToMove">): LiveClocks => ({
    sente: 60_000,
    gote: 60_000,
    senteInByoyomi: false,
    goteInByoyomi: false,
    ...over,
});

const FISCHER: RshogiTimeControl = {
    kind: "fischer",
    mainSeconds: 60,
    byoyomiSeconds: 0,
    incrementSeconds: 5,
};
const COUNTDOWN: RshogiTimeControl = {
    kind: "countdown",
    mainSeconds: 600,
    byoyomiSeconds: 10,
};
const COUNTDOWN_MSEC: RshogiTimeControl = {
    kind: "countdown_msec",
    mainSeconds: 10,
    byoyomiSeconds: 0,
    byoyomiMilliseconds: 500,
};
const STOPWATCH: RshogiTimeControl = {
    kind: "stopwatch",
    mainSeconds: 900,
    byoyomiSeconds: 60,
};
const SUDDEN_DEATH: RshogiTimeControl = {
    kind: "countdown",
    mainSeconds: 300,
    byoyomiSeconds: 0,
};

class MockWebSocket {
    static instances: MockWebSocket[] = [];
    readyState = 0;
    sent: string[] = [];
    closeArgs?: { code: number; reason: string };
    onopen: (() => void) | null = null;
    onmessage: ((ev: { data: string }) => void) | null = null;
    onclose: ((ev: { code: number; reason: string; wasClean: boolean }) => void) | null = null;
    onerror: ((ev: Event) => void) | null = null;

    constructor(public readonly url: string) {
        MockWebSocket.instances.push(this);
    }

    send(data: string): void {
        this.sent.push(data);
    }

    close(code?: number, reason?: string): void {
        this.closeArgs = { code: code ?? 1000, reason: reason ?? "" };
    }

    fireOpen(): void {
        this.readyState = 1;
        this.onopen?.();
    }

    fireLines(lines: string[]): void {
        this.onmessage?.({ data: `${lines.join("\n")}\n` });
    }

    fireClose(code: number, reason = ""): void {
        this.readyState = 3;
        this.onclose?.({ code, reason, wasClean: code === 1000 });
    }
}

const LIVE_SNAPSHOT_LINES = [
    "##[MONITOR2] BEGIN game-1",
    "BEGIN Game_Summary",
    "Game_ID:game-1",
    "Name+:alice",
    "Name-:bob",
    "To_Move:+",
    "Black_Time_Remaining_Ms:600000",
    "White_Time_Remaining_Ms:600000",
    "END Game_Summary",
];

const buildLiveSnapshot = (moves: string[] = [], finalCode?: string): string[] => {
    const lines = [...LIVE_SNAPSHOT_LINES, ...moves];
    if (finalCode) lines.push(finalCode);
    lines.push("##[MONITOR2] END");
    return lines;
};

const createStaticGameFetch = () =>
    vi.fn(
        async () =>
            new Response(
                JSON.stringify({
                    game_id: "game-1",
                    black_handle: "alice",
                    white_handle: "bob",
                    result_kind: "WIN_WHITE",
                    end_reason: "RESIGN",
                    csa: "V2.2\nN+alice\nN-bob\nPI\n+\n+7776FU\n%TORYO\n",
                }),
                { status: 200, headers: { "content-type": "application/json" } },
            ),
    ) as unknown as typeof fetch;

const createStaticGameNotFoundFetch = () =>
    vi.fn(async () => new Response("not found", { status: 404 })) as unknown as typeof fetch;

const createStaticGameFailureFetch = (message = "fallback exploded") =>
    vi.fn(async () => {
        throw new Error(message);
    }) as unknown as typeof fetch;

const createInvalidStaticGameFetch = () =>
    vi.fn(
        async () =>
            new Response(
                JSON.stringify({
                    game_id: "game-1",
                    black_handle: "alice",
                    white_handle: "bob",
                    result_kind: "WIN_WHITE",
                    end_reason: "RESIGN",
                    csa: "not csa",
                }),
                { status: 200, headers: { "content-type": "application/json" } },
            ),
    ) as unknown as typeof fetch;

describe("RshogiCsaLiveViewer: static fallback", () => {
    beforeEach(() => {
        MockWebSocket.instances = [];
        vi.stubGlobal("WebSocket", MockWebSocket);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("terminal snapshot を受けたら GET /games/<id> の静的終局表示へ切り替える", async () => {
        const fetchOverride = createStaticGameFetch();

        render(
            <RshogiCsaLiveViewer
                gameId="game-1"
                engineOptions={[]}
                manifestUrl="/nnue/manifest.json"
                apiBaseUrl="https://example.com/api/v1"
                fetchOverride={fetchOverride}
            />,
        );

        const ws = MockWebSocket.instances[0];
        act(() => {
            ws.fireOpen();
            ws.fireLines(buildLiveSnapshot(["+7776FU,T8"], "#RESIGN"));
        });

        await waitFor(() => {
            expect(fetchOverride).toHaveBeenCalledWith(
                "https://example.com/api/v1/games/game-1",
                expect.objectContaining({ signal: expect.any(AbortSignal) }),
            );
        });
        await waitFor(() => {
            expect(
                screen.getByText("ライブ接続は終了済みのため、保存済み棋譜を表示しています。"),
            ).toBeTruthy();
        });
        expect(screen.getByTestId("shogi-match").getAttribute("data-move-count")).toBe("1");
        expect(screen.getByText("後手 (bob) 勝ち (投了)")).toBeTruthy();
    });

    it("静的 fallback が RshogiGameNotFoundError になったら not-found 表示にする", async () => {
        const fetchOverride = createStaticGameNotFoundFetch();

        render(
            <RshogiCsaLiveViewer
                gameId="game-1"
                engineOptions={[]}
                manifestUrl="/nnue/manifest.json"
                apiBaseUrl="https://example.com/api/v1"
                fetchOverride={fetchOverride}
            />,
        );

        act(() => {
            MockWebSocket.instances[0].fireOpen();
            MockWebSocket.instances[0].fireLines(["##[MONITOR2] NOT_FOUND game-1"]);
        });

        await waitFor(() => {
            expect(screen.getByText(/終局済み棋譜がまだ見つかりませんでした/)).toBeTruthy();
        });
    });

    it("terminal snapshot 0手後の fallback 404 は再読み込み誘導ではなく未保存表示にする", async () => {
        const fetchOverride = createStaticGameNotFoundFetch();

        render(
            <RshogiCsaLiveViewer
                gameId="game-1"
                engineOptions={[]}
                manifestUrl="/nnue/manifest.json"
                apiBaseUrl="https://example.com/api/v1"
                fetchOverride={fetchOverride}
            />,
        );

        act(() => {
            MockWebSocket.instances[0].fireOpen();
            MockWebSocket.instances[0].fireLines(buildLiveSnapshot([], "#ABNORMAL"));
        });

        await waitFor(() => expect(fetchOverride).toHaveBeenCalled());
        await waitFor(() => {
            expect(screen.getByText(/この対局の棋譜データは保存されていません/)).toBeTruthy();
        });
        expect(screen.queryByText(/少し時間をおいて再読み込みしてください/)).toBeNull();
        expect(screen.getByText(/この対局は終局 \(異常終了\)として終了済みです/)).toBeTruthy();
        expect(screen.getByTestId("shogi-match").getAttribute("data-move-count")).toBe("0");
    });

    it("静的 fallback が汎用エラーになったら errorMessage を表示する", async () => {
        const fetchOverride = createStaticGameFailureFetch("fallback exploded");

        render(
            <RshogiCsaLiveViewer
                gameId="game-1"
                engineOptions={[]}
                manifestUrl="/nnue/manifest.json"
                apiBaseUrl="https://example.com/api/v1"
                fetchOverride={fetchOverride}
            />,
        );

        act(() => {
            MockWebSocket.instances[0].fireOpen();
            MockWebSocket.instances[0].fireLines(["##[MONITOR2] NOT_FOUND game-1"]);
        });

        await waitFor(() => {
            expect(screen.getByText("fallback exploded")).toBeTruthy();
        });
    });

    it("terminal snapshot 後の parseCsaMoves 例外は snapshot を保持して抑制する", async () => {
        const fetchOverride = createInvalidStaticGameFetch();

        render(
            <RshogiCsaLiveViewer
                gameId="game-1"
                engineOptions={[]}
                manifestUrl="/nnue/manifest.json"
                apiBaseUrl="https://example.com/api/v1"
                fetchOverride={fetchOverride}
            />,
        );

        act(() => {
            MockWebSocket.instances[0].fireOpen();
            MockWebSocket.instances[0].fireLines(buildLiveSnapshot(["+7776FU,T8"], "#RESIGN"));
        });

        await waitFor(() => expect(fetchOverride).toHaveBeenCalled());
        expect(screen.queryByText(/終局済み棋譜の解析に失敗しました/)).toBeNull();
        expect(screen.getByTestId("shogi-match")).toBeTruthy();
    });

    it("reconnect 上限到達時に静的終局表示へ切り替え、上限エラーを二重表示しない", async () => {
        vi.useFakeTimers();
        try {
            const fetchOverride = createStaticGameFetch();
            render(
                <RshogiCsaLiveViewer
                    gameId="game-1"
                    engineOptions={[]}
                    manifestUrl="/nnue/manifest.json"
                    apiBaseUrl="https://example.com/api/v1"
                    fetchOverride={fetchOverride}
                />,
            );

            const backoff = [1000, 2000, 4000, 8000, 16000, 30000];
            act(() => {
                MockWebSocket.instances[0].fireOpen();
                MockWebSocket.instances[0].fireClose(1006, "flap");
            });
            for (let i = 0; i < backoff.length; i++) {
                await act(async () => {
                    vi.advanceTimersByTime(backoff[i]);
                });
                act(() => {
                    MockWebSocket.instances[i + 1].fireOpen();
                    MockWebSocket.instances[i + 1].fireClose(1006, "flap");
                });
            }

            await act(async () => {});
            await act(async () => {});
            expect(fetchOverride).toHaveBeenCalled();
            expect(
                screen.getByText("ライブ接続は終了済みのため、保存済み棋譜を表示しています。"),
            ).toBeTruthy();
            expect(screen.queryByText(/再接続の上限/)).toBeNull();
        } finally {
            vi.useRealTimers();
        }
    });

    it("snapshot 保持中でも reconnect 上限の fallback 失敗は理由と errorMessage を表示する", async () => {
        vi.useFakeTimers();
        try {
            const fetchOverride = createStaticGameFailureFetch("fallback exploded");
            render(
                <RshogiCsaLiveViewer
                    gameId="game-1"
                    engineOptions={[]}
                    manifestUrl="/nnue/manifest.json"
                    apiBaseUrl="https://example.com/api/v1"
                    fetchOverride={fetchOverride}
                />,
            );

            const backoff = [1000, 2000, 4000, 8000, 16000, 30000];
            act(() => {
                MockWebSocket.instances[0].fireOpen();
                MockWebSocket.instances[0].fireLines(buildLiveSnapshot(["+7776FU,T8"]));
                MockWebSocket.instances[0].fireClose(1006, "flap");
            });
            for (let i = 0; i < backoff.length; i++) {
                await act(async () => {
                    vi.advanceTimersByTime(backoff[i]);
                });
                act(() => {
                    MockWebSocket.instances[i + 1].fireOpen();
                    MockWebSocket.instances[i + 1].fireClose(1006, "flap");
                });
            }

            await act(async () => {});
            await act(async () => {});
            expect(screen.getByText(/再接続の上限/)).toBeTruthy();
            expect(screen.getByText("fallback exploded")).toBeTruthy();
        } finally {
            vi.useRealTimers();
        }
    });

    it("満席 close は専用メッセージを表示し、reconnect しない", async () => {
        vi.useFakeTimers();
        try {
            render(
                <RshogiCsaLiveViewer
                    gameId="game-1"
                    engineOptions={[]}
                    manifestUrl="/nnue/manifest.json"
                    apiBaseUrl="https://example.com/api/v1"
                />,
            );

            act(() => {
                MockWebSocket.instances[0].fireOpen();
                MockWebSocket.instances[0].fireClose(1013, "room full");
                vi.advanceTimersByTime(60000);
            });

            expect(screen.getByText(/観戦者数が上限/)).toBeTruthy();
            expect(MockWebSocket.instances.length).toBe(1);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe("computeRemaining", () => {
    it("手番側 (sideToMove) のみ経過分を減算し、相手側は据え置く", () => {
        const remaining = computeRemaining(
            mkClocks({ sente: 60_000, gote: 45_000, sideToMove: "sente" }),
            5_000,
        );
        expect(remaining.sente).toEqual({ mainMs: 55_000, inByoyomi: false });
        expect(remaining.gote).toEqual({ mainMs: 45_000, inByoyomi: false });
    });

    it("後手番では後手側のみ減算する", () => {
        const remaining = computeRemaining(
            mkClocks({ sente: 60_000, gote: 45_000, sideToMove: "gote" }),
            5_000,
        );
        expect(remaining.sente.mainMs).toBe(60_000);
        expect(remaining.gote.mainMs).toBe(40_000);
    });

    it("手番側の残時間が経過分を下回っても 0 で止める", () => {
        const remaining = computeRemaining(
            mkClocks({ sente: 3_000, gote: 45_000, sideToMove: "sente" }),
            5_000,
        );
        expect(remaining.sente.mainMs).toBe(0);
        expect(remaining.gote.mainMs).toBe(45_000);
    });

    it("clocks 未取得時は両者 mainMs 0・非秒読みを返す", () => {
        expect(computeRemaining(null, 5_000)).toEqual({
            sente: { mainMs: 0, inByoyomi: false },
            gote: { mainMs: 0, inByoyomi: false },
        });
    });

    it("秒読み中の手番側は本体 0・秒読みを full から補間減算する", () => {
        const remaining = computeRemaining(
            mkClocks({ sente: 0, gote: 45_000, sideToMove: "sente", senteInByoyomi: true }),
            3_000,
            COUNTDOWN,
        );
        // 手番側 (先手): 本体 0、秒読み full 10s から 3s 補間減算 → 7000ms
        expect(remaining.sente).toEqual({ mainMs: 0, byoyomiMs: 7_000, inByoyomi: true });
        // 相手側 (後手): 通常表示
        expect(remaining.gote).toEqual({ mainMs: 45_000, inByoyomi: false });
    });

    it("秒読み中の相手側 (非手番) は full の秒読みを据え置き表示する", () => {
        const remaining = computeRemaining(
            mkClocks({ sente: 30_000, gote: 0, sideToMove: "sente", goteInByoyomi: true }),
            3_000,
            COUNTDOWN,
        );
        // 後手は非手番かつ秒読み → full 10s を減算せず表示
        expect(remaining.gote).toEqual({ mainMs: 0, byoyomiMs: 10_000, inByoyomi: true });
    });
});

describe("formatOwnEval", () => {
    it("正/負/ゼロを符号付きで整形する (その手番視点)", () => {
        expect(formatOwnEval(123)).toBe("+123");
        expect(formatOwnEval(-45)).toBe("-45");
        expect(formatOwnEval(0)).toBe("+0");
    });
    it("±100000 の詰みセンチネルは詰み表記にする", () => {
        expect(formatOwnEval(100_000)).toBe("詰み");
        expect(formatOwnEval(-100_000)).toBe("詰まされ");
    });
});

describe("formatByoyomiClock", () => {
    it("秒読み残時間は ceil で m:ss 表示にする", () => {
        expect(formatByoyomiClock(1)).toBe("0:01");
        expect(formatByoyomiClock(59_999)).toBe("0:59");
        expect(formatByoyomiClock(60_000)).toBe("1:00");
        expect(formatByoyomiClock(119_999)).toBe("1:59");
        expect(formatByoyomiClock(120_000)).toBe("2:00");
        expect(formatByoyomiClock(0)).toBe("0:00");
    });
});

describe("applyMoveToClocks: kind ごとの 1 手適用 (server clock.rs ミラー)", () => {
    it("fischer: mover.main = max(0, main - elapsed) + increment (post-increment)", () => {
        // 先手 65s (=60+5)、10s 消費 → max(0, 65000-10000)+5000 = 60000
        const next = applyMoveToClocks(
            mkClocks({ sente: 65_000, gote: 65_000, sideToMove: "sente" }),
            FISCHER,
            "sente",
            10,
        );
        expect(next.sente).toBe(60_000);
        expect(next.gote).toBe(65_000); // 相手側は不変
        expect(next.sideToMove).toBe("gote"); // 手番が相手へ
        expect(next.senteInByoyomi).toBe(false);
    });

    it("fischer: max(0, main - elapsed) + inc の clamp を固定する (main 0 / elapsed 3s / inc 5s → 5000)", () => {
        // 式の clamp 部分の防御的ケースを固定する。inc>0 の fischer で broadcast
        // される手は必ず elapsed <= main のため、この状態はサーバ上では到達しない
        // (client がドリフトで main を小さく見積もった場合の安全側挙動の確認)。
        const next = applyMoveToClocks(
            mkClocks({ sente: 0, gote: 60_000, sideToMove: "sente" }),
            FISCHER,
            "sente",
            3,
        );
        expect(next.sente).toBe(5_000);
    });

    it("countdown: 本体内なら減算、本体使い切りで秒読みへ移行する", () => {
        // 本体 8s の側が 8s 消費 → 本体 0、秒読み (byoyomi 10s>0) へ
        const next = applyMoveToClocks(
            mkClocks({ sente: 8_000, gote: 60_000, sideToMove: "sente" }),
            COUNTDOWN,
            "sente",
            8,
        );
        expect(next.sente).toBe(0);
        expect(next.senteInByoyomi).toBe(true);
    });

    it("countdown: 本体超過で即秒読みへ (elapsed > main)", () => {
        const next = applyMoveToClocks(
            mkClocks({ sente: 3_000, gote: 60_000, sideToMove: "sente" }),
            COUNTDOWN,
            "sente",
            9,
        );
        expect(next.sente).toBe(0);
        expect(next.senteInByoyomi).toBe(true);
    });

    it("countdown: 秒読みは以降の手でも持続し本体 0 のまま (毎手 full リセット・持続量は保持しない)", () => {
        // 既に秒読み中 (main 0 / inByoyomi) の側がさらに指しても本体 0・秒読み継続。
        const inByoyomi = mkClocks({
            sente: 0,
            gote: 60_000,
            sideToMove: "sente",
            senteInByoyomi: true,
        });
        const next = applyMoveToClocks(inByoyomi, COUNTDOWN, "sente", 7);
        expect(next.sente).toBe(0);
        expect(next.senteInByoyomi).toBe(true);
    });

    it("countdown_msec: byoyomiMilliseconds>0 でも本体使い切りで秒読みへ移行する", () => {
        const next = applyMoveToClocks(
            mkClocks({ sente: 500, gote: 10_000, sideToMove: "sente" }),
            COUNTDOWN_MSEC,
            "sente",
            1,
        );
        expect(next.sente).toBe(0);
        expect(next.senteInByoyomi).toBe(true);
    });

    it("stopwatch: 分単位切り捨て (elapsed 59s → 消費 0)", () => {
        const next = applyMoveToClocks(
            mkClocks({ sente: 900_000, gote: 900_000, sideToMove: "sente" }),
            STOPWATCH,
            "sente",
            59,
        );
        // 59 秒は分単位切り捨てで消費 0
        expect(next.sente).toBe(900_000);
        expect(next.senteInByoyomi).toBe(false);
        // 60 秒ちょうどで 1 分消費
        const after60 = applyMoveToClocks(
            mkClocks({ sente: 900_000, gote: 900_000, sideToMove: "sente" }),
            STOPWATCH,
            "sente",
            60,
        );
        expect(after60.sente).toBe(840_000);
    });

    it("stopwatch: 本体 0 到達後は分単位 byoyomi を秒読みフェーズとして表示対象にする", () => {
        const next = applyMoveToClocks(
            mkClocks({ sente: 60_000, gote: 900_000, sideToMove: "sente" }),
            STOPWATCH,
            "sente",
            60,
        );
        expect(next.sente).toBe(0);
        expect(next.senteInByoyomi).toBe(true);

        const alreadyInByoyomi = applyMoveToClocks(
            mkClocks({
                sente: 0,
                gote: 900_000,
                sideToMove: "sente",
                senteInByoyomi: true,
            }),
            STOPWATCH,
            "sente",
            120,
        );
        expect(alreadyInByoyomi.sente).toBe(0);
        expect(alreadyInByoyomi.senteInByoyomi).toBe(true);
    });

    it("sudden-death (byoyomi 0): 0 でクランプし秒読みには入らない", () => {
        const next = applyMoveToClocks(
            mkClocks({ sente: 3_000, gote: 300_000, sideToMove: "sente" }),
            SUDDEN_DEATH,
            "sente",
            9,
        );
        expect(next.sente).toBe(0);
        expect(next.senteInByoyomi).toBe(false); // byoyomi 0 → 秒読みに入らない
    });

    it("後手番の move は後手側だけを更新し先手を据え置く", () => {
        const next = applyMoveToClocks(
            mkClocks({ sente: 60_000, gote: 40_000, sideToMove: "gote" }),
            COUNTDOWN,
            "gote",
            5,
        );
        expect(next.gote).toBe(35_000);
        expect(next.sente).toBe(60_000);
        expect(next.sideToMove).toBe("sente");
    });
});

describe("deriveInByoyomi: snapshot / onClock resync の秒読み派生", () => {
    it("本体 0 + countdown + byoyomi>0 → true", () => {
        expect(deriveInByoyomi(0, COUNTDOWN)).toBe(true);
    });
    it("本体残あり → false", () => {
        expect(deriveInByoyomi(5_000, COUNTDOWN)).toBe(false);
    });
    it("countdown_msec も byoyomiMilliseconds>0 なら true", () => {
        expect(deriveInByoyomi(0, COUNTDOWN_MSEC)).toBe(true);
    });
    it("sudden-death (byoyomi 0) → false", () => {
        expect(deriveInByoyomi(0, SUDDEN_DEATH)).toBe(false);
    });
    it("fischer は秒読み方式でないため false", () => {
        expect(deriveInByoyomi(0, FISCHER)).toBe(false);
    });
    it("stopwatch は byoyomi>0 なら本体 0 で秒読み扱い", () => {
        expect(deriveInByoyomi(0, STOPWATCH)).toBe(true);
    });
    it("timeControl 未取得なら false", () => {
        expect(deriveInByoyomi(0, undefined)).toBe(false);
    });
});

describe("applyMoveComment (onMoveComment reducer)", () => {
    it("奇数 ply は先手・偶数 ply は後手の eval として保持する (wire=先手視点のまま)", () => {
        const afterSente = applyMoveComment({}, 1, { evalCp: 120, pv: ["+7776FU"] });
        expect(afterSente).toEqual({ senteEvalCp: 120, latestPv: ["+7776FU"] });
        const afterGote = applyMoveComment(afterSente, 2, { evalCp: -80, pv: ["-3334FU"] });
        expect(afterGote).toEqual({
            senteEvalCp: 120,
            goteEvalCp: -80,
            latestPv: ["-3334FU"],
        });
    });
    it("eval/pv の無いコメントは前の値を据え置く", () => {
        const prev = { senteEvalCp: 50, goteEvalCp: -10, latestPv: ["+2726FU"] };
        expect(applyMoveComment(prev, 3, {})).toEqual(prev);
    });
});

describe("summarizeMoveDetails", () => {
    const move = (
        csaMove: string,
        elapsedSec: number,
        comment?: RshogiLiveMove["comment"],
    ): RshogiLiveMove => ({ csaMove, elapsedSec, comment });

    it("各手番の最新 eval・最新 PV・直近消費秒を導出する", () => {
        const details = [
            move("7g7f", 8, { raw: "* 30 -3334FU", evalCp: 30, pv: ["-3334FU"] }),
            move("3c3d", 7, { raw: "* -20 +2726FU", evalCp: -20, pv: ["+2726FU"] }),
            move("2g2f", 5, { raw: "* 45", evalCp: 45 }),
        ];
        expect(summarizeMoveDetails(details)).toEqual({
            senteEvalCp: 45, // ply3 (先手) が最新
            goteEvalCp: -20, // ply2 (後手)
            latestPv: ["+2726FU"], // 最後に PV を持つコメント
            lastMoveElapsedSec: 5,
        });
    });
    it("コメントの無い (旧サーバ) moveDetails は eval/PV undefined・消費秒のみ", () => {
        const details = [move("7g7f", 0), move("3c3d", 0)];
        expect(summarizeMoveDetails(details)).toEqual({
            senteEvalCp: undefined,
            goteEvalCp: undefined,
            latestPv: undefined,
            lastMoveElapsedSec: 0,
        });
    });
    it("空配列では全て undefined", () => {
        expect(summarizeMoveDetails([])).toEqual({
            senteEvalCp: undefined,
            goteEvalCp: undefined,
            latestPv: undefined,
            lastMoveElapsedSec: undefined,
        });
    });
});

describe("moveEvals accumulation (initialReview.moveData の材料)", () => {
    const move = (
        csaMove: string,
        elapsedSec: number,
        comment?: RshogiLiveMove["comment"],
    ): RshogiLiveMove => ({ csaMove, elapsedSec, comment });

    it("moveDetailsToEvals: snapshot を moves と同順・同長の付随情報に変換する", () => {
        const details = [
            // 先手 (奇数 ply): 先手視点 +30
            move("7g7f", 3, { raw: "* 30 -3334FU", evalCp: 30, pv: ["-3334FU"] }),
            // 後手 (偶数 ply): 先手視点 -20 (符号そのまま = 反転しない)
            move("3c3d", 5, { raw: "* -20", evalCp: -20 }),
            // 消費秒のみ (コメント無し)
            move("2g2f", 4),
            // eval も T も無い (旧サーバ) → undefined
            move("8c8d", 0),
        ];
        expect(moveDetailsToEvals(details)).toEqual([
            { elapsedMs: 3000, evalCp: 30 },
            { elapsedMs: 5000, evalCp: -20 },
            { elapsedMs: 4000, evalCp: undefined },
            undefined,
        ]);
    });

    it("moveDetailsToEvals: 詰みセンチネル ±100000 は手数不明の詰みとして表示できる形にする", () => {
        const details = [
            move("3f3e", 3, { raw: "* 100000", evalCp: 100000 }),
            move("5a4b", 2, { raw: "* -100000", evalCp: -100000 }),
        ];
        expect(moveDetailsToEvals(details)).toEqual([
            { elapsedMs: 3000, evalMate: MATE_WITHOUT_PLY },
            { elapsedMs: 2000, evalMate: -MATE_WITHOUT_PLY },
        ]);
        expect(formatEval(undefined, moveDetailsToEvals(details)[0]?.evalMate)).toBe("+詰");
        expect(formatEval(undefined, moveDetailsToEvals(details)[1]?.evalMate)).toBe("-詰");
    });

    it("setMoveEvalAtPly: 後追いコメントの詰みセンチネルも手数不明の詰みとして表示できる形にする", () => {
        const prev = [{ elapsedMs: 3000, evalCp: 30 }, { elapsedMs: 6000 }];
        const next = setMoveEvalAtPly(prev, 2, { evalCp: -100000 });
        expect(next).toEqual([
            { elapsedMs: 3000, evalCp: 30 },
            { elapsedMs: 6000, evalCp: undefined, evalMate: -MATE_WITHOUT_PLY },
        ]);
        expect(formatEval(next[1]?.evalCp, next[1]?.evalMate)).toBe("-詰");
    });

    it("appendMoveEval: broadcast move は消費秒のみで追加し eval は後追い", () => {
        const prev = [{ elapsedMs: 3000, evalCp: 30 }];
        // T 付きの新規手 → elapsedMs のみ (eval 未確定)
        expect(appendMoveEval(prev, 6)).toEqual([
            { elapsedMs: 3000, evalCp: 30 },
            { elapsedMs: 6000 },
        ]);
        // T 無し (旧サーバ) → undefined を追加
        expect(appendMoveEval(prev, 0)).toEqual([{ elapsedMs: 3000, evalCp: 30 }, undefined]);
    });

    it("setMoveEvalAtPly: 該当 ply に eval を後追いし、消費秒は保持する", () => {
        // onMove で消費秒だけ入った状態に、onMoveComment で ply2 の eval を書き込む
        const prev = [{ elapsedMs: 3000, evalCp: 30 }, { elapsedMs: 6000 }];
        const next = setMoveEvalAtPly(prev, 2, { evalCp: -45 });
        expect(next).toEqual([
            { elapsedMs: 3000, evalCp: 30 },
            { elapsedMs: 6000, evalCp: -45 },
        ]);
        // 元配列は不変
        expect(prev[1]).toEqual({ elapsedMs: 6000 });
    });

    it("setMoveEvalAtPly: eval 無しコメント・範囲外 ply は配列を据え置く", () => {
        const prev = [{ elapsedMs: 3000, evalCp: 30 }];
        expect(setMoveEvalAtPly(prev, 1, {})).toBe(prev); // eval 無し
        expect(setMoveEvalAtPly(prev, 5, { evalCp: 10 })).toBe(prev); // 範囲外
    });

    it("snapshot → 増分 move → 増分 comment の一連で moves と整合する", () => {
        // snapshot: 1 手 (eval 付き)
        let evals = moveDetailsToEvals([move("7g7f", 3, { raw: "* 30", evalCp: 30 })]);
        expect(evals).toEqual([{ elapsedMs: 3000, evalCp: 30 }]);
        // broadcast move (ply2): 消費秒のみ
        evals = appendMoveEval(evals, 5);
        expect(evals).toEqual([{ elapsedMs: 3000, evalCp: 30 }, { elapsedMs: 5000 }]);
        // move comment (ply2): 後手視点でも先手視点 -20 のまま
        evals = setMoveEvalAtPly(evals, 2, { evalCp: -20 });
        expect(evals).toEqual([
            { elapsedMs: 3000, evalCp: 30 },
            { elapsedMs: 5000, evalCp: -20 },
        ]);
    });
});

describe("RshogiLiveScoreboard: 評価値 / 消費時間の表示", () => {
    it("各手番の評価値をその手番視点で表示する (後手は符号反転)", () => {
        render(
            <RshogiLiveScoreboard
                meta={META}
                moveCount={2}
                clocks={mkClocks({ sideToMove: "sente" })}
                elapsedSinceAnchor={0}
                connectionState="connected"
                senteEvalCp={120}
                goteEvalCp={-80}
                lastMoveElapsedSec={12}
            />,
        );
        // 先手: wire 120 (先手視点) → そのまま +120
        expect(screen.getByText("評価値 +120")).toBeDefined();
        // 後手: wire -80 (先手視点) → 後手視点 +80
        expect(screen.getByText("評価値 +80")).toBeDefined();
        // 直近手の消費秒
        expect(screen.getByText("直前手 12秒")).toBeDefined();
    });

    it("評価値・消費秒が無いときは評価値/直前手を表示しない (graceful)", () => {
        render(
            <RshogiLiveScoreboard
                meta={META}
                moveCount={0}
                clocks={mkClocks({ sideToMove: "sente" })}
                elapsedSinceAnchor={0}
                connectionState="connected"
            />,
        );
        expect(screen.queryByText(/評価値/)).toBeNull();
        expect(screen.queryByText(/直前手/)).toBeNull();
    });

    it("秒読み中の手番側は 00:00 で固まらず「秒読み」と残秒を表示する", () => {
        render(
            <RshogiLiveScoreboard
                meta={{ ...META, timeControl: COUNTDOWN }}
                moveCount={40}
                clocks={mkClocks({
                    sente: 0,
                    gote: 30_000,
                    sideToMove: "sente",
                    senteInByoyomi: true,
                })}
                elapsedSinceAnchor={3_000}
                connectionState="connected"
            />,
        );
        // 秒読みラベルと残秒 (full 10s から 3s 補間 → ceil(7000/1000)=7 → "0:07")
        expect(screen.getByText("秒読み")).toBeDefined();
        expect(screen.getByText("0:07")).toBeDefined();
        // 後手は本体表示のまま (秒読みラベルは 1 件のみ)
        expect(screen.getByText("00:30")).toBeDefined();
    });
});

describe("RshogiLiveMetaPanel: 読み筋の表示", () => {
    it("最新 PV を CSA トークンで表示する", () => {
        render(<RshogiLiveMetaPanel meta={META} latestPv={["+7776FU", "-3334FU"]} />);
        expect(screen.getByText("読み筋")).toBeDefined();
        expect(screen.getByText("+7776FU -3334FU")).toBeDefined();
    });
    it("長い PV は表示を末尾省略しつつ title には全文を渡す", () => {
        const pv = Array.from({ length: 20 }, (_, i) => `+m${i}`);
        render(<RshogiLiveMetaPanel meta={META} latestPv={pv} />);
        const truncated = screen.getByText(/…$/);
        expect(truncated).toBeDefined();
        // ツールチップ (title) は省略前の全文。
        expect(truncated.getAttribute("title")).toBe(pv.join(" "));
    });
    it("PV が無いときは読み筋を表示しない", () => {
        render(<RshogiLiveMetaPanel meta={META} />);
        expect(screen.queryByText("読み筋")).toBeNull();
    });

    it("#MAX_MOVES は勝者不明でも引き分けとして表示する", () => {
        render(
            <RshogiLiveMetaPanel
                meta={META}
                result={{ kind: "max_moves", endReason: "MAX_MOVES" }}
            />,
        );
        expect(screen.getByText("引き分け (最大手数)")).toBeDefined();
    });
});
