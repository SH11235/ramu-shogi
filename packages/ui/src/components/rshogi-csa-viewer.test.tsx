import type { RshogiGame } from "@shogi/match-client";
import { fetchRshogiGame } from "@shogi/match-client";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RshogiCsaViewer } from "./rshogi-csa-viewer";

vi.mock("@shogi/match-client", () => ({
    fetchRshogiGame: vi.fn(),
    RshogiGameNotFoundError: class RshogiGameNotFoundError extends Error {},
}));

vi.mock("./shogi-match", () => ({
    ShogiMatch: ({ reviewLeftContent }: { reviewLeftContent?: ReactNode }) => (
        <div data-testid="shogi-match">{reviewLeftContent}</div>
    ),
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
