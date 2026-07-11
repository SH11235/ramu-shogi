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
            "マイ棋譜",
            "公開棋譜",
            "ライブ観戦",
            "CSA 棋譜ビューア",
            "NNUE モデル",
            "ログイン",
        ]) {
            expect(screen.getByRole("link", { name: link })).toBeTruthy();
        }
    });

    it("現在地を aria-current で示し、live はセグメント境界で判定する", () => {
        const liveSections = buildNavSections("/rshogi-viewer/live/test");
        const liveItem = liveSections
            .flatMap((section) => section.items)
            .find((item) => {
                return item.to === "/rshogi-viewer/live";
            });
        expect(liveItem?.active).toBe(true);

        mockPathname = "/rshogi-viewer/live-game-id";
        render(<NavDrawer />);
        fireEvent.click(screen.getByRole("button", { name: "メニュー" }));

        expect(
            screen.getByRole("link", { name: "CSA 棋譜ビューア" }).getAttribute("aria-current"),
        ).toBe("page");
        expect(screen.getByRole("link", { name: "ライブ観戦" }).getAttribute("aria-current")).toBe(
            null,
        );
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
