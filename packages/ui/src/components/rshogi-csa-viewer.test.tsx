import type { RshogiGame } from "@shogi/match-client";
import { fetchRshogiGame } from "@shogi/match-client";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RshogiCsaViewer } from "./rshogi-csa-viewer";

vi.mock("@shogi/match-client", () => ({
    fetchRshogiGame: vi.fn(),
    RshogiGameNotFoundError: class RshogiGameNotFoundError extends Error {},
}));

interface CapturedShogiMatchProps {
    initialReview?: { sfen: string; moves: string[]; moveData?: unknown[] };
    spectateMode?: boolean;
    viewerMode?: boolean;
    boardTopContent?: ReactNode;
    onPositionSnapshot?: (snapshot: { sfen: string; moves: string[]; label?: string }) => void;
}

const capturedProps: CapturedShogiMatchProps[] = [];

vi.mock("./shogi-match", () => ({
    ShogiMatch: (props: CapturedShogiMatchProps & { reviewLeftContent?: ReactNode }) => {
        capturedProps.push(props);
        return (
            <div data-testid="shogi-match">
                <div data-testid="board-top">{props.boardTopContent}</div>
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
        });
        expect(props?.spectateMode).toBe(false);
    });

    it("対局場所・イベント・レート・元棋譜へのリンクを表示する", async () => {
        vi.mocked(fetchRshogiGame).mockResolvedValue(WDOOR_GAME);

        renderViewer();

        expect(await screen.findByText("Floodgate")).toBeTruthy();
        expect(screen.getByText("floodgate-300-10F")).toBeTruthy();
        const players = screen.getByRole("region", { name: "対局者" });
        expect(players.textContent).toBe("☗先手RAMUR3512☖後手SampleEngineR3447");
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
        expect(sente?.textContent).toBe("☗先手RAMU_TFR3512");
        expect(gote?.getAttribute("data-side")).toBe("gote");
        // 長い名前も省略しない（幅が足りなければ折り返す）。
        expect(gote?.textContent).toBe("☖後手sinden3_770kai_473stb_10mR3447");
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

    it("レートの無い棋譜では名前だけを出す", async () => {
        vi.mocked(fetchRshogiGame).mockResolvedValue(GAME);
        renderViewer();

        const boardTop = await screen.findByTestId("board-top");
        expect(within(boardTop).getByRole("region", { name: "対局者" }).textContent).toBe(
            "☗先手alice☖後手bob",
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

        expect((await screen.findByRole("region", { name: "対局者" })).textContent).toBe(
            "☗先手alice☖後手bob",
        );
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

        // 盤面の上には、対局者（先手・後手を分けた行）と対局場所の 1 行を出す。
        const summary = await screen.findByRole("button", { name: /対局情報/ });
        expect(within(summary).getByText("Floodgate")).toBeTruthy();
        // 盤（ShogiMatch）の外、ページの上部に出る（スマホのレイアウトは盤の上に枠を持たない）。
        const players = screen
            .getAllByRole("region", { name: "対局者" })
            .filter((region) => !screen.getByTestId("shogi-match").contains(region));
        expect(players).toHaveLength(1);
        expect(players[0]?.textContent).toBe("☗先手RAMUR3512☖後手SampleEngineR3447");

        fireEvent.click(summary);

        const sheet = await screen.findByRole("dialog", { name: "対局情報" });
        // 対局者は盤の上に出しているので、シートには重ねて出さない。
        expect(within(sheet).queryByText(/RAMU/)).toBeNull();
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
