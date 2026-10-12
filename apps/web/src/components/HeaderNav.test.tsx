import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

let session: { authenticated: boolean; user: { displayName: string } | null } | null = null;

vi.mock("@tanstack/react-router", () => ({
    Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}));
vi.mock("../hooks/useAuthSession", () => ({
    useAuthSession: () => ({ session }),
}));

const { HeaderNav } = await import("./HeaderNav");

describe("HeaderNav", () => {
    beforeEach(() => {
        session = { authenticated: false, user: null };
    });

    it("何も渡さなければ、これまでどおり /auth へのリンクを出す", () => {
        render(<HeaderNav />);

        expect(screen.getByRole("link", { name: "ログイン" }).getAttribute("href")).toBe("/auth");
    });

    it("進み先を渡すと、未ログインの「ログイン」はその進み先になり、押すと渡した処理を呼ぶ", () => {
        const onNavigate = vi.fn();
        render(<HeaderNav login={{ href: "/auth?next=%2Fstudies%2Fabc", onNavigate }} />);

        const link = screen.getByRole("link", { name: "ログイン" });
        expect(link.getAttribute("href")).toBe("/auth?next=%2Fstudies%2Fabc");
        fireEvent.click(link);
        expect(onNavigate).toHaveBeenCalledTimes(1);
    });

    it("ログイン中は、進み先を渡していても、これまでどおりアカウントの画面へのリンクを出す", () => {
        session = { authenticated: true, user: { displayName: "ラム" } };
        const onNavigate = vi.fn();
        render(<HeaderNav login={{ href: "/auth?next=%2Fstudies%2Fabc", onNavigate }} />);

        const link = screen.getByRole("link", { name: "ラム" });
        expect(link.getAttribute("href")).toBe("/auth");
        fireEvent.click(link);
        expect(onNavigate).not.toHaveBeenCalled();
    });
});
