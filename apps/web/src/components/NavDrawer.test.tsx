import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

let mockPathname = "/";

vi.mock("@tanstack/react-router", () => ({
    Link: ({
        to,
        children,
        onClick,
        className,
        "aria-current": ariaCurrent,
    }: {
        to: string;
        children: ReactNode;
        onClick?: () => void;
        className?: string;
        "aria-current"?: "page";
    }) => (
        <a href={to} onClick={onClick} className={className} aria-current={ariaCurrent}>
            {children}
        </a>
    ),
    useLocation: () => ({ pathname: mockPathname }),
}));

vi.mock("../hooks/useAuthSession", () => ({
    useAuthSession: () => ({
        session: { authenticated: false, user: null },
        sessionError: null,
        isLoadingSession: false,
        refreshSession: vi.fn(),
    }),
}));

const { NavDrawer, buildNavSections } = await import("./NavDrawer");

describe("NavDrawer", () => {
    beforeEach(() => {
        mockPathname = "/";
    });

    it("セクション構造でナビゲーションを表示する", () => {
        render(<NavDrawer />);
        fireEvent.click(screen.getByRole("button", { name: "メニュー" }));

        for (const heading of ["指す", "棋譜", "観戦", "管理"]) {
            expect(screen.getByRole("heading", { name: heading })).toBeTruthy();
        }
        for (const link of [
            "対局",
            "オンライン対局",
            "研究ノート（整備中）",
            // 要ログイン導線はバッジ「要ログイン」がアクセシブルネームに続く
            "マイ棋譜 要ログイン",
            "公開棋譜",
            "観戦・棋譜一覧",
            "NNUE モデル 要ログイン",
            "ログイン",
        ]) {
            expect(screen.getByRole("link", { name: link })).toBeTruthy();
        }
    });

    it("観戦ページと棋譜ページは「観戦・棋譜一覧」を現在地にし、レーティングはメニューに出さない", () => {
        const findViewerItem = (pathname: string) =>
            buildNavSections(pathname)
                .flatMap((section) => section.items)
                .find((item) => item.to === "/rshogi-viewer");
        expect(findViewerItem("/rshogi-viewer")?.active).toBe(true);
        expect(findViewerItem("/rshogi-viewer/live/test")?.active).toBe(true);
        expect(findViewerItem("/rshogi-viewer/some-game")?.active).toBe(true);
        expect(findViewerItem("/rshogi-viewer/players")?.active).toBe(false);
        expect(findViewerItem("/rshogi-viewer-other")?.active).toBe(false);
        // 進行中一覧ページは廃止したので、ナビに専用の項目は無い。
        expect(
            buildNavSections("/rshogi-viewer")
                .flatMap((section) => section.items)
                .some((item) => (item.to as string) === "/rshogi-viewer/live"),
        ).toBe(false);

        mockPathname = "/rshogi-viewer/live/game-id";
        render(<NavDrawer />);
        fireEvent.click(screen.getByRole("button", { name: "メニュー" }));

        expect(
            screen.getByRole("link", { name: "観戦・棋譜一覧" }).getAttribute("aria-current"),
        ).toBe("page");
        // レーティングは運営者向けなので、メニューには出さない。
        expect(screen.queryByRole("link", { name: "レーティング" })).toBeNull();
    });

    it("リンククリックでドロワーを閉じる", async () => {
        render(<NavDrawer />);
        const trigger = screen.getByRole("button", { name: "メニュー" });

        fireEvent.click(trigger);
        expect(trigger.getAttribute("aria-expanded")).toBe("true");

        fireEvent.click(screen.getByRole("link", { name: "対局" }));

        await waitFor(() => {
            expect(trigger.getAttribute("aria-expanded")).toBe("false");
        });
    });
});
