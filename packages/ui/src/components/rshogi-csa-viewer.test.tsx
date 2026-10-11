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
}

const capturedProps: CapturedShogiMatchProps[] = [];

vi.mock("./shogi-match", () => ({
    ShogiMatch: (props: CapturedShogiMatchProps & { reviewLeftContent?: ReactNode }) => {
        capturedProps.push(props);
        return <div data-testid="shogi-match">{props.reviewLeftContent}</div>;
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
        expect(screen.getByText("☗ RAMU (R3512) vs ☖ SampleEngine (R3447)")).toBeTruthy();
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

        expect(await screen.findByText("☗ alice vs ☖ bob")).toBeTruthy();
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

        // 盤面の上には対局者と対局場所だけを 1 行で出す。
        const summary = await screen.findByRole("button", { name: /対局情報/ });
        expect(within(summary).getByText("☗ RAMU vs ☖ SampleEngine")).toBeTruthy();
        expect(within(summary).getByText("Floodgate")).toBeTruthy();

        fireEvent.click(summary);

        const sheet = await screen.findByRole("dialog", { name: "対局情報" });
        expect(within(sheet).getByText("☗ RAMU (R3512) vs ☖ SampleEngine (R3447)")).toBeTruthy();
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
