import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface TestSession {
    authenticated: boolean;
    user: { id: string; displayName: string } | null;
}

let session: TestSession = { authenticated: false, user: null };
const historyPush = vi.fn();
const invalidate = vi.fn(async () => undefined);
const refreshSession = vi.fn(async () => undefined);

vi.mock("@tanstack/react-router", () => ({
    Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
    useRouter: () => ({ history: { push: historyPush }, invalidate }),
}));
vi.mock("../../components/HeaderNav", () => ({ HeaderNav: () => null }));
vi.mock("../../components/PageHeader", () => ({ PageHeader: () => null }));
vi.mock("../../hooks/useAuthSession", () => ({
    useAuthSession: () => ({
        session,
        sessionError: null,
        isLoadingSession: false,
        refreshSession,
    }),
    dispatchAuthSessionSyncEvent: vi.fn(),
    parseApiError: vi.fn(async () => "error"),
}));

const { default: AuthPage } = await import("./AuthPage");

/** ログインのボタンを押して、backend の開始エンドポイントへ渡した戻り先を返す。 */
const startLoginAndReadNext = (buttonName = "Google アカウントでログイン"): string | null => {
    const assign = vi.fn();
    vi.stubGlobal("location", {
        pathname: window.location.pathname,
        search: window.location.search,
        hash: window.location.hash,
        assign,
    });
    render(<AuthPage />);
    fireEvent.click(screen.getByRole("button", { name: buttonName }));

    expect(assign).toHaveBeenCalledTimes(1);
    const url = new URL(String(assign.mock.calls[0]?.[0]), "https://app.invalid");
    expect(url.pathname).toBe("/api/auth/google/start");
    return url.searchParams.get("next");
};

describe("AuthPage", () => {
    beforeEach(() => {
        session = { authenticated: false, user: null };
        historyPush.mockClear();
        invalidate.mockClear();
        refreshSession.mockClear();
        window.history.replaceState(null, "", "/auth");
    });

    afterEach(() => {
        cleanup();
        vi.unstubAllGlobals();
    });

    it("戻り先つきで開くと、ログインの開始時にその戻り先（クエリとハッシュごと）を backend へ渡す", () => {
        window.history.replaceState(
            null,
            "",
            "/auth?next=%2Frshogi-viewer%3Fevent%3DWCSC36%26venue%3Dfloodgate%23list",
        );

        expect(startLoginAndReadNext()).toBe("/rshogi-viewer?event=WCSC36&venue=floodgate#list");
        expect(screen.getByText(/元のページに戻ります/)).toBeTruthy();
    });

    it("戻り先が無ければ、これまでどおりトップへ戻す", () => {
        expect(startLoginAndReadNext()).toBe("/");
        expect(screen.getByText(/トップページに移動します/)).toBeTruthy();
    });

    it("ログインに失敗して戻されたら、理由を出して、同じ戻り先でやり直せる", () => {
        window.history.replaceState(null, "", "/auth?login_error=failed&next=%2Fgames");

        expect(startLoginAndReadNext("もう一度 Google でログイン")).toBe("/games");
        expect(screen.getByRole("alert").textContent).toContain("ログインを完了できませんでした");
    });

    it("Google でやめて戻されたら、中止したことを伝える", () => {
        window.history.replaceState(null, "", "/auth?login_error=cancelled");

        render(<AuthPage />);

        expect(screen.getByRole("alert").textContent).toBe("Google でのログインを中止しました。");
    });

    it.each(["unknown", "constructor"])("知らない login_error（%s）では何も出さない", (value) => {
        window.history.replaceState(null, "", `/auth?login_error=${value}`);

        render(<AuthPage />);

        expect(screen.queryByRole("alert")).toBeNull();
        expect(screen.getByRole("button", { name: "Google アカウントでログイン" })).toBeTruthy();
    });

    it("ログイン済みなら、失敗の表示は出さない", () => {
        window.history.replaceState(null, "", "/auth?login_error=failed");
        session = { authenticated: true, user: { id: "user-1", displayName: "ラム" } };

        render(<AuthPage />);

        expect(screen.queryByRole("alert")).toBeNull();
    });

    it.each([
        "https://evil.example/",
        "//evil.example",
        "/\\evil.example",
        "/auth",
        "/auth?next=%2Fauth",
        "/api/auth/logout",
        "javascript:alert(1)",
    ])("使えない戻り先 %s は捨てて、トップへ戻す", (next) => {
        window.history.replaceState(null, "", `/auth?next=${encodeURIComponent(next)}`);

        expect(startLoginAndReadNext()).toBe("/");
    });

    describe("初回ログイン後のユーザー名設定", () => {
        const saveDisplayName = async (): Promise<void> => {
            session = { authenticated: true, user: { id: "user-1", displayName: "" } };
            vi.stubGlobal(
                "fetch",
                vi.fn(async () => new Response(JSON.stringify({ user: {} }), { status: 200 })),
            );
            render(<AuthPage />);
            fireEvent.change(screen.getByRole("textbox", { name: "ユーザー名" }), {
                target: { value: "ラム" },
            });
            fireEvent.click(screen.getByRole("button", { name: "ユーザー名を保存" }));
            await waitFor(() => expect(historyPush).toHaveBeenCalledTimes(1));
        };

        it("保存すると、ログインを始めた画面（クエリとハッシュごと）へ戻る", async () => {
            window.history.replaceState(
                null,
                "",
                "/auth?setup=username&next=%2Fstudies%2Fabc%3Fview%3Dtree%23n1",
            );

            await saveDisplayName();

            expect(historyPush).toHaveBeenCalledWith("/studies/abc?view=tree#n1");
        });

        it("戻り先が無い・使えないときは、トップへ進む", async () => {
            window.history.replaceState(null, "", "/auth?setup=username&next=%2F%2Fevil.example");

            await saveDisplayName();

            expect(historyPush).toHaveBeenCalledWith("/");
        });
    });

    it("ユーザー名設定でない保存では、どこへも遷移しない", async () => {
        window.history.replaceState(null, "", "/auth?next=%2Fstudies%2Fabc");
        session = { authenticated: true, user: { id: "user-1", displayName: "ラム" } };
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => new Response(JSON.stringify({ user: {} }), { status: 200 })),
        );
        render(<AuthPage />);

        fireEvent.click(screen.getByRole("button", { name: "ユーザー名を保存" }));

        expect(await screen.findByText("ユーザー名を更新しました。")).toBeTruthy();
        expect(historyPush).not.toHaveBeenCalled();
    });
});
