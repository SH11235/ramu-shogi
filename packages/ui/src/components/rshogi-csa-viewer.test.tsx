import type { RshogiGame } from "@shogi/match-client";
import { fetchRshogiGame, fetchRshogiGameEvents } from "@shogi/match-client";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RshogiCsaViewer } from "./rshogi-csa-viewer";

vi.mock("@shogi/match-client", () => ({
    fetchRshogiGame: vi.fn(),
    fetchRshogiGameEvents: vi.fn(),
    RshogiGameNotFoundError: class RshogiGameNotFoundError extends Error {},
}));

interface CapturedShogiMatchProps {
    initialReview?: { sfen: string; moves: string[]; moveData?: unknown[]; openAt?: "start" };
    spectateMode?: boolean;
    viewerMode?: boolean;
    boardTopContent?: ReactNode;
    mobileHeaderContent?: ReactNode;
    evalGraphPinned?: boolean;
    onPositionSnapshot?: (snapshot: { sfen: string; moves: string[]; label?: string }) => void;
}

const capturedProps: CapturedShogiMatchProps[] = [];

vi.mock("./shogi-match", () => ({
    ShogiMatch: (props: CapturedShogiMatchProps & { reviewLeftContent?: ReactNode }) => {
        capturedProps.push(props);
        return (
            <div data-testid="shogi-match">
                <div data-testid="board-top">{props.boardTopContent}</div>
                <div data-testid="mobile-header">{props.mobileHeaderContent}</div>
                <div data-testid="left-panel">{props.reviewLeftContent}</div>
            </div>
        );
    },
}));

const GAME_ID = "game-download";
const CSA_TEXT = "V2.2\nN+alice\nN-bob\nPI\n+\n+7776FU\n";
const GAME: RshogiGame = {
    meta: {
        gameId: GAME_ID,
        senteName: "alice",
        goteName: "bob",
    },
    csa: CSA_TEXT,
};

const renderViewer = () =>
    render(
        <RshogiCsaViewer gameId={GAME_ID} engineOptions={[]} manifestUrl="/nnue-manifest.json" />,
    );

describe("RshogiCsaViewer: 詰みの表示", () => {
    it.each([
        ["P+53KI00KI\nP-51OU\n+\n+0052KI\n%TORYO", "詰み"],
        ["PI\n+\n+7776FU\n%TORYO", "投了"],
    ])("最終局面から終局理由を表示する: %s", async (csa, label) => {
        vi.mocked(fetchRshogiGame).mockResolvedValue({
            ...GAME,
            csa,
            meta: {
                ...GAME.meta,
                result: { kind: "resignation", endReason: "RESIGN", winner: "sente" },
            },
        });
        renderViewer();
        expect(await screen.findByText(`結果: 先手 (alice) 勝ち (${label})`)).toBeTruthy();
    });
});

// イベントのメタデータは、既定では「メタに対応していない古いサーバー」と同じく付かない。
beforeEach(() => {
    vi.mocked(fetchRshogiGameEvents).mockReset();
    vi.mocked(fetchRshogiGameEvents).mockResolvedValue([]);
});

afterEach(() => {
    vi.restoreAllMocks();
    capturedProps.length = 0;
});

const HIRATE_POSITION = [
    "P1-KY-KE-GI-KI-OU-KI-GI-KE-KY",
    "P2 * -HI *  *  *  *  * -KA * ",
    "P3-FU-FU-FU-FU-FU-FU-FU-FU-FU",
    "P4 *  *  *  *  *  *  *  *  * ",
    "P5 *  *  *  *  *  *  *  *  * ",
    "P6 *  *  *  *  *  *  *  *  * ",
    "P7+FU+FU+FU+FU+FU+FU+FU+FU+FU",
    "P8 * +KA *  *  *  *  * +HI * ",
    "P9+KY+KE+GI+KI+OU+KI+GI+KE+KY",
];

// 角換わりの途中局面: 双方が角を 1 枚ずつ持ち、後手番。
const MIDGAME_POSITION = [
    "P1-KY-KE * -KI-OU * -GI-KE-KY",
    "P2 * -HI *  *  *  * -KI *  * ",
    "P3-FU * -FU-FU-FU-FU-GI-FU-FU",
    "P4 *  *  *  *  *  * -FU *  * ",
    "P5 * -FU *  *  *  *  * +FU * ",
    "P6 *  * +FU *  *  *  *  *  * ",
    "P7+FU+FU+GI+FU+FU+FU+FU * +FU",
    "P8 *  * +KI *  *  *  * +HI * ",
    "P9+KY+KE *  * +OU+KI+GI+KE+KY",
    "P+00KA",
    "P-00KA",
];
const MIDGAME_SFEN = "ln1gk1snl/1r4g2/p1ppppspp/6p2/1p5P1/2P6/PPSPPPP1P/2G4R1/LN2KGSNL w Bb 1";

const WDOOR_CSA = [
    "V2",
    "N+RAMU",
    "N-SampleEngine",
    ...HIRATE_POSITION,
    "+",
    "'black_rate:RAMU+0123456789abcdef:3512.4",
    "'white_rate:SampleEngine+fedcba9876543210:3447.0",
    "+7776FU",
    "T3",
    "'** 30 -3334FU +2726FU",
    "-3334FU",
    "T5",
    "+2726FU",
    "T2",
    "'** -100000",
    "%TORYO",
    "T1",
    "'summary:toryo:RAMU win:SampleEngine lose",
].join("\n");

const WDOOR_GAME: RshogiGame = {
    meta: {
        gameId: GAME_ID,
        senteName: "RAMU",
        goteName: "SampleEngine",
        source: "wdoor",
        event: "floodgate-300-10F",
        originUrl: "https://wdoor.c.u-tokyo.ac.jp/shogi/x/2026/10/09/sample.csa",
    },
    csa: WDOOR_CSA,
};

describe("RshogiCsaViewer: 外部から取り込んだ棋譜", () => {
    it("CSA のコメントから評価値・読み筋・消費時間を取り出して ShogiMatch に渡す", async () => {
        vi.mocked(fetchRshogiGame).mockResolvedValue(WDOOR_GAME);

        renderViewer();
        await screen.findByTestId("shogi-match");

        const props = capturedProps.at(-1);
        expect(props?.initialReview).toEqual({
            sfen: "startpos",
            moves: ["7g7f", "3c3d", "2g2f"],
            moveData: [
                { elapsedMs: 3000, evalCp: 30, pv: ["3c3d", "2g2f"] },
                // コメントの無い手は評価値を持たない。
                { elapsedMs: 5000 },
                // ±100000 は手数不明の詰み (後手勝ち)。
                { elapsedMs: 2000, evalMate: Number.NEGATIVE_INFINITY },
            ],
            openAt: "start",
        });
        // 評価値つきの棋譜は、評価値の列とグラフを最初から出す。
        expect(props?.spectateMode).toBe(true);
    });

    it("評価値の無い棋譜では表示設定を切り替えない", async () => {
        vi.mocked(fetchRshogiGame).mockResolvedValue(GAME);

        renderViewer();
        await screen.findByTestId("shogi-match");

        const props = capturedProps.at(-1);
        expect(props?.initialReview).toEqual({
            sfen: "startpos",
            moves: ["7g7f"],
            moveData: [undefined],
            openAt: "start",
        });
        expect(props?.spectateMode).toBe(false);
    });

    it("対局場所・イベント・レート・元棋譜へのリンクを表示する", async () => {
        vi.mocked(fetchRshogiGame).mockResolvedValue(WDOOR_GAME);

        renderViewer();

        expect(await screen.findByText("Floodgate")).toBeTruthy();
        expect(screen.getByText("floodgate-300-10F")).toBeTruthy();
        const players = within(screen.getByTestId("board-top")).getByRole("region", {
            name: "対局者",
        });
        expect(players.textContent).toBe("先手☗RAMUR3512後手☖SampleEngineR3447");
        const link = screen.getByRole("link", { name: "元の棋譜を開く（Floodgate）" });
        expect(link.getAttribute("href")).toBe(WDOOR_GAME.meta.originUrl);
        expect(link.getAttribute("target")).toBe("_blank");
        expect(link.getAttribute("rel")).toBe("noopener noreferrer");
        // 持ち時間 (clock) が無くても落ちない。
        expect(screen.getByText("持ち時間: 不明")).toBeTruthy();
    });

    it.each([
        "https://evil.example.com/https://wdoor.c.u-tokyo.ac.jp/a.csa",
        "http://wdoor.c.u-tokyo.ac.jp/shogi/x/a.csa",
        "https://wdoor.c.u-tokyo.ac.jp.evil.example.com/a.csa",
        "javascript:alert(1)",
    ])("wdoor 以外の origin_url (%s) はリンクにしない", async (originUrl) => {
        vi.mocked(fetchRshogiGame).mockResolvedValue({
            ...WDOOR_GAME,
            meta: { ...WDOOR_GAME.meta, originUrl },
        });

        renderViewer();

        await screen.findByText("Floodgate");
        expect(screen.queryByRole("link")).toBeNull();
    });

    it("upload の対局場所は「その他」で、イベント名は別の項目に出す", async () => {
        vi.mocked(fetchRshogiGame).mockResolvedValue({
            meta: { ...GAME.meta, source: "upload", event: "WCSC36" },
            csa: CSA_TEXT,
        });

        renderViewer();

        expect(await screen.findByText("その他")).toBeTruthy();
        expect(screen.getAllByText("WCSC36")).toHaveLength(1);
        expect(screen.queryByText(/\(R\d+\)/)).toBeNull();
    });

    it("途中局面・持ち駒あり・後手番開始の棋譜は、その局面の SFEN から再生する", async () => {
        vi.mocked(fetchRshogiGame).mockResolvedValue({
            ...GAME,
            csa: [
                "V2.2",
                ...MIDGAME_POSITION,
                "-",
                "-0055KA,T3",
                "'** -35 +2524FU",
                "+2524FU,T4",
            ].join("\n"),
        });

        renderViewer();
        await screen.findByTestId("shogi-match");

        expect(capturedProps.at(-1)?.initialReview).toEqual({
            sfen: MIDGAME_SFEN,
            moves: ["B*5e", "2e2d"],
            moveData: [{ elapsedMs: 3000, evalCp: -35, pv: ["2e2d"] }, { elapsedMs: 4000 }],
            openAt: "start",
        });
    });

    it("駒落ち (PI の駒落ち指定) の棋譜も再生する", async () => {
        vi.mocked(fetchRshogiGame).mockResolvedValue({
            ...GAME,
            csa: "V2\nPI82HI22KA\n-\n-3334FU\n",
        });

        renderViewer();
        await screen.findByTestId("shogi-match");

        expect(capturedProps.at(-1)?.initialReview).toEqual({
            sfen: "lnsgkgsnl/9/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1",
            moves: ["3c3d"],
            moveData: [undefined],
            openAt: "start",
        });
    });

    it("解釈できない局面記述は再生せずエラーを表示する", async () => {
        vi.mocked(fetchRshogiGame).mockResolvedValue({
            ...GAME,
            csa: "V2\nP-51OU\nP+5XFU\n+\n+5352FU\n",
        });

        renderViewer();

        expect(
            await screen.findByText(/CSA の解析に失敗しました: CSA の開始局面を解釈できません/),
        ).toBeTruthy();
        expect(screen.queryByTestId("shogi-match")).toBeNull();
    });

    it("00AL (残りの駒をすべて持ち駒にする) の局面から再生する", async () => {
        vi.mocked(fetchRshogiGame).mockResolvedValue({
            ...GAME,
            csa: "V2\nP-51OU\nP+53FU\nP+00AL\n+\n+0052KI\n",
        });

        renderViewer();
        await screen.findByTestId("shogi-match");

        expect(capturedProps.at(-1)?.initialReview).toEqual({
            sfen: "4k4/9/4P4/9/9/9/9/9/9 b 2R2B4G4S4N4L17P 1",
            moves: ["G*5b"],
            moveData: [undefined],
            openAt: "start",
        });
    });

    it("旧 csa_client 形式 (指し手の前の `'*`) の評価値をその指し手に付ける", async () => {
        vi.mocked(fetchRshogiGame).mockResolvedValue({
            ...GAME,
            csa: [
                "V2.2",
                "PI",
                "+",
                "'* 30 +7776FU -3334FU",
                "+7776FU",
                "T3",
                "'* -50 -3334FU",
                "-3334FU",
                "T5",
            ].join("\n"),
        });

        renderViewer();
        await screen.findByTestId("shogi-match");

        expect(capturedProps.at(-1)?.initialReview?.moveData).toEqual([
            { elapsedMs: 3000, evalCp: 30, pv: ["3c3d"] },
            { elapsedMs: 5000, evalCp: -50 },
        ]);
    });

    it("駒コードの合わない指し手は行番号つきのエラーにして再生しない", async () => {
        vi.mocked(fetchRshogiGame).mockResolvedValue({
            ...GAME,
            csa: "V2\nPI\n+\n+7776HI\n",
        });

        renderViewer();

        expect(
            await screen.findByText(/CSA の解析に失敗しました: 4 行目の指し手を適用できません/),
        ).toBeTruthy();
        expect(screen.queryByTestId("shogi-match")).toBeNull();
    });

    it("対局場所の見出しとバッジで「対局場所」を二重に読み上げない", async () => {
        vi.mocked(fetchRshogiGame).mockResolvedValue(WDOOR_GAME);

        renderViewer();

        const panel = await screen.findByRole("region", { name: "対局情報" });
        expect(within(panel).getAllByText(/対局場所/)).toHaveLength(1);
    });

    it("適用できない指し手を含む棋譜はエラーを表示する", async () => {
        vi.mocked(fetchRshogiGame).mockResolvedValue({
            ...GAME,
            csa: "V2\nPI\n+\n+7776FU\n-3334FU\n+5544FU\n",
        });

        renderViewer();

        expect(await screen.findByText(/CSA の解析に失敗しました/)).toBeTruthy();
        expect(screen.queryByTestId("shogi-match")).toBeNull();
    });
});

describe("RshogiCsaViewer: 見るだけの画面と「この局面から対局」", () => {
    const renderWithPlay = (onPlayFromPosition = vi.fn()) => {
        render(
            <RshogiCsaViewer
                gameId={GAME_ID}
                engineOptions={[]}
                manifestUrl="/nnue-manifest.json"
                renderGameAction={() => <button type="button">研究ノートで開く</button>}
                onPlayFromPosition={onPlayFromPosition}
            />,
        );
        return onPlayFromPosition;
    };
    /** 盤（ShogiMatch）が「いま出している局面」を知らせる。 */
    const showPosition = (sfen: string, moves: string[]) => {
        capturedProps.at(-1)?.onPositionSnapshot?.({ sfen, moves, label: "現在局面" });
    };

    it("対局開始・棋譜読込・局面編集などを出さない指定で盤を開く", async () => {
        vi.mocked(fetchRshogiGame).mockResolvedValue(WDOOR_GAME);
        renderViewer();
        await screen.findByTestId("shogi-match");

        expect(capturedProps.at(-1)?.viewerMode).toBe(true);
    });

    it.each([
        ["評価値のある棋譜", WDOOR_GAME],
        ["評価値の無い棋譜", GAME],
    ])("評価値グラフを常に出す指定で盤を開く（%s）", async (_label, game) => {
        vi.mocked(fetchRshogiGame).mockResolvedValue(game);
        renderViewer();
        await screen.findByTestId("shogi-match");

        expect(capturedProps.at(-1)?.evalGraphPinned).toBe(true);
    });

    it("「研究ノートで開く」のすぐ下に「この局面から対局」を出す", async () => {
        vi.mocked(fetchRshogiGame).mockResolvedValue(WDOOR_GAME);
        renderWithPlay();
        await screen.findByTestId("shogi-match");

        const labels = screen.getAllByRole("button").map((button) => button.textContent);
        expect(labels).toEqual(["研究ノートで開く", "この局面から対局", "CSA ダウンロード"]);
    });

    it("引き継ぎ先を渡さない画面では「この局面から対局」を出さない", async () => {
        vi.mocked(fetchRshogiGame).mockResolvedValue(WDOOR_GAME);
        renderViewer();
        await screen.findByTestId("shogi-match");

        expect(screen.queryByRole("button", { name: "この局面から対局" })).toBeNull();
    });

    it("押すと、いま表示している手数までの手順を渡す（棋譜の最後までではない）", async () => {
        vi.mocked(fetchRshogiGame).mockResolvedValue(WDOOR_GAME);
        const onPlay = renderWithPlay();
        await screen.findByTestId("shogi-match");
        // 棋譜は 3 手。読み込み直後は最後の局面、そのあと 1 手目まで戻した。
        showPosition("startpos", ["7g7f", "3c3d", "2g2f"]);
        showPosition("startpos", ["7g7f"]);

        fireEvent.click(screen.getByRole("button", { name: "この局面から対局" }));

        expect(onPlay).toHaveBeenCalledTimes(1);
        expect(onPlay).toHaveBeenCalledWith({ sfen: "startpos", moves: ["7g7f"] });
    });

    it("分岐を見ているときは、その分岐の手順を渡す", async () => {
        vi.mocked(fetchRshogiGame).mockResolvedValue(WDOOR_GAME);
        const onPlay = renderWithPlay();
        await screen.findByTestId("shogi-match");
        showPosition("startpos", ["7g7f", "8c8d", "2g2f"]);

        fireEvent.click(screen.getByRole("button", { name: "この局面から対局" }));

        expect(onPlay).toHaveBeenCalledWith({
            sfen: "startpos",
            moves: ["7g7f", "8c8d", "2g2f"],
        });
    });

    it("平手以外・後手番開始の棋譜は、その開始局面の SFEN ごと渡す", async () => {
        vi.mocked(fetchRshogiGame).mockResolvedValue({
            ...GAME,
            csa: ["V2.2", ...MIDGAME_POSITION, "-", "-0055KA,T3", "+2524FU,T4"].join("\n"),
        });
        const onPlay = renderWithPlay();
        await screen.findByTestId("shogi-match");
        // 盤が棋譜を読み込む前は平手の開始局面を知らせてくる。これは引き継がない。
        showPosition("startpos", []);

        fireEvent.click(screen.getByRole("button", { name: "この局面から対局" }));
        expect(onPlay).toHaveBeenLastCalledWith({ sfen: MIDGAME_SFEN, moves: [] });

        showPosition(MIDGAME_SFEN, ["B*5e"]);
        fireEvent.click(screen.getByRole("button", { name: "この局面から対局" }));
        expect(onPlay).toHaveBeenLastCalledWith({ sfen: MIDGAME_SFEN, moves: ["B*5e"] });
    });
});

describe("RshogiCsaViewer: 対局者を盤の上に出す", () => {
    const LONG_NAME_GAME: RshogiGame = {
        ...WDOOR_GAME,
        meta: {
            ...WDOOR_GAME.meta,
            senteName: "RAMU_TF",
            goteName: "sinden3_770kai_473stb_10m",
        },
    };

    it("盤の上（対局時計の位置）に、先手と後手を分けて出す", async () => {
        vi.mocked(fetchRshogiGame).mockResolvedValue(LONG_NAME_GAME);
        renderViewer();

        const boardTop = await screen.findByTestId("board-top");
        const players = within(boardTop).getByRole("region", { name: "対局者" });
        const [sente, gote] = Array.from(players.children);
        expect(players.children).toHaveLength(2);
        expect(sente?.getAttribute("data-side")).toBe("sente");
        expect(sente?.textContent).toBe("先手☗RAMU_TFR3512");
        expect(gote?.getAttribute("data-side")).toBe("gote");
        // 長い名前も省略しない（幅が足りなければ折り返す）。
        expect(gote?.textContent).toBe("後手☖sinden3_770kai_473stb_10mR3447");
        expect(within(players).getByText("sinden3_770kai_473stb_10m").className).not.toContain(
            "truncate",
        );
    });

    it("先手は朱、後手は藍で色分けする（評価値グラフと同じ）", async () => {
        vi.mocked(fetchRshogiGame).mockResolvedValue(LONG_NAME_GAME);
        renderViewer();

        const players = within(await screen.findByTestId("board-top")).getByRole("region", {
            name: "対局者",
        });
        expect(within(players).getByText("☗").className).toContain("text-wafuu-shu");
        expect(within(players).getByText("☖").className).toContain("text-wafuu-ai");
    });

    it("見出しなので、背景や枠の付いたカードにしない", async () => {
        vi.mocked(fetchRshogiGame).mockResolvedValue(LONG_NAME_GAME);
        renderViewer();

        const players = within(await screen.findByTestId("board-top")).getByRole("region", {
            name: "対局者",
        });
        expect(players.className).not.toMatch(/\bbg-|\brounded|\bborder\b/);
        // 先手・後手の見分けは、見えるラベルと片側の縦線（先手 = 朱、後手 = 藍）で付ける。
        expect(within(players).getByText("先手").className).not.toContain("sr-only");
        expect(within(players).getByText("後手").className).not.toContain("sr-only");
        expect(players.children[0]?.className).toContain("border-l-4 border-wafuu-shu");
        expect(players.children[1]?.className).toContain("border-r-4 border-wafuu-ai");
    });

    const withResult = (result: RshogiGame["meta"]["result"]): RshogiGame => ({
        ...LONG_NAME_GAME,
        meta: { ...LONG_NAME_GAME.meta, result },
    });
    const winnerMarks = async () => {
        const players = within(await screen.findByTestId("board-top")).getByRole("region", {
            name: "対局者",
        });
        return Array.from(players.children).map(
            (side) => within(side as HTMLElement).queryByText("勝ち") !== null,
        );
    };

    it.each([
        ["先手", "sente", [true, false]],
        ["後手", "gote", [false, true]],
    ] as const)("%sが勝った棋譜では、その側だけに「勝ち」の印を付ける", async (_label, winner, expected) => {
        vi.mocked(fetchRshogiGame).mockResolvedValue(
            withResult({ kind: "resignation", winner, endReason: "RESIGN" }),
        );
        renderViewer();

        expect(await winnerMarks()).toEqual(expected);
    });

    it.each([
        ["引き分け（千日手）", { kind: "draw" }],
        ["中断", { kind: "abort" }],
        ["異常終了", { kind: "abnormal" }],
        ["結果不明", undefined],
    ] as const)("%sでは、どちらにも「勝ち」の印を付けない", async (_label, result) => {
        vi.mocked(fetchRshogiGame).mockResolvedValue(
            withResult(result as RshogiGame["meta"]["result"]),
        );
        renderViewer();

        expect(await winnerMarks()).toEqual([false, false]);
    });

    it("レートの無い棋譜では名前だけを出す", async () => {
        vi.mocked(fetchRshogiGame).mockResolvedValue(GAME);
        renderViewer();

        const boardTop = await screen.findByTestId("board-top");
        expect(within(boardTop).getByRole("region", { name: "対局者" }).textContent).toBe(
            "先手☗alice後手☖bob",
        );
    });

    it("左の対局情報には対局者の行を出さない（残りの項目はそのまま）", async () => {
        vi.mocked(fetchRshogiGame).mockResolvedValue(LONG_NAME_GAME);
        renderViewer();

        const leftPanel = await screen.findByTestId("left-panel");
        const info = within(leftPanel).getByRole("region", { name: "対局情報" });
        expect(within(info).queryByText("対局者")).toBeNull();
        expect(within(info).queryByText(/sinden3_770kai_473stb_10m/)).toBeNull();
        expect(within(leftPanel).queryByRole("region", { name: "対局者" })).toBeNull();
        // 対局 ID はパンくずに出ているので、対局情報には出さない。
        expect(within(info).queryByText("対局 ID")).toBeNull();
        expect(within(info).queryByText(GAME_ID)).toBeNull();
        expect(within(info).getByText("対局場所")).toBeTruthy();
        expect(within(info).getByText("floodgate-300-10F")).toBeTruthy();
    });
});

describe("RshogiCsaViewer: 対局情報パネル", () => {
    it("メタ (対局者・時刻・持ち時間・結果) を表示する", async () => {
        vi.mocked(fetchRshogiGame).mockResolvedValue({
            meta: {
                gameId: GAME_ID,
                senteName: "alice",
                goteName: "bob",
                startedAtMs: 1784307914273,
                endedAtMs: 1784309092948,
                timeControl: { kind: "countdown", mainSeconds: 600, byoyomiSeconds: 10 },
                result: { kind: "resignation", winner: "gote", endReason: "RESIGN" },
            },
            csa: CSA_TEXT,
        });

        renderViewer();

        expect(
            (
                await within(await screen.findByTestId("board-top")).findByRole("region", {
                    name: "対局者",
                })
            ).textContent,
        ).toBe("先手☗alice後手☖bob勝ち");
        // スマホの 1 行表示では「勝」と詰めて出す。
        expect(
            within(screen.getByTestId("mobile-header")).getByRole("region", { name: "対局者" })
                .textContent,
        ).toBe("☗先手alice☖後手bob勝");
        expect(screen.getByText("持ち時間: 10分 + 秒読み10秒")).toBeTruthy();
        expect(screen.getByText("結果: 後手 (bob) 勝ち (投了)")).toBeTruthy();
        expect(screen.queryByText(/不明/)).toBeNull();
    });

    it("winner なしの異常終了を引き分けと表示しない", async () => {
        vi.mocked(fetchRshogiGame).mockResolvedValue({
            meta: {
                gameId: GAME_ID,
                senteName: "alice",
                goteName: "bob",
                result: { kind: "abnormal", endReason: "ABNORMAL" },
            },
            csa: CSA_TEXT,
        });

        renderViewer();

        expect(await screen.findByText("結果: 勝敗なし (異常終了)")).toBeTruthy();
    });

    it("反則時は勝者と反則を表示する", async () => {
        vi.mocked(fetchRshogiGame).mockResolvedValue({
            meta: {
                gameId: GAME_ID,
                senteName: "alice",
                goteName: "bob",
                result: { kind: "abort", winner: "gote", endReason: "ILLEGAL" },
            },
            csa: CSA_TEXT,
        });

        renderViewer();

        expect(await screen.findByText("結果: 後手 (bob) 勝ち (反則)")).toBeTruthy();
    });

    it("千日手は引き分けと表示する", async () => {
        vi.mocked(fetchRshogiGame).mockResolvedValue({
            meta: {
                gameId: GAME_ID,
                senteName: "alice",
                goteName: "bob",
                result: { kind: "draw", endReason: "SENNICHITE" },
            },
            csa: CSA_TEXT,
        });

        renderViewer();

        expect(await screen.findByText("結果: 引き分け (千日手)")).toBeTruthy();
    });

    it("秒未満の秒読みは ms から表示する", async () => {
        vi.mocked(fetchRshogiGame).mockResolvedValue({
            meta: {
                gameId: GAME_ID,
                senteName: "alice",
                goteName: "bob",
                timeControl: {
                    kind: "countdown_msec",
                    mainSeconds: 30,
                    byoyomiSeconds: 0,
                    byoyomiMilliseconds: 250,
                },
            },
            csa: CSA_TEXT,
        });

        renderViewer();

        expect(await screen.findByText("持ち時間: 30秒 + 秒読み0.25秒")).toBeTruthy();
    });

    it("10秒の持ち時間と100msの秒読みを丸めず表示する", async () => {
        vi.mocked(fetchRshogiGame).mockResolvedValue({
            meta: {
                gameId: GAME_ID,
                senteName: "alice",
                goteName: "bob",
                timeControl: {
                    kind: "countdown_msec",
                    mainSeconds: 10,
                    byoyomiSeconds: 0,
                    byoyomiMilliseconds: 100,
                },
            },
            csa: CSA_TEXT,
        });

        renderViewer();

        expect(await screen.findByText("持ち時間: 10秒 + 秒読み0.1秒")).toBeTruthy();
    });
});

describe("RshogiCsaViewer", () => {
    it("ready 状態で CSA ダウンロードボタンを表示する", async () => {
        vi.mocked(fetchRshogiGame).mockResolvedValue(GAME);

        renderViewer();

        expect(await screen.findByRole("button", { name: "CSA ダウンロード" })).toBeTruthy();
    });

    it("サーバーから受け取った CSA を gameId のファイル名でダウンロードする", async () => {
        vi.mocked(fetchRshogiGame).mockResolvedValue(GAME);
        const createObjectUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:csa");
        const revokeObjectUrl = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
        const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
            this: HTMLAnchorElement,
        ) {
            expect(document.body.contains(this)).toBe(true);
        });
        const originalRemove = HTMLAnchorElement.prototype.remove;
        const remove = vi.spyOn(HTMLAnchorElement.prototype, "remove").mockImplementation(function (
            this: HTMLAnchorElement,
        ) {
            originalRemove.call(this);
        });
        renderViewer();

        const button = await screen.findByRole("button", { name: "CSA ダウンロード" });
        fireEvent.click(button);

        expect(createObjectUrl).toHaveBeenCalledOnce();
        const blob = createObjectUrl.mock.calls[0][0] as Blob;
        expect(blob.type).toBe("text/plain;charset=utf-8");
        await expect(blob.text()).resolves.toBe(CSA_TEXT);
        await waitFor(() => expect(click).toHaveBeenCalledOnce());
        const anchor = click.mock.contexts[0] as HTMLAnchorElement;
        expect(anchor.download).toBe(`${GAME_ID}.csa`);
        expect(remove).toHaveBeenCalledOnce();
        expect(document.body.contains(anchor)).toBe(false);
        expect(click.mock.invocationCallOrder[0]).toBeLessThan(remove.mock.invocationCallOrder[0]);
        expect(remove.mock.invocationCallOrder[0]).toBeLessThan(
            revokeObjectUrl.mock.invocationCallOrder[0],
        );
        expect(revokeObjectUrl).toHaveBeenCalledWith("blob:csa");
    });
});

describe("RshogiCsaViewer: モバイル幅", () => {
    const stubMobile = (isMobile: boolean) => {
        vi.spyOn(window, "matchMedia").mockImplementation(
            (query: string) =>
                ({
                    matches: isMobile,
                    media: query,
                    addEventListener: () => {},
                    removeEventListener: () => {},
                }) as unknown as MediaQueryList,
        );
    };

    it("左カラムの無いモバイルでも、1 行の要約とシートから対局情報に到達できる", async () => {
        stubMobile(true);
        vi.mocked(fetchRshogiGame).mockResolvedValue(WDOOR_GAME);

        renderViewer();

        // 盤の上に別の行は取らない。対局者は、盤の上の「手数・反転」の行に小さく出す。
        const summary = await screen.findByRole("button", { name: /対局情報/ });
        expect(within(summary).getByText("Floodgate")).toBeTruthy();
        const inline = within(screen.getByTestId("mobile-header")).getByRole("region", {
            name: "対局者",
        });
        expect(inline.textContent).toBe("☗先手RAMU☖後手SampleEngine");
        // 対局場所の 1 行は、盤（操作欄）の下に出す。
        expect(
            screen.getByTestId("shogi-match").compareDocumentPosition(summary) &
                Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();

        fireEvent.click(summary);

        const sheet = await screen.findByRole("dialog", { name: "対局情報" });
        // 盤の上では名前を省略しうるので、シートには対局者の全文とレートを出す。
        expect(within(sheet).getByRole("region", { name: "対局者" }).textContent).toBe(
            "先手☗RAMUR3512後手☖SampleEngineR3447",
        );
        expect(within(sheet).getByText("floodgate-300-10F")).toBeTruthy();
        expect(
            within(sheet)
                .getByRole("link", { name: "元の棋譜を開く（Floodgate）" })
                .getAttribute("href"),
        ).toBe(WDOOR_GAME.meta.originUrl);
        expect(within(sheet).getByRole("button", { name: "CSA ダウンロード" })).toBeTruthy();
    });

    it("PC 幅では要約の行を出さない (左カラムに出るため)", async () => {
        stubMobile(false);
        vi.mocked(fetchRshogiGame).mockResolvedValue(WDOOR_GAME);

        renderViewer();

        await screen.findByTestId("shogi-match");
        expect(screen.queryByRole("button", { name: /対局情報/ })).toBeNull();
        expect(screen.getByRole("button", { name: "CSA ダウンロード" })).toBeTruthy();
    });
});

describe("RshogiCsaViewer: 大会（イベント）のメタデータ", () => {
    const UPLOAD_GAME: RshogiGame = {
        meta: { ...GAME.meta, source: "upload", event: "WCSC36" },
        csa: CSA_TEXT,
    };
    const WCSC_META = {
        title: "第36回世界コンピュータ将棋選手権",
        organizer: "コンピュータ将棋協会",
        officialUrl: "https://example.org/wcsc36/",
        kifuSourceUrl: "https://example.org/wcsc36/kifu/",
        termsNote: "対局プログラム名と対局日時、大会名を明記",
    };
    const stubMobile = (isMobile: boolean) => {
        vi.spyOn(window, "matchMedia").mockImplementation(
            (query: string) =>
                ({
                    matches: isMobile,
                    media: query,
                    addEventListener: () => {},
                    removeEventListener: () => {},
                }) as unknown as MediaQueryList,
        );
    };

    it("メタがあれば、イベントの欄に正式名称・主催・公式ページ・棋譜の出典を出す", async () => {
        vi.mocked(fetchRshogiGame).mockResolvedValue(UPLOAD_GAME);
        vi.mocked(fetchRshogiGameEvents).mockResolvedValue([
            { event: "floodgate-300-10F", source: "wdoor", games: 40 },
            { event: "WCSC36", source: "upload", games: 120, meta: WCSC_META },
        ]);

        renderViewer();

        const panel = await screen.findByRole("region", { name: "対局情報" });
        expect(await within(panel).findByText(WCSC_META.title)).toBeTruthy();
        // 正式名称を出したら、短いタグは重ねて出さない。
        expect(within(panel).queryByText("WCSC36")).toBeNull();
        expect(within(panel).getByText("主催: コンピュータ将棋協会")).toBeTruthy();

        const official = within(panel).getByRole("link", {
            name: /^大会の公式ページ\s*（新しいタブで開く）$/,
        });
        expect(official.getAttribute("href")).toBe(WCSC_META.officialUrl);
        expect(official.getAttribute("target")).toBe("_blank");
        expect(official.getAttribute("rel")).toBe("noopener noreferrer");
        const kifuSource = within(panel).getByRole("link", {
            name: /^棋譜の出典\s*（新しいタブで開く）$/,
        });
        expect(kifuSource.getAttribute("href")).toBe(WCSC_META.kifuSourceUrl);
        expect(kifuSource.getAttribute("target")).toBe("_blank");
        expect(kifuSource.getAttribute("rel")).toBe("noopener noreferrer");

        // 利用条件のメモは利用者向けの文ではないので出さない。
        expect(screen.queryByText(/大会名を明記/)).toBeNull();
    });

    it("主催や URL の無いメタでは、ある項目だけを出す", async () => {
        vi.mocked(fetchRshogiGame).mockResolvedValue(UPLOAD_GAME);
        vi.mocked(fetchRshogiGameEvents).mockResolvedValue([
            {
                event: "WCSC36",
                source: "upload",
                games: 120,
                meta: { title: WCSC_META.title, officialUrl: WCSC_META.officialUrl },
            },
        ]);

        renderViewer();

        const panel = await screen.findByRole("region", { name: "対局情報" });
        await within(panel).findByText(WCSC_META.title);
        expect(within(panel).queryByText(/主催/)).toBeNull();
        expect(within(panel).getAllByRole("link")).toHaveLength(1);
        expect(
            within(panel).getByRole("link", { name: /^大会の公式ページ\s*（新しいタブで開く）$/ }),
        ).toBeTruthy();
    });

    it("メタの無いイベント（古いサーバーを含む）では、これまでどおりタグだけを出す", async () => {
        vi.mocked(fetchRshogiGame).mockResolvedValue(UPLOAD_GAME);
        vi.mocked(fetchRshogiGameEvents).mockResolvedValue([
            { event: "WCSC36", source: "upload", games: 120 },
            // 別のイベントのメタを、このイベントに付けない
            { event: "DR5", source: "upload", games: 3, meta: { title: "第5回電竜戦" } },
        ]);

        renderViewer();

        const panel = await screen.findByRole("region", { name: "対局情報" });
        await waitFor(() => expect(fetchRshogiGameEvents).toHaveBeenCalled());
        expect(within(panel).getByText("WCSC36")).toBeTruthy();
        expect(within(panel).queryByRole("link")).toBeNull();
        expect(within(panel).queryByText(/主催/)).toBeNull();
        expect(screen.queryByText("第5回電竜戦")).toBeNull();
    });

    it("イベント一覧の取得に失敗しても、棋譜はそのまま表示し、タグだけを出す", async () => {
        vi.mocked(fetchRshogiGame).mockResolvedValue(UPLOAD_GAME);
        vi.mocked(fetchRshogiGameEvents).mockRejectedValue(new Error("events API down"));

        renderViewer();

        const panel = await screen.findByRole("region", { name: "対局情報" });
        await waitFor(() => expect(fetchRshogiGameEvents).toHaveBeenCalled());
        expect(screen.getByTestId("shogi-match")).toBeTruthy();
        expect(within(panel).getByText("WCSC36")).toBeTruthy();
        expect(within(panel).queryByRole("link")).toBeNull();
        expect(screen.queryByText(/events API down/)).toBeNull();
        expect(screen.queryByRole("alert")).toBeNull();
    });

    it("イベントの付いていない棋譜では、イベント一覧を取りに行かない", async () => {
        vi.mocked(fetchRshogiGame).mockResolvedValue(GAME);

        renderViewer();

        await screen.findByTestId("shogi-match");
        expect(fetchRshogiGameEvents).not.toHaveBeenCalled();
    });

    it("スマホでは、対局情報のシートの中に同じ内容を出す", async () => {
        stubMobile(true);
        vi.mocked(fetchRshogiGame).mockResolvedValue(UPLOAD_GAME);
        vi.mocked(fetchRshogiGameEvents).mockResolvedValue([
            { event: "WCSC36", source: "upload", games: 120, meta: WCSC_META },
        ]);

        renderViewer();

        fireEvent.click(await screen.findByRole("button", { name: /対局情報/ }));
        const sheet = await screen.findByRole("dialog", { name: "対局情報" });
        expect(await within(sheet).findByText(WCSC_META.title)).toBeTruthy();
        expect(within(sheet).getByText("主催: コンピュータ将棋協会")).toBeTruthy();
        expect(
            within(sheet)
                .getByRole("link", { name: /^大会の公式ページ\s*（新しいタブで開く）$/ })
                .getAttribute("href"),
        ).toBe(WCSC_META.officialUrl);
        expect(
            within(sheet)
                .getByRole("link", { name: /^棋譜の出典\s*（新しいタブで開く）$/ })
                .getAttribute("href"),
        ).toBe(WCSC_META.kifuSourceUrl);
    });
});
