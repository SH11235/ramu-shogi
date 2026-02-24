import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// @tanstack/react-router のモック
const mockNavigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
    useNavigate: () => mockNavigate,
}));

// @shogi/ui のモック（PositionPresetSelector を使用）
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
}));

// import はモック設定後
const { default: OnlinePage } = await import("./OnlinePage");

describe("OnlinePage", () => {
    beforeEach(() => {
        mockNavigate.mockClear();
    });

    it("見出しとボタンを表示する", () => {
        render(<OnlinePage />);
        expect(screen.getByText("オンライン対局")).toBeTruthy();
        expect(screen.getByRole("button", { name: "部屋を作成する" })).toBeTruthy();
        expect(screen.getByRole("button", { name: "参加する" })).toBeTruthy();
    });

    it("「部屋を作成する」クリックでフォームを表示する", () => {
        render(<OnlinePage />);
        fireEvent.click(screen.getByRole("button", { name: "部屋を作成する" }));
        expect(screen.getByText("対局設定")).toBeTruthy();
        expect(screen.getByPlaceholderText("プレイヤー名")).toBeTruthy();
    });

    it("作成フォームで名前が空のとき送信ボタンが無効", () => {
        render(<OnlinePage />);
        fireEvent.click(screen.getByRole("button", { name: "部屋を作成する" }));
        const submitButton = screen.getByRole("button", { name: "部屋を作成する" });
        expect((submitButton as HTMLButtonElement).disabled).toBe(true);
    });

    it("ルームID を入力して参加ボタンが有効になる", () => {
        render(<OnlinePage />);
        const input = screen.getByPlaceholderText("例: abc123") as HTMLInputElement;
        const joinButton = screen.getByRole("button", { name: "参加する" }) as HTMLButtonElement;
        expect(joinButton.disabled).toBe(true);
        fireEvent.change(input, { target: { value: "abc123" } });
        expect(joinButton.disabled).toBe(false);
    });

    it("API エラー時にエラーメッセージを表示する", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue({
                ok: false,
                json: () => Promise.resolve({ message: "レート制限に達しました" }),
            }),
        );
        render(<OnlinePage />);
        fireEvent.click(screen.getByRole("button", { name: "部屋を作成する" }));
        const nameInput = screen.getByPlaceholderText("プレイヤー名");
        fireEvent.change(nameInput, { target: { value: "テストユーザー" } });
        const createButtons = screen.getAllByRole("button", { name: "部屋を作成する" });
        fireEvent.click(createButtons[createButtons.length - 1]);
        await waitFor(() => {
            expect(screen.getByText("レート制限に達しました")).toBeTruthy();
        });
        vi.unstubAllGlobals();
    });
});
