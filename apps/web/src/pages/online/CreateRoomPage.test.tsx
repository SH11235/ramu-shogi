import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

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

// 本物の選択欄が SFEN 直接入力へ切り替えて入力欄が空のときに通知する "" を、選択肢として出す
vi.mock("@shogi/ui", () => ({
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
});
