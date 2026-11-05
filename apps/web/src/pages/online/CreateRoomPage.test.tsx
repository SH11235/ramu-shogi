import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RATE_LIMITED_MESSAGE } from "../../lib/rateLimitMessage";

vi.mock("@tanstack/react-router", () => ({
    Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
    useNavigate: () => vi.fn(),
    useLocation: () => ({ pathname: "/online/create" }),
}));

vi.mock("../../hooks/useAuthSession", () => ({
    useAuthSession: () => ({
        session: null,
        sessionError: null,
        isLoadingSession: false,
        refreshSession: vi.fn(),
    }),
    syncProfileDisplayNameIfNeeded: () => Promise.resolve(),
}));

const KINGLESS_SFEN = "9/9/9/9/9/9/9/9/4K4 b G 1";

// 本物の選択欄が SFEN 直接入力へ切り替えて入力欄が空のときに通知する "" を、選択肢として出す
vi.mock("@shogi/ui", () => ({
    onlineStartSfenProblem: (value: string) =>
        value === KINGLESS_SFEN ? "使えない局面のわけ" : null,
    PositionPresetSelector: ({
        value,
        onChange,
    }: {
        value: string;
        onChange: (v: string) => void;
    }) => (
        <select
            data-testid="position-preset"
            value={value}
            onChange={(e) => onChange(e.target.value)}
        >
            <option value="startpos">平手</option>
            <option value="">SFEN 直接入力</option>
            <option value={KINGLESS_SFEN}>玉の無い局面</option>
        </select>
    ),
    Sheet: ({ children }: { children: ReactNode }) => <>{children}</>,
    SheetTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
    SheetContent: ({ children }: { children: ReactNode }) => <>{children}</>,
    SheetTitle: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const { default: CreateRoomPage } = await import("./CreateRoomPage");

afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    delete window.turnstile;
});

describe("CreateRoomPage", () => {
    it("SFEN 直接入力が空のあいだは部屋を作成せず、平手として送らない", () => {
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);
        render(<CreateRoomPage />);
        fireEvent.change(screen.getByPlaceholderText("プレイヤー名"), {
            target: { value: "Alice" },
        });
        const submit = screen.getByRole("button", { name: "部屋を作成する" }) as HTMLButtonElement;
        expect(submit.disabled).toBe(false);

        fireEvent.change(screen.getByTestId("position-preset"), { target: { value: "" } });

        expect(submit.disabled).toBe(true);
        expect(screen.getByText("局面（SFEN）を入力すると部屋を作成できます")).toBeTruthy();
        fireEvent.click(submit);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("オンライン対局で使えない局面では部屋を作成せず、そのわけを出す", () => {
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);
        render(<CreateRoomPage />);
        fireEvent.change(screen.getByPlaceholderText("プレイヤー名"), {
            target: { value: "Alice" },
        });

        fireEvent.change(screen.getByTestId("position-preset"), {
            target: { value: KINGLESS_SFEN },
        });

        const submit = screen.getByRole("button", { name: "部屋を作成する" }) as HTMLButtonElement;
        expect(submit.disabled).toBe(true);
        expect(screen.getByText("使えない局面のわけ")).toBeTruthy();
        fireEvent.click(submit);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("パス権の回数は 1〜10 回に収める", () => {
        const { container } = render(<CreateRoomPage />);
        const passRightsOn = container.querySelectorAll<HTMLInputElement>(
            'input[name="pass-rights"]',
        )[1];
        if (!passRightsOn) throw new Error("パス権の「あり」が無い");
        fireEvent.click(passRightsOn);
        const count = screen.getByRole("spinbutton", { name: "パス権の回数" }) as HTMLInputElement;

        fireEvent.change(count, { target: { value: "15" } });
        expect(count.value).toBe("10");
        fireEvent.change(count, { target: { value: "0" } });
        expect(count.value).toBe("1");
    });

    it("ルーム作成がレート制限で拒まれたら、本文の英語ではなく日本語の文言を出す", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () =>
                Response.json(
                    {
                        error: "RATE_LIMITED",
                        message: "Too many room creation requests. Please try again later.",
                    },
                    { status: 429 },
                ),
            ),
        );
        render(<CreateRoomPage />);
        fireEvent.change(screen.getByPlaceholderText("プレイヤー名"), {
            target: { value: "Alice" },
        });
        fireEvent.click(screen.getByRole("button", { name: "部屋を作成する" }));

        expect(await screen.findByText(RATE_LIMITED_MESSAGE)).toBeTruthy();
    });

    it("zone のレート制限で本文が HTML の 429 でも、日本語の文言を出す", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(
                async () =>
                    new Response("<!DOCTYPE html><title>Error 1015</title>", {
                        status: 429,
                        headers: { "Content-Type": "text/html" },
                    }),
            ),
        );
        render(<CreateRoomPage />);
        fireEvent.change(screen.getByPlaceholderText("プレイヤー名"), {
            target: { value: "Alice" },
        });
        fireEvent.click(screen.getByRole("button", { name: "部屋を作成する" }));

        expect(await screen.findByText(RATE_LIMITED_MESSAGE)).toBeTruthy();
    });

    it("本文が JSON でない失敗でも、JSON の読み取りエラーの英語を出さない", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => new Response("<html>Bad Gateway</html>", { status: 502 })),
        );
        render(<CreateRoomPage />);
        fireEvent.change(screen.getByPlaceholderText("プレイヤー名"), {
            target: { value: "Alice" },
        });
        fireEvent.click(screen.getByRole("button", { name: "部屋を作成する" }));

        expect(await screen.findByText("ルームの作成に失敗しました")).toBeTruthy();
    });

    it("設定を拒まれた 400 は、本文の英語ではなく設定の見直しを促す", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () =>
                Response.json(
                    { error: "INVALID_REQUEST", message: "Invalid room settings" },
                    { status: 400 },
                ),
            ),
        );
        render(<CreateRoomPage />);
        fireEvent.change(screen.getByPlaceholderText("プレイヤー名"), {
            target: { value: "Alice" },
        });
        fireEvent.click(screen.getByRole("button", { name: "部屋を作成する" }));

        expect(
            await screen.findByText(
                "この設定では部屋を作れません。開始局面の駒の数や手数を確認してください。",
            ),
        ).toBeTruthy();
    });

    it("429 以外で本文に message が無い失敗は、エラーコードではなくルーム作成の失敗と伝える", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => Response.json({ error: "CREATE_FAILED" }, { status: 500 })),
        );
        render(<CreateRoomPage />);
        fireEvent.change(screen.getByPlaceholderText("プレイヤー名"), {
            target: { value: "Alice" },
        });
        fireEvent.click(screen.getByRole("button", { name: "部屋を作成する" }));

        expect(await screen.findByText("ルームの作成に失敗しました")).toBeTruthy();
    });

    it("sitekey があれば Turnstile のトークンを付けて送る", async () => {
        vi.stubEnv("VITE_TURNSTILE_SITE_KEY", "sitekey-1");
        window.turnstile = {
            render: (_container, options) => {
                options.callback?.("token-1");
                return "widget-1";
            },
            remove: () => undefined,
        };
        const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
            Response.json({ error: "RATE_LIMITED" }, { status: 429 }),
        );
        vi.stubGlobal("fetch", fetchMock);
        render(<CreateRoomPage />);
        fireEvent.change(screen.getByPlaceholderText("プレイヤー名"), {
            target: { value: "Alice" },
        });
        fireEvent.click(screen.getByRole("button", { name: "部屋を作成する" }));

        await waitFor(() => expect(fetchMock).toHaveBeenCalled());
        const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
        expect(body.turnstileToken).toBe("token-1");
    });

    it("sitekey が無ければトークンを付けずに送る", async () => {
        const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
            Response.json({ error: "RATE_LIMITED" }, { status: 429 }),
        );
        vi.stubGlobal("fetch", fetchMock);
        render(<CreateRoomPage />);
        fireEvent.change(screen.getByPlaceholderText("プレイヤー名"), {
            target: { value: "Alice" },
        });
        fireEvent.click(screen.getByRole("button", { name: "部屋を作成する" }));

        await waitFor(() => expect(fetchMock).toHaveBeenCalled());
        const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
        expect(body).not.toHaveProperty("turnstileToken");
    });

    it("Turnstile で拒まれた 403 は、本文の英語ではなく再読み込みを促す", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () =>
                Response.json(
                    { error: "TURNSTILE_FAILED", message: "Turnstile verification failed" },
                    { status: 403 },
                ),
            ),
        );
        render(<CreateRoomPage />);
        fireEvent.change(screen.getByPlaceholderText("プレイヤー名"), {
            target: { value: "Alice" },
        });
        fireEvent.click(screen.getByRole("button", { name: "部屋を作成する" }));

        expect(await screen.findByText(/アクセスの確認に失敗しました/)).toBeTruthy();
    });

    it.each([
        ["TURNSTILE_REQUIRED", 403, /アクセスの確認に失敗しました/],
        ["TURNSTILE_NOT_CONFIGURED", 500, /^ルームの作成に失敗しました$/],
    ] as const)("%s は本文の英語ではなく日本語で伝える", async (error, status, expected) => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => Response.json({ error, message: "English reason" }, { status })),
        );
        render(<CreateRoomPage />);
        fireEvent.change(screen.getByPlaceholderText("プレイヤー名"), {
            target: { value: "Alice" },
        });
        fireEvent.click(screen.getByRole("button", { name: "部屋を作成する" }));

        expect(await screen.findByText(expected)).toBeTruthy();
    });

    it("確認を待つあいだに画面を離れたら、ルームを作らない", async () => {
        vi.stubEnv("VITE_TURNSTILE_SITE_KEY", "sitekey-1");
        let rendered = false;
        const removed: string[] = [];
        window.turnstile = {
            render: () => {
                rendered = true;
                return "widget-1";
            },
            remove: (id) => removed.push(id),
        };
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);
        const { unmount } = render(<CreateRoomPage />);
        fireEvent.change(screen.getByPlaceholderText("プレイヤー名"), {
            target: { value: "Alice" },
        });
        fireEvent.click(screen.getByRole("button", { name: "部屋を作成する" }));
        await waitFor(() => expect(rendered).toBe(true));

        unmount();
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0));
        });

        expect(fetchMock).not.toHaveBeenCalled();
        expect(removed).toEqual(["widget-1"]);
    });
});
