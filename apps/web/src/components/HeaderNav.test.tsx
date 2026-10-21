import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

let session: { authenticated: boolean; user: { displayName: string } | null } | null = null;

// 本物の Link と同じく、`search` は押した時点で評価する（描いた時点の値は href に出す）。
const navigated = vi.fn();
vi.mock("@tanstack/react-router", () => ({
    useLocation: () => ({ pathname: "/" }),
    Link: ({
        to,
        search,
        children,
    }: {
        to: string;
        search?: () => { next?: string };
        children: ReactNode;
    }) => {
        const hrefOf = (): string => {
            const next = search?.().next;
            return next === undefined ? to : `${to}?next=${encodeURIComponent(next)}`;
        };
        return (
            <a
                href={hrefOf()}
                onClick={(event) => {
                    event.preventDefault();
                    navigated(hrefOf());
                }}
            >
                {children}
            </a>
        );
    },
}));
vi.mock("../hooks/useAuthSession", () => ({
    useAuthSession: () => ({ session }),
}));

const { HeaderNav } = await import("./HeaderNav");

describe("HeaderNav", () => {
    beforeEach(() => {
        session = { authenticated: false, user: null };
        navigated.mockClear();
        window.history.replaceState(null, "", "/");
    });

    it("トップでは、戻り先なしで /auth へのリンクを出す", () => {
        render(<HeaderNav />);

        expect(screen.getByRole("link", { name: "ログイン" }).getAttribute("href")).toBe("/auth");
    });

    it("何も渡さなければ、いま開いている画面（パス + クエリ + ハッシュ）を戻り先にする", () => {
        window.history.replaceState(null, "", "/rshogi-viewer?event=WCSC36#list");
        render(<HeaderNav />);

        expect(screen.getByRole("link", { name: "ログイン" }).getAttribute("href")).toBe(
            "/auth?next=%2Frshogi-viewer%3Fevent%3DWCSC36%23list",
        );
    });

    it("リンクを描いたあとに URL が変わっていたら、押した時点の画面を戻り先にする", () => {
        window.history.replaceState(null, "", "/rshogi-viewer");
        render(<HeaderNav />);
        window.history.replaceState(null, "", "/rshogi-viewer?venue=floodgate");

        fireEvent.click(screen.getByRole("link", { name: "ログイン" }));

        expect(navigated).toHaveBeenCalledWith("/auth?next=%2Frshogi-viewer%3Fvenue%3Dfloodgate");
    });

    it("ログインの画面では、その画面が運んできた戻り先を引き継ぐ", () => {
        window.history.replaceState(null, "", "/auth?next=%2Fstudies%2Fabc");
        render(<HeaderNav />);

        expect(screen.getByRole("link", { name: "ログイン" }).getAttribute("href")).toBe(
            "/auth?next=%2Fstudies%2Fabc",
        );
    });

    it("ログイン中のアカウントの画面へのリンクには、戻り先を付けない", () => {
        session = { authenticated: true, user: { displayName: "ラム" } };
        window.history.replaceState(null, "", "/rshogi-viewer?event=WCSC36");
        render(<HeaderNav />);

        expect(screen.getByRole("link", { name: "ラム" }).getAttribute("href")).toBe("/auth");
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
