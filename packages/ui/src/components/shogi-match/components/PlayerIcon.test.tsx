import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ShogiMatchProvider } from "../ShogiMatchContext";
import { PlayerIcon } from "./PlayerIcon";

afterEach(cleanup);

const presetIconUrls = { coco: "https://example.test/coco.jpg" };

describe("AI プリセットのアイコン", () => {
    it("各側の選択を反映し、切替後も相手側の画像を維持する", () => {
        const view = (sente: string) => (
            <ShogiMatchProvider config={{ presetIconUrls, aiPresetKeys: { sente, gote: "coco" } }}>
                <PlayerIcon side="sente" isAI />
                <PlayerIcon side="gote" isAI />
            </ShogiMatchProvider>
        );
        const { rerender } = render(view("ramu"));
        expect(screen.getByAltText("先手AI").getAttribute("src")).toBe("/ramu.jpeg");
        expect(screen.getByAltText("後手AI").getAttribute("src")).toBe(presetIconUrls.coco);
        expect(screen.getByAltText("先手AI").getAttribute("crossorigin")).toBeNull();
        expect(screen.getByAltText("後手AI").getAttribute("crossorigin")).toBe("anonymous");
        rerender(view("coco"));
        expect(screen.getByAltText("先手AI").getAttribute("src")).toBe(presetIconUrls.coco);
        expect(screen.getByAltText("後手AI").getAttribute("src")).toBe(presetIconUrls.coco);
    });

    it("選択メニューの候補は現在選択中の AI に影響されない", () => {
        render(
            <ShogiMatchProvider config={{ presetIconUrls, aiPresetKeys: { sente: "coco" } }}>
                <PlayerIcon side="sente" isAI presetKey="ramu" />
                <PlayerIcon side="gote" isAI presetKey="coco" />
            </ShogiMatchProvider>,
        );
        expect(screen.getByAltText("先手AI").getAttribute("src")).toBe("/ramu.jpeg");
        expect(screen.getByAltText("後手AI").getAttribute("src")).toBe(presetIconUrls.coco);
    });

    it("プリセットを使わない AI と未知の AI は共通画像へ戻る", () => {
        render(
            <ShogiMatchProvider
                config={{
                    aiIconUrl: "/app/ramu.jpeg",
                    presetIconUrls,
                    aiPresetKeys: { sente: "coco", gote: "unknown" },
                }}
            >
                <PlayerIcon side="sente" isAI presetKey={null} />
                <PlayerIcon side="gote" isAI />
            </ShogiMatchProvider>,
        );
        for (const image of screen.getAllByRole("img")) {
            expect(image.getAttribute("src")).toBe("/app/ramu.jpeg");
        }
    });

    it("未指定の共通 URL を Provider に渡しても既定の画像を使用する", () => {
        render(
            <ShogiMatchProvider config={{ aiIconUrl: undefined }}>
                <PlayerIcon side="sente" isAI />
            </ShogiMatchProvider>,
        );
        expect(screen.getByAltText("先手AI").getAttribute("src")).toBe("/ramu.jpeg");
    });

    it("拡大表示にも選択された COCO の画像を使用する", () => {
        render(
            <ShogiMatchProvider config={{ presetIconUrls, aiPresetKeys: { sente: "coco" } }}>
                <PlayerIcon side="sente" isAI enableZoom />
            </ShogiMatchProvider>,
        );
        fireEvent.click(screen.getByRole("button", { name: "先手AIを拡大表示" }));
        const dialog = screen.getByRole("dialog");
        expect(within(dialog).getByAltText("先手AI").getAttribute("src")).toBe(presetIconUrls.coco);
        expect(within(dialog).getByAltText("先手AI").getAttribute("crossorigin")).toBe("anonymous");
    });
});
