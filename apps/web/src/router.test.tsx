import { createMemoryHistory, createRouter, Outlet, RouterProvider } from "@tanstack/react-router";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./AppProviders", () => ({ AppProviders: () => <Outlet /> }));
vi.mock("./components/NavDrawer", () => ({ NavDrawer: () => <nav>メニュー</nav> }));

const { router } = await import("./router");

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    document.title = "ラム将棋";
});

async function show(path: string) {
    const testRouter = createRouter({
        ...router.options,
        history: createMemoryHistory({ initialEntries: [path] }),
        defaultPendingMinMs: 0,
    });
    await testRouter.load();
    return render(<RouterProvider router={testRouter} />);
}

describe("見つからないページ", () => {
    it("存在しない URL に案内と noindex を出し、離れると外す", async () => {
        const view = await show("/no-such-page");
        expect(await screen.findByRole("heading", { name: "ページが見つかりません" })).toBeTruthy();
        expect(document.title).toBe("ページが見つかりません | ラム将棋");
        expect(document.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe(
            "noindex",
        );
        for (const [name, href] of [
            ["対局する", "/play"],
            ["観戦", "/rshogi-viewer"],
            ["トップ", "/"],
        ]) {
            expect(screen.getByRole("link", { name }).getAttribute("href")).toBe(href);
        }
        view.unmount();
        expect(document.querySelector('meta[name="robots"]')).toBeNull();
    });

    it.each([
        [
            "/games/11111111-2222-4333-8444-555555555555",
            "棋譜が見つかりません",
            "棋譜一覧",
            "/games",
        ],
        ["/public/games/missing", "棋譜が見つかりません", "公開棋譜一覧", "/public/games"],
        ["/online/missing", "ルームが見つかりません", "オンライン対局", "/online"],
    ])("%s の 404 を案内する", async (path, title, label, href) => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => new Response(null, { status: 404 })),
        );
        await show(path);
        expect(await screen.findByRole("heading", { name: title })).toBeTruthy();
        expect(screen.getByRole("link", { name: label }).getAttribute("href")).toBe(href);
        expect(screen.getByRole("banner")).toBeTruthy();
        expect(document.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe(
            "noindex",
        );
    });

    it("root のエラー画面は provider なしで描画できる", () => {
        const RootError = router.routeTree.options.errorComponent;
        if (!RootError) throw new Error("root errorComponent がありません");
        render(
            <RootError
                error={new Error("root failure")}
                reset={() => {}}
                info={{ componentStack: "" }}
            />,
        );
        expect(screen.getByText("root failure")).toBeTruthy();
        expect(screen.getByRole("button", { name: "再読み込み" })).toBeTruthy();
        expect(screen.queryByRole("banner")).toBeNull();
    });

    it.each(["network", "server"])("ルームの %s エラーに戻り先を出す", async (failure) => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => {
                if (failure === "network") throw new Error("network");
                return new Response(null, { status: 500 });
            }),
        );
        await show("/online/missing");
        expect(await screen.findByRole("button", { name: "再読み込み" })).toBeTruthy();
        expect(screen.getByRole("link", { name: "オンライン対局" }).getAttribute("href")).toBe(
            "/online",
        );
        expect(screen.getByRole("banner")).toBeTruthy();
    });

    it("通信エラーはヘッダーと再読み込みを出す", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => {
                throw new Error("network");
            }),
        );
        await show("/public/games/missing");
        await waitFor(() => expect(screen.getByText(/ネットワークを確認/)).toBeTruthy());
        expect(screen.getByRole("banner")).toBeTruthy();
        expect(screen.getByRole("button", { name: "再読み込み" })).toBeTruthy();
        expect(document.querySelector('meta[name="robots"]')).toBeNull();
    });
});
