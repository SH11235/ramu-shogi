import type { RoomClient } from "@shogi/match-client";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "./ChatPanel";
import { ChatPanel } from "./ChatPanel";

function makeMockClient(overrides: Partial<RoomClient> = {}): RoomClient {
    return {
        join: vi.fn(),
        resume: vi.fn(),
        move: vi.fn(),
        resign: vi.fn(),
        chat: vi.fn(),
        useAnalysis: vi.fn(),
        ack: vi.fn(),
        sync: vi.fn(),
        ping: vi.fn(),
        subscribe: vi.fn(() => () => {}),
        disconnect: vi.fn(),
        getStatus: vi.fn(() => "connected" as const),
        ...overrides,
    };
}

const MESSAGES: ChatMessage[] = [
    { id: 0, seat: "b", name: "Alice", text: "こんにちは" },
    { id: 1, seat: "w", name: "Bob", text: "よろしくお願いします" },
];

describe("ChatPanel", () => {
    it("メッセージがないとき空状態テキストを表示する", () => {
        render(<ChatPanel messages={[]} client={null} canSend={false} />);
        expect(screen.getByText("まだメッセージはありません")).toBeTruthy();
    });

    it("メッセージ一覧を正しく表示する", () => {
        render(<ChatPanel messages={MESSAGES} client={null} canSend={false} />);
        expect(screen.getByText(/こんにちは/)).toBeTruthy();
        expect(screen.getByText(/よろしくお願いします/)).toBeTruthy();
        expect(screen.getByText(/▲ Alice/)).toBeTruthy();
        expect(screen.getByText(/△ Bob/)).toBeTruthy();
    });

    it("canSend=false のとき入力・送信ボタンが無効", () => {
        const client = makeMockClient();
        render(<ChatPanel messages={[]} client={client} canSend={false} />);
        const input = screen.getByPlaceholderText("メッセージ...") as HTMLInputElement;
        const button = screen.getByRole("button", { name: "送信" }) as HTMLButtonElement;
        expect(input.disabled).toBe(true);
        expect(button.disabled).toBe(true);
    });

    it("入力が空のとき送信ボタンが無効", () => {
        const client = makeMockClient();
        render(<ChatPanel messages={[]} client={client} canSend={true} />);
        const button = screen.getByRole("button", { name: "送信" }) as HTMLButtonElement;
        expect(button.disabled).toBe(true);
    });

    it("送信ボタンをクリックすると client.chat が呼ばれ入力がクリアされる", () => {
        const client = makeMockClient();
        render(<ChatPanel messages={[]} client={client} canSend={true} />);
        const input = screen.getByPlaceholderText("メッセージ...") as HTMLInputElement;
        fireEvent.change(input, { target: { value: "テストメッセージ" } });
        expect(input.value).toBe("テストメッセージ");
        fireEvent.click(screen.getByRole("button", { name: "送信" }));
        expect(client.chat).toHaveBeenCalledWith({ text: "テストメッセージ" });
        expect(input.value).toBe("");
    });

    it("Enter キーで送信される（IME変換中は除く）", () => {
        const client = makeMockClient();
        render(<ChatPanel messages={[]} client={client} canSend={true} />);
        const input = screen.getByPlaceholderText("メッセージ...");
        fireEvent.change(input, { target: { value: "Hello" } });
        fireEvent.keyDown(input, { key: "Enter", isComposing: false });
        expect(client.chat).toHaveBeenCalledWith({ text: "Hello" });
    });

    it("空白のみのテキストは送信されない", () => {
        const client = makeMockClient();
        render(<ChatPanel messages={[]} client={client} canSend={true} />);
        const input = screen.getByPlaceholderText("メッセージ...");
        fireEvent.change(input, { target: { value: "   " } });
        fireEvent.click(screen.getByRole("button", { name: "送信" }));
        expect(client.chat).not.toHaveBeenCalled();
    });
});
