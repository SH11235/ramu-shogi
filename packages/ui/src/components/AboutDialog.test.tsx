import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AboutDialog } from "./AboutDialog";

describe("AboutDialog", () => {
    describe("表示", () => {
        it("open=true の場合、ダイアログが表示される", () => {
            render(<AboutDialog open={true} onOpenChange={vi.fn()} />);

            expect(screen.getByText("このアプリについて")).toBeDefined();
            expect(screen.getByText("Ramu Shogi")).toBeDefined();
        });

        it("open=false の場合、ダイアログが表示されない", () => {
            render(<AboutDialog open={false} onOpenChange={vi.fn()} />);

            expect(screen.queryByText("このアプリについて")).toBeNull();
        });

        it("日本語のライセンス情報が表示される", () => {
            render(<AboutDialog open={true} onOpenChange={vi.fn()} />);

            expect(screen.getByText("ライセンス")).toBeDefined();
            expect(
                screen.getByText(
                    "このアプリケーションは GNU General Public License v3.0 の下でライセンスされています。",
                ),
            ).toBeDefined();
        });

        it("英語のライセンス情報が表示される", () => {
            render(<AboutDialog open={true} onOpenChange={vi.fn()} />);

            expect(screen.getByText("License")).toBeDefined();
            expect(
                screen.getByText(
                    "This application is licensed under the GNU General Public License v3.0.",
                ),
            ).toBeDefined();
        });

        it("NNUEファイルに関する注意が表示される", () => {
            render(<AboutDialog open={true} onOpenChange={vi.fn()} />);

            expect(screen.getByText("NNUEファイルについて")).toBeDefined();
            expect(
                screen.getByText(
                    "アップロードされたNNUEファイルはユーザー提供コンテンツです。 そのライセンスは本アプリケーションでは管理・検証されません。 NNUEファイルの使用権を確認の上、ご利用ください。",
                ),
            ).toBeDefined();
        });

        it("駒画像のクレジットが表示される", () => {
            render(<AboutDialog open={true} onOpenChange={vi.fn()} />);

            expect(screen.getByText("駒画像")).toBeDefined();
            expect(
                screen.getByText(
                    "駒画像は sunfish-shogi 氏が CC0 1.0 Universal（パブリックドメイン）で公開している素材を使用しています。",
                ),
            ).toBeDefined();
        });
    });

    describe("リンク", () => {
        it("GitHubリンクが正しいURLを持つ", () => {
            render(<AboutDialog open={true} onOpenChange={vi.fn()} />);

            const githubLink = screen.getByText("ソースコード (GitHub)");
            expect(githubLink.getAttribute("href")).toBe("https://github.com/SH11235/ramu-shogi");
            expect(githubLink.getAttribute("target")).toBe("_blank");
            expect(githubLink.getAttribute("rel")).toBe("noopener noreferrer");
        });

        it("GPL-3.0リンクが正しいURLを持つ", () => {
            render(<AboutDialog open={true} onOpenChange={vi.fn()} />);

            const gplLink = screen.getByText("ライセンス全文 (GPL-3.0)");
            expect(gplLink.getAttribute("href")).toBe("https://www.gnu.org/licenses/gpl-3.0.html");
            expect(gplLink.getAttribute("target")).toBe("_blank");
            expect(gplLink.getAttribute("rel")).toBe("noopener noreferrer");
        });

        it("駒画像リンクが正しいURLを持つ", () => {
            render(<AboutDialog open={true} onOpenChange={vi.fn()} />);

            const shogiImagesLink = screen.getByText("Shogi Images");
            expect(shogiImagesLink.getAttribute("href")).toBe(
                "https://sunfish-shogi.github.io/shogi-images",
            );
            expect(shogiImagesLink.getAttribute("target")).toBe("_blank");
            expect(shogiImagesLink.getAttribute("rel")).toBe("noopener noreferrer");

            const authorLink = screen.getByText("sunfish-shogi (GitHub)");
            expect(authorLink.getAttribute("href")).toBe("https://github.com/sunfish-shogi");
            expect(authorLink.getAttribute("target")).toBe("_blank");
            expect(authorLink.getAttribute("rel")).toBe("noopener noreferrer");
        });
    });

    describe("閉じる動作", () => {
        it("閉じるボタンをクリックすると onOpenChange が呼ばれる", () => {
            const onOpenChange = vi.fn();
            render(<AboutDialog open={true} onOpenChange={onOpenChange} />);

            const closeButton = screen.getByLabelText("閉じる");
            fireEvent.click(closeButton);

            expect(onOpenChange).toHaveBeenCalledWith(false);
        });
    });
});
