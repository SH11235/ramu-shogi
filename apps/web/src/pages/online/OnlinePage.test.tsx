import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// @tanstack/react-router のモック
const mockNavigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
    Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
    useNavigate: () => mockNavigate,
    useLocation: () => ({ pathname: "/online" }),
}));

vi.mock("../../hooks/useAuthSession", () => ({
    useAuthSession: () => ({
        session: null,
        sessionError: null,
        isLoadingSession: false,
        refreshSession: vi.fn(),
    }),
}));

// @shogi/ui のモック（PositionPresetSelector と、HeaderNav が使う Popover 系）
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
        </select>
    ),
    Popover: ({ children }: { children: ReactNode }) => <>{children}</>,
    PopoverTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
    PopoverContent: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

// import はモック設定後
const { default: OnlinePage } = await import("./OnlinePage");

describe("OnlinePage", () => {
    beforeEach(() => {
        mockNavigate.mockClear();
    });

    it("見出しとボタンを表示する", () => {
        render(<OnlinePage />);
        expect(screen.getByRole("heading", { name: "オンライン対局" })).toBeTruthy();
        expect(screen.getByRole("button", { name: "部屋を作成する" })).toBeTruthy();
        expect(screen.getByRole("button", { name: "参加する" })).toBeTruthy();
    });

    it("「部屋を作成する」クリックで作成ページへ遷移する", () => {
        render(<OnlinePage />);
        fireEvent.click(screen.getByRole("button", { name: "部屋を作成する" }));
        expect(mockNavigate).toHaveBeenCalledWith({ to: "/online/create" });
    });

    it("ルームID が空のとき参加ボタンが無効", () => {
        render(<OnlinePage />);
        const joinButton = screen.getByRole("button", { name: "参加する" }) as HTMLButtonElement;
        expect(joinButton.disabled).toBe(true);
    });

    it("ルームID を入力して参加ボタンが有効になる", () => {
        render(<OnlinePage />);
        const input = screen.getByPlaceholderText("例: abc123") as HTMLInputElement;
        const joinButton = screen.getByRole("button", { name: "参加する" }) as HTMLButtonElement;
        expect(joinButton.disabled).toBe(true);
        fireEvent.change(input, { target: { value: "abc123" } });
        expect(joinButton.disabled).toBe(false);
    });

    it("参加時に roomId を含めて遷移する", async () => {
        render(<OnlinePage />);
        fireEvent.change(screen.getByPlaceholderText("例: abc123"), {
            target: { value: "abc123" },
        });
        fireEvent.click(screen.getByRole("button", { name: "参加する" }));
        await waitFor(() => {
            expect(mockNavigate).toHaveBeenCalledWith({
                to: "/online/$roomId",
                params: { roomId: "abc123" },
                search: { name: undefined, seat: undefined, mode: undefined },
            });
        });
    });

    it("Enter キーでも参加できる", async () => {
        render(<OnlinePage />);
        const input = screen.getByPlaceholderText("例: abc123");
        fireEvent.change(input, { target: { value: "room-enter" } });
        fireEvent.keyDown(input, { key: "Enter" });

        await waitFor(() => {
            expect(mockNavigate).toHaveBeenCalledWith({
                to: "/online/$roomId",
                params: { roomId: "room-enter" },
                search: { name: undefined, seat: undefined, mode: undefined },
            });
        });
    });
});
