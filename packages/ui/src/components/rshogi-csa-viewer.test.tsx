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
